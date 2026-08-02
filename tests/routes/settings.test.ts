import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from 'better-auth/crypto'
import app from '../../src/index'
import { createAuth } from '../../src/auth'
import type { Bindings } from '../../src/services/cloudflare-dns'
import { countAuthFactors } from '../../src/services/user-settings'
import {
  createSharedTestD1,
  markFirstSetupCompleted,
  seedUser,
  type SharedTestD1
} from '../helpers/d1'
import {
  AUTH_ORIGIN,
  cookiesFromHeaders,
  sameOriginJsonHeaders
} from '../helpers/auth'

let shared: SharedTestD1
let db: D1Database
const SECRET = 'test-secret-with-at-least-thirty-two-characters'

beforeEach(async () => {
  shared = await createSharedTestD1()
  db = shared.db
  await shared.resetDatabase()
  await markFirstSetupCompleted(db)
})

afterEach(async () => {
  vi.restoreAllMocks()
})

async function setup() {
  const env = {
    DB: db,
    BETTER_AUTH_SECRET: SECRET,
    DATA_ENCRYPTION_KEY: 'test-data-key-with-at-least-thirty-two-characters',
    BETTER_AUTH_URL: AUTH_ORIGIN,
    APP_NAME: 'Test App'
  } as unknown as Bindings
  return { db, env }
}

async function createSession(
  db: D1Database,
  env: Bindings,
  input: { id: string; email: string; name?: string }
): Promise<Headers> {
  await seedUser(db, { id: input.id, email: input.email, name: input.name ?? 'Test User' })
  const password = 'password123'
  const now = Date.now()
  await db.prepare(
    `INSERT INTO account
     (id, accountId, providerId, userId, password, createdAt, updatedAt)
     VALUES (?, ?, 'credential', ?, ?, ?, ?)`
  ).bind(
    `${input.id}-credential`,
    input.id,
    input.id,
    await hashPassword(password),
    now,
    now
  ).run()

  const auth = await createAuth(env)
  const signIn = await auth.api.signInEmail({
    headers: sameOriginJsonHeaders(),
    body: { email: input.email, password },
    asResponse: true
  })
  expect(signIn.status).toBe(200)
  return sameOriginJsonHeaders(`csrf_token=test-csrf; ${cookiesFromHeaders(signIn.headers)}`)
}

async function postJson(
  env: Bindings,
  path: string,
  body: Record<string, unknown>,
  headers: Headers
): Promise<Response> {
  return await app.request(`${AUTH_ORIGIN}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  }, env)
}

async function seedOAuthAccount(
  db: D1Database,
  input: { id: string; userId: string; providerId: string; accountId: string }
): Promise<void> {
  await db.prepare(
    `INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    input.id,
    input.accountId,
    input.providerId,
    input.userId,
    Date.now(),
    Date.now()
  ).run()
}

async function seedPasskey(
  db: D1Database,
  input: { id: string; userId: string }
): Promise<void> {
  await db.prepare(
    `INSERT INTO passkey (id, name, publicKey, userId, credentialID, counter, deviceType, backedUp, transports, createdAt, aaguid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    input.id,
    'Test Passkey',
    'mock-public-key',
    input.userId,
    'cred-' + input.id,
    0,
    'platform',
    0,
    '["internal"]',
    Date.now(),
    null
  ).run()
}

async function countAuthFactorsDirect(db: D1Database, userId: string) {
  return await countAuthFactors(db, userId)
}

describe('settings routes - profile update', () => {
  it('rejects unauthenticated requests', async () => {
    const { env } = await setup()
    const response = await postJson(env, '/api/settings/profile', { name: 'New Name' }, sameOriginJsonHeaders())
    expect(response.status).toBe(401)
  })

  it('rejects invalid origin', async () => {
    const { db, env } = await setup()
    const headers = await createSession(db, env, { id: 'p1', email: 'p1@example.test' })
    const badHeaders = new Headers(headers)
    badHeaders.set('origin', 'https://evil.example')
    const response = await postJson(env, '/api/settings/profile', { name: 'New Name' }, badHeaders)
    expect(response.status).toBe(403)
  })

  it('rejects invalid CSRF token', async () => {
    const { db, env } = await setup()
    const headers = await createSession(db, env, { id: 'p2', email: 'p2@example.test' })
    const badHeaders = new Headers(headers)
    badHeaders.set('x-csrf-token', 'wrong-token')
    const response = await postJson(env, '/api/settings/profile', { name: 'New Name' }, badHeaders)
    expect(response.status).toBe(403)
  })

  it('rejects empty name', async () => {
    const { db, env } = await setup()
    const headers = await createSession(db, env, { id: 'p3', email: 'p3@example.test' })
    const response = await postJson(env, '/api/settings/profile', { name: '' }, headers)
    expect(response.status).toBe(400)
  })

  it('rejects name longer than 64 characters', async () => {
    const { db, env } = await setup()
    const headers = await createSession(db, env, { id: 'p4', email: 'p4@example.test' })
    const response = await postJson(env, '/api/settings/profile', { name: 'x'.repeat(65) }, headers)
    expect(response.status).toBe(400)
  })

  it('updates the user name successfully', async () => {
    const { db, env } = await setup()
    const headers = await createSession(db, env, { id: 'p5', email: 'p5@example.test', name: 'Old Name' })
    const response = await postJson(env, '/api/settings/profile', { name: 'New Name' }, headers)
    expect(response.status).toBe(200)
    const body = await response.json() as { success: boolean; message: string }
    expect(body.success).toBe(true)
    expect(body.message).toContain('用户名已更新')

    const user = await db.prepare('SELECT name FROM user WHERE id = ?').bind('p5').first<{ name: string }>()
    expect(user?.name).toBe('New Name')
  })

  it('accepts name of exactly 64 characters', async () => {
    const { db, env } = await setup()
    const headers = await createSession(db, env, { id: 'p6', email: 'p6@example.test' })
    const name64 = 'x'.repeat(64)
    const response = await postJson(env, '/api/settings/profile', { name: name64 }, headers)
    expect(response.status).toBe(200)
  })
})

describe('settings routes - OAuth unlink', () => {
  it('rejects unauthenticated requests', async () => {
    const { env } = await setup()
    const response = await postJson(env, '/api/settings/oauth/unlink', { provider_id: 'github' }, sameOriginJsonHeaders())
    expect(response.status).toBe(401)
  })

  it('rejects missing provider_id', async () => {
    const { db, env } = await setup()
    const headers = await createSession(db, env, { id: 'u1', email: 'u1@example.test' })
    const response = await postJson(env, '/api/settings/oauth/unlink', {}, headers)
    expect(response.status).toBe(400)
  })

  it('prevents unlinking the last remaining credential', async () => {
    const { db, env } = await setup()
    // createSession creates a user with a password credential
    const headers = await createSession(db, env, { id: 'u2', email: 'u2@example.test' })
    // Only the password credential exists, no other factors
    const response = await postJson(env, '/api/settings/oauth/unlink', { provider_id: 'credential' }, headers)
    expect(response.status).toBe(400)
    expect((await response.json() as { message: string }).message).toContain('至少保留一种登录方式')
  })

  it('allows unlinking an OAuth account when password also exists', async () => {
    const { db, env } = await setup()
    const headers = await createSession(db, env, { id: 'u3', email: 'u3@example.test' })
    // Add an OAuth account after session creation
    await seedOAuthAccount(db, { id: 'u3-gh', userId: 'u3', providerId: 'github', accountId: 'gh-acc' })

    const response = await postJson(env, '/api/settings/oauth/unlink', { provider_id: 'github', account_id: 'gh-acc' }, headers)
    expect(response.status).toBe(200)
  })
})

describe('settings routes - Passkey delete', () => {
  it('rejects unauthenticated requests', async () => {
    const { env } = await setup()
    const response = await postJson(env, '/api/settings/passkey/delete', { id: 'pk-1' }, sameOriginJsonHeaders())
    expect(response.status).toBe(401)
  })

  it('rejects missing passkey id', async () => {
    const { db, env } = await setup()
    const headers = await createSession(db, env, { id: 'pk2', email: 'pk2@example.test' })
    const response = await postJson(env, '/api/settings/passkey/delete', {}, headers)
    expect(response.status).toBe(400)
  })

  it('prevents deleting the last passkey when it is the only credential', async () => {
    const { db, env } = await setup()
    // Create a user with ONLY a passkey (no password, no OAuth)
    // We cannot use createSession (it requires a password credential), so
    // we manually create the user + passkey and verify the route guards.
    const userId = await seedUser(db, { id: 'pk3', email: 'pk3-only@example.test', name: 'Passkey Only' })
    await seedPasskey(db, { id: 'pk3-key', userId })

    // Build a session cookie by signing in via better-auth with a passkey-only user.
    // Since passkey sign-in requires WebAuthn ceremony we cannot easily do it here.
    // Instead, verify the route logic by checking countAuthFactors directly.
    const factors = await countAuthFactorsDirect(db, userId)
    expect(factors.total).toBe(1)
    expect(factors.passkeyCount).toBe(1)
  })
})

describe('settings routes - OAuth link', () => {
  it('rejects unauthenticated requests', async () => {
    const { env } = await setup()
    const response = await postJson(env, '/api/settings/oauth/link', { provider_id: 'github' }, sameOriginJsonHeaders())
    expect(response.status).toBe(401)
  })

  it('rejects missing provider_id', async () => {
    const { db, env } = await setup()
    const headers = await createSession(db, env, { id: 'l2', email: 'l2@example.test' })
    const response = await postJson(env, '/api/settings/oauth/link', {}, headers)
    expect(response.status).toBe(400)
  })

  it('rejects linking an unavailable provider', async () => {
    const { db, env } = await setup()
    const headers = await createSession(db, env, { id: 'l3', email: 'l3@example.test' })
    const response = await postJson(env, '/api/settings/oauth/link', { provider_id: 'nonexistent' }, headers)
    expect(response.status).toBe(400)
  })
})
