import { afterEach, describe, expect, it } from 'vitest'
import { hashPassword } from 'better-auth/crypto'
import app from '../src/index'
import { createAuth } from '../src/auth'
import {
  listAllRecords,
  listRecentRecordsByUser,
  searchUsers
} from '../src/services/dns-records'
import type { Bindings } from '../src/services/cloudflare-dns'
import {
  createTestD1,
  disposeTestD1Instances,
  markFirstSetupCompleted,
  seedUser,
  type TestD1
} from './helpers/d1'
import {
  AUTH_ORIGIN,
  cookiesFromHeaders,
  sameOriginJsonHeaders
} from './helpers/auth'

const instances: TestD1[] = []
const SECRET = 'test-secret-with-at-least-thirty-two-characters'

async function setup() {
  const instance = await createTestD1()
  instances.push(instance)
  await markFirstSetupCompleted(instance.db)
  const env = {
    DB: instance.db,
    BETTER_AUTH_SECRET: SECRET,
    DATA_ENCRYPTION_KEY: 'test-data-key-with-at-least-thirty-two-characters',
    BETTER_AUTH_URL: AUTH_ORIGIN,
    APP_NAME: 'Test App',
    DOMAINS: 'example.test'
  } as unknown as Bindings
  return { db: instance.db, env }
}

async function createAdminSession(
  db: D1Database,
  env: Bindings,
  input: { id: string; email: string; superAdmin: boolean }
): Promise<Headers> {
  await seedUser(db, { id: input.id, email: input.email, name: 'Route Admin' })
  await db.prepare(
    "UPDATE user SET role = 'admin', super_admin = ? WHERE id = ?"
  ).bind(input.superAdmin ? 1 : 0, input.id).run()

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

afterEach(async () => {
  await disposeTestD1Instances(instances)
})

describe('production route hardening', () => {
  it('adds browser security headers and prevents API caching', async () => {
    const { env } = await setup()

    const page = await app.request(`${AUTH_ORIGIN}/login`, {}, env)
    expect(page.headers.get('x-content-type-options')).toBe('nosniff')
    expect(page.headers.get('x-frame-options')).toBe('DENY')
    expect(page.headers.get('referrer-policy')).toBe('no-referrer')
    expect(page.headers.get('strict-transport-security')).toContain('max-age=31536000')
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    const csp = page.headers.get('content-security-policy') || ''
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("style-src 'self'")
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toContain('cdn.tailwindcss.com')
    expect(await page.text()).toContain('<link rel="stylesheet" href="/static/app.css" />')

    const api = await app.request(`${AUTH_ORIGIN}/api/pages/login`, {}, env)
    expect(api.headers.get('cache-control')).toBe('no-store')
    expect(api.headers.get('pragma')).toBe('no-cache')

    const httpPage = await app.request('http://app.example/login', {}, env)
    expect(httpPage.headers.get('strict-transport-security')).toBeNull()
  })

  it.each([
    ['/api/admin/settings', {}],
    ['/api/admin/oauth/create', {}],
    ['/api/admin/oauth/provider-id/update', {}],
    ['/api/admin/oauth/provider-id/toggle', { enabled: true }],
    ['/api/admin/oauth/provider-id/delete', {}],
    ['/api/admin/mail/test', { to_email: 'recipient@example.test' }]
  ])('requires a super administrator for %s', async (path, body) => {
    const { db, env } = await setup()
    const headers = await createAdminSession(db, env, {
      id: 'regular-admin',
      email: 'regular-admin@example.test',
      superAdmin: false
    })

    const response = await postJson(env, path, body, headers)
    expect(response.status).toBe(403)
  })

  it('does not expose Better Auth errors when an admin creates a duplicate user', async () => {
    const { db, env } = await setup()
    const headers = await createAdminSession(db, env, {
      id: 'super-admin',
      email: 'super-admin@example.test',
      superAdmin: true
    })
    await seedUser(db, { id: 'existing-user', email: 'duplicate@example.test' })
    await db.prepare(
      "UPDATE user SET role = 'user', super_admin = 0 WHERE id = 'existing-user'"
    ).run()

    const response = await postJson(env, '/api/admin/users/create', {
      name: 'Duplicate',
      email: 'duplicate@example.test',
      password: 'password123',
      role: 'user'
    }, headers)
    const text = await response.text()

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(text).toContain('该邮箱已注册')
    expect(text).not.toContain('USER_ALREADY_EXISTS')
    expect(text).not.toContain('stack')
  })

  it('enforces hard limits on UI-facing record and user lists', async () => {
    const { db } = await setup()
    await seedUser(db, { id: 'owner', email: 'owner@example.test' })
    const now = Date.now()
    for (let i = 0; i < 4; i++) {
      await db.prepare(
        `INSERT INTO dns_record
         (id, user_id, root_domain, subdomain, host_name, server_address, port,
          target_type, target_record_id, srv_record_id, created_at)
         VALUES (?, 'owner', 'example.test', ?, ?, '198.51.100.10', 25565,
          'A', ?, NULL, ?)`
      ).bind(`record-${i}`, `host-${i}`, `host-${i}.example.test`, `target-${i}`, now + i).run()
    }
    for (let i = 0; i < 4; i++) {
      await seedUser(db, { id: `user-${i}`, email: `user-${i}@example.test` })
    }

    expect(await listRecentRecordsByUser(db, 'owner', 2)).toHaveLength(2)
    expect(await listAllRecords(db, 3)).toHaveLength(3)
    expect(await searchUsers(db, { limit: 2 })).toHaveLength(2)
  })
})
