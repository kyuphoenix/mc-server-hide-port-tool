import { APIError } from 'better-auth'

export type GitHubUser = {
  id: number
  login: string
  name: string | null
  email: string | null
  avatar_url: string | null
  created_at: string
}

/** Stable machine code embedded in thrown errors for callback interception. */
export const GITHUB_ACCOUNT_AGE_REJECTED_CODE = 'GITHUB_ACCOUNT_AGE_REJECTED'

export async function getGitHubUser(accessToken: string): Promise<GitHubUser | null> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'hide-port-tool'
    }
  })
  if (!res.ok) return null
  return (await res.json()) as GitHubUser
}

export async function getGitHubPrimaryEmail(accessToken: string): Promise<string | null> {
  const emailsRes = await fetch('https://api.github.com/user/emails', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'hide-port-tool'
    }
  })
  if (!emailsRes.ok) return null
  const emails = (await emailsRes.json()) as Array<{
    email?: string
    primary?: boolean
    verified?: boolean
  }>
  const primary = emails.find((e) => e.primary && e.email) || emails.find((e) => e.email)
  return primary?.email ?? null
}

export function meetsAgeRequirement(createdAt: string, minDays: number): boolean {
  if (!minDays || minDays <= 0) return true
  const createdMs = Date.parse(createdAt)
  if (Number.isNaN(createdMs)) return false
  const ageDays = (Date.now() - createdMs) / 86400000
  return ageDays >= minDays
}

export function githubAgeErrorMessage(minDays: number): string {
  return `GitHub 账号注册天数不足 ${minDays} 天`
}

export function githubAgeRejectedMessage(minDays: number, actualDays?: number | null): string {
  const base = `${GITHUB_ACCOUNT_AGE_REJECTED_CODE}:${Math.max(0, Math.floor(minDays))} ${githubAgeErrorMessage(minDays)}`
  if (actualDays == null || !Number.isFinite(actualDays)) return base
  return `${base} actual_days=${Math.max(0, Math.floor(actualDays))}`
}

/**
 * Abort OAuth callback before better-auth creates user/session.
 * Prefer APIError so better-call returns a JSON body with the machine code;
 * plain Error becomes an empty 500 and loses the rejection details.
 * Callers still intercept callback failures and redirect to the rejection page.
 */
export function throwGitHubAgeRejected(minDays: number, actualDays?: number | null): never {
  // APIError is converted to a JSON response by better-auth/better-call,
  // so the OAuth callback interceptor can read the machine code from the body.
  // A plain Error becomes an empty 500 and loses the message.
  throw new APIError('FORBIDDEN', {
    message: githubAgeRejectedMessage(minDays, actualDays),
    code: GITHUB_ACCOUNT_AGE_REJECTED_CODE
  })
}

export function isGitHubAgeRejectedError(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.includes(GITHUB_ACCOUNT_AGE_REJECTED_CODE)
  }
  if (value instanceof Error) {
    return value.message.includes(GITHUB_ACCOUNT_AGE_REJECTED_CODE)
  }
  if (value && typeof value === 'object') {
    const rec = value as { message?: unknown; code?: unknown; error?: unknown; body?: unknown }
    if (typeof rec.message === 'string' && rec.message.includes(GITHUB_ACCOUNT_AGE_REJECTED_CODE)) {
      return true
    }
    if (typeof rec.code === 'string' && rec.code.includes(GITHUB_ACCOUNT_AGE_REJECTED_CODE)) {
      return true
    }
    if (typeof rec.error === 'string' && rec.error.includes(GITHUB_ACCOUNT_AGE_REJECTED_CODE)) {
      return true
    }
    if (rec.body != null && isGitHubAgeRejectedError(rec.body)) {
      return true
    }
  }
  return false
}

export function parseGitHubAgeRejectedMinDays(text: string | null | undefined): number | null {
  if (!text) return null
  const m = text.match(/GITHUB_ACCOUNT_AGE_REJECTED:(\d+)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

export function parseGitHubAgeRejectedActualDays(text: string | null | undefined): number | null {
  if (!text) return null
  const m = text.match(/actual_days=(\d+)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

export function githubAgeRejectedPath(minDays: number, actualDays?: number | null): string {
  let path = `/register/github-age-rejected?min_days=${encodeURIComponent(String(Math.max(0, minDays)))}`
  if (actualDays != null && Number.isFinite(actualDays)) {
    path += `&actual_days=${encodeURIComponent(String(Math.max(0, Math.floor(actualDays))))}`
  }
  return path
}

export function extractGitHubAgeRejectedDetails(
  value: unknown,
  fallbackMinDays = 0
): { minDays: number; actualDays: number | null } {
  const text =
    typeof value === 'string'
      ? value
      : value instanceof Error
        ? value.message
        : value && typeof value === 'object'
          ? JSON.stringify(value)
          : ''
  return {
    minDays: parseGitHubAgeRejectedMinDays(text) ?? Math.max(0, fallbackMinDays),
    actualDays: parseGitHubAgeRejectedActualDays(text)
  }
}