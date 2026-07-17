import { afterEach, describe, expect, it } from 'vitest'
import { buildRateLimitKey, consumeRateLimit } from '../src/services/rate-limit'
import {
  clearVerificationFailures,
  isVerificationRateLimited,
  recordVerificationFailure
} from '../src/services/email-verification'
import {
  createTestD1,
  disposeTestD1Instances,
  type TestD1
} from './helpers/d1'

const instances: TestD1[] = []

afterEach(async () => {
  await disposeTestD1Instances(instances)
})

describe('D1 rate limiter', { timeout: 60_000 }, () => {
  it('increments an active fixed window atomically', async () => {
    const instance = await createTestD1()
    instances.push(instance)
    const key = await buildRateLimitKey('login_ip', '203.0.113.10')

    const results = await Promise.all(
      Array.from({ length: 8 }, () => consumeRateLimit(instance.db, {
        key,
        limit: 5,
        windowMs: 60_000,
        now: 1_000
      }))
    )

    expect(results.filter((result) => result.limited)).toHaveLength(3)
    const row = await instance.db.prepare(
      'SELECT count, reset_at FROM rate_limit_bucket WHERE key = ?'
    ).bind(key).first<{ count: number; reset_at: number }>()
    expect(row).toEqual({ count: 8, reset_at: 61_000 })
  })

  it('resets an expired window in the same statement', async () => {
    const instance = await createTestD1()
    instances.push(instance)
    const key = await buildRateLimitKey('mail_email', 'User@Example.test')
    await instance.db.prepare(
      'INSERT INTO rate_limit_bucket (key, count, reset_at) VALUES (?, 99, ?)'
    ).bind(key, 5_000).run()

    const result = await consumeRateLimit(instance.db, {
      key,
      limit: 3,
      windowMs: 10_000,
      now: 5_000
    })

    expect(result).toMatchObject({ limited: false, remaining: 2 })
    const row = await instance.db.prepare(
      'SELECT count, reset_at FROM rate_limit_bucket WHERE key = ?'
    ).bind(key).first<{ count: number; reset_at: number }>()
    expect(row).toEqual({ count: 1, reset_at: 15_000 })
  })

  it('does not store raw subjects in bucket keys', async () => {
    const key = await buildRateLimitKey(
      'login_email_ip',
      'User@Example.test|203.0.113.10'
    )
    expect(key).toMatch(/^login_email_ip:[a-f0-9]{64}$/)
    expect(key).not.toContain('example.test')
    expect(key).not.toContain('203.0.113.10')
  })

  it('counts concurrent verification failures in both buckets', async () => {
    const instance = await createTestD1()
    instances.push(instance)

    await Promise.all(
      Array.from({ length: 8 }, () =>
        recordVerificationFailure(instance.db, 'User@Example.test', '203.0.113.10')
      )
    )

    const rows = await instance.db.prepare(
      "SELECT key, count FROM rate_limit_bucket WHERE key LIKE 'email_verify_fail%:%'"
    ).all<{ key: string; count: number }>()

    expect(rows.results).toHaveLength(2)
    expect(rows.results.map((row) => row.count)).toEqual([8, 8])
    expect(await isVerificationRateLimited(
      instance.db,
      'User@Example.test',
      '203.0.113.10'
    )).toMatchObject({ limited: true })
  })

  it('limits an email globally even when every failure uses a different IP', async () => {
    const instance = await createTestD1()
    instances.push(instance)

    for (let i = 0; i < 24; i++) {
      await recordVerificationFailure(
        instance.db,
        'victim@example.test',
        `203.0.113.${i + 1}`
      )
    }

    expect(await isVerificationRateLimited(
      instance.db,
      'victim@example.test',
      '198.51.100.77'
    )).toMatchObject({ limited: true })
  })

  it('clears both the per-IP and global buckets after successful verification', async () => {
    const instance = await createTestD1()
    instances.push(instance)
    await recordVerificationFailure(instance.db, 'User@Example.test', '203.0.113.10')

    await clearVerificationFailures(instance.db, 'User@Example.test', '203.0.113.10')

    const row = await instance.db.prepare(
      "SELECT COUNT(*) AS count FROM rate_limit_bucket WHERE key LIKE 'email_verify_fail%:%'"
    ).first<{ count: number }>()
    expect(row?.count).toBe(0)
  })

  it('does not store verification email or IP in either bucket key', async () => {
    const instance = await createTestD1()
    instances.push(instance)

    await recordVerificationFailure(instance.db, 'User@Example.test', '203.0.113.10')
    const rows = await instance.db.prepare(
      "SELECT key FROM rate_limit_bucket WHERE key LIKE 'email_verify_fail%:%'"
    ).all<{ key: string }>()

    expect(rows.results).toHaveLength(2)
    for (const row of rows.results) {
      expect(row.key).toMatch(/^email_verify_fail(?:_global)?:[a-f0-9]{64}$/)
      expect(row.key).not.toContain('example.test')
      expect(row.key).not.toContain('203.0.113.10')
    }
  })
})
