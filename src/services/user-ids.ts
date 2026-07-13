/**
 * Sequential numeric user ids stored as decimal strings: "1", "2", "3", ...
 * Source of truth: user_id_counter (created in migration 0008).
 */

async function maxExistingUserId(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT MAX(CAST(id AS INTEGER)) AS n
       FROM user
       WHERE id GLOB '[0-9]*'`
    )
    .first<{ n: number | null }>()
  const n = Number(row?.n ?? 0)
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
}

export async function ensureUserIdCounter(db: D1Database): Promise<void> {
  const maxId = await maxExistingUserId(db)
  await db
    .prepare(
      `INSERT INTO user_id_counter (name, value)
       VALUES ('user', ?)
       ON CONFLICT(name) DO UPDATE SET
         value = CASE
           WHEN user_id_counter.value < excluded.value THEN excluded.value
           ELSE user_id_counter.value
         END`
    )
    .bind(maxId)
    .run()
}

/**
 * Atomically allocate the next user id starting from 1.
 * Returns a decimal string (better-auth stores user.id as string).
 */
export async function allocateNextUserId(db: D1Database): Promise<string> {
  await ensureUserIdCounter(db)

  try {
    const row = await db
      .prepare(
        `UPDATE user_id_counter
         SET value = value + 1
         WHERE name = 'user'
         RETURNING value`
      )
      .first<{ value: number }>()
    if (row && Number.isFinite(Number(row.value))) {
      return String(Math.trunc(Number(row.value)))
    }
  } catch {
    // Environments without UPDATE...RETURNING
  }

  await db
    .prepare(`UPDATE user_id_counter SET value = value + 1 WHERE name = 'user'`)
    .run()
  const row = await db
    .prepare(`SELECT value FROM user_id_counter WHERE name = 'user'`)
    .first<{ value: number }>()
  const value = Math.max(1, Math.trunc(Number(row?.value ?? 1)))
  return String(value)
}
