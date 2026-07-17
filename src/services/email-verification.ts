import { hashPassword, verifyPassword } from 'better-auth/crypto'
import {
  isSealedSensitiveValue,
  openSensitiveValue,
  sealSensitiveValue,
  type SensitiveDataKeySource
} from './sensitive-data'
import { buildRateLimitKey } from './rate-limit'

export type EmailVerificationRow = {
  id: string
  email: string
  name: string
  password: string
  code_hash: string
  expires_at: number
  created_at: number
  invite_code: string | null
}

export function generateVerificationCode(): string {
  const range = 900_000
  const maxUnbiased = Math.floor(0x1_0000_0000 / range) * range
  const values = new Uint32Array(1)
  let value = 0
  do {
    crypto.getRandomValues(values)
    value = values[0]
  } while (value >= maxUnbiased)
  return String(100_000 + (value % range))
}

export async function hashVerificationCode(code: string): Promise<string> {
  return await hashPassword(code)
}

export async function verifyVerificationCode(code: string, codeHash: string): Promise<boolean> {
  try {
    return await verifyPassword({ hash: codeHash, password: code })
  } catch {
    return false
  }
}

/** Encrypt a pending signup password with the independent data key. */
export async function sealPendingPassword(
  keys: SensitiveDataKeySource,
  password: string
): Promise<string> {
  return await sealSensitiveValue(keys, password)
}

/** Decrypt a pending signup password, allowing the previous key during rotation. */
export async function openPendingPassword(
  keys: SensitiveDataKeySource,
  stored: string
): Promise<string> {
  if (!isSealedSensitiveValue(stored)) throw new Error('Invalid sealed password format')
  return await openSensitiveValue(keys, stored)
}


export async function upsertEmailVerification(
  db: D1Database,
  input: {
    email: string
    name: string
    passwordSealed: string
    codeHash: string
    expiresAt: number
    inviteCode: string | null
  }
): Promise<string> {
  const id = crypto.randomUUID()
  const now = Date.now()
  // Replace any previous pending verification for this email.
  await db.prepare('DELETE FROM email_verification WHERE email = ?').bind(input.email).run()
  await db
    .prepare(
      `INSERT INTO email_verification
        (id, email, name, password, code_hash, expires_at, created_at, invite_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.email,
      input.name,
      input.passwordSealed,
      input.codeHash,
      input.expiresAt,
      now,
      input.inviteCode
    )
    .run()
  return id
}

export async function findLatestEmailVerification(
  db: D1Database,
  email: string
): Promise<EmailVerificationRow | null> {
  return await db
    .prepare(
      `SELECT id, email, name, password, code_hash, expires_at, created_at, invite_code
       FROM email_verification
       WHERE email = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(email)
    .first<EmailVerificationRow>()
}

export async function deleteEmailVerificationsByEmail(db: D1Database, email: string): Promise<void> {
  await db.prepare('DELETE FROM email_verification WHERE email = ?').bind(email).run()
}

export async function purgeExpiredEmailVerifications(db: D1Database, now = Date.now()): Promise<void> {
  await db.prepare('DELETE FROM email_verification WHERE expires_at < ?').bind(now).run()
}

const VERIFY_FAIL_WINDOW_MS = 10 * 60 * 1000
const VERIFY_FAIL_PER_IP_MAX = 8
const VERIFY_FAIL_GLOBAL_MAX = 24
const RATE_SCOPE_IP = 'email_verify_fail'
const RATE_SCOPE_GLOBAL = 'email_verify_fail_global'

type VerificationLimit = {
  key: string
  limit: number
}

async function verificationLimits(
  email: string,
  ip: string | null | undefined
): Promise<VerificationLimit[]> {
  return [
    {
      key: await buildRateLimitKey(RATE_SCOPE_IP, `${email}|${ip || 'unknown'}`),
      limit: VERIFY_FAIL_PER_IP_MAX
    },
    {
      key: await buildRateLimitKey(RATE_SCOPE_GLOBAL, email),
      limit: VERIFY_FAIL_GLOBAL_MAX
    }
  ]
}

export async function clearVerificationFailures(
  db: D1Database,
  email: string,
  ip?: string | null
): Promise<void> {
  const limits = await verificationLimits(email, ip)
  await db.batch(limits.map(({ key }) =>
    db.prepare('DELETE FROM rate_limit_bucket WHERE key = ?').bind(key)
  ))
}

export async function recordVerificationFailure(
  db: D1Database,
  email: string,
  ip?: string | null
): Promise<{ limited: boolean; remaining: number; retryAfterSec: number }> {
  const limits = await verificationLimits(email, ip)
  const now = Date.now()
  const resetAt = now + VERIFY_FAIL_WINDOW_MS
  const results = await db.batch(limits.map(({ key }) => db.prepare(
    `INSERT INTO rate_limit_bucket (key, count, reset_at)
     VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE
         WHEN rate_limit_bucket.reset_at <= ? THEN 1
         ELSE rate_limit_bucket.count + 1
       END,
       reset_at = CASE
         WHEN rate_limit_bucket.reset_at <= ? THEN excluded.reset_at
         ELSE rate_limit_bucket.reset_at
       END
     RETURNING count, reset_at`
  ).bind(key, resetAt, now, now)))

  const states = results.map((result, index) => {
    const row = result.results?.[0] as { count?: number; reset_at?: number } | undefined
    if (!row) throw new Error('verification_rate_limit_update_failed')
    const count = Number(row.count)
    const effectiveResetAt = Number(row.reset_at)
    return {
      limited: count >= limits[index]!.limit,
      remaining: Math.max(0, limits[index]!.limit - count),
      retryAfterSec: Math.max(1, Math.ceil((effectiveResetAt - now) / 1000))
    }
  })
  const blocked = states.filter((state) => state.limited)
  return {
    limited: blocked.length > 0,
    remaining: Math.min(...states.map((state) => state.remaining)),
    retryAfterSec: blocked.length > 0
      ? Math.max(...blocked.map((state) => state.retryAfterSec))
      : Math.max(...states.map((state) => state.retryAfterSec))
  }
}

export async function isVerificationRateLimited(
  db: D1Database,
  email: string,
  ip?: string | null
): Promise<{ limited: boolean; retryAfterSec: number }> {
  const limits = await verificationLimits(email, ip)
  const now = Date.now()
  const results = await db.batch(limits.map(({ key }) =>
    db.prepare('SELECT count, reset_at FROM rate_limit_bucket WHERE key = ?').bind(key)
  ))

  const blockedRetryAfter: number[] = []
  const expiredKeys: string[] = []
  results.forEach((result, index) => {
    const row = result.results?.[0] as { count?: number; reset_at?: number } | undefined
    if (!row) return
    const resetAt = Number(row.reset_at)
    if (now >= resetAt) {
      expiredKeys.push(limits[index]!.key)
      return
    }
    if (Number(row.count) >= limits[index]!.limit) {
      blockedRetryAfter.push(Math.max(1, Math.ceil((resetAt - now) / 1000)))
    }
  })

  if (expiredKeys.length > 0) {
    await db.batch(expiredKeys.map((key) =>
      db.prepare('DELETE FROM rate_limit_bucket WHERE key = ? AND reset_at <= ?').bind(key, now)
    ))
  }
  return blockedRetryAfter.length > 0
    ? { limited: true, retryAfterSec: Math.max(...blockedRetryAfter) }
    : { limited: false, retryAfterSec: 0 }
}

/** Opportunistic cleanup of expired rate-limit rows. */
export async function purgeExpiredRateLimitBuckets(db: D1Database, now = Date.now()): Promise<void> {
  await db.prepare('DELETE FROM rate_limit_bucket WHERE reset_at < ?').bind(now).run()
}
