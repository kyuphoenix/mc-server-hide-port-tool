import type { Hono } from 'hono'
import { createAuth, isSuperAdminUser, requireAdmin } from '../auth'
import { Layout } from '../views/Layout'
import { AdminView } from '../views/AdminView'
import { getSettings, updateSettings, type Settings } from '../services/settings'
import {
  deleteUserCascade,
  findRecordById,
  findUserById,
  hasUnlimitedDnsLimits,
  isSuperAdmin,
  listAllRecords,
  listAllUsers,
  listRecordsByUser,
  setSuperAdmin,
  setUserRecordLimit,
  setUserRole
} from '../services/dns-records'
import {
  createInviteCode,
  listInviteCodes,
  revokeInviteCode
} from '../services/invite-codes'
import {
  createOAuthProvider,
  deleteOAuthProvider,
  listOAuthProviders,
  OAUTH_TEMPLATES,
  setOAuthProviderEnabled,
  updateOAuthProvider
} from '../services/oauth-providers'
import { deleteRecordAndCloudflare, type Bindings } from '../services/cloudflare-dns'
import { splitCsv } from '../lib/http'

type AdminTab = 'settings' | 'oauth' | 'invites' | 'users' | 'dns'

function parseAdminTab(raw: string | undefined | null): AdminTab {
  const v = String(raw ?? '').trim().toLowerCase()
  if (v === 'oauth' || v === 'invites' || v === 'users' || v === 'dns' || v === 'settings') return v
  return 'settings'
}

function adminPath(tab: AdminTab = 'settings', query: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams()
  if (tab && tab !== 'settings') params.set('tab', tab)
  for (const [k, v] of Object.entries(query)) {
    if (v) params.set(k, v)
  }
  const qs = params.toString()
  return qs ? `/admin?${qs}` : '/admin'
}

export function registerAdminRoutes(app: Hono<{ Bindings: Bindings }>) {
  app.get('/admin', async (c) => {
    const user = await requireAdmin(c.env, c.req.raw.headers)
    if (!user) return c.redirect('/')
    // 若未显式指定 tab，则按反馈参数落到对应页签
    const tabFromQuery = c.req.query('tab')
    const inferredTab =
      tabFromQuery
        ? parseAdminTab(tabFromQuery)
        : c.req.query('create_error')
          ? 'users'
          : c.req.query('invite_error') || c.req.query('invite_info')
            ? 'invites'
            : c.req.query('oauth_error') || c.req.query('oauth_info')
              ? 'oauth'
              : 'settings'
    const activeTab = inferredTab
    const [users, records, settings, inviteCodes, oauthProviders] = await Promise.all([
      listAllUsers(c.env.DB),
      listAllRecords(c.env.DB),
      getSettings(c.env.DB),
      listInviteCodes(c.env.DB),
      listOAuthProviders(c.env.DB)
    ])
    return c.html(
      <Layout title="管理后台">
        <AdminView
          users={users}
          records={records}
          settings={settings}
          inviteCodes={inviteCodes}
          oauthProviders={oauthProviders}
          oauthTemplates={OAUTH_TEMPLATES}
          currentUserId={user.id}
          currentUserSuperAdmin={isSuperAdminUser(user)}
          activeTab={activeTab}
          createError={c.req.query('create_error') ?? undefined}
          inviteError={c.req.query('invite_error') ?? undefined}
          inviteInfo={c.req.query('invite_info') ?? undefined}
          oauthError={c.req.query('oauth_error') ?? undefined}
          oauthInfo={c.req.query('oauth_info') ?? undefined}
        />
      </Layout>
    )
  })

  app.post('/admin/settings', async (c) => {
    const admin = await requireAdmin(c.env, c.req.raw.headers)
    if (!admin) return c.redirect('/')
    const form = await c.req.formData()
    const current = await getSettings(c.env.DB)

    const mode = String(form.get('registration_mode') ?? 'email')
    const modeNorm: 'email' | 'oauth' | 'both' =
      mode === 'oauth' ? 'oauth' : mode === 'both' ? 'both' : 'email'

    const whitelistSuffixesRaw = String(form.get('email_whitelist_suffixes') ?? '').trim()
    const blacklistSuffixesRaw = String(form.get('email_blacklist_suffixes') ?? '').trim()

    const resendApiKeyFromForm = String(form.get('resend_api_key') ?? '').trim()
    const patch: Partial<Settings> = {
      registration_enabled: form.get('registration_enabled') === 'on',
      registration_mode: modeNorm,
      invite_required: form.get('invite_required') === 'on',
      email_whitelist_enabled: form.get('email_whitelist_enabled') === 'on',
      email_whitelist_suffixes: splitCsv(whitelistSuffixesRaw),
      email_blacklist_enabled: form.get('email_blacklist_enabled') === 'on',
      email_blacklist_suffixes: splitCsv(blacklistSuffixesRaw),
      github_min_account_age_days: Math.max(0, Number(form.get('github_min_account_age_days') ?? 0) || 0),
      resend_enabled: form.get('resend_enabled') === 'on',
      resend_from: String(form.get('resend_from') ?? '').trim() || null,
      max_records_per_user: Math.max(0, Number(form.get('max_records_per_user') ?? 0) || 0),
      min_subdomain_length: Math.max(0, Number(form.get('min_subdomain_length') ?? 0) || 0)
    }
    // API Key 留空则保留既有
    if (resendApiKeyFromForm) {
      patch.resend_api_key = resendApiKeyFromForm
    } else if (!current.resend_api_key) {
      patch.resend_api_key = null
    }

    await updateSettings(c.env.DB, patch)
    return c.redirect(adminPath('settings'))
  })

  app.post('/admin/users/:id/role', async (c) => {
    const admin = await requireAdmin(c.env, c.req.raw.headers)
    if (!admin) return c.redirect('/')
    if (!isSuperAdminUser(admin)) return c.redirect(adminPath('users'))
    const id = c.req.param('id')
    if (id === admin.id) return c.redirect(adminPath('users'))
    // 超级管理员不能被其他管理员降级
    const targetSuper = await isSuperAdmin(c.env.DB, id)
    if (targetSuper) return c.redirect(adminPath('users'))
    const form = await c.req.formData()
    const roleFromForm = String(form.get('role') ?? '')
    if (roleFromForm === 'admin' || roleFromForm === 'user') {
      await setUserRole(c.env.DB, id, roleFromForm)
    }
    return c.redirect(adminPath('users'))
  })

  app.post('/admin/users/:id/delete', async (c) => {
    const admin = await requireAdmin(c.env, c.req.raw.headers)
    if (!admin) return c.redirect('/')
    const id = c.req.param('id')
    if (id === admin.id) return c.redirect(adminPath('users'))
    const target = await findUserById(c.env.DB, id)
    if (!target) return c.redirect(adminPath('users'))
    if (target.role === 'admin' && !isSuperAdminUser(admin)) return c.redirect(adminPath('users'))
    // 禁止删除超级管理员
    const targetSuper = await isSuperAdmin(c.env.DB, id)
    if (targetSuper) return c.redirect(adminPath('users'))
    // 同时级联删除其 DNS 记录 + Cloudflare 中对应记录
    const records = await listRecordsByUser(c.env.DB, id)
    for (const r of records) {
      await deleteRecordAndCloudflare(c.env, r)
    }
    await deleteUserCascade(c.env.DB, id)
    return c.redirect(adminPath('users'))
  })

  app.post('/admin/users/:id/limit', async (c) => {
    const admin = await requireAdmin(c.env, c.req.raw.headers)
    if (!admin) return c.redirect('/')
    const id = c.req.param('id')
    const target = await findUserById(c.env.DB, id)
    if (!target || hasUnlimitedDnsLimits(target)) return c.redirect(adminPath('users'))
    const form = await c.req.formData()
    const raw = String(form.get('record_limit') ?? '').trim()
    let limit: number | null = null
    if (raw !== '') {
      const n = Number(raw)
      if (Number.isFinite(n) && n >= 0) {
        limit = Math.floor(n)
      } else {
        return c.redirect(adminPath('users'))
      }
    }
    await setUserRecordLimit(c.env.DB, id, limit)
    return c.redirect(adminPath('users'))
  })

  // 管理员手动创建用户（无需走注册流程）
  app.post('/admin/users/create', async (c) => {
    const admin = await requireAdmin(c.env, c.req.raw.headers)
    if (!admin) return c.redirect('/')
    const form = await c.req.formData()
    const name = String(form.get('name') ?? '').trim()
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')
    const role = isSuperAdminUser(admin) && String(form.get('role') ?? 'user') === 'admin' ? 'admin' : 'user'

    if (!name || !email || password.length < 8) {
      return c.redirect(adminPath('users', { create_error: '参数不完整或密码少于8位' }))
    }

    const auth = await createAuth(c.env)
    try {
      const signUpRes = await auth.api.signUpEmail({
        body: { name, email, password },
        headers: c.req.raw.headers,
        asResponse: true
      })
      if (!signUpRes.ok) {
        const data = await signUpRes.json().catch(() => ({}))
        const msg = (data as { message?: string }).message || '创建用户失败'
        return c.redirect(adminPath('users', { create_error: msg }))
      }
      const listRes = await listAllUsers(c.env.DB)
      const newUser = listRes.find((u) => u.email === email)
      if (newUser && role === 'admin') {
        await setUserRole(c.env.DB, newUser.id, 'admin')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '创建用户失败'
      return c.redirect(adminPath('users', { create_error: msg }))
    }
    return c.redirect(adminPath('users'))
  })

  app.post('/admin/dns/:id/delete', async (c) => {
    const admin = await requireAdmin(c.env, c.req.raw.headers)
    if (!admin) return c.redirect('/')
    const id = c.req.param('id')
    const record = await findRecordById(c.env.DB, id)
    if (record) {
      await deleteRecordAndCloudflare(c.env, record)
    }
    return c.redirect(adminPath('dns'))
  })


  app.post('/admin/invites/create', async (c) => {
    const admin = await requireAdmin(c.env, c.req.raw.headers)
    if (!admin) return c.redirect('/')
  // 仅管理员/超级管理员可生成(requireAdmin 已校验 role=admin)
    const settings = await getSettings(c.env.DB)
    if (!settings.invite_required) {
      return c.redirect(adminPath('invites', { invite_error: '请先开启邀请码注册' }))
    }
    try {
      const created = await createInviteCode(c.env.DB, admin.id)
      return c.redirect(adminPath('invites', { invite_info: `已生成邀请码 ${created.code}` }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成邀请码失败'
      return c.redirect(adminPath('invites', { invite_error: msg }))
    }
  })

  app.post('/admin/invites/:id/revoke', async (c) => {
    const admin = await requireAdmin(c.env, c.req.raw.headers)
    if (!admin) return c.redirect('/')
    const id = c.req.param('id')
    const result = await revokeInviteCode(c.env.DB, id)
    if (!result.ok) {
      return c.redirect(adminPath('invites', { invite_error: result.message }))
    }
    return c.redirect(adminPath('invites', { invite_info: '邀请码已作废' }))
  })


  app.post('/admin/oauth/create', async (c) => {
    const admin = await requireAdmin(c.env, c.req.raw.headers)
    if (!admin) return c.redirect('/')
    const form = await c.req.formData()
    const result = await createOAuthProvider(c.env.DB, {
      provider_id: String(form.get('provider_id') ?? ''),
      name: String(form.get('name') ?? ''),
      client_id: String(form.get('client_id') ?? ''),
      client_secret: String(form.get('client_secret') ?? ''),
      discovery_url: String(form.get('discovery_url') ?? ''),
      authorization_url: String(form.get('authorization_url') ?? ''),
      token_url: String(form.get('token_url') ?? ''),
      user_info_url: String(form.get('user_info_url') ?? ''),
      scopes: String(form.get('scopes') ?? 'openid,profile,email'),
      pkce: form.get('pkce') === 'on',
      enabled: form.get('enabled') === 'on',
      sort_order: Number(form.get('sort_order') ?? 0),
      icon_url: String(form.get('icon_url') ?? '')
    })
    if (!result.ok) {
      return c.redirect(adminPath('oauth', { oauth_error: result.message }))
    }
    return c.redirect(adminPath('oauth', { oauth_info: `已添加 OAuth 应用 ${result.provider.name}` }))
  })

  app.post('/admin/oauth/:id/update', async (c) => {
    const admin = await requireAdmin(c.env, c.req.raw.headers)
    if (!admin) return c.redirect('/')
    const id = c.req.param('id')
    const form = await c.req.formData()
    const result = await updateOAuthProvider(c.env.DB, id, {
      provider_id: String(form.get('provider_id') ?? ''),
      name: String(form.get('name') ?? ''),
      client_id: String(form.get('client_id') ?? ''),
      client_secret: String(form.get('client_secret') ?? ''),
      discovery_url: String(form.get('discovery_url') ?? ''),
      authorization_url: String(form.get('authorization_url') ?? ''),
      token_url: String(form.get('token_url') ?? ''),
      user_info_url: String(form.get('user_info_url') ?? ''),
      scopes: String(form.get('scopes') ?? 'openid,profile,email'),
      pkce: form.get('pkce') === 'on',
      enabled: form.get('enabled') === 'on',
      sort_order: Number(form.get('sort_order') ?? 0),
      icon_url: String(form.get('icon_url') ?? '')
    })
    if (!result.ok) {
      return c.redirect(adminPath('oauth', { oauth_error: result.message }))
    }
    return c.redirect(adminPath('oauth', { oauth_info: 'OAuth 应用已更新' }))
  })

  app.post('/admin/oauth/:id/toggle', async (c) => {
    const admin = await requireAdmin(c.env, c.req.raw.headers)
    if (!admin) return c.redirect('/')
    const id = c.req.param('id')
    const form = await c.req.formData()
    const enabled = form.get('enabled') === '1'
    await setOAuthProviderEnabled(c.env.DB, id, enabled)
    return c.redirect(adminPath('oauth', { oauth_info: enabled ? '已启用' : '已禁用' }))
  })

  app.post('/admin/oauth/:id/delete', async (c) => {
    const admin = await requireAdmin(c.env, c.req.raw.headers)
    if (!admin) return c.redirect('/')
    const id = c.req.param('id')
    await deleteOAuthProvider(c.env.DB, id)
    return c.redirect(adminPath('oauth', { oauth_info: 'OAuth 应用已删除' }))
  })
}
