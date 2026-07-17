import { afterEach, describe, expect, it } from 'vitest'
import type { Bindings } from '../src/services/cloudflare-dns'
import { insertRecord, type DnsRecordRow } from '../src/services/dns-records'
import {
  ensureUserDeletionJob,
  findUserDeletionJob,
  processUserDeletionBatch,
  USER_DELETION_BATCH_SIZE
} from '../src/services/user-deletion'
import {
  createTestD1,
  disposeTestD1Instances,
  seedUser,
  type TestD1
} from './helpers/d1'

const instances: TestD1[] = []

afterEach(async () => {
  await disposeTestD1Instances(instances)
})

async function setup(recordCount: number) {
  const instance = await createTestD1()
  instances.push(instance)
  const adminId = await seedUser(instance.db, { id: '7001' })
  const userId = await seedUser(instance.db, {
    id: '7002',
    email: 'delete-target@example.test',
    name: 'Delete Target'
  })
  await instance.db.prepare(
    "UPDATE user SET role = 'user', super_admin = 0 WHERE id = ?"
  ).bind(userId).run()

  for (let i = 0; i < recordCount; i += 1) {
    await insertRecord(instance.db, {
      user_id: userId,
      root_domain: 'example.com',
      subdomain: 'delete-' + i,
      host_name: 'delete-' + i + '.example.com',
      server_address: '192.0.2.' + (i + 1),
      port: 25565,
      target_type: 'A',
      target_record_id: 'cf-' + i,
      srv_record_id: null
    })
  }
  await ensureUserDeletionJob(instance.db, userId, adminId)
  return {
    db: instance.db,
    env: { DB: instance.db } as Bindings,
    userId
  }
}

function localDelete(db: D1Database, calls: string[]) {
  return async (_env: Bindings, record: DnsRecordRow): Promise<void> => {
    calls.push(record.id)
    await db.prepare('DELETE FROM dns_record WHERE id = ?').bind(record.id).run()
  }
}

describe('resumable user deletion', () => {
  it('processes only a bounded DNS batch and deletes the user after the final batch', async () => {
    const { db, env, userId } = await setup(USER_DELETION_BATCH_SIZE + 2)
    const calls: string[] = []

    const first = await processUserDeletionBatch(env, userId, localDelete(db, calls))
    expect(first).toMatchObject({
      status: 'pending',
      processedRecords: USER_DELETION_BATCH_SIZE,
      remainingRecords: 2
    })
    expect(calls).toHaveLength(USER_DELETION_BATCH_SIZE)
    expect(await db.prepare('SELECT id FROM user WHERE id = ?').bind(userId).first()).not.toBeNull()

    const second = await processUserDeletionBatch(env, userId, localDelete(db, calls))
    expect(second).toMatchObject({
      status: 'completed',
      processedRecords: USER_DELETION_BATCH_SIZE + 2,
      remainingRecords: 0
    })
    expect(await db.prepare('SELECT id FROM user WHERE id = ?').bind(userId).first()).toBeNull()
  }, 15_000)

  it('persists partial success and resumes after a remote deletion failure', async () => {
    const { db, env, userId } = await setup(3)
    let shouldFail = true
    const calls: string[] = []
    const flakyDelete = async (_env: Bindings, record: DnsRecordRow): Promise<void> => {
      calls.push(record.id)
      if (shouldFail) {
        shouldFail = false
        throw new Error('private remote failure')
      }
      await db.prepare('DELETE FROM dns_record WHERE id = ?').bind(record.id).run()
    }

    const first = await processUserDeletionBatch(env, userId, flakyDelete)
    expect(first).toMatchObject({
      status: 'failed',
      processedRecords: 2,
      remainingRecords: 1,
      lastErrorCode: 'DNS_EXTERNAL_FAILURE'
    })
    expect(await db.prepare('SELECT id FROM user WHERE id = ?').bind(userId).first()).not.toBeNull()

    const second = await processUserDeletionBatch(env, userId, flakyDelete)
    expect(second).toMatchObject({
      status: 'completed',
      processedRecords: 3,
      remainingRecords: 0
    })
    expect(calls).toHaveLength(4)
  })

  it('honors an active lease and does not duplicate remote work', async () => {
    const { db, env, userId } = await setup(1)
    await db.prepare(
      "UPDATE user_deletion_job SET status = 'running', lease_token = 'other', lease_expires_at = ? WHERE user_id = ?"
    ).bind(Date.now() + 60_000, userId).run()
    const calls: string[] = []

    const progress = await processUserDeletionBatch(env, userId, localDelete(db, calls))
    expect(progress.status).toBe('processing')
    expect(progress.remainingRecords).toBe(1)
    expect(calls).toHaveLength(0)
    expect(await db.prepare('SELECT id FROM user WHERE id = ?').bind(userId).first()).not.toBeNull()
  })

  it('is idempotent after completion', async () => {
    const { db, env, userId } = await setup(0)
    const calls: string[] = []

    await expect(processUserDeletionBatch(env, userId, localDelete(db, calls))).resolves.toMatchObject({
      status: 'completed'
    })
    await expect(processUserDeletionBatch(env, userId, localDelete(db, calls))).resolves.toMatchObject({
      status: 'completed',
      remainingRecords: 0
    })
    expect(calls).toHaveLength(0)
    expect((await findUserDeletionJob(db, userId))?.status).toBe('completed')
  })
})
