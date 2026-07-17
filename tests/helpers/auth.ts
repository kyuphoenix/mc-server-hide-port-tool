import { vi } from 'vitest'
import { invalidateSettingsCache } from '../../src/services/request-cache'

export const AUTH_ORIGIN = 'https://app.example'
export const FIXTURE_PROVIDER_ID = 'fixture'

export async function setRegistrationPolicy(
  db: D1Database,
  input: { enabled: boolean; mode: 'email' | 'oauth' | 'both'; inviteRequired: boolean }
): Promise<void> {
  await db.prepare(
    `UPDATE settings
     SET registration_enabled = ?, registration_mode = ?, invite_required = ?
     WHERE id = 'default'`
  ).bind(
    input.enabled ? 1 : 0,
    input.mode,
    input.inviteRequired ? 1 : 0
  ).run()
  invalidateSettingsCache(db)
}

export async function seedFixtureOAuthProvider(db: D1Database): Promise<void> {
  const now = Date.now()
  await db.prepare(
    `INSERT INTO oauth_provider
      (id, provider_id, name, client_id, client_secret, discovery_url,
       authorization_url, token_url, user_info_url, scopes, pkce, enabled,
       sort_order, icon_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 0, 1, 0, NULL, ?, ?)`
  ).bind(
    'fixture-provider',
    FIXTURE_PROVIDER_ID,
    'Fixture OAuth',
    'fixture-client-id',
    'fixture-client-secret',
    'https://provider.example/authorize',
    'https://provider.example/token',
    'https://provider.example/userinfo',
    'openid,profile,email',
    now,
    now
  ).run()
}

function setCookieValues(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] }
  if (typeof withGetSetCookie.getSetCookie === 'function') {
    return withGetSetCookie.getSetCookie()
  }
  const combined = headers.get('set-cookie')
  return combined ? [combined] : []
}

export function cookiesFromHeaders(headers: Headers): string {
  return setCookieValues(headers)
    .map((value) => value.split(';', 1)[0]?.trim() ?? '')
    .filter(Boolean)
    .join('; ')
}

export function mergeCookieHeaders(...values: Array<string | null | undefined>): string {
  return values.map((value) => value?.trim() ?? '').filter(Boolean).join('; ')
}

export function sameOriginJsonHeaders(cookie = 'csrf_token=test-csrf'): Headers {
  return new Headers({
    'content-type': 'application/json',
    origin: AUTH_ORIGIN,
    cookie,
    'x-csrf-token': 'test-csrf'
  })
}

export function mockOAuthProviderFetch(options: { email?: string } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url
    if (url === 'https://provider.example/token') {
      return Response.json({
        access_token: 'access-token',
        token_type: 'Bearer'
      })
    }
    if (url === 'https://provider.example/userinfo') {
      return Response.json({
        id: 'provider-user-1',
        email: options.email ?? 'oauth-user@example.test',
        email_verified: true,
        name: 'OAuth User'
      })
    }
    return new Response('not found', { status: 404 })
  })
}