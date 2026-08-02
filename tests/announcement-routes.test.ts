import { beforeEach, describe, expect, it } from 'vitest'
import { hashPassword } from 'better-auth/crypto'
import app from '../src/index'
import { createAuth } from '../src/auth'
import type { Bindings } from '../src/services/cloudflare-dns'
import {
  createSharedTestD1,
  markFirstSetupCompleted,
  seedUser,
  type SharedTestD1
} from './helpers/d1'
import {
  AUTH_ORIGIN,
  cookiesFromHeaders,
  sameOriginJsonHeaders
} from './helpers/auth'

const SECRET = 'test-secret-with-at-least-thirty-two-characters'

let shared: SharedTestD1
let db: D1Database

beforeEach(async () => {
  shared = await createSharedTestD1()
  db = shared.db
  await shared.resetDatabase()
  await markFirstSetupCompleted(db)
})

function setup() {
  const env = {
    DB: db,
    BETTER_AUTH_SECRET: SECRET,
    DATA_ENCRYPTION_KEY: 'test-data-key-with-at-least-thirty-two-characters',
    BETTER_AUTH_URL: AUTH_ORIGIN,
    APP_NAME: 'Test App',
    DOMAINS: 'example.test'
  } as unknown as Bindings
  return { db, env }
}

async function createSession(
  db: D1Database,
  env: Bindings,
  input: { id: string; email: string; role: 'user' | 'admin' }
): Promise<Headers> {
  await seedUser(db, { id: input.id, email: input.email, name: 'Announcement User' })
  await db.prepare('UPDATE user SET role = ? WHERE id = ?').bind(input.role, input.id).run()

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

describe('announcement routes', () => {
  it('returns null publicly while disabled', async () => {
    const { env } = setup()

    const response = await app.request(`${AUTH_ORIGIN}/api/announcement/current`, {}, env)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: { announcement: null }
    })
  })

  it('allows a normal administrator to publish and exposes only public fields', async () => {
    const { db, env } = setup()
    const headers = await createSession(db, env, {
      id: 'announcement-admin',
      email: 'announcement-admin@example.test',
      role: 'admin'
    })

    const published = await postJson(env, '/api/admin/announcement', {
      enabled: true,
      title: ' 服务更新 ',
      content: ' 第一行\n第二行 '
    }, headers)
    expect(published.status).toBe(200)
    const publishedBody = await published.json() as any
    expect(publishedBody).toMatchObject({
      success: true,
      data: {
        announcement: {
          enabled: true,
          title: '服务更新',
          content: '第一行\n第二行',
          version: 1,
          updatedBy: 'announcement-admin'
        }
      }
    })

    const current = await app.request(`${AUTH_ORIGIN}/api/announcement/current`, {}, env)
    const currentBody = await current.json() as any
    expect(currentBody.data.announcement).toMatchObject({
      title: '服务更新',
      content: '第一行\n第二行',
      contentHtml: '<p>第一行<br />第二行</p>\n',
      version: 1
    })
    expect(currentBody.data.announcement).not.toHaveProperty('enabled')
    expect(currentBody.data.announcement).not.toHaveProperty('updatedBy')

    const republished = await postJson(env, '/api/admin/announcement', {
      enabled: true,
      title: '服务更新',
      content: '第一行\n第二行'
    }, headers)
    expect(await republished.json()).toMatchObject({
      success: true,
      data: { announcement: { version: 2 } }
    })
  })

  it('rejects regular users and requests without CSRF proof', async () => {
    const { db, env } = setup()
    const userHeaders = await createSession(db, env, {
      id: 'announcement-user',
      email: 'announcement-user@example.test',
      role: 'user'
    })

    const forbidden = await postJson(env, '/api/admin/announcement', {
      enabled: false,
      title: '',
      content: ''
    }, userHeaders)
    expect(forbidden.status).toBe(403)

    const noCsrf = await app.request(`${AUTH_ORIGIN}/api/admin/announcement`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false, title: '', content: '' })
    }, env)
    expect(noCsrf.status).toBe(403)
  })

  it('returns validation messages and includes announcement data in the admin tab payload', async () => {
    const { db, env } = setup()
    const headers = await createSession(db, env, {
      id: 'announcement-admin-2',
      email: 'announcement-admin-2@example.test',
      role: 'admin'
    })

    const invalid = await postJson(env, '/api/admin/announcement', {
      enabled: true,
      title: '通知',
      content: ''
    }, headers)
    expect(invalid.status).toBe(400)
    expect(await invalid.text()).toContain('公告内容不能为空')

    const page = await app.request(`${AUTH_ORIGIN}/api/pages/admin?tab=announcement`, {
      headers
    }, env)
    expect(page.status).toBe(200)
    expect(await page.json()).toMatchObject({
      success: true,
      data: {
        activeTab: 'announcement',
        announcement: {
          enabled: false,
          version: 0
        }
      }
    })
  })
})
