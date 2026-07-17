import { Hono } from 'hono'
import productionApp from '../src/index'
import { describe, expect, it } from 'vitest'
import { MAX_MUTATION_BODY_BYTES, mutationBodyLimit } from '../src/lib/api'

function streamRequest(path: string, chunks: Uint8Array[], contentType = 'application/json'): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    }
  })
  return new Request('https://app.example' + path, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: stream,
    duplex: 'half'
  } as RequestInit & { duplex: 'half' })
}

function createApp() {
  const app = new Hono()
  app.use('*', mutationBodyLimit)
  app.post('/api/echo', async (c) => c.json(await c.req.json()))
  app.post('/form', async (c) => {
    const form = await c.req.formData()
    return c.text(String(form.get('csrf_token') || ''))
  })
  return app
}

describe('mutation request body limit', () => {
  it('rejects an oversized declared Content-Length before parsing', async () => {
    const app = createApp()
    const response = await app.request('/api/echo', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(MAX_MUTATION_BODY_BYTES + 1)
      },
      body: '{}'
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({
      success: false,
      message: '请求体过大',
      code: 'PAYLOAD_TOO_LARGE'
    })
  })

  it('rejects an oversized streamed body without Content-Length', async () => {
    const app = createApp()
    const response = await app.request(streamRequest('/api/echo', [
      new Uint8Array(MAX_MUTATION_BODY_BYTES),
      new Uint8Array([1])
    ]))

    expect(response.status).toBe(413)
    const body = await response.json() as { code?: string }
    expect(body.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('replays a bounded streamed JSON body for downstream parsing', async () => {
    const app = createApp()
    const encoded = new TextEncoder().encode(JSON.stringify({ ok: true }))
    const response = await app.request(streamRequest('/api/echo', [
      encoded.slice(0, 4),
      encoded.slice(4)
    ]))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('enforces the limit in the production app before route authentication', async () => {
    const response = await productionApp.request('/api/session/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(MAX_MUTATION_BODY_BYTES + 1)
    })

    expect(response.status).toBe(413)
    const body = await response.json() as { code?: string }
    expect(body.code).toBe('PAYLOAD_TOO_LARGE')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'")
  })

  it('returns a plain 413 response for oversized page forms', async () => {
    const app = createApp()
    const response = await app.request(streamRequest('/form', [
      new Uint8Array(MAX_MUTATION_BODY_BYTES + 1)
    ], 'application/x-www-form-urlencoded'))

    expect(response.status).toBe(413)
    expect(await response.text()).toBe('Payload Too Large')
  })
})
