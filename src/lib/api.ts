import type { Context } from 'hono'
import { requireMutationCsrf } from './csrf'

export type ApiSuccess<T = unknown> = {
  success: true
  data?: T
  message?: string
  redirect?: string
}

export type ApiFailure = {
  success: false
  message: string
  code?: string
  data?: unknown
  redirect?: string
}

export function apiOk<T = unknown>(
  c: Context,
  data?: T,
  init?: { message?: string; redirect?: string; status?: number; headers?: HeadersInit }
): Response {
  const body: ApiSuccess<T> = {
    success: true,
    ...(data !== undefined ? { data } : {}),
    ...(init?.message ? { message: init.message } : {}),
    ...(init?.redirect ? { redirect: init.redirect } : {})
  }
  return c.json(body, (init?.status ?? 200) as any, init?.headers as any)
}

export function apiErr(
  c: Context,
  message: string,
  status: number = 400,
  extra?: { code?: string; data?: unknown; headers?: HeadersInit; redirect?: string }
): Response {
  const body: ApiFailure & { redirect?: string } = {
    success: false,
    message,
    ...(extra?.code ? { code: extra.code } : {}),
    ...(extra?.data !== undefined ? { data: extra.data } : {}),
    ...(extra?.redirect ? { redirect: extra.redirect } : {})
  }
  return c.json(body, status as any, extra?.headers as any)
}

export async function readJsonBody<T extends Record<string, unknown> = Record<string, unknown>>(
  c: Context
): Promise<T> {
  try {
    const data = await c.req.json()
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return data as T
    }
  } catch {
    // fall through
  }
  return {} as T
}

/** JSON mutations: same-origin + CSRF header (or csrf_token in body). */
export async function requireJsonMutation(c: Context): Promise<Response | null> {
  let form: FormData | null = null
  const contentType = (c.req.header('content-type') || '').toLowerCase()
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    form = await c.req.formData().catch(() => null)
  }
  const denied = await requireMutationCsrf(c, form)
  if (!denied) return null
  const text = await denied.text().catch(() => 'Forbidden')
  return apiErr(c, text || 'Forbidden', denied.status || 403, { code: 'CSRF_DENIED' })
}

export function publicSettings(settings: {
  registration_enabled: boolean
  registration_mode: string
  invite_required: boolean
  github_min_account_age_days: number
  resend_enabled: boolean
  resend_accounts: unknown[]
}): {
  registration_enabled: boolean
  registration_mode: string
  invite_required: boolean
  github_min_account_age_days: number
  email_verification_required: boolean
} {
  return {
    registration_enabled: settings.registration_enabled,
    registration_mode: settings.registration_mode,
    invite_required: settings.invite_required,
    github_min_account_age_days: settings.github_min_account_age_days,
    email_verification_required: !!(settings.resend_enabled && settings.resend_accounts.length > 0)
  }
}

export function maskSettingsForAdmin(settings: {
  registration_enabled: boolean
  registration_mode: string
  invite_required: boolean
  email_whitelist_enabled: boolean
  email_whitelist_suffixes: string[]
  email_blacklist_enabled: boolean
  email_blacklist_suffixes: string[]
  github_min_account_age_days: number
  resend_enabled: boolean
  resend_accounts: { api_key: string; from: string }[]
  max_records_per_user: number
  min_subdomain_length: number
}) {
  return {
    registration_enabled: settings.registration_enabled,
    registration_mode: settings.registration_mode,
    invite_required: settings.invite_required,
    email_whitelist_enabled: settings.email_whitelist_enabled,
    email_whitelist_suffixes: settings.email_whitelist_suffixes,
    email_blacklist_enabled: settings.email_blacklist_enabled,
    email_blacklist_suffixes: settings.email_blacklist_suffixes,
    github_min_account_age_days: settings.github_min_account_age_days,
    resend_enabled: settings.resend_enabled,
    resend_accounts: (settings.resend_accounts || []).map((a) => ({
      from: a.from,
      has_key: !!a.api_key
    })),
    max_records_per_user: settings.max_records_per_user,
    min_subdomain_length: settings.min_subdomain_length
  }
}


/** JSON success while preserving Set-Cookie / other headers from nested auth responses. */
export function apiOkWithHeaders<T = unknown>(
  data?: T,
  headers?: Headers | null,
  init?: { message?: string; redirect?: string; status?: number }
): Response {
  const body: ApiSuccess<T> = {
    success: true,
    ...(data !== undefined ? { data } : {}),
    ...(init?.message ? { message: init.message } : {}),
    ...(init?.redirect ? { redirect: init.redirect } : {})
  }
  const out = new Headers()
  if (headers) {
    for (const [key, value] of headers.entries()) {
      // Drop body-related headers from nested responses.
      const k = key.toLowerCase()
      if (k === 'content-type' || k === 'content-length' || k === 'content-encoding') continue
      out.append(key, value)
    }
  }
  out.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: out
  })
}

export async function extractOAuthRedirectUrl(
  res: Response
): Promise<{ url: string | null; headers: Headers }> {
  const headers = new Headers(res.headers)
  const contentType = (headers.get('content-type') || '').toLowerCase()
  let payload: { url?: string; redirect?: boolean } | null = null

  if (res.status >= 300 && res.status < 400) {
    const location = headers.get('location')
    return { url: location, headers }
  }

  if (
    contentType.includes('application/json') ||
    contentType.includes('text/json') ||
    contentType.includes('+json')
  ) {
    try {
      payload = (await res.clone().json()) as { url?: string; redirect?: boolean }
    } catch {
      payload = null
    }
  } else {
    try {
      const textBody = await res.clone().text()
      if (textBody.trim().startsWith('{')) {
        payload = JSON.parse(textBody) as { url?: string; redirect?: boolean }
      }
    } catch {
      payload = null
    }
  }

  if (payload?.url && payload.redirect !== false) {
    return { url: payload.url, headers }
  }
  return { url: null, headers }
}
