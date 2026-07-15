import { afterEach, describe, expect, it } from 'vitest'
import {
  FIRST_SETUP_CLAIM_TTL_MS,
  FirstSetupError,
  claimFirstSetup,
  createFirstSetupSecurityEvent,
  getFirstSetupState
} from '../src/services/first-setup'
import { createTestD1, type TestD1 } from './helpers/d1'

const instances: TestD1[] = []

afterEach(async () => {
  await Promise.all(instances.splice(0).map((item) => item.dispose()))
})

async function setup(): Promise<D1Database> {
  const instance = await createTestD1()
  instances.push(instance)
  return instance.db
}

async function rawHash(db: D1Database): Promise<string | null> {
  const row = await db.prepare(
    'SELECT claim_token_hash FROM first_setup WHERE id = 1'
  ).first<{ claim_token_hash: string | null }>()
  return row?.claim_token_hash ?? null
}

describe('first setup claim service', () => {
  it('reads the initial open state', async () => {
    const db = await setup()
    expect(await getFirstSetupState(db)).toEqual({
      status: 'open', claimedAt: null, claimedUserId: null, completedAt: null
    })
  })

  it('stores only a SHA-256 hash of a 32-byte claim token', async () => {
    const db = await setup()
    const claim = await claimFirstSetup(db, 1_000)
    const bytes = Uint8Array.from(atob(claim.token), (char) => char.charCodeAt(0))
    expect(bytes).toHaveLength(32)
    expect(claim.expiresAt).toBe(1_000 + FIRST_SETUP_CLAIM_TTL_MS)
    const row = await db.prepare(
      'SELECT claim_token_hash, claimed_at FROM first_setup WHERE id = 1'
    ).first<{ claim_token_hash: string; claimed_at: number }>()
    expect(row?.claim_token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(row?.claim_token_hash).not.toBe(claim.token)
    expect(row?.claimed_at).toBe(1_000)
  })

  it('allows exactly one concurrent claimant without overwriting the winner hash', async () => {
    const db = await setup()
    const results = await Promise.allSettled([
      claimFirstSetup(db, 2_000),
      claimFirstSetup(db, 2_000)
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejection = results.find((result) => result.status === 'rejected')
    expect(rejection && rejection.status === 'rejected' && rejection.reason)
      .toMatchObject({ code: 'SETUP_IN_PROGRESS' })
    const winner = results.find((result) => result.status === 'fulfilled')
    expect(winner?.status).toBe('fulfilled')
    const firstHash = await rawHash(db)
    await expect(claimFirstSetup(db, 2_001)).rejects.toMatchObject({
      code: 'SETUP_IN_PROGRESS'
    })
    expect(await rawHash(db)).toBe(firstHash)
  })

  it('returns SETUP_DONE for completed state', async () => {
    const db = await setup()
    await db.prepare(
      "UPDATE first_setup SET status='completed', completed_at=1 WHERE id=1"
    ).run()
    await expect(claimFirstSetup(db, 2_000)).rejects.toMatchObject({ code: 'SETUP_DONE' })
  })

  it('returns SETUP_DONE when a user already exists even if state is open', async () => {
    const db = await setup()
    const now = Date.now()
    await db.prepare(
      `INSERT INTO user
       (id, name, email, emailVerified, createdAt, updatedAt, role, super_admin)
       VALUES ('1', 'Existing', 'existing@example.test', 1, ?, ?, 'admin', 1)`
    ).bind(now, now).run()
    await expect(claimFirstSetup(db, 2_000)).rejects.toMatchObject({ code: 'SETUP_DONE' })
  })

  it('serializes only allowlisted security event fields', () => {
    const secretError = Object.assign(new Error('raw-secret-message'), {
      email: 'private@example.test',
      token: 'clear-token',
      stack: 'secret-stack'
    })
    const event = createFirstSetupSecurityEvent(secretError, { stage: 'claim', now: 0 })
    expect(event).toEqual({
      event: 'first_setup_security',
      code: 'SETUP_FAILED',
      stage: 'claim',
      timestamp: '1970-01-01T00:00:00.000Z'
    })
    expect(Object.keys(event).sort()).toEqual(['code', 'event', 'stage', 'timestamp'])
    expect(JSON.stringify(event)).not.toMatch(/private|clear-token|raw-secret|secret-stack/)
  })

  it('preserves a known fixed error code in the security event', () => {
    expect(createFirstSetupSecurityEvent(
      new FirstSetupError('SETUP_IN_PROGRESS'),
      { stage: 'claim', now: 0 }
    )).toMatchObject({ code: 'SETUP_IN_PROGRESS' })
  })
})
