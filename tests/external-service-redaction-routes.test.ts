import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from 'better-auth/crypto'
import app from '../src/index'
import { createAuth } from '../src/auth'
import { findRecordById, insertRecord } from '../src/services/dns-records'
import { updateSettings } from '../src/services/settings'
import { sensitiveDataKeysFromEnv } from '../src/services/sensitive-data'
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

const PRIVATE_VALUES = [
  'CF_PRIVATE_BODY',
  'RESEND_PRIVATE_BODY',
  'cf-secret-token',
  'resend-secret-key',
  'example_test_CLOUDFLARE_API_TOKEN',
  'DOMAINS',
  'sender-private@example.test',
  'recipient-private@example.test',
  'private-cookie',
  '203.0.113.44',
  'private-user-agent',
  'private-stack'
]

async function setup(extraEnv: Partial<Bindings> = {}) {
  const instance = await createTestD1()
  instances.push(instance)
  await markFirstSetupCompleted(instance.db)
  await seedUser(instance.db, {
    id: 'admin-user',
    email: 'admin@example.test',
    name: 'Fixture Admin'
  })
  const env = {
    DB: instance.db,
    BETTER_AUTH_SECRET: 'test-secret-with-at-least-thirty-two-characters',
    DATA_ENCRYPTION_KEY: 'test-data-key-with-at-least-thirty-two-characters',
    BETTER_AUTH_URL: AUTH_ORIGIN,
    APP_NAME: 'Test App',
    DOMAINS: 'example.test',
    example_test_CLOUDFLARE_API_TOKEN: 'cf-secret-token',
    ...extraEnv
  } as unknown as Bindings
  return { db: instance.db, env }
}

async function adminHeaders(db: D1Database, env: Bindings): Promise<Headers> {
  const password = 'password123'
  const now = Date.now()
  await db.prepare(
    `INSERT INTO account
     (id, accountId, providerId, userId, password, createdAt, updatedAt)
     VALUES (?, ?, 'credential', ?, ?, ?, ?)`
  ).bind(
    'admin-user-credential',
    'admin-user',
    'admin-user',
    await hashPassword(password),
    now,
    now
  ).run()
  const auth = await createAuth(env)
  const signIn = await auth.api.signInEmail({
    headers: sameOriginJsonHeaders(),
    body: { email: 'admin@example.test', password },
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

async function seedDnsRecord(db: D1Database, userId = 'admin-user') {
  return await insertRecord(db, {
    id: 'record-one',
    user_id: userId,
    root_domain: 'example.test',
    subdomain: 'play',
    host_name: 'play.example.test',
    server_address: '198.51.100.10',
    port: 25565,
    target_type: 'A',
    target_record_id: 'target-record-id',
    srv_record_id: 'srv-record-id'
  })
}

function mockCloudflareFailure(failingMethod: 'POST' | 'PUT' | 'DELETE') {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url
    const method = String(init?.method ?? 'GET').toUpperCase()
    if (url.includes('/zones?')) {
      return Response.json({ success: true, result: [{ id: 'zone-id' }] })
    }
    if (url.includes('/dns_records?')) {
      return Response.json({ success: true, result: [] })
    }
    if (method === failingMethod) {
      return Response.json({
        success: false,
        errors: [{ message: 'CF_PRIVATE_BODY cf-secret-token example_test_CLOUDFLARE_API_TOKEN private-stack' }]
      }, { status: 500 })
    }
    return Response.json({ success: true, result: { id: `${method.toLowerCase()}-record-id` } })
  })
}

function mockCloudflareDeleteNotFound() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url
    if (url.includes('/zones?')) {
      return Response.json({ success: true, result: [{ id: 'zone-id' }] })
    }
    if (url.includes('/dns_records?')) {
      return Response.json({ success: true, result: [] })
    }
    return Response.json({ success: false, result: null }, { status: 404 })
  })
}

function mockResendFailure() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url
    if (url === 'https://api.resend.com/emails') {
      return new Response(
        JSON.stringify({
          message: 'RESEND_PRIVATE_BODY resend-secret-key sender-private@example.test recipient-private@example.test'
        }),
        { status: 422, headers: { 'content-type': 'application/json' } }
      )
    }
    return new Response('not found', { status: 404 })
  })
}

function assertNoPrivateText(text: string) {
  for (const value of PRIVATE_VALUES) {
    expect(text).not.toContain(value)
  }
}

function parsedSecurityEvents(errorSpy: { mock: { calls: unknown[][] } }): Array<Record<string, unknown>> {
  return errorSpy.mock.calls.map((call) => {
    expect(call).toHaveLength(1)
    return JSON.parse(String(call[0])) as Record<string, unknown>
  })
}

afterEach(async () => {
  vi.restoreAllMocks()
  await disposeTestD1Instances(instances)
})

describe('external service error redaction', { timeout: 60_000 }, () => {
  it('redacts DNS config details from create responses', async () => {
    const { db, env } = await setup({ DOMAINS: '' } as Partial<Bindings>)
    const headers = await adminHeaders(db, env)
    const response = await postJson(env, '/api/create-dns', {
      subdomain: 'play',
      rootDomain: 'example.test',
      serverAddress: '198.51.100.10',
      port: 25565
    }, headers)
    const text = await response.text()

    expect(response.status).toBe(500)
    expect(text).toContain('DNS 配置暂不可用，请联系管理员')
    assertNoPrivateText(text)
  })

  it('redacts and logs Cloudflare create failures', async () => {
    const { db, env } = await setup()
    const headers = await adminHeaders(db, env)
    mockCloudflareFailure('POST')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await postJson(env, '/api/create-dns', {
      subdomain: 'play',
      rootDomain: 'example.test',
      serverAddress: '198.51.100.10',
      port: 25565
    }, headers)
    const text = await response.text()

    expect(response.status).toBe(500)
    expect(text).toContain('DNS 服务暂时不可用，请稍后重试')
    assertNoPrivateText(text)
    const events = parsedSecurityEvents(errorSpy)
    expect(events.some((event) => event.event === 'dns_external_service_failed')).toBe(true)
    for (const event of events) {
      expect(Object.keys(event).sort()).toEqual(['code', 'event', 'retriable', 'service', 'stage', 'status', 'timestamp'])
      expect(event.service).toBe('cloudflare_dns')
      assertNoPrivateText(JSON.stringify(event))
    }
  })

  it('rejects a DNS name already occupied in Cloudflare when no local record exists', async () => {
    const { db, env } = await setup()
    const headers = await adminHeaders(db, env)
    const createMethods: string[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
      const method = String(init?.method ?? 'GET').toUpperCase()

      if (url.includes('/zones?')) {
        return Response.json({ success: true, result: [{ id: 'zone-id' }] })
      }
      if (url.includes('/dns_records?')) {
        const name = new URL(url).searchParams.get('name.exact')
        return Response.json({
          success: true,
          result: name === 'play.example.test'
            ? [{
                id: 'existing-remote-record',
                name: 'play.example.test',
                type: 'A',
                content: '198.51.100.99'
              }]
            : []
        })
      }

      createMethods.push(method)
      return new Response('not found', { status: 404 })
    })

    const response = await postJson(env, '/api/create-dns', {
      subdomain: 'play',
      rootDomain: 'example.test',
      serverAddress: '198.51.100.10',
      port: 25565
    }, headers)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toMatchObject({
      success: false,
      code: 'record_occupied',
      message: '域名 play.example.test 已被占用，请换一个子域名'
    })
    expect(createMethods).toEqual([])
    expect(await db.prepare(
      "SELECT COUNT(*) AS count FROM dns_record WHERE host_name = 'play.example.test'"
    ).first()).toEqual({ count: 0 })
  })

  it('creates a proxied plain DNS record without SRV', async () => {
    const { db, env } = await setup()
    const headers = await adminHeaders(db, env)
    const lookupNames: string[] = []
    const recordBodies: Record<string, unknown>[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
      const method = String(init?.method ?? 'GET').toUpperCase()

      if (url.includes('/zones?')) {
        return Response.json({ success: true, result: [{ id: 'zone-id' }] })
      }
      if (url.includes('/dns_records?')) {
        lookupNames.push(new URL(url).searchParams.get('name.exact') || '')
        return Response.json({ success: true, result: [] })
      }
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        recordBodies.push(body)
        return Response.json({
          success: true,
          result: { id: 'plain-target', name: body.name, type: body.type, content: body.content }
        })
      }
      return new Response('not found', { status: 404 })
    })

    const response = await postJson(env, '/api/create-dns', {
      mode: 'dns',
      subdomain: 'www',
      rootDomain: 'example.test',
      recordType: 'A',
      serverAddress: '198.51.100.20',
      proxied: true,
      remark: 'Frontend entry'
    }, headers)
    const body = await response.json() as { record?: Record<string, unknown> }

    expect(response.status).toBe(200)
    expect(lookupNames).toEqual(['www.example.test'])
    expect(recordBodies).toEqual([{
      type: 'A',
      name: 'www.example.test',
      content: '198.51.100.20',
      ttl: 1,
      proxied: true
    }])
    expect(body.record).toMatchObject({
      record_mode: 'dns',
      target_type: 'A',
      proxied: 1,
      srv_record_id: null,
      port: 0,
      remark: 'Frontend entry'
    })
    expect(await db.prepare(
      `SELECT record_mode, target_type, proxied, srv_record_id, port, remark
       FROM dns_record WHERE host_name = ?`
    ).bind('www.example.test').first()).toEqual({
      record_mode: 'dns',
      target_type: 'A',
      proxied: 1,
      srv_record_id: null,
      port: 0,
      remark: 'Frontend entry'
    })
  })

  it('creates a plain TXT record without proxy or SRV', async () => {
    const { db, env } = await setup()
    const headers = await adminHeaders(db, env)
    const lookupNames: string[] = []
    const recordBodies: Record<string, unknown>[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
      const method = String(init?.method ?? 'GET').toUpperCase()

      if (url.includes('/zones?')) {
        return Response.json({ success: true, result: [{ id: 'zone-id' }] })
      }
      if (url.includes('/dns_records?')) {
        lookupNames.push(new URL(url).searchParams.get('name.exact') || '')
        return Response.json({ success: true, result: [] })
      }
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        recordBodies.push(body)
        return Response.json({
          success: true,
          result: { id: 'txt-target', name: body.name, type: body.type, content: body.content }
        })
      }
      return new Response('not found', { status: 404 })
    })

    const response = await postJson(env, '/api/create-dns', {
      mode: 'dns',
      subdomain: '_acme-challenge',
      rootDomain: 'example.test',
      recordType: 'TXT',
      serverAddress: 'Token=MixedCase123',
      proxied: true,
      remark: 'ACME validation'
    }, headers)
    const body = await response.json() as { record?: Record<string, unknown> }

    expect(response.status).toBe(200)
    expect(lookupNames).toEqual(['_acme-challenge.example.test'])
    expect(recordBodies).toEqual([{
      type: 'TXT',
      name: '_acme-challenge.example.test',
      content: 'Token=MixedCase123',
      ttl: 1
    }])
    expect(body.record).toMatchObject({
      record_mode: 'dns',
      target_type: 'TXT',
      proxied: 0,
      srv_record_id: null,
      port: 0,
      remark: 'ACME validation'
    })
    expect(await db.prepare(
      `SELECT server_address, record_mode, target_type, proxied, srv_record_id, port, remark
       FROM dns_record WHERE host_name = ?`
    ).bind('_acme-challenge.example.test').first()).toEqual({
      server_address: 'Token=MixedCase123',
      record_mode: 'dns',
      target_type: 'TXT',
      proxied: 0,
      srv_record_id: null,
      port: 0,
      remark: 'ACME validation'
    })
  })

  it('creates a plain SRV record without Minecraft helper records', async () => {
    const { db, env } = await setup()
    const headers = await adminHeaders(db, env)
    const lookupNames: string[] = []
    const recordBodies: Record<string, unknown>[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
      const method = String(init?.method ?? 'GET').toUpperCase()

      if (url.includes('/zones?')) {
        return Response.json({ success: true, result: [{ id: 'zone-id' }] })
      }
      if (url.includes('/dns_records?')) {
        lookupNames.push(new URL(url).searchParams.get('name.exact') || '')
        return Response.json({ success: true, result: [] })
      }
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        recordBodies.push(body)
        return Response.json({
          success: true,
          result: { id: 'srv-target', name: body.name, type: body.type }
        })
      }
      return new Response('not found', { status: 404 })
    })

    const response = await postJson(env, '/api/create-dns', {
      mode: 'dns',
      subdomain: '_sip._tcp.voice',
      rootDomain: 'example.test',
      recordType: 'SRV',
      serverAddress: 'target.example.com',
      port: 5060,
      proxied: true,
      remark: 'Voice service'
    }, headers)
    const body = await response.json() as { record?: Record<string, unknown> }

    expect(response.status).toBe(200)
    expect(lookupNames).toEqual(['_sip._tcp.voice.example.test'])
    expect(recordBodies).toEqual([{
      type: 'SRV',
      name: '_sip._tcp.voice.example.test',
      ttl: 1,
      data: { priority: 0, weight: 5, port: 5060, target: 'target.example.com' }
    }])
    expect(body.record).toMatchObject({
      record_mode: 'dns',
      target_type: 'SRV',
      proxied: 0,
      srv_record_id: null,
      port: 5060,
      remark: 'Voice service'
    })
    expect(await db.prepare(
      `SELECT server_address, record_mode, target_type, proxied, srv_record_id, port, remark
       FROM dns_record WHERE host_name = ?`
    ).bind('_sip._tcp.voice.example.test').first()).toEqual({
      server_address: 'target.example.com',
      record_mode: 'dns',
      target_type: 'SRV',
      proxied: 0,
      srv_record_id: null,
      port: 5060,
      remark: 'Voice service'
    })
  })

  it('updates a record remark without calling Cloudflare', async () => {
    const { db, env } = await setup()
    const headers = await adminHeaders(db, env)
    await seedDnsRecord(db)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected Cloudflare call'))

    const response = await postJson(env, '/api/dns/record-one/update', {
      mode: 'mc',
      serverAddress: '198.51.100.10',
      port: 25565,
      remark: 'Primary survival server'
    }, headers)
    const body = await response.json() as { record?: Record<string, unknown>; message?: string }

    expect(response.status).toBe(200)
    expect(body.message).toBe('备注已更新')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(body.record).toMatchObject({
      id: 'record-one',
      remark: 'Primary survival server'
    })
    expect(await db.prepare(
      'SELECT remark, pending_remark FROM dns_record WHERE id = ?'
    ).bind('record-one').first()).toEqual({
      remark: 'Primary survival server',
      pending_remark: null
    })
  })

  it('persists and resumes a partially-created DNS record', async () => {
    const { db, env } = await setup()
    const headers = await adminHeaders(db, env)
    let postCount = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const method = String(init?.method ?? 'GET').toUpperCase()
      if (url.includes('/zones?')) return Response.json({ success: true, result: [{ id: 'zone-id' }] })
      if (url.includes('/dns_records?')) return Response.json({ success: true, result: [] })
      if (method === 'POST') {
        postCount += 1
        if (postCount === 1) return Response.json({ success: true, result: { id: 'durable-target', name: 'play.example.test', type: 'A' } })
        return Response.json({ success: false, errors: [{ message: 'temporary failure' }] }, { status: 500 })
      }
      return new Response('not found', { status: 404 })
    })

    const failed = await postJson(env, '/api/create-dns', {
      subdomain: 'play',
      rootDomain: 'example.test',
      serverAddress: '198.51.100.10',
      port: 25565
    }, headers)
    expect(failed.status).toBe(500)

    const pending = await db.prepare(
      `SELECT id, sync_status, sync_error_code, target_record_id, srv_record_id
       FROM dns_record WHERE host_name = ?`
    ).bind('play.example.test').first<{
      id: string
      sync_status: string
      sync_error_code: string | null
      target_record_id: string
      srv_record_id: string | null
    }>()
    expect(pending).toMatchObject({
      sync_status: 'error',
      sync_error_code: 'CLOUDFLARE_REQUEST_FAILED',
      target_record_id: 'durable-target',
      srv_record_id: null
    })

    vi.restoreAllMocks()
    let putCount = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const method = String(init?.method ?? 'GET').toUpperCase()
      if (url.includes('/zones?')) return Response.json({ success: true, result: [{ id: 'zone-id' }] })
      if (url.includes('/dns_records?')) {
        const name = new URL(url).searchParams.get('name.exact')
        return Response.json({
          success: true,
          result: name === 'play.example.test'
            ? [{ id: 'durable-target', name: 'play.example.test', type: 'A', content: '198.51.100.99' }]
            : []
        })
      }
      if (method === 'PUT') {
        putCount += 1
        return Response.json({ success: true, result: { id: 'durable-target', name: 'play.example.test', type: 'A', content: '198.51.100.10' } })
      }
      if (method === 'POST') {
        return Response.json({ success: true, result: { id: 'durable-srv', name: '_minecraft._tcp.play.example.test', type: 'SRV' } })
      }
      return new Response('not found', { status: 404 })
    })

    const retried = await postJson(env, '/api/create-dns', {
      subdomain: 'play',
      rootDomain: 'example.test',
      serverAddress: '198.51.100.10',
      port: 25565
    }, headers)
    expect(retried.status).toBe(200)
    expect(putCount).toBe(1)
    const active = await findRecordById(db, pending!.id)
    expect(active).toMatchObject({
      sync_status: 'active',
      sync_error_code: null,
      target_record_id: 'durable-target',
      srv_record_id: 'durable-srv'
    })
  })

  it('redacts Cloudflare update and delete failures', async () => {
    const { db, env } = await setup()
    const headers = await adminHeaders(db, env)
    await seedDnsRecord(db)

    mockCloudflareFailure('PUT')
    const updateResponse = await postJson(env, '/api/dns/record-one/update', {
      serverAddress: '198.51.100.11',
      port: 25566
    }, headers)
    const updateText = await updateResponse.text()

    expect(updateResponse.status).toBe(500)
    expect(updateText).toContain('DNS 服务暂时不可用，请稍后重试')
    assertNoPrivateText(updateText)
    expect(await findRecordById(db, 'record-one')).toMatchObject({
      sync_status: 'error',
      sync_error_code: 'CLOUDFLARE_REQUEST_FAILED',
      server_address: '198.51.100.10',
      pending_server_address: '198.51.100.11',
      pending_port: 25566,
      pending_target_type: 'A'
    })

    vi.restoreAllMocks()
    mockCloudflareFailure('DELETE')
    const deleteErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const deleteResponse = await postJson(env, '/api/dns/record-one/delete', {}, headers)
    const deleteText = await deleteResponse.text()
    expect(deleteResponse.status).toBe(500)
    expect(deleteText).toContain('DNS 请求处理失败，请稍后重试')
    expect(await findRecordById(db, 'record-one')).not.toBeNull()
    assertNoPrivateText(deleteText)
    const events = parsedSecurityEvents(deleteErrorSpy)
    expect(events.some((event) => event.stage === 'record_delete')).toBe(true)
    for (const event of events) assertNoPrivateText(JSON.stringify(event))

  })
  it('keeps the D1 row when the Cloudflare token is missing', async () => {
    const { db, env } = await setup({
      example_test_CLOUDFLARE_API_TOKEN: ''
    } as Partial<Bindings>)
    const headers = await adminHeaders(db, env)
    await seedDnsRecord(db)

    const response = await postJson(env, '/api/dns/record-one/delete', {}, headers)

    expect(response.status).toBe(500)
    expect(await findRecordById(db, 'record-one')).not.toBeNull()
  })

  it('treats Cloudflare 404 deletes as idempotent success', async () => {
    const { db, env } = await setup()
    const headers = await adminHeaders(db, env)
    await seedDnsRecord(db)
    mockCloudflareDeleteNotFound()

    const response = await postJson(env, '/api/dns/record-one/delete', {}, headers)

    expect(response.status).toBe(200)
    expect(await findRecordById(db, 'record-one')).toBeNull()
  })

  it('redacts Resend failures and logs allowlisted mail events', async () => {
    const { db, env } = await setup()
    const headers = await adminHeaders(db, env)
    await updateSettings(db, {
      resend_enabled: true,
      resend_accounts: [{ api_key: 'resend-secret-key', from: 'sender-private@example.test' }]
    }, sensitiveDataKeysFromEnv(env))
    mockResendFailure()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await postJson(env, '/api/admin/mail/test', {
      to_email: 'recipient-private@example.test'
    }, headers)
    const text = await response.text()

    expect(response.status).toBe(500)
    expect(text).toContain('测试邮件发送失败，请检查邮件配置后重试')
    assertNoPrivateText(text)
    const events = parsedSecurityEvents(errorSpy)
    expect(events.some((event) => event.event === 'mail_external_service_failed')).toBe(true)
    for (const event of events) {
      expect(Object.keys(event).sort()).toEqual(['account_index', 'code', 'event', 'retriable', 'service', 'stage', 'status', 'timestamp'])
      expect(event.service).toBe('resend')
      assertNoPrivateText(JSON.stringify(event))
    }
  })

  it('does not echo recipient email after successful test mail submission', async () => {
    const { db, env } = await setup()
    const headers = await adminHeaders(db, env)
    await updateSettings(db, {
      resend_enabled: true,
      resend_accounts: [{ api_key: 'resend-secret-key', from: 'sender-private@example.test' }]
    }, sensitiveDataKeysFromEnv(env))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id: 'mail-id' }))

    const response = await postJson(env, '/api/admin/mail/test', {
      to_email: 'recipient-private@example.test'
    }, headers)
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(text).toContain('测试邮件已提交发送')
    assertNoPrivateText(text)
  })
})
  it('forbids normal DNS create when dns_mode_enabled is false', async () => {
    const { db, env } = await setup()
    await db.prepare('UPDATE settings SET dns_mode_enabled = 0 WHERE id = ?').bind('default').run()
    const headers = await adminHeaders(db, env)
    const response = await postJson(env, '/api/create-dns', {
      mode: 'dns',
      subdomain: 'www',
      rootDomain: 'example.test',
      recordType: 'A',
      serverAddress: '198.51.100.20',
      proxied: true
    }, headers)
    const body = await response.json()
    expect(response.status).toBe(403)
    expect(body.message).toContain('普通 DNS 模式已关闭')
    expect(await db.prepare('SELECT COUNT(*) AS count FROM dns_record WHERE host_name = ?').bind('www.example.test').first()).toEqual({ count: 0 })
  })
