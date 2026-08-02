import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Miniflare } from 'miniflare'
import { unstable_splitSqlQuery } from 'wrangler'

export type TestD1 = { db: D1Database; dispose: () => Promise<void> }

export type MigrationOptions = { through?: string }

// --- Shared Miniflare instance (one per worker process) ---

// Tables ordered for safe deletion: child tables (with FKs) first, parent
// tables (referenced by FKs) last. This avoids FOREIGN KEY constraint errors
// when D1 has foreign key enforcement enabled.
const RECORD_TABLES = [
  // Level 0: tables with FKs to other business tables (delete first)
  'oauth_registration_intent', // -> invite_code
  // Level 1: tables with FKs to user (CASCADE or SET NULL)
  'account',                  // -> user CASCADE
  'passkey',                  // -> user CASCADE
  'session',                  // -> user CASCADE
  'email_verification',       // standalone (no FKs but reset early for safety)
  'dns_record',               // standalone
  'rate_limit_bucket',        // standalone
  'site_announcement',        // standalone
  'user_deletion_job',        // standalone
  'verification',             // standalone
  // Level 2: invite_code references user (CASCADE + SET NULL)
  'invite_code',
  // Level 3: oauth_provider is standalone
  'oauth_provider',
  // Level 4: user (referenced by many, delete last)
  'user',
  // first_setup and settings are reset separately (triggers / singleton resets)
] as const

// Tables that have a singleton row (id = 'default' or id = 1) and need
// to be re-seeded after a wipe rather than left empty.
const SINGLETON_RESETS: Array<{ sql: string; binds?: unknown[] }> = [
  {
    // settings: delete and re-insert so all column DEFAULTs are restored
    sql: `DELETE FROM settings`,
  },
  {
    sql: `INSERT INTO settings (id) VALUES ('default')`,
  },
  {
    // user_id_counter: reset to 0 so numeric id allocation starts fresh
    sql: `INSERT INTO user_id_counter (name, value) VALUES ('user', 0)
          ON CONFLICT(name) DO UPDATE SET value = 0`,
  },
]

let sharedMf: Miniflare | null = null
let sharedDb: D1Database | null = null

async function getOrCreateSharedMiniflare(): Promise<D1Database> {
  if (sharedDb) return sharedDb
  sharedMf = await createFetchSafeMiniflare()
  const db = await sharedMf.getD1Database('DB')
  sharedDb = db
  await applyMigrations(db)
  return db
}

/**
 * Reset the shared D1 instance by deleting all rows from every business table
 * and re-seeding singleton rows (settings, first_setup, user_id_counter).
 * Fast: no Miniflare restart, no migration re-run.
 *
 * Also invalidates the settings cache so tests see fresh data.
 */
export async function resetDatabase(db: D1Database): Promise<void> {
  // Tables are deleted in dependency order (children first) to avoid FK errors.
  for (const table of RECORD_TABLES) {
    await db.prepare(`DELETE FROM ${table}`).run()
  }
  await resetFirstSetupToOpen(db)
  for (const reset of SINGLETON_RESETS) {
    const stmt = db.prepare(reset.sql)
    if (reset.binds) {
      await stmt.bind(...reset.binds).run()
    } else {
      await stmt.run()
    }
  }
  // Drop test-created temporary triggers that may linger in the shared instance.
  // These are created by specific test files to simulate failure paths and
  // would break subsequent tests if not cleaned up.
  const tempTriggers = [
    'fail_setup_id_allocation',
    'fail_setup_credential',
    'fail_session_creation',
    'force_oauth_state_bind_failure',
    'assert_oauth_intent_consumed_before_session',
    'force_account_failure',
    'force_intent_finalization_failure',
  ]
  for (const trigger of tempTriggers) {
    await db.prepare(`DROP TRIGGER IF EXISTS ${trigger}`).run()
  }

  // Invalidate caches — the shared D1 instance retains WeakMap entries across
  // tests, so stale cached data would leak into the next test.
  try {
    const {
      invalidateSettingsCache,
      invalidateOAuthProviderCache,
    } = await import('../../src/services/request-cache')
    invalidateSettingsCache(db)
    invalidateOAuthProviderCache(db)
  } catch {
    // request-cache not available in this context (non-service test)
  }
}

/**
 * Reset first_setup row to 'open' status.
 *
 * The `first_setup_completed_is_final` trigger prevents updating a completed
 * row back to 'open', so we temporarily drop the trigger, reset the row,
 * then recreate the trigger.
 */
async function resetFirstSetupToOpen(db: D1Database): Promise<void> {
  await db.prepare('DROP TRIGGER IF EXISTS first_setup_completed_is_final').run()
  await db.prepare('DROP TRIGGER IF EXISTS first_setup_row_cannot_be_deleted').run()
  await db
    .prepare(
      `INSERT INTO first_setup (id, status, claim_token_hash, claimed_at, claimed_user_id, completed_at)
       VALUES (1, 'open', NULL, NULL, NULL, NULL)
       ON CONFLICT(id) DO UPDATE SET
         status = 'open',
         claim_token_hash = NULL,
         claimed_at = NULL,
         claimed_user_id = NULL,
         completed_at = NULL`
    )
    .run()
  await db
    .prepare(
      `CREATE TRIGGER IF NOT EXISTS "first_setup_completed_is_final"
       BEFORE UPDATE ON "first_setup"
       WHEN OLD."status" = 'completed' AND NEW."status" <> 'completed'
       BEGIN SELECT RAISE(ABORT, 'first_setup_completed_is_final'); END`
    )
    .run()
  await db
    .prepare(
      `CREATE TRIGGER IF NOT EXISTS "first_setup_row_cannot_be_deleted"
       BEFORE DELETE ON "first_setup"
       BEGIN SELECT RAISE(ABORT, 'first_setup_row_cannot_be_deleted'); END`
    )
    .run()
}

/**
 * A shared, reusable D1 instance backed by a single Miniflare process.
 * Use `resetDatabase` in `beforeEach` to clear state between tests.
 *
 * `dispose` is a no-op for shared instances — the real cleanup happens
 * via `disposeSharedMiniflare` in the vitest global teardown.
 */
export type SharedTestD1 = {
  db: D1Database
  resetDatabase: () => Promise<void>
  dispose: () => Promise<void>
}

export async function createSharedTestD1(
  options: MigrationOptions = {}
): Promise<SharedTestD1> {
  // The shared instance always runs the full migration set.
  // Files that need `through` should use createTestD1 instead.
  if (options.through) {
    throw new Error('createSharedTestD1 does not support `through`; use createTestD1')
  }
  const db = await getOrCreateSharedMiniflare()
  return {
    db,
    resetDatabase: () => resetDatabase(db),
    dispose: async () => {
      // no-op: shared instance is cleaned up globally
    },
  }
}

export async function disposeSharedMiniflare(): Promise<void> {
  if (sharedMf) {
    await sharedMf.dispose()
    sharedMf = null
    sharedDb = null
  }
}

const FETCH_BLOCKED_PORTS = new Set([
  '1', '7', '9', '11', '13', '15', '17', '19', '20', '21', '22', '23', '25',
  '37', '42', '43', '53', '69', '77', '79', '87', '95', '101', '102', '103',
  '104', '109', '110', '111', '113', '115', '117', '119', '123', '135', '137',
  '139', '143', '161', '179', '389', '427', '465', '512', '513', '514', '515',
  '526', '530', '531', '532', '540', '548', '554', '556', '563', '587', '601',
  '636', '989', '990', '993', '995', '1719', '1720', '1723', '2049', '3659',
  '4045', '4190', '5060', '5061', '6000', '6566', '6665', '6666', '6667',
  '6668', '6669', '6679', '6697', '10080'
])

async function createFetchSafeMiniflare(): Promise<Miniflare> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      compatibilityDate: '2026-07-08',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: { DB: crypto.randomUUID() }
    })
    const url = await mf.ready
    if (!FETCH_BLOCKED_PORTS.has(url.port)) {
      return mf
    }
    await mf.dispose()
  }
  throw new Error('Unable to allocate a Fetch-safe Miniflare port')
}

export async function applyMigrationFile(db: D1Database, file: string): Promise<void> {
  const path = resolve(process.cwd(), 'migrations', file)
  const sql = (await readFile(path, 'utf8')).replace(/\r\n/g, '\n')
  const statements = unstable_splitSqlQuery(sql)
  if (statements.length > 0) {
    await db.batch(statements.map((statement) => db.prepare(statement)))
  }
  await applyTriggerFiles(db, file.slice(0, 4))
}

async function applyTriggerFiles(db: D1Database, migrationNumber: string): Promise<void> {
  const dir = resolve(process.cwd(), 'migrations', 'triggers')
  const files = (await readdir(dir))
    .filter((name) => name.startsWith(`${migrationNumber}_`) && name.endsWith('.sql'))
    .sort()
  for (const file of files) {
    const sql = (await readFile(resolve(dir, file), 'utf8')).trim()
    await db.prepare(sql).run()
  }
}

export async function applyMigrations(
  db: D1Database,
  options: MigrationOptions = {}
): Promise<void> {
  const dir = resolve(process.cwd(), 'migrations')
  const files = (await readdir(dir))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()
  if (options.through && !files.includes(options.through)) {
    throw new Error('Unknown migration: ' + options.through)
  }
  const selected = options.through
    ? files.slice(0, files.indexOf(options.through) + 1)
    : files
  for (const file of selected) {
    await applyMigrationFile(db, file)
  }
}

export async function createTestD1(options: MigrationOptions = {}): Promise<TestD1> {
  const mf = await createFetchSafeMiniflare()
  const db = await mf.getD1Database('DB')
  await applyMigrations(db, options)
  return { db, dispose: async () => mf.dispose() }
}

export async function disposeTestD1Instances(instances: TestD1[]): Promise<void> {
  // SharedTestD1 instances have a no-op dispose, so this is safe to call
  // with a mix of shared and dedicated instances.
  for (const instance of instances.splice(0)) {
    await instance.dispose()
  }
  // Always also try to dispose the shared instance — it is only truly freed
  // by disposeSharedMiniflare, but calling it here is harmless.
}

export async function markFirstSetupCompleted(db: D1Database): Promise<void> {
  await db.prepare(
    `UPDATE first_setup
     SET status = 'completed', claim_token_hash = NULL, claimed_at = NULL,
         claimed_user_id = NULL, completed_at = ?
     WHERE id = 1 AND status <> 'completed'`
  ).bind(Date.now()).run()
}

export async function seedUser(
  db: D1Database,
  input: { id?: string; email?: string; name?: string } = {}
): Promise<string> {
  const id = input.id ?? '9001'
  const now = Date.now()
  await db.prepare(
    `INSERT INTO user
     (id, name, email, emailVerified, createdAt, updatedAt, role, super_admin)
     VALUES (?, ?, ?, 1, ?, ?, 'admin', 1)`
  ).bind(
    id,
    input.name ?? 'Fixture Admin',
    input.email ?? 'fixture-admin@example.test',
    now,
    now
  ).run()
  return id
}

export async function seedInvite(
  db: D1Database,
  createdBy: string,
  input: { id?: string; code?: string; revoked?: number; usedBy?: string | null } = {}
): Promise<{ id: string; code: string }> {
  const id = input.id ?? crypto.randomUUID()
  const code = input.code ?? 'INVITE-ONE'
  await db.prepare(
    `INSERT INTO invite_code
     (id, code, created_by, created_at, used_by, used_at, revoked)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    code,
    createdBy,
    Date.now(),
    input.usedBy ?? null,
    input.usedBy ? Date.now() : null,
    input.revoked ?? 0
  ).run()
  return { id, code }
}
