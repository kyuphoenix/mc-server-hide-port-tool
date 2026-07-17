import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ExternalFetchError,
  fetchWithPolicy,
  readTextWithLimit
} from '../src/lib/external-fetch'
import {
  CloudflareDnsError,
  createDnsRecord,
  fetchZoneId
} from '../src/services/cloudflare-dns'
import { getGitHubUser } from '../src/services/github'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('external fetch policy', () => {
  it('retries a retryable idempotent request once', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }))

    const response = await fetchWithPolicy('https://service.example/data', {
      method: 'GET'
    }, {
      timeoutMs: 1_000,
      retries: 1,
      retryDelayMs: 0
    })

    expect(response.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('never retries a non-idempotent POST', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 503 }))

    const response = await fetchWithPolicy('https://service.example/actions', {
      method: 'POST'
    }, {
      timeoutMs: 1_000,
      retries: 3,
      retryDelayMs: 0
    })

    expect(response.status).toBe(503)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('aborts stalled requests at the application timeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))

    await expect(fetchWithPolicy('https://service.example/stalled', {}, {
      timeoutMs: 5,
      retries: 0
    })).rejects.toMatchObject({
      code: 'EXTERNAL_REQUEST_TIMEOUT'
    })
  })

  it('rejects oversized response bodies while streaming', async () => {
    const response = new Response('x'.repeat(33))
    await expect(readTextWithLimit(response, 32)).rejects.toMatchObject({
      code: 'EXTERNAL_RESPONSE_TOO_LARGE'
    })
  })

  it('times out when response headers arrive but the body never completes', async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('partial'))
      }
    }))

    await expect(readTextWithLimit(response, 32, 5)).rejects.toMatchObject({
      code: 'EXTERNAL_REQUEST_TIMEOUT'
    })
  })
})

describe('service retry boundaries', () => {
  it('retries Cloudflare zone lookup but not record creation', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ success: true, result: [{ id: 'zone-1' }] }))

    await expect(fetchZoneId('private-token', 'example.com')).resolves.toBe('zone-1')
    expect(fetchSpy).toHaveBeenCalledTimes(2)

    fetchSpy.mockReset()
    fetchSpy.mockResolvedValue(new Response('', { status: 503 }))
    await expect(createDnsRecord('private-token', 'zone-1', {
      type: 'A',
      name: 'mc.example.com',
      content: '192.0.2.1',
      ttl: 1,
      proxied: false
    })).rejects.toBeInstanceOf(CloudflareDnsError)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('retries GitHub profile GET once and keeps failures private', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(Response.json({
        id: 1,
        login: 'octocat',
        name: null,
        email: null,
        avatar_url: null,
        created_at: '2020-01-01T00:00:00Z'
      }))

    await expect(getGitHubUser('private-access-token')).resolves.toMatchObject({ login: 'octocat' })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(fetchSpy.mock.calls.map(([url]) => String(url)))).not.toContain('private-access-token')
  })
})
