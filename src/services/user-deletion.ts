import type { Bindings } from './cloudflare-dns'
import { deleteRecordAndCloudflare, toDnsFailureEvent } from './cloudflare-dns'
import {
  deleteUserCascade,
  listRecordsByUserBatch
} from './dns-records'
import { logDnsExternalServiceFailure } from '../lib/external-service-security'

export type UserDeletionJobStatus = 'pending' | 'running' | 'failed' | 'completed'

export type UserDeletionJob = {
  id: string
  user_id: string
  created_by: string
  status: UserDeletionJobStatus
  processed_records: number
  last_error_code: string | null
  lease_token: string | null
  lease_expires_at: number | null
  created_at: number
  updated_at: number
  completed_at: number | null
}

export type UserDeletionProgress = {
  status: 'pending' | 'processing' | 'failed' | 'completed'
  processedRecords: number
  remainingRecords: number
  lastErrorCode: string | null
}

export const USER_DELETION_BATCH_SIZE = 5
const USER_DELETION_LEASE_MS = 60_000

type DeleteRecord = typeof deleteRecordAndCloudflare

export async function findUserDeletionJob(
  db: D1Database,
  userId: string
): Promise<UserDeletionJob | null> {
  return await db.prepare(
    'SELECT * FROM user_deletion_job WHERE user_id = ?'
  ).bind(userId).first<UserDeletionJob>()
}

export async function ensureUserDeletionJob(
  db: D1Database,
  userId: string,
  createdBy: string
): Promise<UserDeletionJob> {
  const now = Date.now()
  await db.prepare(
    `INSERT INTO user_deletion_job
       (id, user_id, created_by, status, processed_records, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', 0, ?, ?)
     ON CONFLICT(user_id) DO NOTHING`
  ).bind(crypto.randomUUID(), userId, createdBy, now, now).run()
  const job = await findUserDeletionJob(db, userId)
  if (!job) throw new Error('user_deletion_job_create_failed')
  return job
}

async function remainingRecordCount(db: D1Database, userId: string): Promise<number> {
  const row = await db.prepare(
    'SELECT COUNT(*) AS count FROM dns_record WHERE user_id = ?'
  ).bind(userId).first<{ count: number }>()
  return Number(row?.count || 0)
}

function toProgress(job: UserDeletionJob, remainingRecords: number): UserDeletionProgress {
  return {
    status: job.status === 'running' ? 'processing' : job.status,
    processedRecords: Number(job.processed_records || 0),
    remainingRecords,
    lastErrorCode: job.last_error_code
  }
}

export async function processUserDeletionBatch(
  env: Bindings,
  userId: string,
  deleteRecord: DeleteRecord = deleteRecordAndCloudflare
): Promise<UserDeletionProgress> {
  const job = await findUserDeletionJob(env.DB, userId)
  if (!job) throw new Error('user_deletion_job_not_found')
  if (job.status === 'completed') return toProgress(job, 0)

  const now = Date.now()
  const leaseToken = crypto.randomUUID()
  const claim = await env.DB.prepare(
    `UPDATE user_deletion_job
     SET status = 'running', lease_token = ?, lease_expires_at = ?, updated_at = ?, last_error_code = NULL
     WHERE user_id = ? AND status <> 'completed'
       AND (status <> 'running' OR lease_expires_at IS NULL OR lease_expires_at <= ?)`
  ).bind(leaseToken, now + USER_DELETION_LEASE_MS, now, userId, now).run()

  if (Number(claim.meta.changes || 0) === 0) {
    const current = await findUserDeletionJob(env.DB, userId)
    if (!current) throw new Error('user_deletion_job_not_found')
    return toProgress(current, await remainingRecordCount(env.DB, userId))
  }

  const records = await listRecordsByUserBatch(env.DB, userId, USER_DELETION_BATCH_SIZE)
  const settled = await Promise.allSettled(records.map((record) => deleteRecord(env, record)))
  const succeeded = settled.filter((result) => result.status === 'fulfilled').length
  const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')

  if (failure) {
    const event = toDnsFailureEvent(failure.reason, 'record_delete')
    logDnsExternalServiceFailure(event)
    await env.DB.prepare(
      `UPDATE user_deletion_job
       SET status = 'failed', processed_records = processed_records + ?, last_error_code = ?,
           lease_token = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE user_id = ? AND lease_token = ?`
    ).bind(succeeded, event.code, Date.now(), userId, leaseToken).run()
    const failedJob = await findUserDeletionJob(env.DB, userId)
    if (!failedJob) throw new Error('user_deletion_job_not_found')
    return toProgress(failedJob, await remainingRecordCount(env.DB, userId))
  }

  const remaining = await remainingRecordCount(env.DB, userId)
  if (remaining > 0) {
    await env.DB.prepare(
      `UPDATE user_deletion_job
       SET status = 'pending', processed_records = processed_records + ?, last_error_code = NULL,
           lease_token = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE user_id = ? AND lease_token = ?`
    ).bind(succeeded, Date.now(), userId, leaseToken).run()
    const pendingJob = await findUserDeletionJob(env.DB, userId)
    if (!pendingJob) throw new Error('user_deletion_job_not_found')
    return toProgress(pendingJob, remaining)
  }

  try {
    await deleteUserCascade(env.DB, userId)
  } catch {
    await env.DB.prepare(
      `UPDATE user_deletion_job
       SET status = 'failed', processed_records = processed_records + ?, last_error_code = 'USER_CASCADE_FAILED',
           lease_token = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE user_id = ? AND lease_token = ?`
    ).bind(succeeded, Date.now(), userId, leaseToken).run()
    const failedJob = await findUserDeletionJob(env.DB, userId)
    if (!failedJob) throw new Error('user_deletion_job_not_found')
    return toProgress(failedJob, 0)
  }

  const completedAt = Date.now()
  await env.DB.prepare(
    `UPDATE user_deletion_job
     SET status = 'completed', processed_records = processed_records + ?, last_error_code = NULL,
         lease_token = NULL, lease_expires_at = NULL, updated_at = ?, completed_at = ?
     WHERE user_id = ? AND lease_token = ?`
  ).bind(succeeded, completedAt, completedAt, userId, leaseToken).run()
  const completedJob = await findUserDeletionJob(env.DB, userId)
  if (!completedJob) throw new Error('user_deletion_job_not_found')
  return toProgress(completedJob, 0)
}
