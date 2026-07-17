import { afterEach, describe, expect, it } from 'vitest'
import {
  listAllRecordsPage,
  searchUsersPage
} from '../src/services/dns-records'
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

describe('admin list pagination', () => {
  it('returns exact filtered user totals and clamps out-of-range pages', async () => {
    const instance = await createTestD1()
    instances.push(instance)
    await seedUser(instance.db, { id: '8000' })
    const now = Date.now()
    await instance.db.batch(Array.from({ length: 7 }, (_, index) => instance.db.prepare(
      `INSERT INTO user
       (id, name, email, emailVerified, createdAt, updatedAt, role, super_admin)
       VALUES (?, ?, ?, 1, ?, ?, ?, 0)`
    ).bind(
      String(8100 + index),
      'Paged User ' + index,
      'paged-' + index + '@example.test',
      now + index,
      now + index,
      index < 5 ? 'user' : 'admin'
    )))

    const first = await searchUsersPage(instance.db, { role: 'user', page: 1, pageSize: 3 })
    expect(first).toMatchObject({ total: 5, page: 1, pageSize: 3, totalPages: 2 })
    expect(first.items).toHaveLength(3)

    const last = await searchUsersPage(instance.db, { role: 'user', page: 99, pageSize: 3 })
    expect(last).toMatchObject({ total: 5, page: 2, totalPages: 2 })
    expect(last.items).toHaveLength(2)
    expect(last.items.every((user) => user.role === 'user')).toBe(true)
  })

  it('paginates all DNS records with a stable ordering and exact total', async () => {
    const instance = await createTestD1()
    instances.push(instance)
    const userId = await seedUser(instance.db, { id: '8200' })
    const now = Date.now()
    await instance.db.batch(Array.from({ length: 7 }, (_, index) => instance.db.prepare(
      `INSERT INTO dns_record
       (id, user_id, root_domain, subdomain, host_name, server_address, port, target_type,
        target_record_id, srv_record_id, created_at)
       VALUES (?, ?, 'example.com', ?, ?, '192.0.2.1', 25565, 'A', ?, NULL, ?)`
    ).bind(
      'record-' + index,
      userId,
      'paged-' + index,
      'paged-' + index + '.example.com',
      'cf-' + index,
      now + index
    )))

    const second = await listAllRecordsPage(instance.db, { page: 2, pageSize: 3 })
    expect(second).toMatchObject({ total: 7, page: 2, pageSize: 3, totalPages: 3 })
    expect(second.items.map((record) => record.id)).toEqual(['record-3', 'record-2', 'record-1'])

    const last = await listAllRecordsPage(instance.db, { page: 9, pageSize: 3 })
    expect(last).toMatchObject({ total: 7, page: 3, totalPages: 3 })
    expect(last.items.map((record) => record.id)).toEqual(['record-0'])
  })
})
