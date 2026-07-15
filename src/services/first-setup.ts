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
  claimed_at: number | null
  claimed_user_id: string | null
  completed_at: number | null
}

function asFirstSetupError(error: unknown): FirstSetupError {
  return error instanceof FirstSetupError
    ? error
    : new FirstSetupError('SETUP_FAILED')
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

export async function getFirstSetupState(db: D1Database): Promise<FirstSetupState> {
  const row = await db.prepare(
    'SELECT status, claimed_at, claimed_user_id, completed_at FROM first_setup WHERE id = 1'
  ).first<StateRow>()
  if (!row) throw new FirstSetupError('SETUP_INCONSISTENT')
  return {
    status: row.status,
    claimedAt: row.claimed_at == null ? null : Number(row.claimed_at),
    claimedUserId: row.claimed_user_id,
    completedAt: row.completed_at == null ? null : Number(row.completed_at)
  }
}

export async function reconcileFirstSetup(
  db: D1Database,
  _now = Date.now()
): Promise<FirstSetupState> {
  return await getFirstSetupState(db)
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
