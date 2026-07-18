import { getCachedEnabledOAuthProviders, invalidateOAuthProviderCache } from './request-cache'
import { ExternalFetchError, fetchWithPolicy, readTextWithLimit } from '../lib/external-fetch'
import { getSettings } from './settings'
import {
  openSensitiveValue,
  sealSensitiveValue,
  type SensitiveDataKeySource
} from './sensitive-data'
import {
  getGitHubPrimaryEmail,
  getGitHubUser,
  meetsAgeRequirement,
  throwGitHubAgeRejected
} from './github'

export type OAuthProviderRow = {
  id: string
  provider_id: string
  name: string
  client_id: string
  client_secret: string
  discovery_url: string | null
  authorization_url: string | null
  token_url: string | null
  user_info_url: string | null
  scopes: string
  pkce: number
  enabled: number
  sort_order: number
  icon_url: string | null
  created_at: number
  updated_at: number
}

export type OAuthProviderPublic = {
  provider_id: string
  name: string
  icon_url: string | null
  sort_order: number
}

export type OAuthProviderAdminView = {
  id: string
  provider_id: string
  name: string
  client_id: string
  has_client_secret: boolean
  discovery_url: string | null
  authorization_url: string | null
  token_url: string | null
  user_info_url: string | null
  scopes: string
  pkce: number
  enabled: number
  sort_order: number
  icon_url: string | null
  created_at: number
  updated_at: number
}

export type OAuthProviderInput = {
  provider_id: string
  name: string
  client_id: string
  client_secret: string
  discovery_url?: string
  authorization_url?: string
  token_url?: string
  user_info_url?: string
  scopes?: string
  pkce?: boolean
  enabled?: boolean
  sort_order?: number
  icon_url?: string
}

export type OAuthTemplate = {
  id: string
  name: string
  provider_id: string
  discovery_url?: string
  authorization_url?: string
  token_url?: string
  user_info_url?: string
  scopes: string
  pkce: boolean
  icon_url?: string
  notes?: string
}

const RESERVED_PROVIDER_IDS = new Set(['credential'])

export const OAUTH_TEMPLATES: OAuthTemplate[] = [
  {
    id: 'github',
    name: 'GitHub',
    provider_id: 'github',
    authorization_url: 'https://github.com/login/oauth/authorize',
    token_url: 'https://github.com/login/oauth/access_token',
    user_info_url: 'https://api.github.com/user',
    scopes: 'read:user,user:email',
    pkce: false,
    icon_url: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/github.svg',
    notes: 'Callback: BETTER_AUTH_URL/api/auth/oauth2/callback/github'
  },
  {
    id: 'google',
    name: 'Google',
    provider_id: 'google',
    discovery_url: 'https://accounts.google.com/.well-known/openid-configuration',
    scopes: 'openid,profile,email',
    pkce: true,
    icon_url: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/google.svg'
  },
  {
    id: 'microsoft',
    name: 'Microsoft Entra ID',
    provider_id: 'microsoft',
    discovery_url:
      'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration',
    scopes: 'openid,profile,email,offline_access',
    pkce: true,
    icon_url: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/microsoft.svg'
  },
  {
    id: 'discord',
    name: 'Discord',
    provider_id: 'discord',
    authorization_url: 'https://discord.com/api/oauth2/authorize',
    token_url: 'https://discord.com/api/oauth2/token',
    user_info_url: 'https://discord.com/api/users/@me',
    scopes: 'identify,email',
    pkce: true,
    icon_url: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/discord.svg'
  },
  {
    id: 'linuxdo',
    name: 'Linux.do',
    provider_id: 'linuxdo',
    authorization_url: 'https://connect.linux.do/oauth2/authorize',
    token_url: 'https://connect.linux.do/oauth2/token',
    user_info_url: 'https://connect.linux.do/api/user',
    scopes: 'openid,profile,email',
    pkce: true,
    icon_url: 'https://cdn3.ldstatic.com/original/4X/c/c/d/ccd8c210609d498cbeb3d5201d4c259348447562.png'
  },
  {
    id: 'oidc',
    name: 'Generic OIDC',
    provider_id: 'oidc',
    discovery_url: '',
    scopes: 'openid,profile,email',
    pkce: true,
    notes: 'Fill discovery_url or authorization/token/userinfo URLs'
  }
]

export function getOAuthTemplate(id: string): OAuthTemplate | null {
  return OAUTH_TEMPLATES.find((t) => t.id === id) ?? null
}

function parseScopes(scopes: string | null | undefined): string[] {
  return String(scopes ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

const BLOCKED_HOST_SUFFIXES = [
  '.local',
  '.internal',
  '.lan',
  '.home',
  '.localhost',
  '.test',
  '.invalid'
]

const DEFAULT_OAUTH_ALLOWED_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'accounts.google.com',
  'oauth2.googleapis.com',
  'openidconnect.googleapis.com',
  'login.microsoftonline.com',
  'graph.microsoft.com',
  'discord.com',
  'connect.linux.do',
  // Reserved integration-test hostname; it cannot resolve on the public Internet.
  'provider.example'
])

const OAUTH_DISCOVERY_TIMEOUT_MS = 5_000
const OAUTH_DISCOVERY_MAX_BYTES = 64 * 1024
const OAUTH_RUNTIME_TIMEOUT_MS = 5_000
const OAUTH_TOKEN_MAX_BYTES = 128 * 1024
const OAUTH_USER_INFO_MAX_BYTES = 256 * 1024

type OAuthValidationOptions = {
  requireSecret?: boolean
  requireUserInfo?: boolean
  allowedHosts?: string
  enforceHostAllowlist?: boolean
}

function isBlockedIpv4(hostname: string): boolean {
  const parts = hostname.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false
  const octets = parts.map(Number)
  if (octets.some((part) => part < 0 || part > 255)) return true
  const [a, b, c] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

function configuredOAuthHostPatterns(raw: string | undefined): string[] {
  return String(raw ?? '')
    .split(/[\s,;]+/)
    .map((entry) => entry.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean)
}

function isAllowedOAuthHostname(hostname: string, configuredHosts: string | undefined): boolean {
  if (DEFAULT_OAUTH_ALLOWED_HOSTS.has(hostname)) return true
  for (const pattern of configuredOAuthHostPatterns(configuredHosts)) {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2)
      if (hostname.endsWith(`.${suffix}`) && hostname !== suffix) return true
      continue
    }
    if (hostname === pattern) return true
  }
  return false
}

function isSafeExternalHttpsUrl(
  raw: string,
  opts: Pick<OAuthValidationOptions, 'allowedHosts' | 'enforceHostAllowlist'> = {}
): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password) return false
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
    if (!hostname || hostname.includes(':')) return false
    if (!hostname.includes('.')) return false
    if (BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return false
    if (isBlockedIpv4(hostname)) return false
    if (opts.enforceHostAllowlist && !isAllowedOAuthHostname(hostname, opts.allowedHosts)) {
      return false
    }
    return true
  } catch {
    return false
  }
}

function normalizeOptionalUrl(raw: string | undefined | null): string | null {
  const v = String(raw ?? '').trim()
  return v ? v : null
}

function normalizeIconUrl(raw: string | undefined | null): string | null {
  const v = String(raw ?? '').trim()
  if (!v) return null
  if (!isSafeExternalHttpsUrl(v)) return null
  return v
}

function firstUnsafeEndpoint(
  entries: Array<[string, string | null]>,
  opts: Pick<OAuthValidationOptions, 'allowedHosts' | 'enforceHostAllowlist'> = {}
): string | null {
  for (const [label, value] of entries) {
    if (value && !isSafeExternalHttpsUrl(value, opts)) return label
  }
  return null
}

export function validateOAuthProviderInput(
  input: OAuthProviderInput,
  opts: OAuthValidationOptions = {}
):
  | {
      ok: true
      value: {
        provider_id: string
        name: string
        client_id: string
        client_secret: string
        discovery_url: string | null
        authorization_url: string | null
        token_url: string | null
        user_info_url: string | null
        scopes: string
        pkce: boolean
        enabled: boolean
        sort_order: number
        icon_url: string | null
      }
    }
  | { ok: false; message: string } {
  const provider_id = String(input.provider_id ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
  const name = String(input.name ?? '').trim()
  const client_id = String(input.client_id ?? '').trim()
  const client_secret = String(input.client_secret ?? '').trim()
  const discovery_url = normalizeOptionalUrl(input.discovery_url)
  const authorization_url = normalizeOptionalUrl(input.authorization_url)
  const token_url = normalizeOptionalUrl(input.token_url)
  const user_info_url = normalizeOptionalUrl(input.user_info_url)
  const icon_url = normalizeIconUrl(input.icon_url)
  const unsafeEndpoint = firstUnsafeEndpoint([
    ['Discovery URL', discovery_url],
    ['Authorization URL', authorization_url],
    ['Token URL', token_url],
    ['User Info URL', user_info_url]
  ], opts)
  const scopes = String(input.scopes ?? 'openid,profile,email').trim() || 'openid,profile,email'
  const pkce = input.pkce !== false
  const enabled = input.enabled !== false
  const sort_order = Number.isFinite(Number(input.sort_order)) ? Math.floor(Number(input.sort_order)) : 0

  if (!provider_id) return { ok: false, message: '提供商 ID 无效（仅支持字母数字、下划线、中划线）' }
  if (RESERVED_PROVIDER_IDS.has(provider_id)) {
    return { ok: false, message: 'provider_id 不能为 credential' }
  }
  if (!name) return { ok: false, message: '请填写显示名称' }
  if (!client_id) return { ok: false, message: '请填写 client_id' }
  if (opts?.requireSecret !== false && !client_secret) {
    return { ok: false, message: '请填写 client_secret' }
  }
  if (unsafeEndpoint) {
    return { ok: false, message: `${unsafeEndpoint} 必须使用 HTTPS 且不能指向本地或保留地址` }
  }
  if (input.icon_url && String(input.icon_url).trim() && !icon_url) {
    return { ok: false, message: '图标 URL 必须使用安全的 HTTPS 地址' }
  }
  if (!discovery_url && !(authorization_url && token_url)) {
    return {
      ok: false,
      message:
        '请填写 Discovery URL，或同时填写 Authorization URL 与 Token URL'
    }
  }

  return {
    ok: true,
    value: {
      provider_id,
      name,
      client_id,
      client_secret,
      discovery_url,
      authorization_url,
      token_url,
      user_info_url,
      scopes,
      pkce,
      enabled,
      sort_order,
      icon_url
    }
  }
}

type ValidatedOAuthProviderInput = Extract<
  ReturnType<typeof validateOAuthProviderInput>,
  { ok: true }
>['value']

type OAuthDiscoveryDocument = {
  issuer?: unknown
  authorization_endpoint?: unknown
  token_endpoint?: unknown
  userinfo_endpoint?: unknown
}

async function fetchOAuthDiscoveryDocument(
  discoveryUrl: string,
  allowedHosts: string | undefined
): Promise<OAuthDiscoveryDocument> {
  if (!isSafeExternalHttpsUrl(discoveryUrl, {
    allowedHosts,
    enforceHostAllowlist: true
  })) {
    throw new Error('oauth_discovery_host_not_allowed')
  }

  const response = await fetchWithPolicy(discoveryUrl, {
    method: 'GET',
    redirect: 'error',
    headers: { Accept: 'application/json' }
  }, {
    timeoutMs: OAUTH_DISCOVERY_TIMEOUT_MS,
    retries: 1
  })
  if (!response.ok) throw new Error('oauth_discovery_request_failed')
  const text = await readTextWithLimit(response, OAUTH_DISCOVERY_MAX_BYTES, OAUTH_DISCOVERY_TIMEOUT_MS)
  const parsed = JSON.parse(text) as OAuthDiscoveryDocument
  if (!parsed || typeof parsed !== 'object') throw new Error('oauth_discovery_invalid_json')
  return parsed
}

async function resolveOAuthProviderInput(
  input: OAuthProviderInput,
  opts: OAuthValidationOptions
): Promise<ReturnType<typeof validateOAuthProviderInput>> {
  const initial = validateOAuthProviderInput(input, opts)
  if (!initial.ok) return initial
  if (!initial.value.discovery_url) {
    if (opts.requireUserInfo && !initial.value.user_info_url) {
      return { ok: false, message: 'OAuth provider requires an allowlisted UserInfo URL' }
    }
    return initial
  }
  if (
    initial.value.authorization_url &&
    initial.value.token_url &&
    (!opts.requireUserInfo || initial.value.user_info_url)
  ) {
    return initial
  }

  let discovery: OAuthDiscoveryDocument
  try {
    discovery = await fetchOAuthDiscoveryDocument(initial.value.discovery_url, opts.allowedHosts)
  } catch {
    return { ok: false, message: 'OAuth Discovery 获取或验证失败' }
  }

  const authorizationUrl = String(discovery.authorization_endpoint ?? '').trim()
  const tokenUrl = String(discovery.token_endpoint ?? '').trim()
  const userInfoUrl = String(discovery.userinfo_endpoint ?? '').trim()
  if (!authorizationUrl || !tokenUrl) {
    return { ok: false, message: 'OAuth Discovery 缺少 authorization_endpoint 或 token_endpoint' }
  }

  const resolved = validateOAuthProviderInput({
    ...input,
    discovery_url: initial.value.discovery_url,
    authorization_url: authorizationUrl,
    token_url: tokenUrl,
    user_info_url: initial.value.user_info_url || userInfoUrl
  }, opts)
  if (!resolved.ok) {
    return { ok: false, message: 'OAuth Discovery 返回了未获准的 endpoint' }
  }
  if (opts.requireUserInfo && !resolved.value.user_info_url) {
    return { ok: false, message: 'OAuth Discovery 缺少 userinfo_endpoint' }
  }
  return resolved
}

async function persistResolvedOAuthEndpoints(
  db: D1Database,
  id: string,
  value: ValidatedOAuthProviderInput
): Promise<void> {
  await db.prepare(
    `UPDATE oauth_provider
     SET authorization_url = ?, token_url = ?, user_info_url = ?, updated_at = ?
     WHERE id = ?`
  ).bind(
    value.authorization_url,
    value.token_url,
    value.user_info_url,
    Date.now(),
    id
  ).run()
  invalidateOAuthProviderCache(db)
}

function storedProviderInput(row: OAuthProviderRow, clientSecret = row.client_secret): OAuthProviderInput {
  return {
    provider_id: row.provider_id,
    name: row.name,
    client_id: row.client_id,
    client_secret: clientSecret,
    discovery_url: row.discovery_url || undefined,
    authorization_url: row.authorization_url || undefined,
    token_url: row.token_url || undefined,
    user_info_url: row.user_info_url || undefined,
    scopes: row.scopes,
    pkce: !!row.pkce,
    enabled: !!row.enabled,
    sort_order: row.sort_order,
    icon_url: row.icon_url || undefined
  }
}

export async function listOAuthProviders(db: D1Database): Promise<OAuthProviderRow[]> {
  const result = await db
    .prepare('SELECT * FROM oauth_provider ORDER BY sort_order ASC, created_at ASC')
    .all<OAuthProviderRow>()
  return result.results ?? []
}

export function maskOAuthProviderForAdmin(row: OAuthProviderRow): OAuthProviderAdminView {
  return {
    id: row.id,
    provider_id: row.provider_id,
    name: row.name,
    client_id: row.client_id,
    has_client_secret: String(row.client_secret ?? '').trim().length > 0,
    discovery_url: row.discovery_url,
    authorization_url: row.authorization_url,
    token_url: row.token_url,
    user_info_url: row.user_info_url,
    scopes: row.scopes,
    pkce: row.pkce,
    enabled: row.enabled,
    sort_order: row.sort_order,
    icon_url: row.icon_url,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

export async function listOAuthProvidersForAdmin(db: D1Database): Promise<OAuthProviderAdminView[]> {
  const rows = await listOAuthProviders(db)
  return rows.map(maskOAuthProviderForAdmin)
}

async function loadEnabledOAuthProviders(db: D1Database): Promise<OAuthProviderRow[]> {
  const result = await db
    .prepare('SELECT * FROM oauth_provider WHERE enabled = 1 ORDER BY sort_order ASC, created_at ASC')
    .all<OAuthProviderRow>()
  return result.results ?? []
}

function logRuntimeProviderRejected(row: OAuthProviderRow, reason: string): void {
  console.error(JSON.stringify({
    event: 'oauth_provider_runtime_rejected',
    provider_id: row.id,
    reason
  }))
}

export async function listEnabledOAuthProviders(
  db: D1Database,
  keys: SensitiveDataKeySource,
  allowedHosts?: string
): Promise<OAuthProviderRow[]> {
  const rows = await getCachedEnabledOAuthProviders<OAuthProviderRow[]>(db, () => loadEnabledOAuthProviders(db))
  const providers: OAuthProviderRow[] = []
  for (const row of rows) {
    let provider: OAuthProviderRow
    try {
      provider = {
        ...row,
        client_secret: await openSensitiveValue(keys, row.client_secret)
      }
    } catch {
      // A single stale or corrupted encrypted secret must not disable every
      // other OAuth provider configured for the deployment.
      logRuntimeProviderRejected(row, 'secret_unavailable')
      continue
    }

    const validated = await resolveOAuthProviderInput(
      storedProviderInput(provider, provider.client_secret),
      { requireSecret: true, requireUserInfo: true, allowedHosts, enforceHostAllowlist: true }
    )
    if (!validated.ok) {
      logRuntimeProviderRejected(row, 'invalid_configuration')
      continue
    }
    const resolvedProvider: OAuthProviderRow = {
      ...provider,
      authorization_url: validated.value.authorization_url,
      token_url: validated.value.token_url,
      user_info_url: validated.value.user_info_url
    }
    if (
      provider.authorization_url !== resolvedProvider.authorization_url ||
      provider.token_url !== resolvedProvider.token_url ||
      provider.user_info_url !== resolvedProvider.user_info_url
    ) {
      await persistResolvedOAuthEndpoints(db, provider.id, validated.value).catch(() => undefined)
    }
    providers.push(resolvedProvider)
  }
  return providers
}

export async function listPublicOAuthProviders(
  db: D1Database,
  keys: SensitiveDataKeySource,
  allowedHosts?: string
): Promise<OAuthProviderPublic[]> {
  // Use the exact same resolved and allowlisted provider set as createAuth().
  // This keeps login/register pages compatible with providers created before
  // resolved discovery endpoints were persisted.
  const rows = await listEnabledOAuthProviders(db, keys, allowedHosts)
  return rows.map((r) => ({
    provider_id: r.provider_id,
    name: r.name,
    icon_url: r.icon_url ?? null,
    sort_order: r.sort_order
  }))
}

export async function findOAuthProviderById(db: D1Database, id: string): Promise<OAuthProviderRow | null> {
  return await db.prepare('SELECT * FROM oauth_provider WHERE id = ?').bind(id).first<OAuthProviderRow>()
}

export async function findOAuthProviderByProviderId(
  db: D1Database,
  providerId: string
): Promise<OAuthProviderRow | null> {
  return await db
    .prepare('SELECT * FROM oauth_provider WHERE provider_id = ?')
    .bind(providerId)
    .first<OAuthProviderRow>()
}

export async function createOAuthProvider(
  db: D1Database,
  input: OAuthProviderInput,
  keys: SensitiveDataKeySource,
  allowedHosts?: string
): Promise<{ ok: true; provider: OAuthProviderRow } | { ok: false; message: string }> {
  const validated = await resolveOAuthProviderInput(input, {
    requireSecret: true,
    requireUserInfo: true,
    allowedHosts,
    enforceHostAllowlist: true
  })
  if (!validated.ok) return validated

  const existing = await findOAuthProviderByProviderId(db, validated.value.provider_id)
  if (existing) return { ok: false, message: 'provider_id 已存在' }

  const now = Date.now()
  const id = crypto.randomUUID()
  const sealedClientSecret = await sealSensitiveValue(keys, validated.value.client_secret)
  const row: OAuthProviderRow = {
    id,
    provider_id: validated.value.provider_id,
    name: validated.value.name,
    client_id: validated.value.client_id,
    client_secret: sealedClientSecret,
    discovery_url: validated.value.discovery_url,
    authorization_url: validated.value.authorization_url,
    token_url: validated.value.token_url,
    user_info_url: validated.value.user_info_url,
    scopes: validated.value.scopes,
    pkce: validated.value.pkce ? 1 : 0,
    enabled: validated.value.enabled ? 1 : 0,
    sort_order: validated.value.sort_order,
    icon_url: validated.value.icon_url,
    created_at: now,
    updated_at: now
  }

  await db
    .prepare(
      `INSERT INTO oauth_provider
        (id, provider_id, name, client_id, client_secret, discovery_url, authorization_url, token_url, user_info_url, scopes, pkce, enabled, sort_order, icon_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      row.id,
      row.provider_id,
      row.name,
      row.client_id,
      row.client_secret,
      row.discovery_url,
      row.authorization_url,
      row.token_url,
      row.user_info_url,
      row.scopes,
      row.pkce,
      row.enabled,
      row.sort_order,
      row.icon_url,
      row.created_at,
      row.updated_at
    )
    .run()

  invalidateOAuthProviderCache(db)
  return { ok: true, provider: row }
}

export async function updateOAuthProvider(
  db: D1Database,
  id: string,
  input: OAuthProviderInput,
  encryptionKeys: SensitiveDataKeySource,
  allowedHosts?: string
): Promise<{ ok: true; provider: OAuthProviderRow } | { ok: false; message: string }> {
  const current = await findOAuthProviderById(db, id)
  if (!current) return { ok: false, message: 'OAuth 应用不存在' }

  const clientSecret = input.client_secret.trim() || await openSensitiveValue(
    encryptionKeys,
    current.client_secret
  )
  const validated = await resolveOAuthProviderInput(
    { ...input, client_secret: clientSecret },
    { requireSecret: true, requireUserInfo: true, allowedHosts, enforceHostAllowlist: true }
  )
  if (!validated.ok) return validated

  const conflict = await findOAuthProviderByProviderId(db, validated.value.provider_id)
  if (conflict && conflict.id !== id) {
    return { ok: false, message: 'provider_id 已存在' }
  }

  const now = Date.now()
  const sealedClientSecret = await sealSensitiveValue(encryptionKeys, validated.value.client_secret)
  await db
    .prepare(
      `UPDATE oauth_provider SET
        provider_id = ?,
        name = ?,
        client_id = ?,
        client_secret = ?,
        discovery_url = ?,
        authorization_url = ?,
        token_url = ?,
        user_info_url = ?,
        scopes = ?,
        pkce = ?,
        enabled = ?,
        sort_order = ?,
        icon_url = ?,
        updated_at = ?
      WHERE id = ?`
    )
    .bind(
      validated.value.provider_id,
      validated.value.name,
      validated.value.client_id,
      sealedClientSecret,
      validated.value.discovery_url,
      validated.value.authorization_url,
      validated.value.token_url,
      validated.value.user_info_url,
      validated.value.scopes,
      validated.value.pkce ? 1 : 0,
      validated.value.enabled ? 1 : 0,
      validated.value.sort_order,
      validated.value.icon_url,
      now,
      id
    )
    .run()

  const updated = await findOAuthProviderById(db, id)
  if (!updated) return { ok: false, message: '更新失败' }
  invalidateOAuthProviderCache(db)
  return { ok: true, provider: updated }
}

export async function deleteOAuthProvider(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM oauth_provider WHERE id = ?').bind(id).run()
  invalidateOAuthProviderCache(db)
}

export async function setOAuthProviderEnabled(
  db: D1Database,
  id: string,
  enabled: boolean
): Promise<void> {
  await db
    .prepare('UPDATE oauth_provider SET enabled = ?, updated_at = ? WHERE id = ?')
    .bind(enabled ? 1 : 0, Date.now(), id)
    .run()
  invalidateOAuthProviderCache(db)
}


type OAuthRuntimeTokens = {
  tokenType?: string
  accessToken?: string
  refreshToken?: string
  accessTokenExpiresAt?: Date
  refreshTokenExpiresAt?: Date
  scopes?: string[]
  idToken?: string
  raw?: Record<string, unknown>
}

type OAuthTokenExchangeInput = {
  code: string
  redirectURI: string
  codeVerifier?: string
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function oauthProfileId(value: unknown): string | undefined {
  const stringValue = nonEmptyString(value)
  if (stringValue) return stringValue
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined
}

function oauthExpiryDate(value: unknown): Date | undefined {
  const seconds = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined
  const date = new Date(Date.now() + seconds * 1_000)
  return Number.isFinite(date.getTime()) ? date : undefined
}

function oauthScopes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(nonEmptyString).filter((scope): scope is string => !!scope)
  }
  return String(value ?? '')
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
}

function parseOAuthResponseRecord(
  text: string,
  contentType: string | null,
  allowFormEncoded: boolean
): Record<string, unknown> {
  const trimmed = text.trim()
  if (!trimmed) throw new ExternalFetchError('EXTERNAL_REQUEST_FAILED')

  if (contentType?.toLowerCase().includes('application/x-www-form-urlencoded')) {
    if (!allowFormEncoded) throw new ExternalFetchError('EXTERNAL_REQUEST_FAILED')
    return Object.fromEntries(new URLSearchParams(trimmed))
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid_oauth_response')
    }
    return parsed as Record<string, unknown>
  } catch {
    if (allowFormEncoded && trimmed.includes('=')) {
      return Object.fromEntries(new URLSearchParams(trimmed))
    }
    throw new ExternalFetchError('EXTERNAL_REQUEST_FAILED')
  }
}

function assertSafeOAuthRuntimeUrl(raw: string | null, allowedHosts: string | undefined): string {
  if (!raw || !isSafeExternalHttpsUrl(raw, {
    allowedHosts,
    enforceHostAllowlist: true
  })) {
    throw new ExternalFetchError('EXTERNAL_REQUEST_FAILED')
  }
  return raw
}

const SAFE_OAUTH_UPSTREAM_ERROR = /^[A-Za-z0-9_.:-]{1,80}$/

function safeOAuthUpstreamError(raw: Record<string, unknown>, fallback: string): string {
  const value = nonEmptyString(raw.error) ?? nonEmptyString(raw.error_code) ?? nonEmptyString(raw.code)
  return value && SAFE_OAUTH_UPSTREAM_ERROR.test(value) ? value : fallback
}

function logOAuthTokenExchangeFailure(
  row: OAuthProviderRow,
  tokenUrl: string,
  responseStatus: number | null,
  upstreamError: string
): void {
  console.error(JSON.stringify({
    event: 'oauth_token_exchange_failed',
    provider_id: row.provider_id,
    token_host: new URL(tokenUrl).hostname,
    response_status: responseStatus,
    upstream_error: upstreamError
  }))
}

async function exchangeOAuthCode(
  row: OAuthProviderRow,
  input: OAuthTokenExchangeInput,
  allowedHosts: string | undefined
): Promise<OAuthRuntimeTokens> {
  const tokenUrl = assertSafeOAuthRuntimeUrl(row.token_url, allowedHosts)
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectURI,
    client_id: row.client_id
  })
  if (row.client_secret) body.set('client_secret', row.client_secret)
  if (input.codeVerifier) body.set('code_verifier', input.codeVerifier)

  let response: Response
  try {
    response = await fetchWithPolicy(tokenUrl, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'hide-port-tool'
      },
      body
    }, {
      timeoutMs: OAUTH_RUNTIME_TIMEOUT_MS,
      retries: 0
    })
  } catch (error) {
    const upstreamError = error instanceof ExternalFetchError && error.code === 'EXTERNAL_REQUEST_TIMEOUT'
      ? 'request_timeout'
      : 'request_failed'
    logOAuthTokenExchangeFailure(row, tokenUrl, null, upstreamError)
    throw error
  }

  let raw: Record<string, unknown>
  try {
    const text = await readTextWithLimit(response, OAUTH_TOKEN_MAX_BYTES, OAUTH_RUNTIME_TIMEOUT_MS)
    raw = parseOAuthResponseRecord(text, response.headers.get('content-type'), true)
  } catch (error) {
    logOAuthTokenExchangeFailure(row, tokenUrl, response.status, 'invalid_response')
    throw error
  }

  if (!response.ok) {
    logOAuthTokenExchangeFailure(
      row,
      tokenUrl,
      response.status,
      safeOAuthUpstreamError(raw, 'http_error')
    )
    throw new ExternalFetchError('EXTERNAL_REQUEST_FAILED')
  }

  const accessToken = nonEmptyString(raw.access_token)
  if (!accessToken) {
    logOAuthTokenExchangeFailure(
      row,
      tokenUrl,
      response.status,
      safeOAuthUpstreamError(raw, 'missing_access_token')
    )
    throw new ExternalFetchError('EXTERNAL_REQUEST_FAILED')
  }

  return {
    tokenType: nonEmptyString(raw.token_type),
    accessToken,
    refreshToken: nonEmptyString(raw.refresh_token),
    accessTokenExpiresAt: oauthExpiryDate(raw.expires_in),
    refreshTokenExpiresAt: oauthExpiryDate(raw.refresh_token_expires_in),
    scopes: oauthScopes(raw.scope),
    idToken: nonEmptyString(raw.id_token)
  }
}

function oauthProfileBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

function oauthProfileImage(value: unknown): string | undefined {
  const image = nonEmptyString(value)
  return image && isSafeExternalHttpsUrl(image) ? image : undefined
}

async function fetchOAuthUserInfo(
  row: OAuthProviderRow,
  tokens: OAuthRuntimeTokens,
  allowedHosts: string | undefined
) {
  const userInfoUrl = assertSafeOAuthRuntimeUrl(row.user_info_url, allowedHosts)
  const accessToken = nonEmptyString(tokens.accessToken)
  if (!accessToken) return null

  const response = await fetchWithPolicy(userInfoUrl, {
    method: 'GET',
    redirect: 'error',
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + accessToken
    }
  }, {
    timeoutMs: OAUTH_RUNTIME_TIMEOUT_MS,
    retries: 1
  })
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined)
    throw new ExternalFetchError('EXTERNAL_REQUEST_FAILED')
  }

  const text = await readTextWithLimit(response, OAUTH_USER_INFO_MAX_BYTES, OAUTH_RUNTIME_TIMEOUT_MS)
  const profile = parseOAuthResponseRecord(text, response.headers.get('content-type'), false)
  const id = oauthProfileId(profile.id) ?? oauthProfileId(profile.sub)
  if (!id) return null

  const email = nonEmptyString(profile.email) ?? null
  const name = nonEmptyString(profile.name)
    ?? nonEmptyString(profile.preferred_username)
    ?? nonEmptyString(profile.username)
    ?? nonEmptyString(profile.login)
    ?? email
  if (!name) return null

  return {
    id,
    name,
    email,
    image: oauthProfileImage(profile.picture ?? profile.avatar_url),
    emailVerified: oauthProfileBoolean(profile.email_verified ?? profile.verified_email)
  }
}

export function toGenericOAuthConfig(
  row: OAuthProviderRow,
  db: D1Database,
  policy?: { disableSignUp?: boolean; disableImplicitSignUp?: boolean },
  sensitiveKeys?: SensitiveDataKeySource,
  allowedHosts?: string
) {
  const base = {
    providerId: row.provider_id,
    clientId: row.client_id,
    clientSecret: row.client_secret,
    // Discovery is resolved and validated before runtime. Never let the auth
    // library fetch a mutable discovery document during a login request.
    discoveryUrl: undefined,
    authorizationUrl: row.authorization_url || undefined,
    tokenUrl: row.token_url || undefined,
    userInfoUrl: row.user_info_url || undefined,
    scopes: parseScopes(row.scopes),
    pkce: !!row.pkce,
    disableSignUp: policy?.disableSignUp === true,
    // Default true: login must not create accounts unless requestSignUp is set.
    disableImplicitSignUp: policy?.disableImplicitSignUp !== false,
    getToken: (input: OAuthTokenExchangeInput) => exchangeOAuthCode(row, input, allowedHosts)
  }

  if (row.provider_id === 'github') {
    return {
      ...base,
      async getUserInfo(tokens: { accessToken?: string | null }) {
        const accessToken = tokens.accessToken
        if (!accessToken) return null

        const profile = await getGitHubUser(accessToken)
        if (!profile?.id) return null

        const accountId = String(profile.id)
        let email = profile.email || null
        if (!email) {
          email = await getGitHubPrimaryEmail(accessToken)
        }
        if (!email) return null

        // Only enforce age for brand-new local accounts. Existing linked users may still log in.
        const existingAccount = await db
          .prepare(
            "SELECT id FROM account WHERE providerId = 'github' AND accountId = ? LIMIT 1"
          )
          .bind(accountId)
          .first<{ id: string }>()
        const existingUser = existingAccount
          ? null
          : await db
              .prepare('SELECT id FROM user WHERE email = ? LIMIT 1')
              .bind(email.toLowerCase())
              .first<{ id: string }>()

        if (!existingAccount && !existingUser) {
          const settings = await getSettings(db, sensitiveKeys)
          if (
            settings.github_min_account_age_days > 0 &&
            !meetsAgeRequirement(profile.created_at, settings.github_min_account_age_days)
          ) {
            const createdMs = Date.parse(profile.created_at)
            const actualDays = Number.isFinite(createdMs)
              ? (Date.now() - createdMs) / 86400000
              : null
            // Throwing aborts OAuth callback before better-auth creates user/session.
            throwGitHubAgeRejected(settings.github_min_account_age_days, actualDays)
          }
        }

        return {
          id: accountId,
          name: profile.name || profile.login || email,
          email,
          image: profile.avatar_url || undefined,
          emailVerified: true
        }
      }
    }
  }

  return {
    ...base,
    getUserInfo: (tokens: OAuthRuntimeTokens) => fetchOAuthUserInfo(row, tokens, allowedHosts)
  }
}
