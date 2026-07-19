import type { Context, Hono } from 'hono'
import { hashPassword } from 'better-auth/crypto'
import {
  createAuth,
  getCurrentUser
} from '../auth'
import { getSettings, isEmailAllowed } from '../services/settings'
import { deleteUserCascade } from '../services/dns-records'
import {
  clearVerificationFailures,
  deleteEmailVerificationsByEmail,
  findLatestEmailVerification,
  generateVerificationCode,
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
  githubAgeRejectedPath,
  isGitHubAgeRejectedError
} from '../services/github'
import { type Bindings } from '../services/cloudflare-dns'
import {
  parseCookie,
  redirectWithHeaders
} from '../lib/http'
import { finalizeInviteUsage, findUserIdByEmail, requireInviteCodeIfNeeded } from '../lib/invite'
import { findOAuthProviderByProviderId } from '../services/oauth-providers'
import {
  OAUTH_REGISTRATION_INTENT_COOKIE,
  bindOAuthRegistrationIntentState,
  buildOAuthRegistrationIntentClearCookie,
  buildOAuthRegistrationIntentCookie,
  cleanupOAuthRegistrationIntents,
  createOAuthRegistrationIntent,
  createOAuthRegistrationSecurityEvent,
  releasePendingOAuthRegistrationIntent
} from '../services/oauth-registration-intents'
import { requestIsHttps, safeInternalPath } from '../lib/security'
import { requireMutationCsrf } from '../lib/csrf'
import {
  assertFirstSetupCompleted,
  claimFirstSetup,
  createFirstSetupSecurityEvent,
  FirstSetupError,
  reconcileFirstSetup,
  releaseOwnedFirstSetupClaim,
  type FirstSetupStage
} from '../services/first-setup'
import {
  apiErr,
  apiOk,
  apiOkWithHeaders,
  extractOAuthRedirectUrl,
  readJsonBody,
  requireJsonMutation
} from '../lib/api'
import {
  buildRateLimitKey,
  clearRateLimit,
  consumeAnyRateLimit,
  getClientAddress
} from '../services/rate-limit'
import { sensitiveDataKeysFromEnv } from '../services/sensitive-data'

function logOAuthRegistrationFailure(error: unknown, providerId: string): void {
  console.error(JSON.stringify(createOAuthRegistrationSecurityEvent(error, { providerId })))
}

function logAuthRouteFailure(operation: string, error: unknown): void {
  console.error(JSON.stringify({
    event: 'auth_route_failure',
    operation,
    error_name: error instanceof Error ? error.name : 'UnknownError'
  }))
}

type AuthRouteContext = Context<{ Bindings: Bindings }>

function logFirstSetupFailure(error: unknown, stage: FirstSetupStage): void {
  console.error(JSON.stringify(createFirstSetupSecurityEvent(error, { stage })))
}

async function requireFirstSetupCompleted(
  c: AuthRouteContext
): Promise<Response | null> {
  try {
    await assertFirstSetupCompleted(c.env.DB)
    return null
  } catch (error) {
    if (
      error instanceof FirstSetupError &&
      error.code === 'SETUP_NOT_READY'
    ) {
      return apiErr(c, '请先完成管理员初始化', 409, {
        code: error.code
      })
    }

    logFirstSetupFailure(error, 'guard')
    return apiErr(c, '初始化状态不可用', 503, {
      code: 'SETUP_NOT_READY'
    })
  }
}

function firstSetupErrorResponse(c: AuthRouteContext, error: unknown): Response {
  const code = error instanceof FirstSetupError ? error.code : 'SETUP_FAILED'
  if (code === 'SETUP_DONE') {
    return apiErr(c, '已完成初始化', 400, { code })
  }
  if (code === 'SETUP_IN_PROGRESS') {
    return apiErr(c, '初始化正在进行，请稍后重试', 409, { code })
  }
  if (code === 'SETUP_NOT_READY') {
    return apiErr(c, '请先完成管理员初始化', 409, { code })
  }
  return apiErr(c, '创建管理员失败', 500, { code: 'SETUP_FAILED' })
}

async function cleanupOAuthRegistrationRouteState(
  db: D1Database,
  token: string | null
): Promise<void> {
  await releasePendingOAuthRegistrationIntent(db, token).catch((error) => {
    logOAuthRegistrationFailure(error, 'unknown')
  })
  await cleanupOAuthRegistrationIntents(db).catch((error) => {
    logOAuthRegistrationFailure(error, 'unknown')
  })
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

    const body = await readJsonBody(c)
    const name = String(body.name ?? '').trim()
    const email = String(body.email ?? '').trim()
    const password = String(body.password ?? '')
    const confirm = String(body.confirm ?? '')

    if (!name || !email || !password) return apiErr(c, '请填写完整信息')
    if (password !== confirm) return apiErr(c, '两次密码不一致')
    if (password.length < 8) return apiErr(c, '密码至少 8 位')

    let claim: Awaited<ReturnType<typeof claimFirstSetup>> | null = null
    let stage: FirstSetupStage = 'reconcile'
    try {
      await reconcileFirstSetup(c.env.DB)
      stage = 'claim'
      claim = await claimFirstSetup(c.env.DB)
      stage = 'create-user'
      const auth = await createAuth(c.env, undefined, {
        firstSetupClaimToken: claim.token
      })
      const signUpRes = await auth.api.signUpEmail({
        body: { name, email, password },
        headers: c.req.raw.headers,
        asResponse: true
      })
      if (!signUpRes.ok) {
        throw new FirstSetupError('SETUP_FAILED')
      }
    } catch (error) {
      logFirstSetupFailure(error, stage)
      if (claim) {
        await releaseOwnedFirstSetupClaim(c.env.DB, claim.token).catch((releaseError) => {
          logFirstSetupFailure(releaseError, 'release')
        })
      }
      return firstSetupErrorResponse(c, error)
    }

    try {
      const auth = await createAuth(c.env)
      const signInRes = await auth.api.signInEmail({
        body: { email, password },
        headers: c.req.raw.headers,
        asResponse: true
      })
      if (signInRes.ok) {
        return apiOkWithHeaders(undefined, signInRes.headers, {
          redirect: '/',
          message: '初始化成功'
        })
      }
    } catch (error) {
      logFirstSetupFailure(error, 'create-user')
    }

    return apiOk(c, undefined, {
      redirect: '/login',
      message: '管理员已创建，请登录'
    })
  })

  app.post('/api/auth/login', async (c) => {
    const denied = await requireJsonMutation(c)
    if (denied) return denied
    const next = safeInternalPath(c.req.query('next'), '/')
    const body = await readJsonBody(c)
    const email = String(body.email ?? '').trim()
    const password = String(body.password ?? '')
    if (!email || !password) return apiErr(c, "请填写邮箱和密码")

    const clientAddress = getClientAddress(c.req.raw.headers)
    const [ipKey, emailKey, emailIpKey] = await Promise.all([
      buildRateLimitKey('login_ip', clientAddress),
      buildRateLimitKey('login_email', email),
      buildRateLimitKey('login_email_ip', `${email}|${clientAddress}`)
    ])
    const limited = await consumeAnyRateLimit(c.env.DB, [
      { key: ipKey, limit: 30, windowMs: 10 * 60 * 1000 },
      { key: emailKey, limit: 20, windowMs: 10 * 60 * 1000 },
      { key: emailIpKey, limit: 8, windowMs: 10 * 60 * 1000 }
    ])
    if (limited) {
      c.header('Retry-After', String(limited.retryAfterSec))
      return apiErr(c, '登录尝试过于频繁，请稍后重试', 429)
    }

    const auth = await createAuth(c.env)
    try {
      const res = await auth.api.signInEmail({
        body: { email, password },
        headers: c.req.raw.headers,
        asResponse: true
      })
      if (res.ok) {
        await clearRateLimit(c.env.DB, [emailKey, emailIpKey]).catch(() => undefined)
        return apiOkWithHeaders(undefined, res.headers, { redirect: next, message: "登录成功" })
      }
      return apiErr(c, '邮箱或密码错误', res.status === 429 ? 429 : 401)
    } catch {
      return apiErr(c, '登录服务暂不可用，请稍后重试', 500)
    }
  })

  app.post('/api/auth/register', async (c) => {
    const denied = await requireJsonMutation(c)
    if (denied) return denied
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (user) return apiOk(c, undefined, { redirect: '/' })

    const setupDenied = await requireFirstSetupCompleted(c)
    if (setupDenied) return setupDenied

    const settings = await getSettings(c.env.DB, sensitiveDataKeysFromEnv(c.env))
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
      const clientAddress = getClientAddress(c.req.raw.headers)
      const [ipKey, emailKey] = await Promise.all([
        buildRateLimitKey('verification_send_ip', clientAddress),
        buildRateLimitKey('verification_send_email', email)
      ])
      const limited = await consumeAnyRateLimit(c.env.DB, [
        { key: ipKey, limit: 10, windowMs: 15 * 60 * 1000 },
        { key: emailKey, limit: 3, windowMs: 15 * 60 * 1000 }
      ])
      if (limited) {
        c.header('Retry-After', String(limited.retryAfterSec))
        return apiErr(c, '验证码发送过于频繁，请稍后重试', 429)
      }

      const existingUserId = await findUserIdByEmail(c.env.DB, email)
      if (existingUserId) return apiErr(c, '该邮箱已注册', 409)

      const code = generateVerificationCode()
      const codeHash = await hashPassword(code)
      const expires_at = Date.now() + 10 * 60 * 1000
      const passwordSealed = await sealPendingPassword(sensitiveDataKeysFromEnv(c.env), password)
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
      const message = res.status === 422 || res.status === 409 ? "该邮箱已注册" : "注册失败"
      return apiErr(c, message, res.status)
    } catch (err) {
      logAuthRouteFailure('email_signup', err)
      return apiErr(c, "注册失败", 500)
    }
  })

  app.post('/api/auth/verify-email', async (c) => {
    const denied = await requireJsonMutation(c)
    if (denied) return denied
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (user) return apiOk(c, undefined, { redirect: '/' })

    const setupDenied = await requireFirstSetupCompleted(c)
    if (setupDenied) return setupDenied

    const settings = await getSettings(c.env.DB, sensitiveDataKeysFromEnv(c.env))
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
      plainPassword = await openPendingPassword(sensitiveDataKeysFromEnv(c.env), row.password)
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
      const message = res.status === 422 || res.status === 409 ? "该邮箱已注册" : "注册失败"
      return apiErr(c, message, res.status)
    } catch (err) {
      logAuthRouteFailure('verified_email_signup', err)
      return apiErr(c, "注册失败", 500)
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
          errorCallbackURL: '/login?oauth_error=1'
        },
        headers: c.req.raw.headers,
        asResponse: true
      })
      const extracted = await extractOAuthRedirectUrl(res)
      if (extracted.url) {
        return apiOkWithHeaders(undefined, extracted.headers, { redirect: extracted.url })
      }
      if (!res.ok) {
        return apiErr(c, "OAuth 登录失败", res.status)
      }
      return apiErr(c, "OAuth 登录失败")
    } catch (err) {
      logAuthRouteFailure('oauth_login', err)
      return apiErr(c, "OAuth 登录失败", 500)
    }
  })

  app.post('/api/auth/oauth/register', async (c) => {
    const denied = await requireJsonMutation(c)
    if (denied) return denied
    const user = await getCurrentUser(c.env, c.req.raw.headers)
    if (user) return apiOk(c, undefined, { redirect: '/' })

    const setupDenied = await requireFirstSetupCompleted(c)
    if (setupDenied) return setupDenied

    const settings = await getSettings(c.env.DB, sensitiveDataKeysFromEnv(c.env))
    if (!settings.registration_enabled) return apiErr(c, "当前已关闭注册", 403)
    if (settings.registration_mode === 'email') return apiErr(c, "当前仅支持邮箱注册", 403)

    const body = await readJsonBody(c)
    const providerId = String(body.provider_id ?? '').trim()
    const inviteCode = String(body.invite_code ?? '').trim()
    const oauthRegistrationFailed = () =>
      apiErr(c, 'OAuth 注册失败，请重新发起注册', 400, {
        code: 'OAUTH_REGISTRATION_FAILED'
      })

    if (!providerId) return oauthRegistrationFailed()

    let intent: Awaited<ReturnType<typeof createOAuthRegistrationIntent>> | null = null
    let eventProviderId = 'unknown'
    try {
      const provider = await findOAuthProviderByProviderId(c.env.DB, providerId)
      if (!provider || provider.enabled !== 1) {
        throw new Error('oauth_provider_unavailable')
      }
      eventProviderId = provider.provider_id

      await cleanupOAuthRegistrationIntents(c.env.DB).catch((error) => {
        logOAuthRegistrationFailure(error, eventProviderId)
      })
      intent = await createOAuthRegistrationIntent(c.env.DB, {
        providerId,
        inviteRequired: settings.invite_required,
        inviteCode
      })

      const auth = await createAuth(c.env)
      const res = await (auth.api as any).signInWithOAuth2({
        body: {
          providerId,
          callbackURL: '/register/oauth/done',
          errorCallbackURL: '/register/oauth/error',
          requestSignUp: true
        },
        headers: c.req.raw.headers,
        asResponse: true
      })
      const extracted = await extractOAuthRedirectUrl(res)
      if (!extracted.url) throw new Error('oauth_redirect_missing')

      const authorization = new URL(extracted.url)
      const state = authorization.searchParams.get('state') || ''
      if (!state) throw new Error('oauth_state_missing')
      await bindOAuthRegistrationIntentState(c.env.DB, {
        id: intent.id,
        token: intent.token,
        providerId,
        state
      })

      const headers = new Headers(extracted.headers)
      headers.append(
        'Set-Cookie',
        buildOAuthRegistrationIntentCookie(intent.token, requestIsHttps(c.req.raw))
      )
      return apiOkWithHeaders(undefined, headers, { redirect: extracted.url })
    } catch (error) {
      logOAuthRegistrationFailure(error, eventProviderId)
      if (intent) {
        await releasePendingOAuthRegistrationIntent(c.env.DB, intent.token).catch((releaseError) => {
          logOAuthRegistrationFailure(releaseError, eventProviderId)
        })
      }
      return oauthRegistrationFailed()
    }
  })

  app.get('/register/oauth/done', async (c) => {
    let user: Awaited<ReturnType<typeof getCurrentUser>> = null
    try {
      user = await getCurrentUser(c.env, c.req.raw.headers)
    } catch (error) {
      logOAuthRegistrationFailure(error, 'unknown')
    }
    const token = parseCookie(
      c.req.header('Cookie') || '',
      OAUTH_REGISTRATION_INTENT_COOKIE
    )
    await cleanupOAuthRegistrationRouteState(c.env.DB, token)
    const headers = new Headers({
      'Set-Cookie': buildOAuthRegistrationIntentClearCookie(requestIsHttps(c.req.raw))
    })
    return user
      ? redirectWithHeaders('/', 302, headers)
      : redirectWithHeaders(
          '/login?error=' + encodeURIComponent('OAuth 注册失败，请重新发起注册'),
          302,
          headers
        )
  })

  app.get('/register/oauth/error', async (c) => {
    const token = parseCookie(
      c.req.header('Cookie') || '',
      OAUTH_REGISTRATION_INTENT_COOKIE
    )
    await cleanupOAuthRegistrationRouteState(c.env.DB, token)
    const headers = new Headers({
      'Set-Cookie': buildOAuthRegistrationIntentClearCookie(requestIsHttps(c.req.raw))
    })
    return redirectWithHeaders(
      '/register?error=' +
        encodeURIComponent('OAuth 注册失败，请重新发起注册') +
        '&code=OAUTH_REGISTRATION_FAILED',
      302,
      headers
    )
  })

  app.all('/api/auth/*', async (c) => {
    const pathname = new URL(c.req.url).pathname
    const method = c.req.method.toUpperCase()
    const authSubpath = pathname
      .replace(/^\/api\/auth/, '')
      .replace(/\/+$/, '') || '/'

    if (method === 'POST' && authSubpath === '/sign-in/oauth2') {
      return apiErr(c, '请通过网站登录或注册入口使用 OAuth', 403, {
        code: 'OAUTH2_PUBLIC_ENTRY_DISABLED'
      })
    }

    if (method === 'POST' && (pathname.endsWith('/sign-up/email') || pathname.includes('/sign-up/email'))) {
      return c.json(
        {
          code: 'SIGN_UP_DISABLED',
          message: "请通过网站注册页面完成注册"
        },
        403
      )
    }

    const auth = await createAuth(c.env)

    const isGitHubOAuthCallback =
      pathname.endsWith('/oauth2/callback/github') ||
      pathname.includes('/oauth2/callback/github')

    const redirectAgeRejected = async (value: unknown) => {
      const settings = await getSettings(c.env.DB, sensitiveDataKeysFromEnv(c.env))
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
