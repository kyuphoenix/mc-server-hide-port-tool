export type DnsSyncStatus = 'creating' | 'active' | 'updating' | 'error'

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
  sync_status: DnsSyncStatus
  sync_error_code: string | null
  sync_updated_at: number
  pending_server_address: string | null
  pending_port: number | null
  pending_target_type: string | null
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

export async function listRecordsByUserBatch(
  db: D1Database,
  userId: string,
  limit: number
): Promise<DnsRecordRow[]> {
  const safeLimit = Math.max(1, Math.min(25, Math.floor(limit) || 1))
  const result = await db
    .prepare('SELECT * FROM dns_record WHERE user_id = ? ORDER BY created_at ASC, id ASC LIMIT ?')
    .bind(userId, safeLimit)
    .all<DnsRecordRow>()
  return result.results ?? []
}

export async function listRecentRecordsByUser(
  db: D1Database,
  userId: string,
  limit = 500
): Promise<DnsRecordRow[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit) || 500))
  const result = await db
    .prepare('SELECT * FROM dns_record WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .bind(userId, safeLimit)
    .all<DnsRecordRow>()
  return result.results ?? []
}

export async function listAllRecords(db: D1Database, limit = 500): Promise<DnsRecordRow[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit) || 500))
  const result = await db
    .prepare('SELECT * FROM dns_record ORDER BY created_at DESC LIMIT ?')
    .bind(safeLimit)
    .all<DnsRecordRow>()
  return result.results ?? []
}

export type PageResult<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

function normalizePage(value: number | undefined): number {
  return Math.max(1, Math.floor(Number(value)) || 1)
}

function normalizePageSize(value: number | undefined, fallback = 50): number {
  return Math.max(1, Math.min(100, Math.floor(Number(value)) || fallback))
}

export async function listAllRecordsPage(
  db: D1Database,
  opts: { page?: number; pageSize?: number } = {}
): Promise<PageResult<DnsRecordRow>> {
  const pageSize = normalizePageSize(opts.pageSize)
  const countRow = await db.prepare('SELECT COUNT(*) AS count FROM dns_record').first<{ count: number }>()
  const total = Number(countRow?.count || 0)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(normalizePage(opts.page), totalPages)
  const result = await db
    .prepare('SELECT * FROM dns_record ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
    .bind(pageSize, (page - 1) * pageSize)
    .all<DnsRecordRow>()
  return { items: result.results ?? [], total, page, pageSize, totalPages }
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
  record: Omit<DnsRecordRow, 'id' | 'created_at' | 'sync_status' | 'sync_error_code' | 'sync_updated_at' | 'pending_server_address' | 'pending_port' | 'pending_target_type'> & { id?: string }
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

  return (await findRecordById(db, id))!
}

export async function insertPendingRecord(
  db: D1Database,
  record: Omit<DnsRecordRow, 'id' | 'created_at' | 'target_record_id' | 'srv_record_id' | 'sync_status' | 'sync_error_code' | 'sync_updated_at' | 'pending_server_address' | 'pending_port' | 'pending_target_type'> & { id?: string }
): Promise<DnsRecordRow> {
  const id = record.id ?? genId()
  const now = Date.now()
  await db.prepare(
    `INSERT INTO dns_record
      (id, user_id, root_domain, subdomain, host_name, server_address, port, target_type,
       target_record_id, srv_record_id, created_at, sync_status, sync_error_code, sync_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', NULL, ?, 'creating', NULL, ?)`
  ).bind(
    id,
    record.user_id,
    record.root_domain,
    record.subdomain,
    record.host_name,
    record.server_address,
    record.port,
    record.target_type,
    now,
    now
  ).run()
  return (await findRecordById(db, id))!
}

export async function beginRecordUpdate(
  db: D1Database,
  id: string,
  desired: { server_address: string; port: number; target_type: string }
): Promise<DnsRecordRow | null> {
  await db.prepare(
    `UPDATE dns_record
     SET sync_status = 'updating', sync_error_code = NULL, sync_updated_at = ?,
         pending_server_address = ?, pending_port = ?, pending_target_type = ?
     WHERE id = ?`
  ).bind(Date.now(), desired.server_address, desired.port, desired.target_type, id).run()
  return await findRecordById(db, id)
}

export async function persistRecordRemoteIds(
  db: D1Database,
  id: string,
  patch: { target_record_id?: string; srv_record_id?: string | null }
): Promise<void> {
  const row = await findRecordById(db, id)
  if (!row) throw new Error('dns_record_not_found')
  await db.prepare(
    `UPDATE dns_record SET target_record_id = ?, srv_record_id = ?, sync_updated_at = ? WHERE id = ?`
  ).bind(
    patch.target_record_id === undefined ? row.target_record_id : patch.target_record_id,
    patch.srv_record_id === undefined ? row.srv_record_id : patch.srv_record_id,
    Date.now(),
    id
  ).run()
}

export async function markRecordSyncError(db: D1Database, id: string, errorCode: string): Promise<void> {
  await db.prepare(
    `UPDATE dns_record SET sync_status = 'error', sync_error_code = ?, sync_updated_at = ? WHERE id = ?`
  ).bind(errorCode.slice(0, 64), Date.now(), id).run()
}

export async function finalizeRecordSync(
  db: D1Database,
  id: string,
  patch?: { server_address: string; port: number; target_type: string }
): Promise<DnsRecordRow | null> {
  const row = await findRecordById(db, id)
  if (!row) return null
  const desired = patch ?? {
    server_address: row.pending_server_address ?? row.server_address,
    port: row.pending_port ?? row.port,
    target_type: row.pending_target_type ?? row.target_type
  }
  await db.prepare(
    `UPDATE dns_record
     SET server_address = ?, port = ?, target_type = ?, sync_status = 'active',
         sync_error_code = NULL, sync_updated_at = ?, pending_server_address = NULL,
         pending_port = NULL, pending_target_type = NULL
     WHERE id = ?`
  ).bind(desired.server_address, desired.port, desired.target_type, Date.now(), id).run()
  return await findRecordById(db, id)
}


export async function updateRecordTarget(
  db: D1Database,
  id: string,
  patch: {
    server_address: string
    port: number
    target_type: string
    target_record_id: string
    srv_record_id: string | null
  }
): Promise<DnsRecordRow | null> {
  await db
    .prepare(
      `UPDATE dns_record
       SET server_address = ?, port = ?, target_type = ?, target_record_id = ?, srv_record_id = ?
       WHERE id = ?`
    )
    .bind(
      patch.server_address,
      patch.port,
      patch.target_type,
      patch.target_record_id,
      patch.srv_record_id,
      id
    )
    .run()
  return await findRecordById(db, id)
}

export async function deleteRecordRow(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM dns_record WHERE id = ?').bind(id).run()
}

export async function listAllUsers(db: D1Database): Promise<UserListRow[]> {
  const r = await db
    .prepare('SELECT id, name, email, emailVerified, role, super_admin, record_limit, createdAt FROM user ORDER BY "createdAt" ASC')
    .all<UserListRow>()
  return r.results ?? []
}

export type UserSearchRole = 'all' | 'user' | 'admin' | 'super'

export type UserSearchOptions = {
  q?: string
  role?: UserSearchRole
  limit?: number
}

export type UserSearchPageOptions = Omit<UserSearchOptions, 'limit'> & {
  page?: number
  pageSize?: number
}

function userSearchWhere(opts: UserSearchPageOptions): { whereSql: string; binds: unknown[] } {
  const q = String(opts.q ?? '').trim()
  const role = opts.role ?? 'all'
  const where: string[] = []
  const binds: unknown[] = []

  if (role === 'user') {
    where.push("(COALESCE(role, 'user') = 'user' AND COALESCE(super_admin, 0) = 0)")
  } else if (role === 'admin') {
    where.push("(role = 'admin' AND COALESCE(super_admin, 0) = 0)")
  } else if (role === 'super') {
    where.push('COALESCE(super_admin, 0) > 0')
  }

  if (q) {
    // Email is searched in D1 and masked before the result crosses the API boundary.
    where.push('(email = ? OR lower(email) LIKE ? OR lower(name) LIKE ? OR id = ? OR id LIKE ?)')
    const like = '%' + q.toLowerCase() + '%'
    binds.push(q, like, like, q, like)
  }

  return {
    whereSql: where.length ? ' WHERE ' + where.join(' AND ') : '',
    binds
  }
}

export async function searchUsersPage(
  db: D1Database,
  opts: UserSearchPageOptions = {}
): Promise<PageResult<UserListRow>> {
  const pageSize = normalizePageSize(opts.pageSize)
  const { whereSql, binds } = userSearchWhere(opts)
  const countRow = await db.prepare(
    'SELECT COUNT(*) AS count FROM user' + whereSql
  ).bind(...binds).first<{ count: number }>()
  const total = Number(countRow?.count || 0)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(normalizePage(opts.page), totalPages)
  const rows = await db.prepare(
    'SELECT id, name, email, emailVerified, role, super_admin, record_limit, createdAt FROM user' +
    whereSql + ' ORDER BY "createdAt" ASC, id ASC LIMIT ? OFFSET ?'
  ).bind(...binds, pageSize, (page - 1) * pageSize).all<UserListRow>()
  return { items: rows.results ?? [], total, page, pageSize, totalPages }
}

/** Search users by plaintext email/name/id; role filter is applied in SQL. */
export async function searchUsers(
  db: D1Database,
  opts: UserSearchOptions = {}
): Promise<UserListRow[]> {
  const limit = Math.max(1, Math.min(500, Math.floor(Number(opts.limit)) || 200))
  const result = await searchUsersPage(db, {
    q: opts.q,
    role: opts.role,
    page: 1,
    pageSize: Math.min(limit, 100)
  })
  if (limit <= 100 || result.total <= result.items.length) return result.items

  const pages = [result.items]
  for (let page = 2; page <= Math.ceil(Math.min(limit, result.total) / 100); page += 1) {
    pages.push((await searchUsersPage(db, { q: opts.q, role: opts.role, page, pageSize: 100 })).items)
  }
  return pages.flat().slice(0, limit)
}

export type UserListRow = {
  id: string
  name: string
  email: string
  emailVerified: number
  role: string
  super_admin: number
  record_limit: number | null
  createdAt: number
}

export async function findUserById(db: D1Database, id: string) {
  return await db
    .prepare('SELECT id, name, email, role, super_admin, record_limit FROM user WHERE id = ?')
    .bind(id)
    .first<{ id: string; name: string; email: string; role: string; super_admin: number; record_limit: number | null }>()
}

export async function setUserRole(
  db: D1Database,
  id: string,
  role: 'admin' | 'user'
): Promise<void> {
  await db.prepare('UPDATE user SET role = ? WHERE id = ?').bind(role, id).run()
}

export async function setUserRecordLimit(
  db: D1Database,
  id: string,
  limit: number | null
): Promise<void> {
  const value = limit === null ? null : Math.max(0, Math.floor(limit))
  await db
    .prepare('UPDATE user SET record_limit = ? WHERE id = ?')
    .bind(value, id)
    .run()
}

export async function isSuperAdmin(db: D1Database, id: string): Promise<boolean> {
  const r = await db
    .prepare('SELECT super_admin FROM user WHERE id = ?')
    .bind(id)
    .first<{ super_admin: number }>()
  return !!r?.super_admin
}

export async function countRecordsByUser(db: D1Database, userId: string): Promise<number> {
  const r = await db
    .prepare('SELECT COUNT(*) as n FROM dns_record WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number }>()
  return r?.n ?? 0
}

/**
 * 计算用户的最终记录上限：用户自定义优先，否则用全局上限。
 */
export function resolveRecordLimit(
  userLimit: number | null | undefined,
  globalLimit: number
): number {
  if (userLimit === null || userLimit === undefined) return globalLimit
  return Math.max(0, Math.floor(userLimit))
}

type DnsLimitUser = {
  role?: string | null
  super_admin?: number | null
  record_limit?: number | null
}

export function hasUnlimitedDnsLimits(user: DnsLimitUser | null | undefined): boolean {
  return user?.role === 'admin' || Number(user?.super_admin ?? 0) > 0
}

export function resolveUserRecordLimit(
  user: DnsLimitUser | null | undefined,
  globalLimit: number
): number {
  if (hasUnlimitedDnsLimits(user)) return 0
  return resolveRecordLimit(user?.record_limit ?? null, globalLimit)
}

export function resolveMinSubdomainLength(
  user: DnsLimitUser | null | undefined,
  globalMinLength: number
): number {
  if (hasUnlimitedDnsLimits(user)) return 0
  return Math.max(0, Math.floor(globalMinLength))
}

export async function deleteUserCascade(db: D1Database, id: string): Promise<void> {
  const user = await db
    .prepare('SELECT email FROM user WHERE id = ?')
    .bind(id)
    .first<{ email: string }>()

  const statements = [
    db.prepare('DELETE FROM dns_record WHERE user_id = ?').bind(id),
    db.prepare('DELETE FROM session WHERE userId = ?').bind(id),
    db.prepare('DELETE FROM account WHERE userId = ?').bind(id),
    db.prepare('DELETE FROM passkey WHERE userId = ?').bind(id),
    // Keep invite history, but detach FK references that would block user deletion.
    db.prepare('UPDATE invite_code SET used_by = NULL WHERE used_by = ?').bind(id),
    db.prepare('DELETE FROM invite_code WHERE created_by = ? AND used_by IS NULL').bind(id),
    ...(user?.email
      ? [db.prepare('DELETE FROM email_verification WHERE email = ?').bind(user.email)]
      : []),
    db.prepare('DELETE FROM user WHERE id = ?').bind(id)
  ]
  await db.batch(statements)
}
