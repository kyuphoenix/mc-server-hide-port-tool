import { hashPassword, symmetricDecrypt, symmetricEncrypt, verifyPassword } from 'better-auth/crypto'

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

const ENC_PREFIX = 'enc:v1:'

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

/** Encrypt pending signup password with app secret. */
export async function sealPendingPassword(secret: string | undefined, password: string): Promise<string> {
  if (!secret) {
    throw new Error('Cannot seal pending signup password: missing BETTER_AUTH_SECRET')
  }
  const cipher = await symmetricEncrypt({ key: secret, data: password })
  return `${ENC_PREFIX}${cipher}`
}

/** Decrypt pending signup password. */
export async function openPendingPassword(secret: string | undefined, stored: string): Promise<string> {
  if (!stored.startsWith(ENC_PREFIX)) {
    throw new Error('Invalid sealed password format')
  }
  if (!secret) {
    throw new Error('Cannot decrypt pending signup password: missing BETTER_AUTH_SECRET')
  }
  return await symmetricDecrypt({
    key: secret,
    data: stored.slice(ENC_PREFIX.length)
  })
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
const VERIFY_FAIL_MAX = 8
const RATE_SCOPE = 'email_verify_fail'

function verifyFailKey(email: string, ip: string | null | undefined): string {
  return `${RATE_SCOPE}:${email.toLowerCase()}|${ip || 'unknown'}`
}

export async function clearVerificationFailures(
  db: D1Database,
  email: string,
  ip?: string | null
): Promise<void> {
  await db
    .prepare('DELETE FROM rate_limit_bucket WHERE key = ?')
    .bind(verifyFailKey(email, ip))
    .run()
}

export async function recordVerificationFailure(
  db: D1Database,
  email: string,
  ip?: string | null
): Promise<{ limited: boolean; remaining: number; retryAfterSec: number }> {
  const key = verifyFailKey(email, ip)
  const now = Date.now()
  const current = await db
    .prepare('SELECT count, reset_at FROM rate_limit_bucket WHERE key = ?')
    .bind(key)
    .first<{ count: number; reset_at: number }>()

  if (!current || now >= Number(current.reset_at)) {
    const resetAt = now + VERIFY_FAIL_WINDOW_MS
    await db
      .prepare(
        `INSERT INTO rate_limit_bucket (key, count, reset_at)
         VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET
           count = 1,
           reset_at = excluded.reset_at`
      )
      .bind(key, resetAt)
      .run()
    return {
      limited: false,
      remaining: VERIFY_FAIL_MAX - 1,
      retryAfterSec: Math.ceil(VERIFY_FAIL_WINDOW_MS / 1000)
    }
  }

  // Atomic increment for an active window. If concurrent writers race, the higher count wins.
  await db
    .prepare(
      `UPDATE rate_limit_bucket
       SET count = count + 1
       WHERE key = ? AND reset_at > ?`
    )
    .bind(key, now)
    .run()

  const updated = await db
    .prepare('SELECT count, reset_at FROM rate_limit_bucket WHERE key = ?')
    .bind(key)
    .first<{ count: number; reset_at: number }>()

  const count = Math.max(1, Number(updated?.count ?? current.count + 1))
  const resetAt = Number(updated?.reset_at ?? current.reset_at)
  const remaining = Math.max(0, VERIFY_FAIL_MAX - count)
  return {
    limited: count >= VERIFY_FAIL_MAX,
    remaining,
    retryAfterSec: Math.max(1, Math.ceil((resetAt - now) / 1000))
  }
}

export async function isVerificationRateLimited(
  db: D1Database,
  email: string,
  ip?: string | null
): Promise<{ limited: boolean; retryAfterSec: number }> {
  const key = verifyFailKey(email, ip)
  const now = Date.now()
  const current = await db
    .prepare('SELECT count, reset_at FROM rate_limit_bucket WHERE key = ?')
    .bind(key)
    .first<{ count: number; reset_at: number }>()

  if (!current || now >= Number(current.reset_at)) {
    if (current && now >= Number(current.reset_at)) {
      await db.prepare('DELETE FROM rate_limit_bucket WHERE key = ?').bind(key).run()
    }
    return { limited: false, retryAfterSec: 0 }
  }
  if (Number(current.count) < VERIFY_FAIL_MAX) {
    return { limited: false, retryAfterSec: 0 }
  }
  return {
    limited: true,
    retryAfterSec: Math.max(1, Math.ceil((Number(current.reset_at) - now) / 1000))
  }
}

/** Opportunistic cleanup of expired rate-limit rows. */
export async function purgeExpiredRateLimitBuckets(db: D1Database, now = Date.now()): Promise<void> {
  await db.prepare('DELETE FROM rate_limit_bucket WHERE reset_at < ?').bind(now).run()
}
