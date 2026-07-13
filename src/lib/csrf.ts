import type { Context } from 'hono'
import {
  ensureCsrfToken,
  isSameOriginMutation,
  requestIsHttps,
  verifyCsrfToken
} from './security'

export function getRequestCsrf(c: Context): { token: string; setCookie: string | null } {
  return ensureCsrfToken(c.req.header('Cookie'), {
    secure: requestIsHttps(c.req.raw)
  })
}

export function csrfField(token: string): string {
  // Used in places where JSX prop injection is awkward.
  return `<input type="hidden" name="csrf_token" value="${token}" />`
}

export async function requireMutationCsrf(
  c: Context,
  form?: FormData | null
): Promise<Response | null> {
  if (!isSameOriginMutation(c.req.raw)) {
    return c.text('Forbidden: invalid origin', 403)
  }
  const token =
    form?.get('csrf_token') != null
      ? String(form.get('csrf_token'))
      : c.req.header('x-csrf-token') || ''
  if (!verifyCsrfToken(c.req.header('Cookie'), token)) {
    return c.text('Forbidden: invalid CSRF token', 403)
  }
  return null
}

export function withCsrfCookie(response: Response, setCookie: string | null): Response {
  if (!setCookie) return response
  const headers = new Headers(response.headers)
  headers.append('Set-Cookie', setCookie)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}
