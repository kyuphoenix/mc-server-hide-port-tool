export function safeInternalPath(
  raw: string | null | undefined,
  fallback = '/'
): string {
  if (raw == null) return fallback
  const value = String(raw).trim()
  if (!value) return fallback

  // Absolute external URLs and protocol-relative URLs are never allowed.
  if (!value.startsWith('/')) return fallback
  if (value.startsWith('//')) return fallback
  if (
    value.includes(String.fromCharCode(92)) ||
    value.includes(String.fromCharCode(13)) ||
    value.includes(String.fromCharCode(10)) ||
    value.includes(String.fromCharCode(0))
  ) {
    return fallback
  }

  try {
    const parsed = new URL(value, 'http://local.invalid')
    if (parsed.origin !== 'http://local.invalid') return fallback
    if (!parsed.pathname.startsWith('/') || parsed.pathname.startsWith('//')) return fallback
    return (parsed.pathname + parsed.search + parsed.hash) || fallback
  } catch {
    return fallback
  }
}

export function isSameOriginMutation(request: Request): boolean {
  const url = new URL(request.url)
  const origin = request.headers.get('origin')
  if (origin) {
    try {
      return new URL(origin).origin === url.origin
    } catch {
      return false
    }
  }

  const referer = request.headers.get('referer')
  if (referer) {
    try {
      return new URL(referer).origin === url.origin
    } catch {
      return false
    }
  }

  // Browser form/fetch POSTs should send Origin or Referer.
  // Fail closed for cookie-authenticated state changes.
  return false
}

export function csrfCookieName(): string {
  return 'csrf_token'
}

export function createCsrfToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function buildCsrfCookie(
  token: string,
  opts?: { maxAgeSeconds?: number; secure?: boolean }
): string {
  const maxAgeSeconds = opts?.maxAgeSeconds ?? 60 * 60 * 8
  const secure = opts?.secure !== false
  const parts = [
    csrfCookieName() + '=' + encodeURIComponent(token),
    'Path=/',
    'SameSite=Lax',
    'Max-Age=' + String(maxAgeSeconds)
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function clearCsrfCookie(opts?: { secure?: boolean }): string {
  const secure = opts?.secure !== false
  const parts = [
    csrfCookieName() + '=',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=0'
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function readCsrfTokenFromCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null
  const parts = cookieHeader.split(';')
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=')
    if (k === csrfCookieName()) {
      try {
        return decodeURIComponent(rest.join('=') || '')
      } catch {
        return rest.join('=') || ''
      }
    }
  }
  return null
}

export function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return out === 0
}

export function verifyCsrfToken(
  cookieHeader: string | null | undefined,
  formToken: string | null | undefined
): boolean {
  const cookieToken = readCsrfTokenFromCookie(cookieHeader)
  const provided = String(formToken ?? '').trim()
  if (!cookieToken || !provided) return false
  return timingSafeEqualString(cookieToken, provided)
}

export function ensureCsrfToken(
  cookieHeader: string | null | undefined,
  opts?: { secure?: boolean }
): {
  token: string
  setCookie: string | null
} {
  const existing = readCsrfTokenFromCookie(cookieHeader)
  if (existing && existing.length >= 32) {
    return { token: existing, setCookie: null }
  }
  const token = createCsrfToken()
  return { token, setCookie: buildCsrfCookie(token, { secure: opts?.secure }) }
}

export function requestIsHttps(request: Request): boolean {
  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

export function appendSetCookie(headers: Headers, cookie: string | null | undefined): void {
  if (!cookie) return
  headers.append('Set-Cookie', cookie)
}
