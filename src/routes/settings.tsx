import type { Hono } from 'hono'
import { createAuth, getCurrentUser } from '../auth'
import { Layout } from '../views/Layout'
import { SettingsView } from '../views/SettingsView'
import { listPublicOAuthProviders } from '../services/oauth-providers'
import {
  countAuthFactors,
  listLinkedAccounts,
  type PasskeyRow
} from '../services/user-settings'
import { redirectFromOAuthResponse } from '../lib/http'
import type { Bindings } from '../services/cloudflare-dns'

function settingsPath(query: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v) params.set(k, v)
  }
  const qs = params.toString()
  return qs ? `/settings?${qs}` : '/settings'
}

async function listPasskeysForUser(auth: Awaited<ReturnType<typeof createAuth>>, headers: Headers): Promise<PasskeyRow[]> {
  try {
    const res = await (auth.api as any).listPasskeys({
      headers,
      asResponse: true
    })
    if (!res.ok) return []
    const data = await res.json().catch(() => [])
    return Array.isArray(data) ? (data as PasskeyRow[]) : []
  } catch {
    return []
  }
}

export function registerSettingsRoutes(app: Hono<{ Bindings: Bindings }>) {
  app.get('/settings', async (c) => {
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (!user) return c.redirect('/login?next=' + encodeURIComponent('/settings'))

    const auth = await createAuth(c.env)
    const [linkedAccounts, availableProviders, passkeys] = await Promise.all([
      listLinkedAccounts(c.env.DB, user.id),
      listPublicOAuthProviders(c.env.DB),
      listPasskeysForUser(auth, c.req.raw.headers)
    ])

    return c.html(
      <Layout title="个人设置">
        <SettingsView
          name={user.name}
          email={user.email}
          role={user.role ?? 'user'}
          linkedAccounts={linkedAccounts}
          availableProviders={availableProviders}
          passkeys={passkeys}
          profileError={c.req.query('profile_error') ?? undefined}
          profileInfo={c.req.query('profile_info') ?? undefined}
          oauthError={c.req.query('oauth_error') ?? undefined}
          oauthInfo={c.req.query('oauth_info') ?? undefined}
          passkeyError={c.req.query('passkey_error') ?? undefined}
          passkeyInfo={c.req.query('passkey_info') ?? undefined}
        />
      </Layout>
    )
  })

  app.post('/settings/profile', async (c) => {
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (!user) return c.redirect('/login?next=' + encodeURIComponent('/settings'))

    const form = await c.req.formData()
    const name = String(form.get('name') ?? '').trim()
    if (!name || name.length > 64) {
      return c.redirect(settingsPath({ profile_error: '用户名不能为空，且不超过 64 个字符' }))
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
        const msg = (data as { message?: string }).message || '更新用户名失败'
        return c.redirect(settingsPath({ profile_error: msg }), 302)
      }
      // ensure cookie headers from better-auth are preserved if present
      if (res.headers.get('set-cookie')) {
        const headers = new Headers(res.headers)
        headers.set('Location', settingsPath({ profile_info: '用户名已更新' }))
        return new Response(null, { status: 302, headers })
      }
      return c.redirect(settingsPath({ profile_info: '用户名已更新' }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : '更新用户名失败'
      return c.redirect(settingsPath({ profile_error: msg }))
    }
  })

  app.post('/settings/oauth/link', async (c) => {
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (!user) return c.redirect('/login?next=' + encodeURIComponent('/settings'))

    const form = await c.req.formData()
    const providerId = String(form.get('provider_id') ?? '').trim()
    if (!providerId) {
      return c.redirect(settingsPath({ oauth_error: '请选择要绑定的 OAuth 应用' }))
    }

    const providers = await listPublicOAuthProviders(c.env.DB)
    if (!providers.some((p) => p.provider_id === providerId)) {
      return c.redirect(settingsPath({ oauth_error: '该 OAuth 应用不可用或未启用' }))
    }

    const linked = await listLinkedAccounts(c.env.DB, user.id)
    if (linked.some((a) => a.providerId === providerId)) {
      return c.redirect(settingsPath({ oauth_info: '该社交账号已绑定' }))
    }

    const auth = await createAuth(c.env)
    try {
      const res = await (auth.api as any).oAuth2LinkAccount({
        body: {
          providerId,
          callbackURL: settingsPath({ oauth_info: '社交账号绑定成功' }),
          errorCallbackURL: settingsPath({ oauth_error: '社交账号绑定失败' })
        },
        headers: c.req.raw.headers,
        asResponse: true
      })
      return await redirectFromOAuthResponse(
        res,
        settingsPath({ oauth_error: '社交账号绑定失败' })
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : '社交账号绑定失败'
      return c.redirect(settingsPath({ oauth_error: msg }))
    }
  })

  app.post('/settings/oauth/unlink', async (c) => {
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (!user) return c.redirect('/login?next=' + encodeURIComponent('/settings'))

    const form = await c.req.formData()
    const providerId = String(form.get('provider_id') ?? '').trim()
    const accountId = String(form.get('account_id') ?? '').trim()
    if (!providerId) {
      return c.redirect(settingsPath({ oauth_error: '缺少 provider' }))
    }

    const factors = await countAuthFactors(c.env.DB, user.id)
    if (factors.total <= 1) {
      return c.redirect(settingsPath({ oauth_error: '至少保留一种登录方式，无法解绑最后一个凭证' }))
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
        const msg = (data as { message?: string }).message || '解绑失败'
        return c.redirect(settingsPath({ oauth_error: msg }))
      }
      return c.redirect(settingsPath({ oauth_info: '已解绑社交账号' }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : '解绑失败'
      return c.redirect(settingsPath({ oauth_error: msg }))
    }
  })

  app.post('/settings/passkey/delete', async (c) => {
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (!user) return c.redirect('/login?next=' + encodeURIComponent('/settings'))

    const form = await c.req.formData()
    const id = String(form.get('id') ?? '').trim()
    if (!id) {
      return c.redirect(settingsPath({ passkey_error: '缺少 Passkey ID' }))
    }

    const factors = await countAuthFactors(c.env.DB, user.id)
    // if this is the only auth factor, block deletion
    if (factors.total <= 1 && factors.passkeyCount === 1) {
      return c.redirect(settingsPath({ passkey_error: '至少保留一种登录方式，无法删除最后一个 Passkey' }))
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
        const msg = (data as { message?: string }).message || '删除 Passkey 失败'
        return c.redirect(settingsPath({ passkey_error: msg }))
      }
      return c.redirect(settingsPath({ passkey_info: 'Passkey 已删除' }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除 Passkey 失败'
      return c.redirect(settingsPath({ passkey_error: msg }))
    }
  })
}
