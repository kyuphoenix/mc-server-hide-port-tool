import { getCachedSettings, invalidateSettingsCache } from './request-cache'
import {
  openSensitiveValue,
  sealSensitiveValue,
  type SensitiveDataKeySource
} from './sensitive-data'

export type ResendAccount = {
  api_key: string
  from: string
}

export type SiteDnsMode = 'mc' | 'dns' | 'both'

export type Settings = {
  site_page_title: string
  site_header_name: string
  dns_mode_enabled: boolean
  site_dns_mode: SiteDnsMode
  favicon_url: string
  favicon_data: string
  registration_enabled: boolean
  registration_mode: 'email' | 'oauth' | 'both'
  invite_required: boolean
  email_whitelist_enabled: boolean
  email_whitelist_suffixes: string[]
  email_blacklist_enabled: boolean
  email_blacklist_suffixes: string[]
  github_min_account_age_days: number
  resend_enabled: boolean
  /** Ordered Resend accounts. First is primary; later ones are fallback. */
  resend_accounts: ResendAccount[]
  max_records_per_user: number
  min_subdomain_length: number
}

type DbRow = {
  site_page_title: string | null
  site_header_name: string | null
  dns_mode_enabled: number | null
  site_dns_mode: string | null
  favicon_url: string | null
  favicon_data: string | null
  registration_enabled: number
  registration_mode: string
  invite_required: number | null
  email_whitelist_enabled: number
  email_whitelist_suffixes: string
  email_blacklist_enabled: number
  email_blacklist_suffixes: string
  github_min_account_age_days: number
  resend_enabled: number
  resend_api_key: string | null
  resend_from: string | null
  max_records_per_user: number | null
  min_subdomain_length: number | null
}

export const DEFAULT_SETTINGS: Settings = {
  site_page_title: '子域名分发系统',
  site_header_name: '子域名分发系统',
  dns_mode_enabled: true,
  site_dns_mode: 'both',
  favicon_url: '',
  favicon_data: '',
  registration_enabled: true,
  registration_mode: 'email',
  invite_required: false,
  email_whitelist_enabled: false,
  email_whitelist_suffixes: [],
  email_blacklist_enabled: false,
  email_blacklist_suffixes: [],
  github_min_account_age_days: 0,
  resend_enabled: false,
  resend_accounts: [],
  max_records_per_user: 5,
  min_subdomain_length: 0
}

export function isEmailAllowed(email: string, s: Settings): { ok: boolean; reason?: string } {
  const suffix = email.split('@')[1]?.toLowerCase() ?? ''
  if (!suffix) {
    return { ok: false, reason: '邮箱格式无效' }
  }

  if (s.email_whitelist_enabled) {
    const list = s.email_whitelist_suffixes.map((x) => x.toLowerCase().trim()).filter(Boolean)
    if (list.length > 0 && !list.some((d) => suffix === d || suffix.endsWith('.' + d))) {
      return { ok: false, reason: '邮箱域名不在允许列表中' }
    }
  }

  if (s.email_blacklist_enabled) {
    const list = s.email_blacklist_suffixes.map((x) => x.toLowerCase().trim()).filter(Boolean)
    if (list.some((d) => suffix === d || suffix.endsWith('.' + d))) {
      return { ok: false, reason: '邮箱域名不允许注册' }
    }
  }

  return { ok: true }
}

export function parseResendAccounts(
  apiKeyRaw: string | null | undefined,
  fromRaw: string | null | undefined
): ResendAccount[] {
  const apiRaw = String(apiKeyRaw ?? '').trim()
  const fromRawStr = String(fromRaw ?? '').trim()
  if (!apiRaw && !fromRawStr) return []

  // Preferred: JSON array in resend_api_key, optional parallel from list in resend_from.
  if (apiRaw.startsWith('[')) {
    try {
      const parsed = JSON.parse(apiRaw) as unknown
      if (Array.isArray(parsed)) {
        const fromList = (() => {
          if (fromRawStr.startsWith('[')) {
            try {
              const f = JSON.parse(fromRawStr)
              return Array.isArray(f) ? f.map((x) => String(x ?? '').trim()) : []
            } catch {
              return []
            }
          }
          // single from applied to all, or csv
          if (fromRawStr.includes(',')) {
            return fromRawStr.split(',').map((x) => x.trim()).filter(Boolean)
          }
          return fromRawStr ? [fromRawStr] : []
        })()

        const accounts: ResendAccount[] = []
        for (let i = 0; i < parsed.length; i++) {
          const item = parsed[i]
          if (typeof item === 'string') {
            const api_key = item.trim()
            const from = (fromList[i] || fromList[0] || '').trim()
            if (api_key && from) accounts.push({ api_key, from })
            continue
          }
          if (item && typeof item === 'object') {
            const rec = item as { api_key?: unknown; from?: unknown; apiKey?: unknown }
            const api_key = String(rec.api_key ?? rec.apiKey ?? '').trim()
            const from = String(rec.from ?? fromList[i] ?? fromList[0] ?? '').trim()
            if (api_key && from) accounts.push({ api_key, from })
          }
        }
        return accounts
      }
    } catch {
      // fall through to legacy parsing
    }
  }

  // Legacy single pair
  if (apiRaw && fromRawStr && !apiRaw.includes('\n') && !fromRawStr.includes('\n')) {
    return [{ api_key: apiRaw, from: fromRawStr }]
  }

  // Multiline / CSV pairs: one api key per line, one from per line
  const keys = apiRaw
    .split(/\r?\n|,/)
    .map((x) => x.trim())
    .filter(Boolean)
  const froms = fromRawStr
    .split(/\r?\n|,/)
    .map((x) => x.trim())
    .filter(Boolean)
  const accounts: ResendAccount[] = []
  const n = Math.max(keys.length, froms.length)
  for (let i = 0; i < n; i++) {
    const api_key = (keys[i] || keys[0] || '').trim()
    const from = (froms[i] || froms[0] || '').trim()
    if (api_key && from) accounts.push({ api_key, from })
  }
  // de-dupe exact pairs while preserving order
  const seen = new Set<string>()
  return accounts.filter((a) => {
    const k = `${a.api_key}||${a.from}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export function serializeResendAccounts(accounts: ResendAccount[]): {
  resend_api_key: string | null
  resend_from: string | null
} {
  const cleaned = accounts
    .map((a) => ({
      api_key: String(a.api_key || '').trim(),
      from: String(a.from || '').trim()
    }))
    .filter((a) => a.api_key && a.from)
  if (cleaned.length === 0) {
    return { resend_api_key: null, resend_from: null }
  }
  return {
    resend_api_key: JSON.stringify(cleaned.map((a) => a.api_key)),
    resend_from: JSON.stringify(cleaned.map((a) => a.from))
  }
}

export function hasResendCredentials(s: Settings): boolean {
  return s.resend_accounts.length > 0
}

async function loadSettingsRow(db: D1Database): Promise<DbRow | null> {
  return await db
    .prepare('SELECT * FROM settings WHERE id = ?')
    .bind('default')
    .first<DbRow>()
}

function normalizeSiteDnsMode(raw: string | null | undefined, legacyEnabled: number | boolean | null | undefined): SiteDnsMode {
  if (raw === 'mc' || raw === 'dns' || raw === 'both') return raw
  // Legacy: dns_mode_enabled column (1 = both, 0 = mc); NULL default: both
  const legacyOn = legacyEnabled == null ? true : legacyEnabled === true || legacyEnabled === 1
  return legacyOn ? 'both' : 'mc'
}

export async function getSettings(
  db: D1Database,
  keys?: SensitiveDataKeySource
): Promise<Settings> {
  const row = await getCachedSettings<DbRow | null>(db, () => loadSettingsRow(db))
  if (!row) {
    return { ...DEFAULT_SETTINGS }
  }

  const resendApiKey = await openSensitiveValue(keys, row.resend_api_key ?? '')
  return {
    site_page_title: normalizeSiteText(row.site_page_title, DEFAULT_SETTINGS.site_page_title, 80),
    site_header_name: normalizeSiteText(row.site_header_name, DEFAULT_SETTINGS.site_header_name, 40),
    dns_mode_enabled: row.dns_mode_enabled == null ? DEFAULT_SETTINGS.dns_mode_enabled : !!row.dns_mode_enabled,
    site_dns_mode: normalizeSiteDnsMode(row.site_dns_mode, row.dns_mode_enabled),
    favicon_url: String(row.favicon_url ?? ''),
    favicon_data: String(row.favicon_data ?? ''),
    registration_enabled: !!row.registration_enabled,
    registration_mode: normalizeMode(row.registration_mode),
    invite_required: !!row.invite_required,
    email_whitelist_enabled: !!row.email_whitelist_enabled,
    email_whitelist_suffixes: safeParseArray(row.email_whitelist_suffixes),
    email_blacklist_enabled: !!row.email_blacklist_enabled,
    email_blacklist_suffixes: safeParseArray(row.email_blacklist_suffixes),
    github_min_account_age_days: row.github_min_account_age_days || 0,
    resend_enabled: !!row.resend_enabled,
    resend_accounts: parseResendAccounts(resendApiKey, row.resend_from),
    max_records_per_user: row.max_records_per_user ?? DEFAULT_SETTINGS.max_records_per_user,
    min_subdomain_length: row.min_subdomain_length ?? DEFAULT_SETTINGS.min_subdomain_length
  }
}

export async function updateSettings(
  db: D1Database,
  patch: Partial<Settings>,
  keys?: SensitiveDataKeySource
): Promise<Settings> {
  const current = await getSettings(db, keys)
  const next: Settings = { ...current, ...patch }
  const serialized = serializeResendAccounts(next.resend_accounts)
  const storedResendApiKey = serialized.resend_api_key
    ? await sealSensitiveValue(keys, serialized.resend_api_key)
    : ''
  const sitePageTitle = normalizeSiteText(next.site_page_title, DEFAULT_SETTINGS.site_page_title, 80)
  const siteHeaderName = normalizeSiteText(next.site_header_name, DEFAULT_SETTINGS.site_header_name, 40)
  const siteDnsMode = normalizeSiteDnsMode(next.site_dns_mode, next.dns_mode_enabled)
  // dns_mode_enabled is now a mirror of site_dns_mode to keep legacy readers working.
  const dnsModeEnabled = siteDnsMode !== 'mc'
  const faviconUrl = String(next.favicon_url ?? '').trim().slice(0, 2000)
  const faviconData = String(next.favicon_data ?? '').slice(0, 300_000)

  await db
    .prepare(
      `UPDATE settings SET
        site_page_title = ?,
        site_header_name = ?,
        dns_mode_enabled = ?,
        site_dns_mode = ?,
        favicon_url = ?,
        favicon_data = ?,
        registration_enabled = ?,
        registration_mode = ?,
        invite_required = ?,
        email_whitelist_enabled = ?,
        email_whitelist_suffixes = ?,
        email_blacklist_enabled = ?,
        email_blacklist_suffixes = ?,
        github_min_account_age_days = ?,
        resend_enabled = ?,
        resend_api_key = ?,
        resend_from = ?,
        max_records_per_user = ?,
        min_subdomain_length = ?
      WHERE id = ?`
    )
    .bind(
      sitePageTitle,
      siteHeaderName,
      dnsModeEnabled ? 1 : 0,
      siteDnsMode,
      faviconUrl,
      faviconData,
      next.registration_enabled ? 1 : 0,
      next.registration_mode,
      next.invite_required ? 1 : 0,
      next.email_whitelist_enabled ? 1 : 0,
      JSON.stringify(next.email_whitelist_suffixes),
      next.email_blacklist_enabled ? 1 : 0,
      JSON.stringify(next.email_blacklist_suffixes),
      next.github_min_account_age_days,
      next.resend_enabled ? 1 : 0,
      storedResendApiKey,
      serialized.resend_from,
      next.max_records_per_user,
      next.min_subdomain_length,
      'default'
    )
    .run()

  invalidateSettingsCache(db)
  return {
    ...next,
    site_page_title: sitePageTitle,
    site_header_name: siteHeaderName,
    site_dns_mode: siteDnsMode,
    dns_mode_enabled: dnsModeEnabled,
    favicon_url: faviconUrl,
    favicon_data: faviconData
  }
}

function normalizeSiteText(value: string | null | undefined, fallback: string, maxLength: number): string {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ')
  return (text || fallback).slice(0, maxLength)
}

function normalizeMode(m: string): 'email' | 'oauth' | 'both' {
  if (m === 'oauth') return 'oauth'
  if (m === 'both') return 'both'
  return 'email'
}

function safeParseArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === 'string')
    }
  } catch {
    // empty
  }
  return []
}
