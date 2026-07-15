import { OAUTH_REGISTRATION_INTENT_COOKIE } from '../services/oauth-registration-intents'

type HookContextLike = {
  method?: unknown
  path?: unknown
  params?: unknown
  query?: unknown
  getCookie?: unknown
}

export type GenericOAuthCallback = {
  providerId: string
  state: string
  intentToken: string
}

export function readGenericOAuthCallback(value: unknown): GenericOAuthCallback | null {
  if (!value || typeof value !== 'object') return null
  const context = value as HookContextLike
  if (context.method !== 'GET' || context.path !== '/oauth2/callback/:providerId') return null
  const params = context.params && typeof context.params === 'object'
    ? context.params as Record<string, unknown> : {}
  const providerId = String(params.providerId ?? '').trim()
  if (!providerId) return null
  const query = context.query && typeof context.query === 'object'
    ? context.query as Record<string, unknown> : {}
  const getCookie = typeof context.getCookie === 'function'
    ? context.getCookie as (name: string) => string | null : () => null
  return {
    providerId,
    state: String(query.state ?? ''),
    intentToken: String(getCookie(OAUTH_REGISTRATION_INTENT_COOKIE) ?? '')
  }
}