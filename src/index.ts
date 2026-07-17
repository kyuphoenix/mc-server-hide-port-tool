import { Hono } from 'hono'
import type { Bindings } from './services/cloudflare-dns'
import { registerAuthRoutes } from './routes/auth'
import { registerDnsRoutes } from './routes/dns'
import { registerAdminRoutes } from './routes/admin'
import { registerSettingsRoutes } from './routes/settings'
import { registerPageRoutes } from './routes/pages'
import { requestIsHttps } from './lib/security'
import { mutationBodyLimit } from './lib/api'

const app = new Hono<{ Bindings: Bindings }>()

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self' data:",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'"
].join('; ')

app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'no-referrer')
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
  c.header('Content-Security-Policy', CONTENT_SECURITY_POLICY)
  if (requestIsHttps(c.req.raw)) {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  if (c.req.path.startsWith('/api/')) {
    c.header('Cache-Control', 'no-store')
    c.header('Pragma', 'no-cache')
  }
})

app.use('*', mutationBodyLimit)

// App-owned APIs and page shells first; better-auth catch-all is inside auth routes.
registerAuthRoutes(app)
registerSettingsRoutes(app)
registerAdminRoutes(app)
registerDnsRoutes(app)
registerPageRoutes(app)

export default app
