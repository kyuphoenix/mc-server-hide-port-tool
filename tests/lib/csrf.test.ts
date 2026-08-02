import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import {
  getRequestCsrf,
  csrfField,
  requireMutationCsrf,
  withCsrfCookie
} from '../../src/lib/csrf'
import { createCsrfToken, buildCsrfCookie } from '../../src/lib/security'

function createContext(
  opts: {
    method?: string
    origin?: string | null
    cookie?: string | null
    csrfHeader?: string | null
    formData?: FormData | null
    path?: string
  }
): Parameters<typeof requireMutationCsrf>[0] {
  const headers = new Headers()
  if (opts.origin) headers.set('origin', opts.origin)
  if (opts.cookie) headers.set('cookie', opts.cookie)
  if (opts.csrfHeader) headers.set('x-csrf-token', opts.csrfHeader)

  const url = new URL(opts.path ?? '/api/test', 'https://app.example')
  const req = new Request(url, {
    method: opts.method ?? 'POST',
    headers
  })
  return {
    req: {
      raw: req,
      header: (name: string) => headers.get(name) || null
    },
    text: (msg: string, status: number = 403) => new Response(msg, { status })
  } as unknown as Parameters<typeof requireMutationCsrf>[0]
}

describe('getRequestCsrf', () => {
  it('returns existing token from cookie without setting new cookie', () => {
    const token = createCsrfToken()
    const c = createContext({ cookie: `csrf_token=${token}`, origin: 'https://app.example' })
    const result = getRequestCsrf(c)
    expect(result.token).toBe(token)
    expect(result.setCookie).toBeNull()
  })

  it('creates a new token when no cookie exists', () => {
    const c = createContext({ cookie: null, origin: 'https://app.example' })
    const result = getRequestCsrf(c)
    expect(result.token).toMatch(/^[0-9a-f]{64}$/)
    expect(result.setCookie).not.toBeNull()
    expect(result.setCookie).toContain('Secure')
  })

  it('creates non-Secure cookie over HTTP', () => {
    // requestIsHttps checks the request URL protocol, not the Origin header
    const headers = new Headers()
    const req = new Request('http://localhost:8787/api/test', { method: 'GET', headers })
    const c = {
      req: { raw: req, header: (name: string) => headers.get(name) || null }
    } as unknown as Parameters<typeof getRequestCsrf>[0]
    const result = getRequestCsrf(c)
    expect(result.setCookie).not.toBeNull()
    expect(result.setCookie).not.toContain('Secure')
  })
})

describe('csrfField', () => {
  it('returns a hidden input with the token value', () => {
    const html = csrfField('abc123')
    expect(html).toContain('type="hidden"')
    expect(html).toContain('name="csrf_token"')
    expect(html).toContain('value="abc123"')
  })

  it('does not escape special characters in the token (raw interpolation)', () => {
    // csrfField uses raw template string interpolation without HTML escaping.
    // CSRF tokens are hex strings so this is safe in practice.
    const html = csrfField('abc123')
    expect(html).toBe('<input type="hidden" name="csrf_token" value="abc123" />')
  })
})

describe('requireMutationCsrf', () => {
  const validToken = createCsrfToken()
  const validCookie = `csrf_token=${validToken}`

  it('returns null for valid same-origin request with matching CSRF token', async () => {
    const c = createContext({
      origin: 'https://app.example',
      cookie: validCookie,
      csrfHeader: validToken
    })
    const result = await requireMutationCsrf(c)
    expect(result).toBeNull()
  })

  it('returns 403 for mismatched origin', async () => {
    const c = createContext({
      origin: 'https://evil.example',
      cookie: validCookie,
      csrfHeader: validToken
    })
    const result = await requireMutationCsrf(c)
    expect(result).not.toBeNull()
    expect(result!.status).toBe(403)
    expect(await result!.text()).toContain('origin')
  })

  it('returns 403 for missing origin header', async () => {
    const c = createContext({
      origin: null,
      cookie: validCookie,
      csrfHeader: validToken
    })
    const result = await requireMutationCsrf(c)
    expect(result).not.toBeNull()
    expect(result!.status).toBe(403)
  })

  it('returns 403 for invalid CSRF token', async () => {
    const c = createContext({
      origin: 'https://app.example',
      cookie: validCookie,
      csrfHeader: 'wrong-token'
    })
    const result = await requireMutationCsrf(c)
    expect(result).not.toBeNull()
    expect(result!.status).toBe(403)
    expect(await result!.text()).toContain('CSRF')
  })

  it('returns 403 for missing CSRF header', async () => {
    const c = createContext({
      origin: 'https://app.example',
      cookie: validCookie,
      csrfHeader: null
    })
    const result = await requireMutationCsrf(c)
    expect(result).not.toBeNull()
    expect(result!.status).toBe(403)
  })

  it('returns 403 for missing CSRF cookie', async () => {
    const c = createContext({
      origin: 'https://app.example',
      cookie: null,
      csrfHeader: validToken
    })
    const result = await requireMutationCsrf(c)
    expect(result).not.toBeNull()
    expect(result!.status).toBe(403)
  })

  it('accepts CSRF token from form data field', async () => {
    const form = new FormData()
    form.append('csrf_token', validToken)
    const c = createContext({
      origin: 'https://app.example',
      cookie: validCookie,
      formData: form
    })
    // Override header to be empty so it falls through to form data
    const headers = new Headers()
    headers.set('origin', 'https://app.example')
    headers.set('cookie', validCookie)
    const req = new Request('https://app.example/api/test', { method: 'POST', headers })
    const ctx = {
      req: {
        raw: req,
        header: (name: string) => headers.get(name) || null
      },
      text: (msg: string, status: number = 403) => new Response(msg, { status })
    } as unknown as Parameters<typeof requireMutationCsrf>[0]
    const result = await requireMutationCsrf(ctx, form)
    expect(result).toBeNull()
  })
})

describe('withCsrfCookie', () => {
  it('appends Set-Cookie header to the response', () => {
    const original = new Response('ok', { status: 200 })
    const cookie = buildCsrfTokenCookie()
    const result = withCsrfCookie(original, cookie)
    expect(result.headers.get('set-cookie')).toBe(cookie)
    expect(result.status).toBe(200)
  })

  it('returns the original response when setCookie is null', () => {
    const original = new Response('ok', { status: 200 })
    const result = withCsrfCookie(original, null)
    expect(result.headers.get('set-cookie')).toBeNull()
    expect(result).toBe(original)
  })

  it('returns the original response when setCookie is empty', () => {
    const original = new Response('ok', { status: 200 })
    const result = withCsrfCookie(original, '')
    expect(result.headers.get('set-cookie')).toBeNull()
  })

  it('preserves existing response headers', () => {
    const original = new Response('ok', {
      status: 201,
      headers: { 'content-type': 'application/json' }
    })
    const cookie = buildCsrfTokenCookie()
    const result = withCsrfCookie(original, cookie)
    expect(result.status).toBe(201)
    expect(result.headers.get('content-type')).toBe('application/json')
    expect(result.headers.get('set-cookie')).toBe(cookie)
  })
})

function buildCsrfTokenCookie(): string {
  return buildCsrfCookie(createCsrfToken(), { secure: true })
}
