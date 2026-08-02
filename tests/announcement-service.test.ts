import { beforeEach, describe, expect, it } from 'vitest'
import {
  ANNOUNCEMENT_CONTENT_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  getAnnouncement,
  getPublishedAnnouncement,
  updateAnnouncement
} from '../src/services/announcement'
import { createSharedTestD1, type SharedTestD1 } from './helpers/d1'

let shared: SharedTestD1
let db: D1Database

beforeEach(async () => {
  shared = await createSharedTestD1()
  db = shared.db
  await shared.resetDatabase()
})

describe('site announcement service', () => {
  it('starts with a disabled singleton announcement', async () => {
    await expect(getAnnouncement(db)).resolves.toMatchObject({
      enabled: false,
      title: '系统公告',
      content: '',
      version: 0,
      updatedAt: null,
      updatedBy: null
    })
    await expect(getPublishedAnnouncement(db)).resolves.toBeNull()
  })

  it('publishes trimmed plain text and increments the version on every save', async () => {
    const first = await updateAnnouncement(db, {
      enabled: true,
      title: ' 维护通知 ',
      content: ' 今晚维护。 ',
      updatedBy: 'admin-1'
    })
    expect(first).toMatchObject({
      enabled: true,
      title: '维护通知',
      content: '今晚维护。',
      version: 1,
      updatedBy: 'admin-1'
    })
    expect(first.updatedAt).toEqual(expect.any(Number))
    await expect(getPublishedAnnouncement(db)).resolves.toEqual({
      title: '维护通知',
      content: '今晚维护。',
      version: 1,
      updatedAt: first.updatedAt
    })

    const second = await updateAnnouncement(db, {
      enabled: true,
      title: first.title,
      content: first.content,
      updatedBy: 'admin-1'
    })
    expect(second.version).toBe(2)
  })

  it('allows disabling while retaining content and hides disabled announcements publicly', async () => {
    await updateAnnouncement(db, {
      enabled: true,
      title: '通知',
      content: '内容',
      updatedBy: 'admin-1'
    })

    const disabled = await updateAnnouncement(db, {
      enabled: false,
      title: '通知',
      content: '内容',
      updatedBy: 'admin-2'
    })

    expect(disabled).toMatchObject({ enabled: false, version: 2, updatedBy: 'admin-2' })
    await expect(getPublishedAnnouncement(db)).resolves.toBeNull()
  })

  it('validates enabled content and configured length limits', async () => {
    await expect(updateAnnouncement(db, {
      enabled: true,
      title: '',
      content: '内容',
      updatedBy: 'admin-1'
    })).rejects.toThrow('公告标题不能为空')

    await expect(updateAnnouncement(db, {
      enabled: true,
      title: '通知',
      content: '',
      updatedBy: 'admin-1'
    })).rejects.toThrow('公告内容不能为空')

    await expect(updateAnnouncement(db, {
      enabled: false,
      title: 'x'.repeat(ANNOUNCEMENT_TITLE_MAX + 1),
      content: '',
      updatedBy: 'admin-1'
    })).rejects.toThrow(`公告标题不能超过 ${ANNOUNCEMENT_TITLE_MAX} 个字符`)

    await expect(updateAnnouncement(db, {
      enabled: false,
      title: '通知',
      content: 'x'.repeat(ANNOUNCEMENT_CONTENT_MAX + 1),
      updatedBy: 'admin-1'
    })).rejects.toThrow(`公告内容不能超过 ${ANNOUNCEMENT_CONTENT_MAX} 个字符`)
  })
})
