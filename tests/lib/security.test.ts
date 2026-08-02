import { describe, expect, it } from 'vitest'
import {
  safeInternalPath,
  isSameOriginMutation,
  csrfCookieName,
  createCsrfToken,
  buildCsrfCookie,
  clearCsrfCookie,
  readCsrfTokenFromCookie,
  timingSafeEqualString,
  verifyCsrfToken,
  ensureCsrfToken,
  requestIsHttps,
  appendSetCookie
} from '../../src/lib/security'

describe('safeInternalPath', () => {
  it('accepts simple relative paths', () => {
    expect(safeInternalPath('/')).toBe('/')
    expect(safeInternalPath('/login')).toBe('/login')
    expect(safeInternalPath('/admin?tab=users')).toBe('/admin?tab=users')
    expect(safeInternalPath('/settings#section')).toBe('/settings#section')
  })

  it('rejects absolute external URLs', () => {
    expect(safeInternalPath('https://evil.example/')).toBe('/')
    expect(safeInternalPath('http://evil.example/login')).toBe('/')
  })

  it('rejects protocol-relative URLs', () => {
    expect(safeInternalPath('//evil.example/')).toBe('/')
    expect(safeInternalPath('///evil.example/')).toBe('/')
  })

  it('rejects backslash, CR, LF, and null characters', () => {
    expect(safeInternalPath('/\\evil.example')).toBe('/')
    expect(safeInternalPath('/\rfoo')).toBe('/')
    expect(safeInternalPath('/\nfoo')).toBe('/')
    expect(safeInternalPath('/\0foo')).toBe('/')
  })

  it('falls back to default for null/undefined/empty', () => {
    expect(safeInternalPath(null)).toBe('/')
    expect(safeInternalPath(undefined)).toBe('/')
    expect(safeInternalPath('')).toBe('/')
    expect(safeInternalPath('   ')).toBe('/')
  })

  it('uses custom fallback', () => {
    expect(safeInternalPath(null, '/login')).toBe('/login')
    expect(safeInternalPath('https://evil/', '/login')).toBe('/login')
  })

  it('preserves query strings and hashes on valid paths', () => {
    expect(safeInternalPath('/login?next=/settings&a=b')).toBe('/login?next=/settings&a=b')
  })

  it('rejects paths that resolve to a different origin', () => {
    // A path like /@evil.example/ should not escape to another origin
    expect(safeInternalPath('/@evil.example/')).toMatch(/^\//)
  })
})

describe('isSameOriginMutation', () => {
  const appUrl = 'https://app.example/api/create'

  function makeRequest(opts: { origin?: string | null; referer?: string | null }): Request {
    const headers = new Headers()
    if (opts.origin !== null && opts.origin !== undefined) {
      if (opts.origin) headers.set('origin', opts.origin)
    } else {
      // no header
    }
    if (opts.referer !== null && opts.referer !== undefined) {
      if (opts.referer) headers.set('referer', opts.referer)
    }
    return new Request(appUrl, { method: 'POST', headers })
  }

  it('accepts matching Origin header', () => {
    expect(isSameOriginMutation(makeRequest({ origin: 'https://app.example' }))).toBe(true)
  })

  it('rejects mismatched Origin header', () => {
    expect(isSameOriginMutation(makeRequest({ origin: 'https://evil.example' }))).toBe(false)
  })

  it('falls back to Referer when Origin is absent', () => {
    expect(isSameOriginMutation(makeRequest({ origin: null, referer: 'https://app.example/page' }))).toBe(true)
  })

  it('rejects mismatched Referer', () => {
    expect(isSameOriginMutation(makeRequest({ origin: null, referer: 'https://evil.example/page' }))).toBe(false)
  })

  it('fails closed when neither Origin nor Referer is present', () => {
    expect(isSameOriginMutation(makeRequest({ origin: null, referer: null }))).toBe(false)
  })

  it('rejects malformed Origin', () => {
    expect(isSameOriginMutation(makeRequest({ origin: 'not-a-url' }))).toBe(false)
  })
})

describe('requestIsHttps', () => {
  it('returns true for https URLs', () => {
    expect(requestIsHttps(new Request('https://app.example/'))).toBe(true)
  })

  it('returns false for http URLs', () => {
    expect(requestIsHttps(new Request('http://localhost:8787/'))).toBe(false)
  })
})

describe('CSRF token utilities', () => {
  it('csrfCookieName returns the expected name', () => {
    expect(csrfCookieName()).toBe('csrf_token')
  })

  it('createCsrfToken produces 64 hex chars (32 bytes)', () => {
    const token = createCsrfToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('two tokens are different (randomness)', () => {
    expect(createCsrfToken()).not.toBe(createCsrfToken())
  })

  it('buildCsrfCookie includes required attributes', () => {
    const cookie = buildCsrfCookie('abc123', { secure: true })
    expect(cookie).toContain('csrf_token=abc123')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Secure')
    expect(cookie).toMatch(/Max-Age=\d+/)
  })

  it('buildCsrfCookie omits Secure when secure=false', () => {
    const cookie = buildCsrfCookie('abc123', { secure: false })
    expect(cookie).not.toContain('Secure')
  })

  it('clearCsrfCookie sets Max-Age=0', () => {
    const cookie = clearCsrfCookie({ secure: true })
    expect(cookie).toContain('csrf_token=')
    expect(cookie).toContain('Max-Age=0')
    expect(cookie).toContain('Secure')
  })

  it('clearCsrfCookie omits Secure when secure=false', () => {
    const cookie = clearCsrfCookie({ secure: false })
    expect(cookie).not.toContain('Secure')
  })

  it('readCsrfTokenFromCookie extracts the token', () => {
    expect(readCsrfTokenFromCookie('csrf_token=abc123')).toBe('abc123')
    expect(readCsrfTokenFromCookie('foo=bar; csrf_token=xyz')).toBe('xyz')
  })

  it('readCsrfTokenFromCookie returns null for missing cookie', () => {
    expect(readCsrfTokenFromCookie(null)).toBeNull()
    expect(readCsrfTokenFromCookie('')).toBeNull()
    expect(readCsrfTokenFromCookie('foo=bar')).toBeNull()
  })

  it('readCsrfTokenFromCookie decodes URL-encoded values', () => {
    expect(readCsrfTokenFromCookie('csrf_token=hello%20world')).toBe('hello world')
  })
})

describe('timingSafeEqualString', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeEqualString('abc', 'abc')).toBe(true)
  })

  it('returns false for different strings of same length', () => {
    expect(timingSafeEqualString('abc', 'abd')).toBe(false)
  })

  it('returns false for different lengths', () => {
    expect(timingSafeEqualString('abc', 'abcd')).toBe(false)
    expect(timingSafeEqualString('abcd', 'abc')).toBe(false)
  })

  it('returns true for empty strings', () => {
    expect(timingSafeEqualString('', '')).toBe(true)
  })
})

describe('verifyCsrfToken', () => {
  const token = 'a'.repeat(32)

  it('returns true when cookie token matches provided token', () => {
    expect(verifyCsrfToken(`csrf_token=${token}`, token)).toBe(true)
  })

  it('returns false when tokens do not match', () => {
    expect(verifyCsrfToken(`csrf_token=${token}`, 'b'.repeat(32))).toBe(false)
  })

  it('returns false when cookie header is null', () => {
    expect(verifyCsrfToken(null, token)).toBe(false)
  })

  it('returns false when provided token is empty', () => {
    expect(verifyCsrfToken(`csrf_token=${token}`, '')).toBe(false)
    expect(verifyCsrfToken(`csrf_token=${token}`, null)).toBe(false)
  })

  it('returns false when cookie token is missing', () => {
    expect(verifyCsrfToken('foo=bar', token)).toBe(false)
  })
})

describe('ensureCsrfToken', () => {
  it('reuses an existing valid token without setting a new cookie', () => {
    const existing = 'c'.repeat(32)
    const result = ensureCsrfToken(`csrf_token=${existing}`)
    expect(result.token).toBe(existing)
    expect(result.setCookie).toBeNull()
  })

  it('creates a new token when none exists', () => {
    const result = ensureCsrfToken(null, { secure: true })
    expect(result.token).toMatch(/^[0-9a-f]{64}$/)
    expect(result.setCookie).not.toBeNull()
    expect(result.setCookie).toContain('Secure')
  })

  it('creates a new token when existing token is too short', () => {
    const result = ensureCsrfToken('csrf_token=short', { secure: false })
    expect(result.token).toMatch(/^[0-9a-f]{64}$/)
    expect(result.setCookie).not.toBeNull()
    expect(result.setCookie).not.toContain('Secure')
  })

  it('creates a new token when cookie header is null', () => {
    const result = ensureCsrfToken(null)
    expect(result.token).toMatch(/^[0-9a-f]{64}$/)
    expect(result.setCookie).not.toBeNull()
  })
})

describe('appendSetCookie', () => {
  it('appends a Set-Cookie header', () => {
    const headers = new Headers()
    appendSetCookie(headers, 'csrf_token=abc; Path=/')
    expect(headers.get('set-cookie')).toBe('csrf_token=abc; Path=/')
  })

  it('appends multiple Set-Cookie headers', () => {
    const headers = new Headers()
    appendSetCookie(headers, 'cookie1=a')
    appendSetCookie(headers, 'cookie2=b')
    expect(headers.getSetCookie()).toEqual(['cookie1=a', 'cookie2=b'])
  })

  it('does nothing for null/undefined/empty cookie', () => {
    const headers = new Headers()
    appendSetCookie(headers, null)
    appendSetCookie(headers, undefined)
    appendSetCookie(headers, '')
    expect(headers.get('set-cookie')).toBeNull()
  })
})
