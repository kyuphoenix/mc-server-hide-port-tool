export type Settings = {
  registration_enabled: boolean
  registration_mode: 'email' | 'github' | 'both'
  email_whitelist_enabled: boolean
  email_whitelist_suffixes: string[]
  email_blacklist_enabled: boolean
  email_blacklist_suffixes: string[]
  github_min_account_age_days: number
  resend_enabled: boolean
  resend_api_key: string | null
  resend_from: string | null
}

type DbRow = {
  registration_enabled: number
  registration_mode: string
  email_whitelist_enabled: number
  email_whitelist_suffixes: string
  email_blacklist_enabled: number
  email_blacklist_suffixes: string
  github_min_account_age_days: number
  resend_enabled: number
  resend_api_key: string | null
  resend_from: string | null
}

export const DEFAULT_SETTINGS: Settings = {
  registration_enabled: true,
  registration_mode: 'email',
  email_whitelist_enabled: false,
  email_whitelist_suffixes: [],
  email_blacklist_enabled: false,
  email_blacklist_suffixes: [],
  github_min_account_age_days: 0,
  resend_enabled: false,
  resend_api_key: null,
  resend_from: null
}

export function isEmailAllowed(email: string, s: Settings): { ok: boolean; reason?: string } {
  const suffix = email.split('@')[1]?.toLowerCase() ?? ''
  if (!suffix) {
    return { ok: false, reason: '邮箱格式不正确' }
  }

  if (s.email_whitelist_enabled) {
    const list = s.email_whitelist_suffixes.map((x) => x.toLowerCase().trim()).filter(Boolean)
    if (list.length > 0 && !list.some((d) => suffix === d || suffix.endsWith('.' + d))) {
      return { ok: false, reason: '邮箱后缀不在白名单' }
    }
  }

  if (s.email_blacklist_enabled) {
    const list = s.email_blacklist_suffixes.map((x) => x.toLowerCase().trim()).filter(Boolean)
    if (list.some((d) => suffix === d || suffix.endsWith('.' + d))) {
      return { ok: false, reason: '邮箱后缀在黑名单中' }
    }
  }

  return { ok: true }
}

export async function getSettings(db: D1Database): Promise<Settings> {
  const row = await db
    .prepare('SELECT * FROM settings WHERE id = ?')
    .bind('default')
    .first<DbRow>()

  if (!row) {
    return { ...DEFAULT_SETTINGS }
  }

  return {
    registration_enabled: !!row.registration_enabled,
    registration_mode: normalizeMode(row.registration_mode),
    email_whitelist_enabled: !!row.email_whitelist_enabled,
    email_whitelist_suffixes: safeParseArray(row.email_whitelist_suffixes),
    email_blacklist_enabled: !!row.email_blacklist_enabled,
    email_blacklist_suffixes: safeParseArray(row.email_blacklist_suffixes),
    github_min_account_age_days: row.github_min_account_age_days || 0,
    resend_enabled: !!row.resend_enabled,
    resend_api_key: row.resend_api_key,
    resend_from: row.resend_from
  }
}

export async function updateSettings(
  db: D1Database,
  patch: Partial<Settings>
): Promise<Settings> {
  const current = await getSettings(db)
  const next: Settings = { ...current, ...patch }

  await db
    .prepare(
      `UPDATE settings SET
        registration_enabled = ?,
        registration_mode = ?,
        email_whitelist_enabled = ?,
        email_whitelist_suffixes = ?,
        email_blacklist_enabled = ?,
        email_blacklist_suffixes = ?,
        github_min_account_age_days = ?,
        resend_enabled = ?,
        resend_api_key = ?,
        resend_from = ?
      WHERE id = ?`
    )
    .bind(
      next.registration_enabled ? 1 : 0,
      next.registration_mode,
      next.email_whitelist_enabled ? 1 : 0,
      JSON.stringify(next.email_whitelist_suffixes),
      next.email_blacklist_enabled ? 1 : 0,
      JSON.stringify(next.email_blacklist_suffixes),
      next.github_min_account_age_days,
      next.resend_enabled ? 1 : 0,
      next.resend_api_key ?? null,
      next.resend_from ?? null,
      'default'
    )
    .run()

  return next
}

function normalizeMode(m: string): 'email' | 'github' | 'both' {
  if (m === 'email' || m === 'github' || m === 'both') return m
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
