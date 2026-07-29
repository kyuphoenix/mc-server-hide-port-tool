export const ANNOUNCEMENT_TITLE_MAX = 80
export const ANNOUNCEMENT_CONTENT_MAX = 5000

export type Announcement = {
  enabled: boolean
  title: string
  content: string
  version: number
  updatedAt: number | null
  updatedBy: string | null
}

export type PublicAnnouncement = Pick<
  Announcement,
  'title' | 'content' | 'version' | 'updatedAt'
>

export type UpdateAnnouncementInput = {
  enabled: boolean
  title: string
  content: string
  updatedBy: string
}

type AnnouncementRow = {
  enabled: number
  title: string
  content: string
  version: number
  updated_at: number | null
  updated_by: string | null
}

const DEFAULT_ANNOUNCEMENT: Announcement = {
  enabled: false,
  title: '系统公告',
  content: '',
  version: 0,
  updatedAt: null,
  updatedBy: null
}

export class AnnouncementValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnnouncementValidationError'
  }
}

function normalizeRow(row: AnnouncementRow | null): Announcement {
  if (!row) return { ...DEFAULT_ANNOUNCEMENT }
  return {
    enabled: !!row.enabled,
    title: String(row.title ?? ''),
    content: String(row.content ?? ''),
    version: Math.max(0, Number(row.version) || 0),
    updatedAt: row.updated_at == null ? null : Number(row.updated_at),
    updatedBy: row.updated_by == null ? null : String(row.updated_by)
  }
}

function validateInput(input: UpdateAnnouncementInput): {
  enabled: boolean
  title: string
  content: string
  updatedBy: string
} {
  const enabled = !!input.enabled
  const title = String(input.title ?? '').trim()
  const content = String(input.content ?? '').trim()
  const updatedBy = String(input.updatedBy ?? '').trim()

  if (title.length > ANNOUNCEMENT_TITLE_MAX) {
    throw new AnnouncementValidationError(`公告标题不能超过 ${ANNOUNCEMENT_TITLE_MAX} 个字符`)
  }
  if (content.length > ANNOUNCEMENT_CONTENT_MAX) {
    throw new AnnouncementValidationError(`公告内容不能超过 ${ANNOUNCEMENT_CONTENT_MAX} 个字符`)
  }
  if (enabled && !title) {
    throw new AnnouncementValidationError('公告标题不能为空')
  }
  if (enabled && !content) {
    throw new AnnouncementValidationError('公告内容不能为空')
  }
  if (!updatedBy) {
    throw new AnnouncementValidationError('缺少公告更新人')
  }

  return { enabled, title, content, updatedBy }
}

export async function getAnnouncement(db: D1Database): Promise<Announcement> {
  const row = await db
    .prepare(
      `SELECT enabled, title, content, version, updated_at, updated_by
       FROM site_announcement
       WHERE id = ?`
    )
    .bind('default')
    .first<AnnouncementRow>()
  return normalizeRow(row)
}

export async function getPublishedAnnouncement(
  db: D1Database
): Promise<PublicAnnouncement | null> {
  const announcement = await getAnnouncement(db)
  if (!announcement.enabled || !announcement.title.trim() || !announcement.content.trim()) {
    return null
  }
  return {
    title: announcement.title,
    content: announcement.content,
    version: announcement.version,
    updatedAt: announcement.updatedAt
  }
}

export async function updateAnnouncement(
  db: D1Database,
  input: UpdateAnnouncementInput
): Promise<Announcement> {
  const next = validateInput(input)
  const updatedAt = Date.now()

  await db
    .prepare(
      `INSERT INTO site_announcement
         (id, enabled, title, content, version, updated_at, updated_by)
       VALUES ('default', ?, ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         enabled = excluded.enabled,
         title = excluded.title,
         content = excluded.content,
         version = site_announcement.version + 1,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`
    )
    .bind(
      next.enabled ? 1 : 0,
      next.title,
      next.content,
      updatedAt,
      next.updatedBy
    )
    .run()

  return await getAnnouncement(db)
}
