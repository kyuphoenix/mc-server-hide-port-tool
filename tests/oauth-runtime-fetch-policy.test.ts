import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  toGenericOAuthConfig,
  type OAuthProviderRow
} from '../src/services/oauth-providers'

function providerRow(overrides: Partial<OAuthProviderRow> = {}): OAuthProviderRow {
  return {
    id: 'runtime-provider',
    provider_id: 'fixture',
    name: 'Fixture',
    client_id: 'client-id',
    client_secret: 'client-secret',
    discovery_url: null,
    authorization_url: 'https://provider.example/authorize',
    token_url: 'https://provider.example/token',
    user_info_url: 'https://provider.example/userinfo',
    scopes: 'openid profile email',
    pkce: 1,
    enabled: 1,
    sort_order: 0,
    icon_url: null,
    created_at: 1,
    updated_at: 1,
    ...overrides
  }
}

function runtimeConfig(row = providerRow(), allowedHosts?: string) {
  return toGenericOAuthConfig(row, {} as D1Database, undefined, undefined, allowedHosts)
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('OAuth runtime external request policy', () => {
  it('exchanges a code with a bounded non-redirecting POST and maps JSON tokens', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token_expires_in: 7200,
      scope: 'openid profile',
      id_token: 'id-token'
    }))
    const before = Date.now()

    const tokens = await runtimeConfig().getToken({
      code: 'oauth-code',
      redirectURI: 'https://app.example/api/auth/oauth2/callback/fixture',
      codeVerifier: 'verifier'
    })

    expect(tokens).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      scopes: ['openid', 'profile'],
      idToken: 'id-token'
    })
    expect(tokens.accessTokenExpiresAt?.getTime()).toBeGreaterThanOrEqual(before + 3_599_000)
    expect(tokens.refreshTokenExpiresAt?.getTime()).toBeGreaterThanOrEqual(before + 7_199_000)

    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe('https://provider.example/token')
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual' })
    const body = init?.body as URLSearchParams
    expect(Object.fromEntries(body)).toEqual({
      grant_type: 'authorization_code',
      code: 'oauth-code',
      redirect_uri: 'https://app.example/api/auth/oauth2/callback/fixture',
      client_id: 'client-id',
      client_secret: 'client-secret',
      code_verifier: 'verifier'
    })
  })

  it('uses manual redirect handling because workerd rejects redirect error mode', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      if (init?.redirect === 'error') throw new TypeError('workerd rejects redirect error mode')
      return Response.json({ access_token: 'access-token' })
    })

    await expect(runtimeConfig().getToken({
      code: 'oauth-code',
      redirectURI: 'https://app.example/api/auth/oauth2/callback/fixture'
    })).resolves.toMatchObject({ accessToken: 'access-token' })
  })

  it('logs a sanitized upstream error when the token endpoint rejects the exchange', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      error: 'incorrect_client_credentials',
      error_description: 'The client_id and/or client_secret passed are incorrect.'
    }))

    await expect(runtimeConfig().getToken({
      code: 'sensitive-oauth-code',
      redirectURI: 'https://app.example/api/auth/oauth2/callback/fixture'
    })).rejects.toMatchObject({ code: 'EXTERNAL_REQUEST_FAILED' })

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const event = JSON.parse(String(errorSpy.mock.calls[0]?.[0]))
    expect(event).toMatchObject({
      event: 'oauth_token_exchange_failed',
      provider_id: 'fixture',
      token_host: 'provider.example',
      response_status: 200,
      upstream_error: 'incorrect_client_credentials'
    })
    const serializedEvent = JSON.stringify(event)
    expect(serializedEvent).not.toContain('sensitive-oauth-code')
    expect(serializedEvent).not.toContain('client-secret')
    expect(serializedEvent).not.toContain('The client_id and/or client_secret passed are incorrect.')
  })

  it('accepts form-encoded token responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      'access_token=form-token&token_type=bearer&scope=openid%20email',
      { headers: { 'content-type': 'application/x-www-form-urlencoded' } }
    ))

    await expect(runtimeConfig().getToken({
      code: 'code',
      redirectURI: 'https://app.example/callback'
    })).resolves.toMatchObject({
      accessToken: 'form-token',
      tokenType: 'bearer',
      scopes: ['openid', 'email']
    })
  })

  it('rejects token redirects and oversized token responses', async () => {
    const config = runtimeConfig()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { location: 'https://attacker.example/token' }
    }))
    await expect(config.getToken({
      code: 'code',
      redirectURI: 'https://app.example/callback'
    })).rejects.toMatchObject({ code: 'EXTERNAL_REQUEST_FAILED' })

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('x'.repeat(128 * 1024 + 1), {
      headers: { 'content-type': 'application/json' }
    }))
    await expect(config.getToken({
      code: 'code',
      redirectURI: 'https://app.example/callback'
    })).rejects.toMatchObject({ code: 'EXTERNAL_RESPONSE_TOO_LARGE' })
  })

  it('enforces the token response-body deadline', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{'))
      }
    }), { headers: { 'content-type': 'application/json' } }))

    const pending = runtimeConfig().getToken({
      code: 'code',
      redirectURI: 'https://app.example/callback'
    })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'EXTERNAL_REQUEST_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(5_001)
    await rejected
  })

  it('fetches userinfo with bearer auth, retries GET, and maps common claims', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('upstream unavailable', { status: 503 }))
      .mockResolvedValueOnce(Response.json({
        id: 42,
        preferred_username: 'oauth-user',
        email: 'oauth-user@example.test',
        email_verified: true,
        picture: 'https://provider.example/avatar.png'
      }))

    await expect(runtimeConfig().getUserInfo({ accessToken: 'access-token' })).resolves.toEqual({
      id: '42',
      name: 'oauth-user',
      email: 'oauth-user@example.test',
      image: 'https://provider.example/avatar.png',
      emailVerified: true
    })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[1]?.[1]).toMatchObject({
      method: 'GET',
      redirect: 'manual',
      headers: expect.objectContaining({ Authorization: 'Bearer access-token' })
    })
  })

  it('revalidates runtime endpoints against the configured host allowlist', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const config = runtimeConfig(providerRow({
      token_url: 'https://unapproved.example/token',
      user_info_url: 'https://unapproved.example/userinfo'
    }), 'provider.example')

    await expect(config.getToken({
      code: 'code',
      redirectURI: 'https://app.example/callback'
    })).rejects.toMatchObject({ code: 'EXTERNAL_REQUEST_FAILED' })
    await expect(config.getUserInfo({ accessToken: 'access-token' }))
      .rejects.toMatchObject({ code: 'EXTERNAL_REQUEST_FAILED' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
