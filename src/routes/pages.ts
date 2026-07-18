import type { Hono } from 'hono'
import { getCurrentUser, isSuperAdminUser, requireAdmin } from '../auth'
import { pageShellResponse } from '../lib/page-shell'
import { apiErr, apiOk, maskSettingsForAdmin, publicSettings } from '../lib/api'
import { safeInternalPath } from '../lib/security'
import { listAllRecordsPage, listRecentRecordsByUser, searchUsersPage, type UserSearchRole } from '../services/dns-records'
import { maskUsersForAdmin } from '../lib/privacy'
import { listInviteCodes } from '../services/invite-codes'
import { listOAuthProvidersForAdmin, listPublicOAuthProviders, OAUTH_TEMPLATES } from '../services/oauth-providers'
import { getSettings } from '../services/settings'
import { reconcileFirstSetup } from '../services/first-setup'
import { listLinkedAccounts, type PasskeyRow } from '../services/user-settings'
import { createAuth } from '../auth'
import type { Bindings } from '../services/cloudflare-dns'
import { sensitiveDataKeysFromEnv } from '../services/sensitive-data'

type AdminTab = 'settings' | 'oauth' | 'invites' | 'users' | 'dns'

async function firstSetupIsCompleted(db: D1Database): Promise<boolean> {
  return (await reconcileFirstSetup(db)).status === 'completed'
}

function parseAdminTab(raw: string | undefined | null): AdminTab {
  const v = String(raw ?? '').trim().toLowerCase()
  if (v === 'oauth' || v === 'invites' || v === 'users' || v === 'dns' || v === 'settings') return v
  return 'settings'
}

function parsePositivePage(raw: string | undefined | null): number {
  return Math.max(1, Math.floor(Number(raw)) || 1)
}

async function listPasskeysForUser(
  auth: Awaited<ReturnType<typeof createAuth>>,
  headers: Headers
): Promise<PasskeyRow[]> {
  try {
    const res = await (auth.api as any).listPasskeys({ headers, asResponse: true })
    if (!res.ok) return []
    const data = await res.json().catch(() => [])
    return Array.isArray(data) ? (data as PasskeyRow[]) : []
  } catch {
    return []
  }
}

function serializeUser(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  if (!user) return null
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role ?? 'user',
    super_admin: Number(user.super_admin ?? 0) > 0,
    record_limit: user.record_limit ?? null,
    createdAt: user.createdAt
  }
}

export function registerPageRoutes(app: Hono<{ Bindings: Bindings }>) {
  app.get('/', async (c) => {
    if (!(await firstSetupIsCompleted(c.env.DB))) return c.redirect('/setup')
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (!user) return c.redirect('/login')
    return pageShellResponse(c, {
      title: 'Minecraft 端口隐藏工具',
      page: 'home',
      scripts: ['/static/pages-home.js', '/static/main.js']
    })
  })

  app.get('/login', async (c) => {
    if (!(await firstSetupIsCompleted(c.env.DB))) return c.redirect('/setup')
    const next = safeInternalPath(c.req.query('next'), '/')
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (user) return c.redirect(next)
    return pageShellResponse(c, {
      title: '登录',
      page: 'login',
      scripts: ['/static/pages-auth.js']
    })
  })

  app.get('/register', async (c) => {
    if (!(await firstSetupIsCompleted(c.env.DB))) return c.redirect('/setup')
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (user) return c.redirect('/')
    return pageShellResponse(c, {
      title: '注册',
      page: 'register',
      scripts: ['/static/pages-auth.js']
    })
  })

  app.get('/verify-email', async (c) => {
    if (!(await firstSetupIsCompleted(c.env.DB))) return c.redirect('/setup')
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (user) return c.redirect('/')
    return pageShellResponse(c, {
      title: '邮箱验证',
      page: 'verify-email',
      scripts: ['/static/pages-auth.js']
    })
  })

  app.get('/setup', async (c) => {
    if (await firstSetupIsCompleted(c.env.DB)) return c.redirect('/')
    return pageShellResponse(c, {
      title: '初始化管理员',
      page: 'setup',
      scripts: ['/static/pages-auth.js']
    })
  })

  app.get('/register/github-age-rejected', async (c) => {
    return pageShellResponse(c, {
      title: 'GitHub 账号天数未达标',
      page: 'github-age-rejected',
      scripts: ['/static/pages-auth.js']
    })
  })

  app.get('/settings', async (c) => {
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (!user) return c.redirect('/login?next=' + encodeURIComponent('/settings'))
    return pageShellResponse(c, {
      title: '个人设置',
      page: 'settings',
      scripts: ['/static/pages-settings.js']
    })
  })

  app.get('/admin', async (c) => {
    const user = await requireAdmin(c.env, c.req.raw.headers)
    if (!user) return c.redirect('/')
    return pageShellResponse(c, {
      title: '管理后台',
      page: 'admin',
      scripts: ['/static/pages-admin.js', '/static/admin-mail.js']
    })
  })

  app.get('/api/pages/home', async (c) => {
    if (!(await firstSetupIsCompleted(c.env.DB))) {
      return apiOk(c, null, { redirect: '/setup' })
    }
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (!user) return apiErr(c, '未登录', 401, { redirect: '/login' })
    const records = await listRecentRecordsByUser(c.env.DB, user.id)
    return apiOk(c, { user: serializeUser(user), records })
  })

  app.get('/api/pages/login', async (c) => {
    if (!(await firstSetupIsCompleted(c.env.DB))) {
      return apiOk(c, null, { redirect: '/setup' })
    }
    const next = safeInternalPath(c.req.query('next'), '/')
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (user) return apiOk(c, null, { redirect: next })
    const oauthProviders = await listPublicOAuthProviders(
      c.env.DB,
      sensitiveDataKeysFromEnv(c.env),
      c.env.OAUTH_ALLOWED_HOSTS
    )
    return apiOk(c, {
      next,
      oauthProviders,
      error: c.req.query('error') || undefined,
      info: c.req.query('registered') ? '注册成功，请登录' : undefined
    })
  })

  app.get('/api/pages/register', async (c) => {
    if (!(await firstSetupIsCompleted(c.env.DB))) {
      return apiOk(c, null, { redirect: '/setup' })
    }
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (user) return apiOk(c, null, { redirect: '/' })
    const settings = await getSettings(c.env.DB, sensitiveDataKeysFromEnv(c.env))
    const oauthProviders = await listPublicOAuthProviders(
      c.env.DB,
      sensitiveDataKeysFromEnv(c.env),
      c.env.OAUTH_ALLOWED_HOSTS
    )
    return apiOk(c, {
      settings: publicSettings(settings),
      oauthProviders,
      error: c.req.query('error') || undefined
    })
  })

  app.get('/api/pages/setup', async (c) => {
    if (await firstSetupIsCompleted(c.env.DB)) {
      return apiOk(c, null, { redirect: '/' })
    }
    return apiOk(c, {})
  })

  app.get('/api/pages/github-age-rejected', async (c) => {
    const settings = await getSettings(c.env.DB, sensitiveDataKeysFromEnv(c.env))
    const minDays = Math.max(0, Number(c.req.query('min_days') ?? settings.github_min_account_age_days) || 0)
    const actualDaysRaw = c.req.query('actual_days')
    const actualDays = actualDaysRaw == null || actualDaysRaw === '' ? null : Math.max(0, Number(actualDaysRaw) || 0)
    return apiOk(c, { minDays, actualDays })
  })

  app.get('/api/pages/settings', async (c) => {
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (!user) return apiErr(c, '未登录', 401, { redirect: '/login?next=' + encodeURIComponent('/settings') })
    const auth = await createAuth(c.env)
    const [linkedAccounts, availableProviders, passkeys] = await Promise.all([
      listLinkedAccounts(c.env.DB, user.id),
      listPublicOAuthProviders(
        c.env.DB,
        sensitiveDataKeysFromEnv(c.env),
        c.env.OAUTH_ALLOWED_HOSTS
      ),
      listPasskeysForUser(auth, c.req.raw.headers)
    ])
    return apiOk(c, {
      user: serializeUser(user),
      linkedAccounts,
      availableProviders,
      passkeys
    })
  })

  app.get('/api/pages/admin', async (c) => {
    const user = await requireAdmin(c.env, c.req.raw.headers)
    if (!user) return apiErr(c, '无权限', 403, { redirect: '/' })
    const activeTab = parseAdminTab(c.req.query('tab'))
    const q = String(c.req.query('q') ?? '').trim()
    const roleRaw = String(c.req.query('role') ?? 'all').trim().toLowerCase()
    const role: UserSearchRole =
      roleRaw === 'user' || roleRaw === 'admin' || roleRaw === 'super' ? roleRaw : 'all'

    const userPage = parsePositivePage(c.req.query('user_page'))
    const dnsPage = parsePositivePage(c.req.query('dns_page'))
    const [usersResult, recordsResult, settings, inviteCodes, oauthProviders] = await Promise.all([
      searchUsersPage(c.env.DB, { q, role, page: userPage, pageSize: 50 }),
      listAllRecordsPage(c.env.DB, { page: dnsPage, pageSize: 50 }),
      getSettings(c.env.DB, sensitiveDataKeysFromEnv(c.env)),
      listInviteCodes(c.env.DB),
      listOAuthProvidersForAdmin(c.env.DB)
    ])
    return apiOk(c, {
      activeTab,
      users: maskUsersForAdmin(usersResult.items),
      usersQuery: { q, role },
      userPagination: {
        total: usersResult.total,
        page: usersResult.page,
        pageSize: usersResult.pageSize,
        totalPages: usersResult.totalPages
      },
      records: recordsResult.items,
      dnsPagination: {
        total: recordsResult.total,
        page: recordsResult.page,
        pageSize: recordsResult.pageSize,
        totalPages: recordsResult.totalPages
      },
      settings: maskSettingsForAdmin(settings),
      inviteCodes,
      oauthProviders,
      oauthTemplates: OAUTH_TEMPLATES,
      currentUserId: user.id,
      currentUserSuperAdmin: isSuperAdminUser(user)
    })
  })
}
