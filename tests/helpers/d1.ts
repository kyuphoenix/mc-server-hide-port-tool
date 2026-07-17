import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Miniflare } from 'miniflare'
import { unstable_splitSqlQuery } from 'wrangler'

export type TestD1 = { db: D1Database; dispose: () => Promise<void> }

export type MigrationOptions = { through?: string }

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
  for (const instance of instances.splice(0)) {
    await instance.dispose()
  }
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
