import { beforeEach, describe, expect, it } from 'vitest'
import { listLinkedAccounts, countAuthFactors } from '../../src/services/user-settings'
import {
  createSharedTestD1,
  markFirstSetupCompleted,
  seedUser,
  type SharedTestD1
} from '../helpers/d1'

let shared: SharedTestD1
let db: D1Database

beforeEach(async () => {
  shared = await createSharedTestD1()
  db = shared.db
  await shared.resetDatabase()
  await markFirstSetupCompleted(db)
})

async function seedAccount(
  db: D1Database,
  input: {
    id: string
    userId: string
    providerId: string
    accountId: string
    password?: string | null
  }
): Promise<void> {
  await db.prepare(
    `INSERT INTO account (id, userId, providerId, accountId, password, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    input.id,
    input.userId,
    input.providerId,
    input.accountId,
    input.password ?? null,
    Date.now(),
    Date.now()
  ).run()
}

async function seedPasskey(
  db: D1Database,
  input: { id: string; userId: string; credentialID?: string }
): Promise<void> {
  await db.prepare(
    `INSERT INTO passkey (id, name, publicKey, userId, credentialID, counter, deviceType, backedUp, transports, createdAt, aaguid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    input.id,
    'Test Passkey',
    'mock-public-key',
    input.userId,
    input.credentialID ?? 'cred-' + input.id,
    0,
    'platform',
    0,
    '["internal"]',
    Date.now(),
    null
  ).run()
}

describe('listLinkedAccounts', () => {
  it('returns only non-credential accounts for the user', async () => {
    const userId = await seedUser(db, { id: '1', email: 'user1@example.test' })
    await seedAccount(db, { id: 'a1', userId, providerId: 'credential', accountId: 'cred-1', password: 'hashed-pw' })
    await seedAccount(db, { id: 'a2', userId, providerId: 'github', accountId: 'gh-123' })
    await seedAccount(db, { id: 'a3', userId, providerId: 'google', accountId: 'goog-456' })

    const linked = await listLinkedAccounts(db, userId)
    expect(linked).toHaveLength(2)
    expect(linked.every((a) => a.providerId !== 'credential')).toBe(true)
    expect(linked.map((a) => a.providerId).sort()).toEqual(['github', 'google'])
  })

  it('returns empty array when user has only credential account', async () => {
    const userId = await seedUser(db, { id: '2', email: 'user2@example.test' })
    await seedAccount(db, { id: 'a1', userId, providerId: 'credential', accountId: 'cred-1', password: 'pw' })

    const linked = await listLinkedAccounts(db, userId)
    expect(linked).toEqual([])
  })

  it('returns empty array for a user with no accounts', async () => {
    const userId = await seedUser(db, { id: '3', email: 'user3@example.test' })

    const linked = await listLinkedAccounts(db, userId)
    expect(linked).toEqual([])
  })

  it('returns accounts ordered by createdAt ascending', async () => {
    const userId = await seedUser(db, { id: '4', email: 'user4@example.test' })
    const now = Date.now()
    await db.prepare(
      `INSERT INTO account (id, userId, providerId, accountId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind('a1', userId, 'discord', 'dis-1', now + 2000, now + 2000).run()
    await db.prepare(
      `INSERT INTO account (id, userId, providerId, accountId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind('a2', userId, 'github', 'gh-1', now + 1000, now + 1000).run()
    await db.prepare(
      `INSERT INTO account (id, userId, providerId, accountId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind('a3', userId, 'google', 'goog-1', now + 3000, now + 3000).run()

    const linked = await listLinkedAccounts(db, userId)
    expect(linked.map((a) => a.providerId)).toEqual(['github', 'discord', 'google'])
  })

  it('does not return accounts from other users', async () => {
    const userId1 = await seedUser(db, { id: '5', email: 'user5@example.test' })
    const userId2 = await seedUser(db, { id: '6', email: 'user6@example.test' })
    await seedAccount(db, { id: 'a1', userId: userId1, providerId: 'github', accountId: 'gh-1' })
    await seedAccount(db, { id: 'a2', userId: userId2, providerId: 'github', accountId: 'gh-2' })

    const linked = await listLinkedAccounts(db, userId1)
    expect(linked).toHaveLength(1)
    expect(linked[0]!.accountId).toBe('gh-1')
  })
})

describe('countAuthFactors', () => {
  it('returns zero for a user with no accounts or passkeys', async () => {
    const userId = await seedUser(db, { id: '10', email: 'user10@example.test' })

    const factors = await countAuthFactors(db, userId)
    expect(factors).toEqual({
      password: false,
      oauthCount: 0,
      passkeyCount: 0,
      total: 0
    })
  })

  it('counts a credential/password account', async () => {
    const userId = await seedUser(db, { id: '11', email: 'user11@example.test' })
    await seedAccount(db, { id: 'a1', userId, providerId: 'credential', accountId: 'cred', password: 'hashed' })

    const factors = await countAuthFactors(db, userId)
    expect(factors.password).toBe(true)
    expect(factors.total).toBe(1)
  })

  it('does not count a credential account without password', async () => {
    const userId = await seedUser(db, { id: '12', email: 'user12@example.test' })
    await seedAccount(db, { id: 'a1', userId, providerId: 'credential', accountId: 'cred', password: null })

    const factors = await countAuthFactors(db, userId)
    expect(factors.password).toBe(false)
    expect(factors.total).toBe(0)
  })

  it('counts OAuth accounts separately from credential', async () => {
    const userId = await seedUser(db, { id: '13', email: 'user13@example.test' })
    await seedAccount(db, { id: 'a1', userId, providerId: 'credential', accountId: 'c', password: 'pw' })
    await seedAccount(db, { id: 'a2', userId, providerId: 'github', accountId: 'gh' })
    await seedAccount(db, { id: 'a3', userId, providerId: 'google', accountId: 'go' })

    const factors = await countAuthFactors(db, userId)
    expect(factors.password).toBe(true)
    expect(factors.oauthCount).toBe(2)
    expect(factors.passkeyCount).toBe(0)
    expect(factors.total).toBe(3)
  })

  it('counts passkeys', async () => {
    const userId = await seedUser(db, { id: '14', email: 'user14@example.test' })
    await seedAccount(db, { id: 'a1', userId, providerId: 'credential', accountId: 'c', password: 'pw' })
    await seedPasskey(db, { id: 'p1', userId })
    await seedPasskey(db, { id: 'p2', userId })

    const factors = await countAuthFactors(db, userId)
    expect(factors.password).toBe(true)
    expect(factors.oauthCount).toBe(0)
    expect(factors.passkeyCount).toBe(2)
    expect(factors.total).toBe(3)
  })

  it('counts only passkeys as total when no password or OAuth', async () => {
    const userId = await seedUser(db, { id: '15', email: 'user15@example.test' })
    await seedPasskey(db, { id: 'p1', userId })

    const factors = await countAuthFactors(db, userId)
    expect(factors.password).toBe(false)
    expect(factors.oauthCount).toBe(0)
    expect(factors.passkeyCount).toBe(1)
    expect(factors.total).toBe(1)
  })
})
