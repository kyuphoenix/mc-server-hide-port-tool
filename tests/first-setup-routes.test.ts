import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import type { Bindings } from '../src/services/cloudflare-dns'
import {
  claimFirstSetup,
  getFirstSetupState
} from '../src/services/first-setup'
import {
  createTestD1,
  markFirstSetupCompleted,
  type TestD1
} from './helpers/d1'
import {
  AUTH_ORIGIN,
  sameOriginJsonHeaders
} from './helpers/auth'

const instances: TestD1[] = []

const validSetupBody = {
  name: 'Setup Admin',
  email: 'setup-admin@example.test',
  password: 'password123',
  confirm: 'password123'
}

async function setupOpen() {
  const instance = await createTestD1()
  instances.push(instance)
  const env: Bindings = {
    DB: instance.db,
    BETTER_AUTH_SECRET: 'test-secret-with-at-least-thirty-two-characters',
    BETTER_AUTH_URL: AUTH_ORIGIN,
    APP_NAME: 'Test App'
  } as unknown as Bindings
  return { db: instance.db, env }
}

async function postSetup(
  env: Bindings,
  body: Record<string, unknown> = validSetupBody,
  headers: Headers = sameOriginJsonHeaders()
): Promise<Response> {
  return await app.request(`${AUTH_ORIGIN}/api/auth/setup`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  }, env)
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>
}

async function counts(db: D1Database) {
  const [users, credentials] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM user').first<{ n: number }>(),
    db.prepare(
      "SELECT COUNT(*) AS n FROM account WHERE providerId = 'credential'"
    ).first<{ n: number }>()
  ])
  return {
    users: Number(users?.n ?? 0),
    credentials: Number(credentials?.n ?? 0)
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(instances.splice(0).map(({ dispose }) => dispose()))
})

describe('first setup route', { timeout: 30_000 }, () => {
  it.each([
    ['missing fields', { name: '', email: '', password: '', confirm: '' }],
    ['mismatched passwords', { ...validSetupBody, confirm: 'different-password' }],
    ['short password', { ...validSetupBody, password: 'short', confirm: 'short' }]
  ])('does not claim setup for %s', async (_label, body) => {
    const { db, env } = await setupOpen()
    const response = await postSetup(env, body)

    expect(response.status).toBe(400)
    expect(await getFirstSetupState(db)).toMatchObject({ status: 'open' })
    expect(await counts(db)).toEqual({ users: 0, credentials: 0 })
  })

  it('creates exactly one credential super administrator and completes setup', async () => {
    const { db, env } = await setupOpen()
    const response = await postSetup(env)
    const body = await jsonBody(response)

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ success: true })
    expect(['/','/login']).toContain(body.redirect)
    expect(await counts(db)).toEqual({ users: 1, credentials: 1 })
    expect(await db.prepare(
      'SELECT id, role, super_admin FROM user'
    ).first()).toEqual({ id: '1', role: 'admin', super_admin: 1 })
    expect(await getFirstSetupState(db)).toMatchObject({
      status: 'completed',
      claimedUserId: '1'
    })
  })

  it('allows at most one winner across five concurrent setup rounds', async () => {
    for (let round = 0; round < 5; round += 1) {
      const { db, env } = await setupOpen()
      const [first, second] = await Promise.all([
        postSetup(env, {
          ...validSetupBody,
          email: `setup-a-${round}@example.test`
        }),
        postSetup(env, {
          ...validSetupBody,
          email: `setup-b-${round}@example.test`
        })
      ])
      const bodies = await Promise.all([jsonBody(first), jsonBody(second)])
      const winners = bodies.filter((body) => body.success === true)
      const loser = bodies.find((body) => body.success === false)

      expect(winners).toHaveLength(1)
      expect(['SETUP_IN_PROGRESS', 'SETUP_DONE']).toContain(loser?.code)
      expect(await counts(db)).toEqual({ users: 1, credentials: 1 })
      expect(await db.prepare(
        'SELECT role, super_admin FROM user'
      ).first()).toEqual({ role: 'admin', super_admin: 1 })
      expect(await getFirstSetupState(db)).toMatchObject({ status: 'completed' })
    }
  })

  it('returns SETUP_DONE for completed setup without exposing user data', async () => {
    const { db, env } = await setupOpen()
    await markFirstSetupCompleted(db)
    const response = await postSetup(env)
    const text = await response.text()

    expect(response.status).toBe(400)
    expect(JSON.parse(text)).toMatchObject({ success: false, code: 'SETUP_DONE' })
    expect(text).not.toContain(validSetupBody.email)
    expect(text).not.toContain(validSetupBody.name)
  })

  it('returns SETUP_IN_PROGRESS without changing an active claim hash', async () => {
    const { db, env } = await setupOpen()
    await claimFirstSetup(db)
    const before = await db.prepare(
      'SELECT claim_token_hash FROM first_setup WHERE id = 1'
    ).first<{ claim_token_hash: string }>()

    const response = await postSetup(env)
    const body = await jsonBody(response)
    const after = await db.prepare(
      'SELECT claim_token_hash FROM first_setup WHERE id = 1'
    ).first<{ claim_token_hash: string }>()

    expect(response.status).toBe(409)
    expect(body).toMatchObject({ success: false, code: 'SETUP_IN_PROGRESS' })
    expect(after).toEqual(before)
    expect(await counts(db)).toEqual({ users: 0, credentials: 0 })
  })

  it('releases the claim immediately when user creation fails before insert', async () => {
    const { db, env } = await setupOpen()
    await db.prepare(
      `CREATE TRIGGER fail_setup_id_allocation
       BEFORE UPDATE ON user_id_counter
       BEGIN
         SELECT RAISE(ABORT, 'forced_setup_id_failure');
       END`
    ).run()

    const response = await postSetup(env)

    expect(response.status).toBe(500)
    expect(await jsonBody(response)).toMatchObject({
      success: false,
      code: 'SETUP_FAILED'
    })
    expect(await getFirstSetupState(db)).toMatchObject({ status: 'open' })
    expect(await counts(db)).toEqual({ users: 0, credentials: 0 })
  })

  it('deletes an orphan user and reopens setup when credential insertion fails', async () => {
    const { db, env } = await setupOpen()
    await db.prepare(
      `CREATE TRIGGER fail_setup_credential
       BEFORE INSERT ON account
       WHEN NEW.providerId = 'credential'
       BEGIN
         SELECT RAISE(ABORT, 'forced_setup_credential_failure');
       END`
    ).run()

    const response = await postSetup(env)

    expect(response.status).toBe(500)
    expect(await jsonBody(response)).toMatchObject({
      success: false,
      code: 'SETUP_FAILED'
    })
    expect(await getFirstSetupState(db)).toMatchObject({ status: 'open' })
    expect(await counts(db)).toEqual({ users: 0, credentials: 0 })
  })

  it('keeps the completed administrator when only automatic sign-in fails', async () => {
    const { db, env } = await setupOpen()
    await db.prepare(
      `CREATE TRIGGER fail_setup_session
       BEFORE INSERT ON session
       BEGIN
         SELECT RAISE(ABORT, 'forced_setup_session_failure');
       END`
    ).run()

    const response = await postSetup(env)
    const body = await jsonBody(response)

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ success: true, redirect: '/login' })
    expect(await counts(db)).toEqual({ users: 1, credentials: 1 })
    expect(await db.prepare(
      'SELECT role, super_admin FROM user'
    ).first()).toEqual({ role: 'admin', super_admin: 1 })
    expect(await getFirstSetupState(db)).toMatchObject({ status: 'completed' })
  })

  it('logs only allowlisted security events and returns only fixed errors', async () => {
    const { db, env } = await setupOpen()
    const privateValues = [
      'Private Setup Name',
      'private-setup@example.test',
      'private-password',
      'clear-token-private',
      'claim-hash-private',
      'private-cookie',
      '203.0.113.9',
      'private-user-agent',
      'private-stack'
    ]
    await db.prepare(
      `CREATE TRIGGER fail_private_setup_id
       BEFORE UPDATE ON user_id_counter
       BEGIN
         SELECT RAISE(ABORT, 'clear-token-private claim-hash-private private-stack');
       END`
    ).run()
    await db.prepare(
      `CREATE TRIGGER fail_private_setup_release
       BEFORE UPDATE ON first_setup
       WHEN OLD.status = 'claimed' AND NEW.status = 'open'
       BEGIN
         SELECT RAISE(ABORT, 'private-cookie 203.0.113.9 private-user-agent');
       END`
    ).run()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const headers = sameOriginJsonHeaders('csrf_token=test-csrf; private-cookie=secret')
    headers.set('user-agent', 'private-user-agent')
    headers.set('cf-connecting-ip', '203.0.113.9')

    const response = await postSetup(env, {
      name: privateValues[0],
      email: privateValues[1],
      password: privateValues[2],
      confirm: privateValues[2]
    }, headers)
    const responseText = await response.text()

    expect(response.status).toBe(500)
    expect(JSON.parse(responseText)).toMatchObject({
      success: false,
      code: 'SETUP_FAILED'
    })
    expect(errorSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
    for (const call of errorSpy.mock.calls) {
      expect(call).toHaveLength(1)
      const serialized = String(call[0])
      const event = JSON.parse(serialized) as Record<string, unknown>
      expect(Object.keys(event).sort()).toEqual(['code', 'event', 'stage', 'timestamp'])
      expect(event.event).toBe('first_setup_security')
      expect(['SETUP_FAILED']).toContain(event.code)
      for (const privateValue of privateValues) {
        expect(serialized).not.toContain(privateValue)
      }
    }
    for (const privateValue of privateValues) {
      expect(responseText).not.toContain(privateValue)
    }
  })
})
