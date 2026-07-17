export type RateLimitResult = {
  limited: boolean
  remaining: number
  retryAfterSec: number
}

type ConsumeRateLimitInput = {
  key: string
  limit: number
  windowMs: number
  now?: number
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function buildRateLimitKey(scope: string, subject: string): Promise<string> {
  return `${scope}:${await sha256Hex(subject.trim().toLowerCase())}`
}

export function getClientAddress(headers: Headers): string {
  const cloudflare = headers.get('cf-connecting-ip')?.trim()
  if (cloudflare) return cloudflare
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || 'unknown'
}

export async function consumeRateLimit(
  db: D1Database,
  input: ConsumeRateLimitInput
): Promise<RateLimitResult> {
  const limit = Math.max(1, Math.floor(input.limit))
  const windowMs = Math.max(1000, Math.floor(input.windowMs))
  const now = input.now ?? Date.now()
  const resetAt = now + windowMs
  const row = await db.prepare(
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
  ).bind(input.key, resetAt, now, now).first<{ count: number; reset_at: number }>()

  if (!row) throw new Error('rate_limit_update_failed')
  const count = Number(row.count)
  const effectiveResetAt = Number(row.reset_at)
  return {
    limited: count > limit,
    remaining: Math.max(0, limit - count),
    retryAfterSec: Math.max(1, Math.ceil((effectiveResetAt - now) / 1000))
  }
}

export async function clearRateLimit(db: D1Database, keys: string[]): Promise<void> {
  const uniqueKeys = [...new Set(keys)]
  if (uniqueKeys.length === 0) return
  await db.batch(uniqueKeys.map((key) =>
    db.prepare('DELETE FROM rate_limit_bucket WHERE key = ?').bind(key)
  ))
}

export async function consumeAnyRateLimit(
  db: D1Database,
  limits: ConsumeRateLimitInput[]
): Promise<RateLimitResult | null> {
  for (const limit of limits) {
    const result = await consumeRateLimit(db, limit)
    if (result.limited) return result
  }
  return null
}
