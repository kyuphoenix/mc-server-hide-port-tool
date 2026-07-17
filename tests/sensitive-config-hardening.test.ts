import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createOAuthProvider,
  listEnabledOAuthProviders,
  listPublicOAuthProviders,
  updateOAuthProvider,
  validateOAuthProviderInput,
  toGenericOAuthConfig
} from '../src/services/oauth-providers'
import { getSettings, updateSettings } from '../src/services/settings'
import { createTestD1, disposeTestD1Instances, type TestD1 } from './helpers/d1'

const SECRET = 'test-secret-with-at-least-thirty-two-characters'
const TEST_OAUTH_HOSTS = 'accounts.example.com,api.example.com'
const instances: TestD1[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await disposeTestD1Instances(instances)
})

function providerInput(overrides: Record<string, unknown> = {}) {
  return {
    provider_id: 'secure-provider',
    name: 'Secure Provider',
    client_id: 'client-id',
    client_secret: 'client-secret-value',
    authorization_url: 'https://accounts.example.com/oauth/authorize',
    token_url: 'https://accounts.example.com/oauth/token',
    user_info_url: 'https://api.example.com/oauth/userinfo',
    scopes: 'openid profile email',
    pkce: true,
    enabled: true,
    sort_order: 0,
    icon_url: 'https://cdn.example.com/icon.svg',
    ...overrides
  }
}

describe('OAuth URL hardening', () => {
  it.each([
    'http://accounts.example.com/oauth/token',
    'https://user:password@accounts.example.com/oauth/token',
    'https://localhost/oauth/token',
    'https://metadata/oauth/token',
    'https://service.internal/oauth/token',
    'https://127.0.0.1/oauth/token',
    'https://169.254.169.254/latest/meta-data',
    'https://10.0.0.1/oauth/token',
    'https://172.16.0.1/oauth/token',
    'https://192.168.1.1/oauth/token',
    'https://100.64.0.1/oauth/token',
    'https://192.0.2.1/oauth/token',
    'https://198.51.100.1/oauth/token',
    'https://203.0.113.1/oauth/token',
    'https://224.0.0.1/oauth/token',
    'https://[::1]/oauth/token',
    'https://[fd00::1]/oauth/token'
  ])('rejects unsafe server-side endpoint %s', (tokenUrl) => {
    const result = validateOAuthProviderInput(providerInput({ token_url: tokenUrl }))
    expect(result.ok).toBe(false)
  })

  it('accepts HTTPS endpoints on public multi-label hosts', () => {
    const result = validateOAuthProviderInput(providerInput())
    expect(result.ok).toBe(true)
  })

  it('requires HTTPS for provider icons', () => {
    const result = validateOAuthProviderInput(providerInput({ icon_url: 'http://cdn.example.com/icon.svg' }))
    expect(result.ok).toBe(false)
  })
})

describe('OAuth discovery hardening', () => {
  it('resolves and persists allowlisted discovery endpoints before runtime', async () => {
    const instance = await createTestD1()
    instances.push(instance)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      issuer: 'https://accounts.example.com',
      authorization_endpoint: 'https://accounts.example.com/oauth/authorize',
      token_endpoint: 'https://accounts.example.com/oauth/token',
      userinfo_endpoint: 'https://api.example.com/oauth/userinfo'
    }))

    const created = await createOAuthProvider(instance.db, providerInput({
      discovery_url: 'https://accounts.example.com/.well-known/openid-configuration',
      authorization_url: '',
      token_url: '',
      user_info_url: ''
    }), SECRET, TEST_OAUTH_HOSTS)

    expect(created.ok).toBe(true)
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://accounts.example.com/.well-known/openid-configuration',
      expect.objectContaining({ redirect: 'error' })
    )
    const stored = await instance.db.prepare(
      'SELECT authorization_url, token_url, user_info_url FROM oauth_provider WHERE provider_id = ?'
    ).bind('secure-provider').first<Record<string, string>>()
    expect(stored).toMatchObject({
      authorization_url: 'https://accounts.example.com/oauth/authorize',
      token_url: 'https://accounts.example.com/oauth/token',
      user_info_url: 'https://api.example.com/oauth/userinfo'
    })

    const runtime = await listEnabledOAuthProviders(instance.db, SECRET, TEST_OAUTH_HOSTS)
    expect(runtime).toHaveLength(1)
    const config = toGenericOAuthConfig(runtime[0]!, instance.db)
    expect(config.discoveryUrl).toBeUndefined()
    expect(config.authorizationUrl).toBe('https://accounts.example.com/oauth/authorize')
    expect(config.tokenUrl).toBe('https://accounts.example.com/oauth/token')
  })

  it('rejects discovery documents that return non-allowlisted endpoints', async () => {
    const instance = await createTestD1()
    instances.push(instance)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      authorization_endpoint: 'https://accounts.example.com/oauth/authorize',
      token_endpoint: 'https://attacker.example/oauth/token',
      userinfo_endpoint: 'https://api.example.com/oauth/userinfo'
    }))

    const created = await createOAuthProvider(instance.db, providerInput({
      discovery_url: 'https://accounts.example.com/.well-known/openid-configuration',
      authorization_url: '',
      token_url: '',
      user_info_url: ''
    }), SECRET, TEST_OAUTH_HOSTS)

    expect(created.ok).toBe(false)
    expect(await instance.db.prepare(
      'SELECT COUNT(*) AS count FROM oauth_provider'
    ).first<{ count: number }>()).toEqual({ count: 0 })
  })

  it('rejects providers without a trusted userinfo endpoint', async () => {
    const instance = await createTestD1()
    instances.push(instance)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      authorization_endpoint: 'https://accounts.example.com/oauth/authorize',
      token_endpoint: 'https://accounts.example.com/oauth/token'
    }))

    const created = await createOAuthProvider(instance.db, providerInput({
      discovery_url: 'https://accounts.example.com/.well-known/openid-configuration',
      authorization_url: '',
      token_url: '',
      user_info_url: ''
    }), SECRET, TEST_OAUTH_HOSTS)

    expect(created.ok).toBe(false)
    expect(await instance.db.prepare(
      'SELECT COUNT(*) AS count FROM oauth_provider'
    ).first<{ count: number }>()).toEqual({ count: 0 })
  })
})

describe('sensitive configuration encryption', () => {
  it('stores OAuth client secrets encrypted and decrypts only for runtime use', async () => {
    const instance = await createTestD1()
    instances.push(instance)

    const created = await createOAuthProvider(instance.db, providerInput(), SECRET, TEST_OAUTH_HOSTS)
    expect(created.ok).toBe(true)

    const stored = await instance.db
      .prepare('SELECT client_secret FROM oauth_provider WHERE provider_id = ?')
      .bind('secure-provider')
      .first<{ client_secret: string }>()
    expect(stored?.client_secret).toMatch(/^enc:v1:/)
    expect(stored?.client_secret).not.toContain('client-secret-value')

    const runtime = await listEnabledOAuthProviders(instance.db, SECRET, TEST_OAUTH_HOSTS)
    expect(runtime[0]?.client_secret).toBe('client-secret-value')
  })

  it('rejects enabled providers whose stored endpoints are tampered with', async () => {
    const instance = await createTestD1()
    instances.push(instance)

    const created = await createOAuthProvider(instance.db, providerInput(), SECRET, TEST_OAUTH_HOSTS)
    expect(created.ok).toBe(true)
    await instance.db.prepare(
      'UPDATE oauth_provider SET token_url = ? WHERE provider_id = ?'
    ).bind(
      'https://169.254.169.254/latest/meta-data',
      'secure-provider'
    ).run()

    expect(await listEnabledOAuthProviders(instance.db, SECRET, TEST_OAUTH_HOSTS)).toEqual([])
    expect(await listPublicOAuthProviders(instance.db, TEST_OAUTH_HOSTS)).toEqual([])
  })
  it('migrates a legacy plaintext OAuth secret when updating without replacing it', async () => {
    const instance = await createTestD1()
    instances.push(instance)
    const now = Date.now()
    await instance.db.prepare(
      `INSERT INTO oauth_provider
       (id, provider_id, name, client_id, client_secret, discovery_url,
        authorization_url, token_url, user_info_url, scopes, pkce, enabled,
        sort_order, icon_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 1, 1, 0, NULL, ?, ?)`
    ).bind(
      'legacy-provider', 'legacy', 'Legacy', 'legacy-client', 'legacy-plaintext-secret',
      'https://accounts.example.com/authorize', 'https://accounts.example.com/token',
      'https://accounts.example.com/userinfo', 'openid profile email', now, now
    ).run()

    const result = await updateOAuthProvider(
      instance.db,
      'legacy-provider',
      providerInput({ provider_id: 'legacy', client_secret: '' }),
      SECRET,
      TEST_OAUTH_HOSTS
    )
    expect(result.ok).toBe(true)

    const stored = await instance.db
      .prepare('SELECT client_secret FROM oauth_provider WHERE id = ?')
      .bind('legacy-provider')
      .first<{ client_secret: string }>()
    expect(stored?.client_secret).toMatch(/^enc:v1:/)
    expect((await listEnabledOAuthProviders(instance.db, SECRET, TEST_OAUTH_HOSTS))[0]?.client_secret)
      .toBe('legacy-plaintext-secret')
  })

  it('stores Resend API keys encrypted while preserving settings behavior', async () => {
    const instance = await createTestD1()
    instances.push(instance)

    await updateSettings(instance.db, {
      resend_enabled: true,
      resend_accounts: [{ api_key: 're_test_private_key', from: 'Sender <sender@example.com>' }]
    }, SECRET)

    const stored = await instance.db
      .prepare("SELECT resend_api_key FROM settings WHERE id = 'default'")
      .first<{ resend_api_key: string }>()
    expect(stored?.resend_api_key).toMatch(/^enc:v1:/)
    expect(stored?.resend_api_key).not.toContain('re_test_private_key')

    const settings = await getSettings(instance.db, SECRET)
    expect(settings.resend_accounts).toEqual([
      { api_key: 're_test_private_key', from: 'Sender <sender@example.com>' }
    ])
  })
})
