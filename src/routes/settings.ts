import type { Hono } from 'hono'
import { createAuth, getCurrentUser } from '../auth'
import { listPublicOAuthProviders } from '../services/oauth-providers'
import { countAuthFactors, listLinkedAccounts } from '../services/user-settings'
import {
  apiErr,
  apiOk,
  apiOkWithHeaders,
  extractOAuthRedirectUrl,
  readJsonBody,
  requireJsonMutation
} from '../lib/api'
import type { Bindings } from '../services/cloudflare-dns'

export function registerSettingsRoutes(app: Hono<{ Bindings: Bindings }>) {
  app.post('/api/settings/profile', async (c) => {
    const denied = await requireJsonMutation(c)
    if (denied) return denied
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (!user) return apiErr(c, "未登录", 401)

    const body = await readJsonBody(c)
    const name = String(body.name ?? '').trim()
    if (!name || name.length > 64) {
      return apiErr(c, "用户名不能为空，且不超过 64 个字符")
    }

    const auth = await createAuth(c.env)
    try {
      const res = await auth.api.updateUser({
        body: { name },
        headers: c.req.raw.headers,
        asResponse: true
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const msg = (data as { message?: string }).message || "更新用户名失败"
        return apiErr(c, msg, res.status)
      }
      return apiOkWithHeaders(undefined, res.headers, { message: "用户名已更新" })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "更新用户名失败"
      return apiErr(c, msg, 500)
    }
  })

  app.post('/api/settings/oauth/link', async (c) => {
    const denied = await requireJsonMutation(c)
    if (denied) return denied
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (!user) return apiErr(c, "未登录", 401)

    const body = await readJsonBody(c)
    const providerId = String(body.provider_id ?? '').trim()
    if (!providerId) return apiErr(c, "请选择要绑定的 OAuth 应用")

    const providers = await listPublicOAuthProviders(c.env.DB)
    if (!providers.some((p) => p.provider_id === providerId)) {
      return apiErr(c, "该 OAuth 应用不可用或未启用")
    }

    const linked = await listLinkedAccounts(c.env.DB, user.id)
    if (linked.some((a) => a.providerId === providerId)) {
      return apiOk(c, undefined, { message: "该社交账号已绑定" })
    }

    const auth = await createAuth(c.env)
    try {
      const res = await (auth.api as any).oAuth2LinkAccount({
        body: {
          providerId,
          callbackURL: '/settings?oauth_info=' + encodeURIComponent("社交账号绑定成功"),
          errorCallbackURL: '/settings?oauth_error=' + encodeURIComponent("社交账号绑定失败")
        },
        headers: c.req.raw.headers,
        asResponse: true
      })
      const extracted = await extractOAuthRedirectUrl(res)
      if (extracted.url) {
        return apiOkWithHeaders(undefined, extracted.headers, { redirect: extracted.url })
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const msg = (data as { message?: string }).message || "社交账号绑定失败"
        return apiErr(c, msg, res.status)
      }
      return apiErr(c, "社交账号绑定失败")
    } catch (err) {
      const msg = err instanceof Error ? err.message : "社交账号绑定失败"
      return apiErr(c, msg, 500)
    }
  })

  app.post('/api/settings/oauth/unlink', async (c) => {
    const denied = await requireJsonMutation(c)
    if (denied) return denied
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (!user) return apiErr(c, "未登录", 401)

    const body = await readJsonBody(c)
    const providerId = String(body.provider_id ?? '').trim()
    const accountId = String(body.account_id ?? '').trim()
    if (!providerId) return apiErr(c, "缺少 provider")

    const factors = await countAuthFactors(c.env.DB, user.id)
    if (factors.total <= 1) {
      return apiErr(c, "至少保留一种登录方式，无法解绑最后一个凭证")
    }

    const auth = await createAuth(c.env)
    try {
      const res = await auth.api.unlinkAccount({
        body: {
          providerId,
          ...(accountId ? { accountId } : {})
        },
        headers: c.req.raw.headers,
        asResponse: true
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const msg = (data as { message?: string }).message || "解绑失败"
        return apiErr(c, msg, res.status)
      }
      return apiOkWithHeaders(undefined, res.headers, { message: "已解绑社交账号" })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "解绑失败"
      return apiErr(c, msg, 500)
    }
  })

  app.post('/api/settings/passkey/delete', async (c) => {
    const denied = await requireJsonMutation(c)
    if (denied) return denied
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (!user) return apiErr(c, "未登录", 401)

    const body = await readJsonBody(c)
    const id = String(body.id ?? '').trim()
    if (!id) return apiErr(c, "缺少 Passkey ID")

    const factors = await countAuthFactors(c.env.DB, user.id)
    if (factors.total <= 1 && factors.passkeyCount === 1) {
      return apiErr(c, "至少保留一种登录方式，无法删除最后一个 Passkey")
    }

    const auth = await createAuth(c.env)
    try {
      const res = await (auth.api as any).deletePasskey({
        body: { id },
        headers: c.req.raw.headers,
        asResponse: true
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const msg = (data as { message?: string }).message || "删除 Passkey 失败"
        return apiErr(c, msg, res.status)
      }
      return apiOkWithHeaders(undefined, res.headers, { message: "Passkey 已删除" })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "删除 Passkey 失败"
      return apiErr(c, msg, 500)
    }
  })
}
