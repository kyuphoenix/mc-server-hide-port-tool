import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  isEmailAllowed,
  type Settings
} from '../../src/services/settings'
import { createSharedTestD1, seedUser, type SharedTestD1 } from '../helpers/d1'
import { invalidateSettingsCache } from '../../src/services/request-cache'
import {
  requireInviteCodeIfNeeded,
  findUserIdByEmail,
  finalizeInviteUsage
} from '../../src/lib/invite'

let shared: SharedTestD1
let db: D1Database

beforeEach(async () => {
  shared = await createSharedTestD1()
  db = shared.db
  await shared.resetDatabase()
})

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides }
}

describe('isEmailAllowed', () => {
  it('allows any email when neither whitelist nor blacklist is enabled', () => {
    const settings = makeSettings()
    expect(isEmailAllowed('user@example.com', settings).ok).toBe(true)
    expect(isEmailAllowed('admin@evil.test', settings).ok).toBe(true)
  })

  it('rejects emails without @', () => {
    const settings = makeSettings()
    expect(isEmailAllowed('notanemail', settings).ok).toBe(false)
  })

  it('rejects emails with empty suffix', () => {
    const settings = makeSettings()
    expect(isEmailAllowed('user@', settings).ok).toBe(false)
  })

  it('enforces whitelist when enabled', () => {
    const settings = makeSettings({
      email_whitelist_enabled: true,
      email_whitelist_suffixes: ['gmail.com', 'example.com']
    })
    expect(isEmailAllowed('user@gmail.com', settings).ok).toBe(true)
    expect(isEmailAllowed('user@example.com', settings).ok).toBe(true)
    expect(isEmailAllowed('user@evil.com', settings).ok).toBe(false)
  })

  it('whitelist matches subdomains (e.g. mail.gmail.com matches gmail.com)', () => {
    const settings = makeSettings({
      email_whitelist_enabled: true,
      email_whitelist_suffixes: ['gmail.com']
    })
    expect(isEmailAllowed('user@mail.gmail.com', settings).ok).toBe(true)
    expect(isEmailAllowed('user@sub.gmail.com', settings).ok).toBe(true)
  })

  it('whitelist is case-insensitive', () => {
    const settings = makeSettings({
      email_whitelist_enabled: true,
      email_whitelist_suffixes: ['Gmail.COM']
    })
    expect(isEmailAllowed('user@gmail.com', settings).ok).toBe(true)
    expect(isEmailAllowed('USER@GMAIL.COM', settings).ok).toBe(true)
  })

  it('enforces blacklist when enabled', () => {
    const settings = makeSettings({
      email_blacklist_enabled: true,
      email_blacklist_suffixes: ['evil.com', 'spam.org']
    })
    expect(isEmailAllowed('user@evil.com', settings).ok).toBe(false)
    expect(isEmailAllowed('user@spam.org', settings).ok).toBe(false)
    expect(isEmailAllowed('user@example.com', settings).ok).toBe(true)
  })

  it('blacklist matches subdomains', () => {
    const settings = makeSettings({
      email_blacklist_enabled: true,
      email_blacklist_suffixes: ['evil.com']
    })
    expect(isEmailAllowed('user@sub.evil.com', settings).ok).toBe(false)
  })

  it('blacklist takes precedence when both are enabled and email is in both', () => {
    const settings = makeSettings({
      email_whitelist_enabled: true,
      email_whitelist_suffixes: ['example.com'],
      email_blacklist_enabled: true,
      email_blacklist_suffixes: ['example.com']
    })
    expect(isEmailAllowed('user@example.com', settings).ok).toBe(false)
  })

  it('allows email in whitelist and not in blacklist when both enabled', () => {
    const settings = makeSettings({
      email_whitelist_enabled: true,
      email_whitelist_suffixes: ['example.com'],
      email_blacklist_enabled: true,
      email_blacklist_suffixes: ['evil.com']
    })
    expect(isEmailAllowed('user@example.com', settings).ok).toBe(true)
  })
})

describe('requireInviteCodeIfNeeded', () => {
  it('skips invite check when invite_required is false', async () => {
    const settings = makeSettings({ invite_required: false })
    const result = await requireInviteCodeIfNeeded(db, settings, '')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.code).toBeNull()
  })

  it('rejects empty invite code when invite_required is true', async () => {
    await enableInviteRequired(db)
    const settings = makeSettings({ invite_required: true })
    const result = await requireInviteCodeIfNeeded(db, settings, '')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('邀请码')
  })

  it('accepts a valid available invite code', async () => {
    const adminId = await seedUser(db)
    const { code } = await seedAvailableInvite(db, adminId)
    await enableInviteRequired(db)
    const settings = makeSettings({ invite_required: true })
    const result = await requireInviteCodeIfNeeded(db, settings, code)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.code).toBe(code.toUpperCase())
  })

  it('normalizes invite code to uppercase', async () => {
    const adminId = await seedUser(db)
    const { code } = await seedAvailableInvite(db, adminId, 'TESTCODE')
    await enableInviteRequired(db)
    const settings = makeSettings({ invite_required: true })
    const result = await requireInviteCodeIfNeeded(db, settings, 'testcode')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.code).toBe('TESTCODE')
  })

  it('rejects a revoked invite code', async () => {
    const adminId = await seedUser(db)
    const { code } = await seedAvailableInvite(db, adminId)
    await revokeInvite(db, code)
    await enableInviteRequired(db)
    const settings = makeSettings({ invite_required: true })
    const result = await requireInviteCodeIfNeeded(db, settings, code)
    expect(result.ok).toBe(false)
  })

  it('rejects an already-used invite code', async () => {
    const adminId = await seedUser(db)
    const otherId = await seedUser(db, { id: 'other-user', email: 'other@example.test', name: 'Other' })
    const { code } = await seedAvailableInvite(db, adminId)
    await markInviteUsed(db, code, otherId)
    await enableInviteRequired(db)
    const settings = makeSettings({ invite_required: true })
    const result = await requireInviteCodeIfNeeded(db, settings, code)
    expect(result.ok).toBe(false)
  })
})

describe('findUserIdByEmail', () => {
  it('finds a user by email', async () => {
    await seedUser(db, { id: '12345', email: 'findme@example.test' })
    const id = await findUserIdByEmail(db, 'findme@example.test')
    expect(id).toBe('12345')
  })

  it('returns null for non-existent email', async () => {
    await seedUser(db, { email: 'exists@example.test' })
    const id = await findUserIdByEmail(db, 'nobody@example.test')
    expect(id).toBeNull()
  })

  it('returns null when no users exist', async () => {
    const id = await findUserIdByEmail(db, 'ghost@example.test')
    expect(id).toBeNull()
  })
})

describe('finalizeInviteUsage', () => {
  it('returns ok when inviteCode is null', async () => {
    const result = await finalizeInviteUsage(db, null, 'user-1')
    expect(result.ok).toBe(true)
  })

  it('returns ok when userId is null', async () => {
    const result = await finalizeInviteUsage(db, 'SOME-CODE', null)
    expect(result.ok).toBe(true)
  })

  it('returns ok when both are null', async () => {
    const result = await finalizeInviteUsage(db, null, null)
    expect(result.ok).toBe(true)
  })

  it('returns ok when both are undefined', async () => {
    const result = await finalizeInviteUsage(db, undefined, undefined)
    expect(result.ok).toBe(true)
  })

  it('consumes a valid invite code', async () => {
    const adminId = await seedUser(db)
    const newUserId = await seedUser(db, { id: 'new-user-1', email: 'new@example.test', name: 'New' })
    const { code } = await seedAvailableInvite(db, adminId, 'CONSUME-ME')
    const result = await finalizeInviteUsage(db, code, newUserId)
    expect(result.ok).toBe(true)
    // Verify invite is now used
    const row = await db.prepare('SELECT used_by FROM invite_code WHERE code = ?').bind(code).first<{ used_by: string | null }>()
    expect(row?.used_by).toBe(newUserId)
  })

  it('fails for an already-used invite code', async () => {
    const adminId = await seedUser(db)
    const firstId = await seedUser(db, { id: 'first-user', email: 'first@example.test', name: 'First' })
    const secondId = await seedUser(db, { id: 'second-user', email: 'second@example.test', name: 'Second' })
    const { code } = await seedAvailableInvite(db, adminId, 'DOUBLE-USE')
    await markInviteUsed(db, code, firstId)
    const result = await finalizeInviteUsage(db, code, secondId)
    expect(result.ok).toBe(false)
  })
})

// --- Helpers for invite tests ---

async function enableInviteRequired(db: D1Database): Promise<void> {
  await db.prepare("UPDATE settings SET invite_required = 1 WHERE id = 'default'").run()
  invalidateSettingsCache(db)
}

async function disableInviteRequired(db: D1Database): Promise<void> {
  await db.prepare("UPDATE settings SET invite_required = 0 WHERE id = 'default'").run()
  invalidateSettingsCache(db)
}

async function seedAvailableInvite(
  db: D1Database,
  createdBy: string,
  code?: string
): Promise<{ id: string; code: string }> {
  const id = crypto.randomUUID()
  const actualCode = code ?? 'INVITE-' + Math.random().toString(36).slice(2, 8).toUpperCase()
  await db.prepare(
    `INSERT INTO invite_code (id, code, created_by, created_at, used_by, used_at, revoked)
     VALUES (?, ?, ?, ?, NULL, NULL, 0)`
  ).bind(id, actualCode, createdBy, Date.now()).run()
  return { id, code: actualCode }
}

async function revokeInvite(db: D1Database, code: string): Promise<void> {
  await db.prepare('UPDATE invite_code SET revoked = 1 WHERE code = ?').bind(code).run()
}

async function markInviteUsed(db: D1Database, code: string, usedBy: string): Promise<void> {
  await db.prepare('UPDATE invite_code SET used_by = ?, used_at = ? WHERE code = ?')
    .bind(usedBy, Date.now(), code).run()
}
