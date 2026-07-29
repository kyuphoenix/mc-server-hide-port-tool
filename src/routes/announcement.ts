import type { Hono } from 'hono'
import { apiOk } from '../lib/api'
import { renderAnnouncementHtml } from '../services/announcement-renderer'
import { getPublishedAnnouncement } from '../services/announcement'
import type { Bindings } from '../services/cloudflare-dns'

export function registerAnnouncementRoutes(app: Hono<{ Bindings: Bindings }>) {
  app.get('/api/announcement/current', async (c) => {
    const published = await getPublishedAnnouncement(c.env.DB)
    const announcement = published
      ? {
          ...published,
          contentHtml: renderAnnouncementHtml(published.content)
        }
      : null
    return apiOk(c, { announcement })
  })
}
