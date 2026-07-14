import type { Hono } from 'hono'
import { hashPassword } from 'better-auth/crypto'
import {
  createAuth,
  getCurrentUser
} from '../auth'
import { getSettings, isEmailAllowed } from '../services/settings'
import {
  countUsers,
  deleteUserCascade,
  listAllUsers,
  setSuperAdmin,
  setUserRole
} from '../services/dns-records'
import {
  clearVerificationFailures,
  deleteEmailVerificationsByEmail,
  findLatestEmailVerification,
  isVerificationRateLimited,
  openPendingPassword,
  purgeExpiredEmailVerifications,
  purgeExpiredRateLimitBuckets,
  recordVerificationFailure,
  sealPendingPassword,
  upsertEmailVerification,
  verifyVerificationCode
} from '../services/email-verification'
import { sendVerificationCode } from '../services/mailer'
import {
  extractGitHubAgeRejectedDetails,
  getGitHubUser,
  githubAgeRejectedPath,
  isGitHubAgeRejectedError,
  meetsAgeRequirement
} from '../services/github'
import { type Bindings } from '../services/cloudflare-dns'
import {
  parseCookie,
  redirectWithHeaders
} from '../lib/http'
import { finalizeInviteUsage, findUserIdByEmail, requireInviteCodeIfNeeded } from '../lib/invite'
import { requestIsHttps, safeInternalPath } from '../lib/security'
import { requireMutationCsrf } from '../lib/csrf'
import {
  apiErr,
  apiOk,
  apiOkWithHeaders,
  extractOAuthRedirectUrl,
  readJsonBody,
  requireJsonMutation
} from '../lib/api'

function inviteCookie(code: string | null, secure: boolean, maxAge: number): string {
  if (!code) {
    return `pending_invite_code=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
  }
  return `pending_invite_code=${encodeURIComponent(code)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

export function registerAuthRoutes(app: Hono<{ Bindings: Bindings }>) {

  app.post('/api/session/logout', async (c) => {
    const denied = await requireJsonMutation(c)
    if (denied) return denied
    const auth = await createAuth(c.env)
    try {
      const res = await auth.api.signOut({ headers: c.req.raw.headers, asResponse: true })
      return apiOkWithHeaders(undefined, res.headers, { redirect: '/login', message: "已退出登录" })
    } catch {
      return apiOk(c, undefined, { redirect: '/login' })
    }
  })

  app.post('/logout', async (c) => {
    const form = await c.req.formData().catch(() => null)
    const csrfDenied = await requireMutationCsrf(c, form)
    if (csrfDenied) return csrfDenied
    const auth = await createAuth(c.env)
    try {
      const res = await auth.api.signOut({ headers: c.req.raw.headers, asResponse: true })
      return redirectWithHeaders('/login', 302, res.headers)
    } catch {
      return c.redirect('/login')
    }
  })

  app.post('/api/auth/setup', async (c) => {
    const denied = await requireJsonMutation(c)
    if (denied) return denied
    const userCount = await countUsers(c.env.DB)
    if (userCount > 0) return apiErr(c, "已完成初始化", 400, { code: 'SETUP_DONE' })

    const body = await readJsonBody(c)
    const name = String(body.name ?? '').trim()
    const email = String(body.email ?? '').trim()
    const password = String(body.password ?? '')
    const confirm = String(body.confirm ?? '')

    if (!name || !email || !password) return apiErr(c, "请填写完整")
    if (password !== confirm) return apiErr(c, "两次密码不一致")
    if (password.length < 8) return apiErr(c, "密码至少 8 位")

    const auth = await createAuth(c.env)
    try {
      const signUpRes = await auth.api.signUpEmail({
        body: { name, email, password },
        headers: c.req.raw.headers,
        asResponse: true
      })
      if (!signUpRes.ok) {
        const data = await signUpRes.json().catch(() => ({}))
        const msg = (data as { message?: string }).message || "创建管理员失败"
        return apiErr(c, msg, signUpRes.status)
      }

      const listRes = await listAllUsers(c.env.DB)
      const newUser = listRes.find((u) => u.email === email)
      const firstUser = listRes[0]
      if (newUser && firstUser && newUser.id === firstUser.id) {
        await setUserRole(c.env.DB, newUser.id, 'admin')
        await setSuperAdmin(c.env.DB, newUser.id, true)
      } else if (newUser) {
        await setUserRole(c.env.DB, newUser.id, 'user')
        await setSuperAdmin(c.env.DB, newUser.id, false)
      }

      const signInRes = await auth.api.signInEmail({
        body: { email, password },
        headers: c.req.raw.headers,
        asResponse: true
      })
      if (signInRes.ok) {
        return apiOkWithHeaders(undefined, signInRes.headers, { redirect: '/', message: "初始化成功" })
      }
      return apiOk(c, undefined, { redirect: '/login', message: "管理员已创建，请登录" })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "创建管理员失败"
      return apiErr(c, msg, 500)
    }
  })

  app.post('/api/auth/login', async (c) => {
    const denied = await requireJsonMutation(c)
    if (denied) return denied
    const next = safeInternalPath(c.req.query('next'), '/')
    const body = await readJsonBody(c)
    const email = String(body.email ?? '').trim()
    const password = String(body.password ?? '')
    if (!email || !password) return apiErr(c, "请填写邮箱和密码")

    const auth = await createAuth(c.env)
    try {
      const res = await auth.api.signInEmail({
        body: { email, password },
        headers: c.req.raw.headers,
        asResponse: true
      })
      if (res.ok) {
        return apiOkWithHeaders(undefined, res.headers, { redirect: next, message: "登录成功" })
      }
      const data = await res.json().catch(() => ({}))
      const message =
        (data as { message?: string }).message ||
        (res.status === 401 ? "邮箱或密码错误" : "登录失败")
      return apiErr(c, message, res.status)
    } catch (err) {
      const message = err instanceof Error ? err.message : "登录失败"
      return apiErr(c, message, 500)
    }
  })

  app.post('/api/auth/register', async (c) => {
    const denied = await requireJsonMutation(c)
    if (denied) return denied
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (user) return apiOk(c, undefined, { redirect: '/' })

    const settings = await getSettings(c.env.DB)
    if (!settings.registration_enabled) return apiErr(c, "当前已关闭注册", 403)
    if (settings.registration_mode === 'oauth') return apiErr(c, "当前仅支持 OAuth 注册", 403)

    const body = await readJsonBody(c)
    const name = String(body.name ?? '').trim()
    const email = String(body.email ?? '').trim()
    const password = String(body.password ?? '')
    const inviteCode = String(body.invite_code ?? '').trim()

    if (!name || !email || !password) return apiErr(c, "请填写完整信息")
    if (password.length < 8) return apiErr(c, "密码至少 8 位")

    const emailCheck = isEmailAllowed(email, settings)
    if (!emailCheck.ok) return apiErr(c, emailCheck.reason || "邮箱不被允许")

    const inviteCheck = await requireInviteCodeIfNeeded(c.env.DB, settings, inviteCode)
    if (!inviteCheck.ok) return apiErr(c, inviteCheck.message)

    if (settings.resend_enabled && settings.resend_accounts.length > 0) {
      const code = String(Math.floor(100000 + Math.random() * 900000))
      const codeHash = await hashPassword(code)
      const expires_at = Date.now() + 10 * 60 * 1000
      const passwordSealed = await sealPendingPassword(c.env.BETTER_AUTH_SECRET, password)
      await purgeExpiredEmailVerifications(c.env.DB)
      await upsertEmailVerification(c.env.DB, {
        email,
        name,
        passwordSealed,
        codeHash,
        expiresAt: expires_at,
        inviteCode: inviteCheck.code
      })
      const result = await sendVerificationCode(c.env, email, code)
      if (!result.ok) return apiErr(c, result.message || "验证码发送失败", 500)
      return apiOk(c, { need_verification: true, email }, { message: "验证码已发送" })
    }

    const auth = await createAuth(c.env)
    try {
      const res = await auth.api.signUpEmail({
        body: { name, email, password },
        headers: c.req.raw.headers,
        asResponse: true
      })
      if (res.ok) {
        const newUserId = await findUserIdByEmail(c.env.DB, email)
        const used = await finalizeInviteUsage(c.env.DB, inviteCheck.code, newUserId)
        if (!used.ok && newUserId) {
          await deleteUserCascade(c.env.DB, newUserId)
          return apiErr(c, used.message)
        }
        return apiOk(c, undefined, { redirect: '/login?registered=1', message: "注册成功" })
      }
      const data = await res.json().catch(() => ({}))
      const message =
        (data as { message?: string }).message ||
        (res.status === 422 ? "该邮箱已注册" : "注册失败")
      return apiErr(c, message, res.status)
    } catch (err) {
      const message = err instanceof Error ? err.message : "注册失败"
      return apiErr(c, message, 500)
    }
  })

  app.post('/api/auth/verify-email', async (c) => {
    const denied = await requireJsonMutation(c)
    if (denied) return denied
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (user) return apiOk(c, undefined, { redirect: '/' })

    const settings = await getSettings(c.env.DB)
    const body = await readJsonBody(c)
    const email = String(body.email ?? '').trim()
    const code = String(body.code ?? '').trim()
    const clientIp =
      c.req.header('cf-connecting-ip') ||
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      null

    if (!email || !code) return apiErr(c, "请填写邮箱和验证码")

    await purgeExpiredRateLimitBuckets(c.env.DB)
    const limited = await isVerificationRateLimited(c.env.DB, email, clientIp)
    if (limited.limited) {
      return apiErr(c, "尝试过于频繁，请 " + String(limited.retryAfterSec) + " 秒后再试", 429)
    }

    const row = await findLatestEmailVerification(c.env.DB, email)
    if (!row) return apiErr(c, "验证码不存在或已失效")
    if (Date.now() > row.expires_at) return apiErr(c, "验证码已过期，请重新注册")

    const codeOk = await verifyVerificationCode(code, row.code_hash)
    if (!codeOk) {
      const fail = await recordVerificationFailure(c.env.DB, email, clientIp)
      const msg = fail.limited
        ? ("尝试过于频繁，请 " + String(fail.retryAfterSec) + " 秒后再试")
        : "验证码错误"
      return apiErr(c, msg, fail.limited ? 429 : 400)
    }

    if (!settings.registration_enabled) return apiErr(c, "当前已关闭注册", 403)
    if (settings.registration_mode === 'oauth') return apiErr(c, "当前仅支持 OAuth 注册", 403)

    const emailCheck = isEmailAllowed(email, settings)
    if (!emailCheck.ok) return apiErr(c, emailCheck.reason || "邮箱不被允许")

    if (settings.invite_required) {
      const inviteCheck = await requireInviteCodeIfNeeded(c.env.DB, settings, row.invite_code || '')
      if (!inviteCheck.ok) return apiErr(c, inviteCheck.message)
    }

    let plainPassword: string
    try {
      plainPassword = await openPendingPassword(c.env.BETTER_AUTH_SECRET, row.password)
    } catch {
      return apiErr(c, "注册信息已失效，请重新注册")
    }

    const auth = await createAuth(c.env)
    try {
      const res = await auth.api.signUpEmail({
        body: { name: row.name, email, password: plainPassword },
        headers: c.req.raw.headers,
        asResponse: true
      })
      if (res.ok) {
        const newUserId = await findUserIdByEmail(c.env.DB, email)
        const used = await finalizeInviteUsage(c.env.DB, row.invite_code, newUserId)
        if (!used.ok && newUserId) {
          await deleteUserCascade(c.env.DB, newUserId)
          return apiErr(c, used.message)
        }
        await deleteEmailVerificationsByEmail(c.env.DB, email)
        await clearVerificationFailures(c.env.DB, email, clientIp)
        return apiOk(c, undefined, { redirect: '/login?registered=1', message: "注册成功" })
      }
      const data = await res.json().catch(() => ({}))
      const message =
        (data as { message?: string }).message ||
        (res.status === 422 ? "该邮箱已注册" : "注册失败")
      return apiErr(c, message, res.status)
    } catch (err) {
      const message = err instanceof Error ? err.message : "注册失败"
      return apiErr(c, message, 500)
    }
  })

  app.post('/api/auth/oauth/login', async (c) => {
    const denied = await requireJsonMutation(c)
    if (denied) return denied
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    const next = safeInternalPath(c.req.query('next'), '/')
    if (user) return apiOk(c, undefined, { redirect: next })

    const body = await readJsonBody(c)
    const providerId = String(body.provider_id ?? '').trim()
    if (!providerId) return apiErr(c, "请选择 OAuth 应用")

    const auth = await createAuth(c.env)
    try {
      const res = await (auth.api as any).signInWithOAuth2({
        body: {
          providerId,
          callbackURL: next,
          errorCallbackURL: '/login?error=' + encodeURIComponent("OAuth 登录失败")
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
        const msg = (data as { message?: string }).message || "OAuth 登录失败"
        return apiErr(c, msg, res.status)
      }
      return apiErr(c, "OAuth 登录失败")
    } catch (err) {
      const msg = err instanceof Error ? err.message : "OAuth 登录失败"
      return apiErr(c, msg, 500)
    }
  })

  app.post('/api/auth/oauth/register', async (c) => {
    const denied = await requireJsonMutation(c)
    if (denied) return denied
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (user) return apiOk(c, undefined, { redirect: '/' })

    const settings = await getSettings(c.env.DB)
    if (!settings.registration_enabled) return apiErr(c, "当前已关闭注册", 403)
    if (settings.registration_mode === 'email') return apiErr(c, "当前仅支持邮箱注册", 403)

    const body = await readJsonBody(c)
    const providerId = String(body.provider_id ?? '').trim()
    const inviteCode = String(body.invite_code ?? '').trim()
    if (!providerId) return apiErr(c, "请选择 OAuth 应用")

    const inviteCheck = await requireInviteCodeIfNeeded(c.env.DB, settings, inviteCode)
    if (!inviteCheck.ok) return apiErr(c, inviteCheck.message)

    const auth = await createAuth(c.env)
    try {
      const res = await (auth.api as any).signInWithOAuth2({
        body: {
          providerId,
          callbackURL: '/register/oauth/done',
          errorCallbackURL: '/register?error=' + encodeURIComponent("OAuth 注册失败"),
          requestSignUp: true
        },
        headers: c.req.raw.headers,
        asResponse: true
      })
      const extracted = await extractOAuthRedirectUrl(res)
      if (extracted.url) {
        const headers = new Headers(extracted.headers)
        if (inviteCheck.code) {
          headers.append(
            'Set-Cookie',
            inviteCookie(inviteCheck.code, requestIsHttps(c.req.raw), 1800)
          )
        }
        return apiOkWithHeaders(undefined, headers, { redirect: extracted.url })
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const msg = (data as { message?: string }).message || "OAuth 注册失败"
        return apiErr(c, msg, res.status)
      }
      return apiErr(c, "OAuth 注册失败")
    } catch (err) {
      const msg = err instanceof Error ? err.message : "OAuth 注册失败"
      return apiErr(c, msg, 500)
    }
  })

  app.get('/register/oauth/done', async (c) => {
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    const settings = await getSettings(c.env.DB)
    const cookieHeader = c.req.header('Cookie') || ''
    const pendingInvite = parseCookie(cookieHeader, 'pending_invite_code')
    const clearInviteCookie = inviteCookie(null, requestIsHttps(c.req.raw), 0)
    if (!user) {
      return redirectWithHeaders('/login', 302, new Headers({ 'Set-Cookie': clearInviteCookie }))
    }

    const failOAuthRegister = async (message: string) => {
      await deleteUserCascade(c.env.DB, user.id)
      return redirectWithHeaders(
        '/register?error=' + encodeURIComponent(message),
        302,
        new Headers({ 'Set-Cookie': clearInviteCookie })
      )
    }

    const createdAtMs = new Date(user.createdAt).getTime()
    const isNewUser = Number.isFinite(createdAtMs) && Date.now() - createdAtMs < 5 * 60 * 1000

    if (isNewUser) {
      const oauthSignupAllowed =
        settings.registration_enabled &&
        (settings.registration_mode === 'oauth' || settings.registration_mode === 'both')
      if (!oauthSignupAllowed) {
        return await failOAuthRegister("当前不允许 OAuth 注册")
      }
    }

    if (isNewUser && settings.github_min_account_age_days > 0) {
      const account = await c.env.DB
        .prepare(
          "SELECT accessToken FROM account WHERE userId = ? AND providerId = 'github' ORDER BY updatedAt DESC LIMIT 1"
        )
        .bind(user.id)
        .first<{ accessToken: string | null }>()

      if (account) {
        if (!account.accessToken) {
          await deleteUserCascade(c.env.DB, user.id)
          return redirectWithHeaders(
            githubAgeRejectedPath(settings.github_min_account_age_days),
            302,
            new Headers({ 'Set-Cookie': clearInviteCookie })
          )
        }
        const ghUser = await getGitHubUser(account.accessToken)
        if (!ghUser || !meetsAgeRequirement(ghUser.created_at, settings.github_min_account_age_days)) {
          await deleteUserCascade(c.env.DB, user.id)
          const actualDays = ghUser
            ? (Date.now() - Date.parse(ghUser.created_at)) / 86400000
            : null
          return redirectWithHeaders(
            githubAgeRejectedPath(settings.github_min_account_age_days, actualDays),
            302,
            new Headers({ 'Set-Cookie': clearInviteCookie })
          )
        }
      }
    }

    if (settings.invite_required && isNewUser) {
      const used = await finalizeInviteUsage(c.env.DB, pendingInvite, user.id)
      if (!used.ok) return await failOAuthRegister(used.message)
    }
    return redirectWithHeaders('/', 302, new Headers({ 'Set-Cookie': clearInviteCookie }))
  })

  app.all('/api/auth/*', async (c) => {
    const auth = await createAuth(c.env)
    const pathname = new URL(c.req.url).pathname
    const method = c.req.method.toUpperCase()

    if (method === 'POST' && (pathname.endsWith('/sign-up/email') || pathname.includes('/sign-up/email'))) {
      return c.json(
        {
          code: 'SIGN_UP_DISABLED',
          message: "请通过网站注册页面完成注册"
        },
        403
      )
    }

    const isGitHubOAuthCallback =
      pathname.endsWith('/oauth2/callback/github') ||
      pathname.includes('/oauth2/callback/github')

    const redirectAgeRejected = async (value: unknown) => {
      const settings = await getSettings(c.env.DB)
      const details = extractGitHubAgeRejectedDetails(value, settings.github_min_account_age_days)
      return c.redirect(githubAgeRejectedPath(details.minDays, details.actualDays))
    }

    let res: Response
    try {
      res = await auth.handler(c.req.raw)
    } catch (err) {
      if (isGitHubOAuthCallback && isGitHubAgeRejectedError(err)) {
        return await redirectAgeRejected(err)
      }
      throw err
    }

    if (isGitHubOAuthCallback) {
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location') || ''
        if (isGitHubAgeRejectedError(location) || location.includes('error=GITHUB_ACCOUNT_AGE_REJECTED')) {
          return await redirectAgeRejected(decodeURIComponent(location))
        }
      }

      if (res.status >= 400) {
        let bodyText = ''
        try {
          bodyText = await res.clone().text()
        } catch {
          bodyText = ''
        }

        if (isGitHubAgeRejectedError(bodyText) || isGitHubAgeRejectedError(res.statusText)) {
          return await redirectAgeRejected(bodyText || res.statusText)
        }
      }
    }

    return res
  })
}
