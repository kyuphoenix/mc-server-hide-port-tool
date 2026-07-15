export const FIRST_SETUP_CLAIM_TTL_MS = 10 * 60 * 1000

export type FirstSetupStatus = 'open' | 'claimed' | 'completed'

export type FirstSetupStage =
  | 'claim'
  | 'bind-user'
  | 'create-user'
  | 'release'
  | 'reconcile'
  | 'guard'

export type FirstSetupState = {
  status: FirstSetupStatus
  claimedAt: number | null
  claimedUserId: string | null
  completedAt: number | null
}

export type FirstSetupClaim = {
  token: string
  expiresAt: number
}

export type FirstSetupErrorCode =
  | 'SETUP_DONE'
  | 'SETUP_IN_PROGRESS'
  | 'SETUP_NOT_READY'
  | 'SETUP_CLAIM_INVALID'
  | 'SETUP_INCONSISTENT'
  | 'SETUP_FAILED'

export class FirstSetupError extends Error {
  constructor(readonly code: FirstSetupErrorCode) {
    super(code)
    this.name = 'FirstSetupError'
  }
}

type StateRow = {
  status: FirstSetupStatus
  claim_token_hash: string | null
  claimed_at: number | null
  claimed_user_id: string | null
  completed_at: number | null
}

function asFirstSetupError(error: unknown): FirstSetupError {
  return error instanceof FirstSetupError
    ? error
    : new FirstSetupError('SETUP_FAILED')
}

function toState(row: StateRow): FirstSetupState {
  return {
    status: row.status,
    claimedAt: row.claimed_at == null ? null : Number(row.claimed_at),
    claimedUserId: row.claimed_user_id,
    completedAt: row.completed_at == null ? null : Number(row.completed_at)
  }
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0')
  ).join('')
}

async function getStateRow(db: D1Database): Promise<StateRow> {
  const row = await db.prepare(
    `SELECT status, claim_token_hash, claimed_at, claimed_user_id, completed_at
     FROM first_setup WHERE id = 1`
  ).first<StateRow>()
  if (!row) throw new FirstSetupError('SETUP_INCONSISTENT')
  return row
}

async function hasCredential(db: D1Database, userId: string): Promise<boolean> {
  return !!(await db.prepare(
    "SELECT 1 AS present FROM account WHERE userId = ? AND providerId = 'credential' LIMIT 1"
  ).bind(userId).first())
}

async function completeClaimIfCredentialPresent(
  db: D1Database,
  row: StateRow,
  now: number
): Promise<FirstSetupState | null> {
  if (row.status !== 'claimed' || !row.claim_token_hash || !row.claimed_user_id) return null
  if (!(await hasCredential(db, row.claimed_user_id))) return null

  const result = await db.prepare(
    `UPDATE first_setup
     SET status = 'completed', claim_token_hash = NULL, completed_at = ?
     WHERE id = 1 AND status = 'claimed'
       AND claim_token_hash = ? AND claimed_user_id = ?
       AND EXISTS (
         SELECT 1 FROM account
         WHERE userId = ? AND providerId = 'credential'
       )
       AND EXISTS (
         SELECT 1 FROM user
         WHERE id = ? AND role = 'admin' AND COALESCE(super_admin, 0) = 1
       )`
  ).bind(
    now,
    row.claim_token_hash,
    row.claimed_user_id,
    row.claimed_user_id,
    row.claimed_user_id
  ).run()
  if (Number(result.meta.changes ?? 0) === 1) {
    return toState(await getStateRow(db))
  }

  const current = await getStateRow(db)
  if (current.status === 'completed') return toState(current)
  if (await hasCredential(db, row.claimed_user_id)) {
    throw new FirstSetupError('SETUP_INCONSISTENT')
  }
  return null
}

async function releaseClaimByConditions(
  db: D1Database,
  input: { hash: string; staleCutoff?: number }
): Promise<void> {
  const staleClause = input.staleCutoff == null ? '' : ' AND claimed_at <= ?'
  const deleteBindings = input.staleCutoff == null
    ? [input.hash]
    : [input.hash, input.staleCutoff]
  const updateBindings = input.staleCutoff == null
    ? [input.hash]
    : [input.hash, input.staleCutoff]

  const deleteStatement = db.prepare(
    `DELETE FROM user
     WHERE id = (
       SELECT claimed_user_id FROM first_setup
       WHERE id = 1 AND status = 'claimed' AND claim_token_hash = ?` + staleClause + `
     )
     AND NOT EXISTS (
       SELECT 1 FROM account
       WHERE account.userId = user.id AND account.providerId = 'credential'
     )`
  ).bind(...deleteBindings)

  const updateStatement = db.prepare(
    `UPDATE first_setup
     SET status = 'open', claim_token_hash = NULL, claimed_at = NULL,
         claimed_user_id = NULL, completed_at = NULL
     WHERE id = 1 AND status = 'claimed' AND claim_token_hash = ?` + staleClause + `
       AND (
         claimed_user_id IS NULL
         OR NOT EXISTS (SELECT 1 FROM user WHERE id = first_setup.claimed_user_id)
       )
       AND NOT EXISTS (
         SELECT 1 FROM account
         WHERE userId = first_setup.claimed_user_id AND providerId = 'credential'
       )`
  ).bind(...updateBindings)

  await db.batch([deleteStatement, updateStatement])
}

export async function getFirstSetupState(db: D1Database): Promise<FirstSetupState> {
  return toState(await getStateRow(db))
}

export async function reconcileFirstSetup(
  db: D1Database,
  now = Date.now()
): Promise<FirstSetupState> {
  let row = await getStateRow(db)
  if (row.status === 'completed') return toState(row)

  if (row.status === 'open') {
    const existingUser = await db.prepare('SELECT 1 AS present FROM user LIMIT 1').first()
    if (!existingUser) return toState(row)
    await db.prepare(
      `UPDATE first_setup
       SET status = 'completed', claim_token_hash = NULL, claimed_at = NULL,
           claimed_user_id = NULL, completed_at = ?
       WHERE id = 1 AND status = 'open'
         AND EXISTS (SELECT 1 FROM user)`
    ).bind(now).run()
    return toState(await getStateRow(db))
  }

  const completed = await completeClaimIfCredentialPresent(db, row, now)
  if (completed) return completed

  if (row.claimed_at == null || !row.claim_token_hash) {
    throw new FirstSetupError('SETUP_INCONSISTENT')
  }
  const staleCutoff = now - FIRST_SETUP_CLAIM_TTL_MS
  if (Number(row.claimed_at) > staleCutoff) return toState(row)

  await releaseClaimByConditions(db, {
    hash: row.claim_token_hash,
    staleCutoff
  })
  row = await getStateRow(db)
  if (row.status === 'completed' || row.status === 'open') return toState(row)

  const completedAfterRace = await completeClaimIfCredentialPresent(db, row, now)
  if (completedAfterRace) return completedAfterRace
  throw new FirstSetupError('SETUP_INCONSISTENT')
}

export async function claimFirstSetup(
  db: D1Database,
  now = Date.now()
): Promise<FirstSetupClaim> {
  await reconcileFirstSetup(db, now)
  const token = randomToken()
  const tokenHash = await sha256Hex(token)
  const result = await db.prepare(
    `UPDATE first_setup
     SET status = 'claimed', claim_token_hash = ?, claimed_at = ?,
         claimed_user_id = NULL, completed_at = NULL
     WHERE id = 1 AND status = 'open'
       AND NOT EXISTS (SELECT 1 FROM user)`
  ).bind(tokenHash, now).run()
  if (Number(result.meta.changes ?? 0) === 1) {
    return { token, expiresAt: now + FIRST_SETUP_CLAIM_TTL_MS }
  }

  const existingUser = await db.prepare('SELECT 1 AS present FROM user LIMIT 1').first()
  const state = await getFirstSetupState(db)
  if (state.status === 'completed' || existingUser) {
    throw new FirstSetupError('SETUP_DONE')
  }
  if (state.status === 'claimed') {
    throw new FirstSetupError('SETUP_IN_PROGRESS')
  }
  throw new FirstSetupError('SETUP_INCONSISTENT')
}

export async function assertFirstSetupClaimActive(
  db: D1Database,
  token: string,
  now = Date.now()
): Promise<void> {
  const hash = await sha256Hex(token)
  const row = await db.prepare(
    `SELECT claimed_at FROM first_setup
     WHERE id = 1 AND status = 'claimed' AND claim_token_hash = ?
       AND claimed_user_id IS NULL AND claimed_at > ?
       AND NOT EXISTS (SELECT 1 FROM user)`
  ).bind(hash, now - FIRST_SETUP_CLAIM_TTL_MS).first<{ claimed_at: number }>()
  if (!row) throw new FirstSetupError('SETUP_CLAIM_INVALID')
}

export async function bindFirstSetupUser(
  db: D1Database,
  input: { token: string; userId: string; now?: number }
): Promise<void> {
  const now = input.now ?? Date.now()
  const hash = await sha256Hex(input.token)
  const result = await db.prepare(
    `UPDATE first_setup
     SET claimed_user_id = ?
     WHERE id = 1 AND status = 'claimed' AND claim_token_hash = ?
       AND claimed_user_id IS NULL AND claimed_at > ?
       AND NOT EXISTS (SELECT 1 FROM user)`
  ).bind(input.userId, hash, now - FIRST_SETUP_CLAIM_TTL_MS).run()
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new FirstSetupError('SETUP_CLAIM_INVALID')
  }
}

export async function assertFirstSetupCompleted(db: D1Database): Promise<void> {
  const state = await reconcileFirstSetup(db)
  if (state.status !== 'completed') {
    throw new FirstSetupError('SETUP_NOT_READY')
  }
}

export async function releaseOwnedFirstSetupClaim(
  db: D1Database,
  token: string
): Promise<FirstSetupState> {
  const hash = await sha256Hex(token)
  let row = await getStateRow(db)
  if (row.status !== 'claimed' || row.claim_token_hash !== hash) {
    return toState(row)
  }

  const completed = await completeClaimIfCredentialPresent(db, row, Date.now())
  if (completed) return completed

  await releaseClaimByConditions(db, { hash })
  row = await getStateRow(db)
  if (row.status === 'completed' || row.status === 'open') return toState(row)

  const completedAfterRace = await completeClaimIfCredentialPresent(db, row, Date.now())
  if (completedAfterRace) return completedAfterRace
  throw new FirstSetupError('SETUP_INCONSISTENT')
}

export function createFirstSetupSecurityEvent(
  error: unknown,
  input: { stage: FirstSetupStage; now?: number }
): {
  event: 'first_setup_security'
  code: FirstSetupError['code']
  stage: FirstSetupStage
  timestamp: string
} {
  return {
    event: 'first_setup_security',
    code: asFirstSetupError(error).code,
    stage: input.stage,
    timestamp: new Date(input.now ?? Date.now()).toISOString()
  }
}
