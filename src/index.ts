import { Hono } from 'hono'
import type { Bindings } from './services/cloudflare-dns'
import { registerAuthRoutes } from './routes/auth'
import { registerDnsRoutes } from './routes/dns'
import { registerAdminRoutes } from './routes/admin'
import { registerSettingsRoutes } from './routes/settings'
import { registerPageRoutes } from './routes/pages'

const app = new Hono<{ Bindings: Bindings }>()

// App-owned APIs and page shells first; better-auth catch-all is inside auth routes.
registerAuthRoutes(app)
registerSettingsRoutes(app)
registerAdminRoutes(app)
registerDnsRoutes(app)
registerPageRoutes(app)

export default app
