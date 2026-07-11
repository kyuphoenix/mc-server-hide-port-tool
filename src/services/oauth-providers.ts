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
  created_at: number
  updated_at: number
}

export type OAuthProviderPublic = {
  id: string
  provider_id: string
  name: string
  enabled: boolean
}

export type OAuthProviderInput = {
  provider_id: string
  name: string
  client_id: string
  client_secret: string
  discovery_url?: string | null
  authorization_url?: string | null
  token_url?: string | null
  user_info_url?: string | null
  scopes?: string
  pkce?: boolean
  enabled?: boolean
  sort_order?: number
}

function normalizeProviderId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function normalizeOptionalUrl(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim()
  return v ? v : null
}

export function parseScopes(scopes: string | null | undefined): string[] {
  return String(scopes ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function validateOAuthProviderInput(
  input: OAuthProviderInput,
  opts?: { requireSecret?: boolean }
): { ok: true; value: Required<Pick<OAuthProviderInput, 'provider_id' | 'name' | 'client_id' | 'client_secret' | 'scopes' | 'pkce' | 'enabled' | 'sort_order'>> & {
  discovery_url: string | null
  authorization_url: string | null
  token_url: string | null
  user_info_url: string | null
} } | { ok: false; message: string } {
  const provider_id = normalizeProviderId(input.provider_id)
  const name = input.name.trim()
  const client_id = input.client_id.trim()
  const client_secret = input.client_secret.trim()
  const discovery_url = normalizeOptionalUrl(input.discovery_url)
  const authorization_url = normalizeOptionalUrl(input.authorization_url)
  const token_url = normalizeOptionalUrl(input.token_url)
  const user_info_url = normalizeOptionalUrl(input.user_info_url)
  const scopes = (input.scopes ?? 'openid,profile,email').trim() || 'openid,profile,email'
  const pkce = input.pkce !== false
  const enabled = input.enabled !== false
  const sort_order = Math.max(0, Math.floor(Number(input.sort_order ?? 0) || 0))

  if (!provider_id) return { ok: false, message: 'provider_id 无效（仅支持字母数字、下划线、中划线）' }
  if (provider_id === 'credential') return { ok: false, message: 'provider_id 不能为 credential' }
  if (!name) return { ok: false, message: '请填写显示名称' }
  if (!client_id) return { ok: false, message: '请填写 Client ID' }
  if ((opts?.requireSecret ?? true) && !client_secret) {
    return { ok: false, message: '请填写 Client Secret' }
  }
  if (!discovery_url && !(authorization_url && token_url)) {
    return { ok: false, message: '请填写 Discovery URL，或同时填写 Authorization URL 与 Token URL' }
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
      sort_order
    }
  }
}

export async function listOAuthProviders(db: D1Database): Promise<OAuthProviderRow[]> {
  const result = await db
    .prepare('SELECT * FROM oauth_provider ORDER BY sort_order ASC, created_at ASC')
    .all<OAuthProviderRow>()
  return result.results ?? []
}

export async function listEnabledOAuthProviders(db: D1Database): Promise<OAuthProviderRow[]> {
  const result = await db
    .prepare('SELECT * FROM oauth_provider WHERE enabled = 1 ORDER BY sort_order ASC, created_at ASC')
    .all<OAuthProviderRow>()
  return result.results ?? []
}

export async function listPublicOAuthProviders(db: D1Database): Promise<OAuthProviderPublic[]> {
  const rows = await listEnabledOAuthProviders(db)
  return rows.map((r) => ({
    id: r.id,
    provider_id: r.provider_id,
    name: r.name,
    enabled: true
  }))
}

export async function findOAuthProviderById(db: D1Database, id: string): Promise<OAuthProviderRow | null> {
  return await db
    .prepare('SELECT * FROM oauth_provider WHERE id = ?')
    .bind(id)
    .first<OAuthProviderRow>()
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
  input: OAuthProviderInput
): Promise<{ ok: true; provider: OAuthProviderRow } | { ok: false; message: string }> {
  const validated = validateOAuthProviderInput(input, { requireSecret: true })
  if (!validated.ok) return validated

  const existing = await findOAuthProviderByProviderId(db, validated.value.provider_id)
  if (existing) return { ok: false, message: 'provider_id 已存在' }

  // 保留内置 github env 配置的命名空间，避免冲突
  if (validated.value.provider_id === 'github') {
    return { ok: false, message: 'github 为内置提供商，请改用其他 provider_id（如 github-enterprise）' }
  }

  const now = Date.now()
  const id = crypto.randomUUID()
  const row: OAuthProviderRow = {
    id,
    provider_id: validated.value.provider_id,
    name: validated.value.name,
    client_id: validated.value.client_id,
    client_secret: validated.value.client_secret,
    discovery_url: validated.value.discovery_url,
    authorization_url: validated.value.authorization_url,
    token_url: validated.value.token_url,
    user_info_url: validated.value.user_info_url,
    scopes: validated.value.scopes,
    pkce: validated.value.pkce ? 1 : 0,
    enabled: validated.value.enabled ? 1 : 0,
    sort_order: validated.value.sort_order,
    created_at: now,
    updated_at: now
  }

  await db
    .prepare(
      `INSERT INTO oauth_provider
        (id, provider_id, name, client_id, client_secret, discovery_url, authorization_url, token_url, user_info_url, scopes, pkce, enabled, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      row.created_at,
      row.updated_at
    )
    .run()

  return { ok: true, provider: row }
}

export async function updateOAuthProvider(
  db: D1Database,
  id: string,
  input: OAuthProviderInput & { keep_secret?: boolean }
): Promise<{ ok: true; provider: OAuthProviderRow } | { ok: false; message: string }> {
  const current = await findOAuthProviderById(db, id)
  if (!current) return { ok: false, message: 'OAuth 应用不存在' }

  const secret = input.client_secret.trim() || current.client_secret
  const validated = validateOAuthProviderInput(
    { ...input, client_secret: secret },
    { requireSecret: true }
  )
  if (!validated.ok) return validated

  if (validated.value.provider_id === 'github') {
    return { ok: false, message: 'github 为内置提供商，请改用其他 provider_id' }
  }

  const conflict = await findOAuthProviderByProviderId(db, validated.value.provider_id)
  if (conflict && conflict.id !== id) {
    return { ok: false, message: 'provider_id 已存在' }
  }

  const now = Date.now()
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
        updated_at = ?
      WHERE id = ?`
    )
    .bind(
      validated.value.provider_id,
      validated.value.name,
      validated.value.client_id,
      validated.value.client_secret,
      validated.value.discovery_url,
      validated.value.authorization_url,
      validated.value.token_url,
      validated.value.user_info_url,
      validated.value.scopes,
      validated.value.pkce ? 1 : 0,
      validated.value.enabled ? 1 : 0,
      validated.value.sort_order,
      now,
      id
    )
    .run()

  const updated = await findOAuthProviderById(db, id)
  if (!updated) return { ok: false, message: '更新失败' }
  return { ok: true, provider: updated }
}

export async function deleteOAuthProvider(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM oauth_provider WHERE id = ?').bind(id).run()
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
}

export function toGenericOAuthConfig(row: OAuthProviderRow) {
  return {
    providerId: row.provider_id,
    clientId: row.client_id,
    clientSecret: row.client_secret,
    discoveryUrl: row.discovery_url || undefined,
    authorizationUrl: row.authorization_url || undefined,
    tokenUrl: row.token_url || undefined,
    userInfoUrl: row.user_info_url || undefined,
    scopes: parseScopes(row.scopes),
    pkce: !!row.pkce
  }
}
