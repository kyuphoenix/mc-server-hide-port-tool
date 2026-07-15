import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Miniflare } from 'miniflare'
import { unstable_splitSqlQuery } from 'wrangler'

export type TestD1 = { db: D1Database; dispose: () => Promise<void> }

export async function createTestD1(): Promise<TestD1> {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-07-08',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: crypto.randomUUID() }
  })
  const db = await mf.getD1Database('DB')
  const dir = resolve(process.cwd(), 'migrations')
  const files = (await readdir(dir))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()
  for (const file of files) {
    const sql = (await readFile(resolve(dir, file), 'utf8')).replace(/\r\n/g, '\n')
    const statements = unstable_splitSqlQuery(sql)
    if (statements.length > 0) {
      await db.batch(statements.map((statement) => db.prepare(statement)))
    }
  }
  return { db, dispose: async () => mf.dispose() }
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
