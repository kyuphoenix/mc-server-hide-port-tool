export type LinkedAccountRow = {
  id: string
  providerId: string
  accountId: string
  createdAt: number | null
  updatedAt: number | null
}

export type PasskeyRow = {
  id: string
  name: string | null
  credentialID: string
  deviceType: string
  backedUp: number | boolean
  transports: string | null
  createdAt: number | Date | null
  aaguid: string | null
}

export async function listLinkedAccounts(db: D1Database, userId: string): Promise<LinkedAccountRow[]> {
  const result = await db
    .prepare(
      `SELECT id, providerId, accountId, createdAt, updatedAt
       FROM account
       WHERE userId = ? AND providerId != 'credential'
       ORDER BY createdAt ASC`
    )
    .bind(userId)
    .all<LinkedAccountRow>()
  return result.results ?? []
}

export async function countAuthFactors(db: D1Database, userId: string): Promise<{
  password: boolean
  oauthCount: number
  passkeyCount: number
  total: number
}> {
  const password = await db
    .prepare(
      `SELECT id FROM account
       WHERE userId = ? AND providerId = 'credential' AND password IS NOT NULL
       LIMIT 1`
    )
    .bind(userId)
    .first<{ id: string }>()
  const oauth = await db
    .prepare(
      `SELECT COUNT(*) as n FROM account
       WHERE userId = ? AND providerId != 'credential'`
    )
    .bind(userId)
    .first<{ n: number }>()
  const passkeys = await db
    .prepare('SELECT COUNT(*) as n FROM passkey WHERE userId = ?')
    .bind(userId)
    .first<{ n: number }>()

  const oauthCount = Number(oauth?.n ?? 0)
  const passkeyCount = Number(passkeys?.n ?? 0)
  const hasPassword = !!password
  return {
    password: hasPassword,
    oauthCount,
    passkeyCount,
    total: (hasPassword ? 1 : 0) + oauthCount + passkeyCount
  }
}
