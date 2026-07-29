import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'

type AnnouncementPreferences = { hideDate?: unknown; dismissedVersion?: unknown }
type AnnouncementModule = {
  dismissAnnouncementVersion(
    preferences: AnnouncementPreferences,
    version: number
  ): { hideDate: string; dismissedVersion: number }
  hideAnnouncementForToday(
    preferences: AnnouncementPreferences,
    today?: string
  ): { hideDate: string; dismissedVersion: number }
  isAnnouncementTrigger(page: string, search?: string): boolean
  localDateKey(date?: Date): string
  normalizeAnnouncementPreferences(value: unknown): { hideDate: string; dismissedVersion: number }
  shouldShowAnnouncement(
    version: number,
    preferences: AnnouncementPreferences,
    today?: string
  ): boolean
}

let announcementModule: AnnouncementModule

beforeAll(async () => {
  const modulePath = '../public/static/announcement.js'
  announcementModule = await import(modulePath) as AnnouncementModule
})

describe('announcement browser policy', () => {
  it('uses the browser-local calendar date', () => {
    expect(announcementModule.localDateKey(new Date(2026, 6, 29, 23, 59, 59))).toBe('2026-07-29')
    expect(announcementModule.localDateKey(new Date(2026, 0, 2, 0, 0, 0))).toBe('2026-01-02')
  })

  it('suppresses every announcement version for the selected local day', () => {
    const preferences = announcementModule.hideAnnouncementForToday(
      { dismissedVersion: 2 },
      '2026-07-29'
    )

    expect(announcementModule.shouldShowAnnouncement(4, preferences, '2026-07-29')).toBe(false)
    expect(announcementModule.shouldShowAnnouncement(4, preferences, '2026-07-30')).toBe(true)
  })

  it('suppresses only the dismissed version until the announcement is updated', () => {
    const preferences = announcementModule.dismissAnnouncementVersion({ hideDate: '' }, 4)

    expect(announcementModule.shouldShowAnnouncement(4, preferences, '2026-07-29')).toBe(false)
    expect(announcementModule.shouldShowAnnouncement(3, preferences, '2026-07-29')).toBe(false)
    expect(announcementModule.shouldShowAnnouncement(5, preferences, '2026-07-29')).toBe(true)
  })

  it('normalizes corrupt stored preference values safely', () => {
    expect(announcementModule.normalizeAnnouncementPreferences(null)).toEqual({
      hideDate: '',
      dismissedVersion: 0
    })
    expect(announcementModule.normalizeAnnouncementPreferences({ hideDate: 123, dismissedVersion: -5 })).toEqual({
      hideDate: '',
      dismissedVersion: 0
    })
  })

  it('boots on authenticated pages and registration success only', () => {
    expect(announcementModule.isAnnouncementTrigger('home', '')).toBe(true)
    expect(announcementModule.isAnnouncementTrigger('settings', '')).toBe(true)
    expect(announcementModule.isAnnouncementTrigger('admin', '?tab=announcement')).toBe(true)
    expect(announcementModule.isAnnouncementTrigger('login', '?registered=1')).toBe(true)
    expect(announcementModule.isAnnouncementTrigger('login', '')).toBe(false)
    expect(announcementModule.isAnnouncementTrigger('register', '')).toBe(false)
    expect(announcementModule.isAnnouncementTrigger('setup', '')).toBe(false)
  })

  it('renders only server-sanitized rich announcement HTML with a plaintext fallback', async () => {
    const source = await readFile('public/static/announcement.js', 'utf8')

    expect(source).toContain("typeof announcement.contentHtml === 'string'")
    expect(source).toContain('content.innerHTML = announcement.contentHtml')
    expect(source).toContain("content.textContent = String(announcement.content || '')")
    expect(source).not.toContain('content.innerHTML = announcement.content;')
  })

  it('adds a dedicated announcement editor to the admin SPA', async () => {
    const source = await readFile('public/static/pages-admin.js', 'utf8')

    expect(source).toContain('data-tab-link="announcement"')
    expect(source).toContain('id="admin-announcement-form"')
    expect(source).toContain('name="announcement_title"')
    expect(source).toContain('name="announcement_content"')
    expect(source).toContain("apiPost('/api/admin/announcement'")
    expect(source).toContain('每次保存都会发布一个新版本')
    expect(source).toContain('支持 Markdown（标题、列表、链接、代码块等）和常用 HTML 标签')
  })
})
