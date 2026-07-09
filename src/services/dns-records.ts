export type DnsRecordRow = {
  id: string
  user_id: string | null
  root_domain: string
  subdomain: string
  host_name: string
  server_address: string
  port: number
  target_type: string
  target_record_id: string
  srv_record_id: string | null
  created_at: number
}

export function genId(): string {
  return crypto.randomUUID()
}

export async function listRecordsByUser(db: D1Database, userId: string): Promise<DnsRecordRow[]> {
  const result = await db
    .prepare('SELECT * FROM dns_record WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all<DnsRecordRow>()
  return result.results ?? []
}

export async function listAllRecords(db: D1Database): Promise<DnsRecordRow[]> {
  const result = await db
    .prepare('SELECT * FROM dns_record ORDER BY created_at DESC')
    .all<DnsRecordRow>()
  return result.results ?? []
}

export async function findRecordById(db: D1Database, id: string): Promise<DnsRecordRow | null> {
  return await db.prepare('SELECT * FROM dns_record WHERE id = ?').bind(id).first<DnsRecordRow>()
}

export async function findRecordByHostName(
  db: D1Database,
  hostName: string
): Promise<DnsRecordRow | null> {
  return await db
    .prepare('SELECT * FROM dns_record WHERE host_name = ?')
    .bind(hostName)
    .first<DnsRecordRow>()
}

export async function insertRecord(
  db: D1Database,
  record: Omit<DnsRecordRow, 'id' | 'created_at'> & { id?: string }
): Promise<DnsRecordRow> {
  const id = record.id ?? genId()
  const created_at = Date.now()
  await db
    .prepare(
      `INSERT INTO dns_record
        (id, user_id, root_domain, subdomain, host_name, server_address, port, target_type, target_record_id, srv_record_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      record.user_id,
      record.root_domain,
      record.subdomain,
      record.host_name,
      record.server_address,
      record.port,
      record.target_type,
      record.target_record_id,
      record.srv_record_id,
      created_at
    )
    .run()

  return { ...record, id, created_at }
}

export async function deleteRecordRow(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM dns_record WHERE id = ?').bind(id).run()
}

export async function countUsers(db: D1Database): Promise<number> {
  const r = await db.prepare('SELECT COUNT(*) as n FROM user').first<{ n: number }>()
  return r?.n ?? 0
}

export async function listAllUsers(db: D1Database): Promise<UserListRow[]> {
  const r = await db
    .prepare('SELECT id, name, email, emailVerified, role, createdAt FROM user ORDER BY "createdAt" DESC')
    .all<UserListRow>()
  return r.results ?? []
}

export type UserListRow = {
  id: string
  name: string
  email: string
  emailVerified: number
  role: string
  createdAt: number
}

export async function findUserById(db: D1Database, id: string) {
  return await db
    .prepare('SELECT id, name, email, role FROM user WHERE id = ?')
    .bind(id)
    .first<{ id: string; name: string; email: string; role: string }>()
}

export async function setUserRole(
  db: D1Database,
  id: string,
  role: 'admin' | 'user'
): Promise<void> {
  await db.prepare('UPDATE user SET role = ? WHERE id = ?').bind(role, id).run()
}

export async function deleteUserCascade(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM dns_record WHERE user_id = ?').bind(id).run()
  await db.prepare('DELETE FROM session WHERE userId = ?').bind(id).run()
  await db.prepare('DELETE FROM account WHERE userId = ?').bind(id).run()
  await db.prepare('DELETE FROM user WHERE id = ?').bind(id).run()
}
