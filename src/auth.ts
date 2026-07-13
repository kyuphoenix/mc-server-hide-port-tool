import { betterAuth } from 'better-auth'
import { genericOAuth } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import {
  listEnabledOAuthProviders,
  toGenericOAuthConfig,
  type OAuthProviderRow
} from './services/oauth-providers'
import { getSettings } from './services/settings'
import { allocateNextUserId } from './services/user-ids'

export type AuthBindings = {
  DB: D1Database
  BETTER_AUTH_SECRET?: string
  APP_NAME?: string
  BETTER_AUTH_URL?: string
}

export type Auth = ReturnType<typeof betterAuth>

async function resolveOAuthSignupPolicy(db: D1Database): Promise<{
  disableSignUp: boolean
  disableImplicitSignUp: boolean
}> {
  const settings = await getSettings(db)
  // OAuth new-account creation is only allowed when open registration is enabled
  // and mode is oauth/both. Invite requirement is enforced in app routes for new users.
  const oauthSignupAllowed =
    settings.registration_enabled &&
    (settings.registration_mode === 'oauth' || settings.registration_mode === 'both')
  return {
    disableSignUp: !oauthSignupAllowed,
    // Always require explicit requestSignUp for new OAuth accounts when allowed;
    // login path must not implicitly create users.
    disableImplicitSignUp: true
  }
}


function resolvePasskeyRp(env: AuthBindings): { rpID: string; rpName: string; origin?: string } {
  const appName = env.APP_NAME || 'hide-port-tool'
  const base = (env.BETTER_AUTH_URL || '').trim()
  if (!base) {
    return { rpID: 'localhost', rpName: appName }
  }
  try {
    const url = new URL(base)
    return {
      rpID: url.hostname,
      rpName: appName,
      origin: url.origin
    }
  } catch {
    return { rpID: 'localhost', rpName: appName }
  }
}

export async function createAuth(
  env: AuthBindings,
  oauthProviders?: OAuthProviderRow[]
) {
  const providers =
    oauthProviders ?? (await listEnabledOAuthProviders(env.DB).catch(() => [] as OAuthProviderRow[]))

  // Public email signup is blocked at the /api/auth/* edge; app routes call signUpEmail server-side.
  const oauthSignupPolicy = await resolveOAuthSignupPolicy(env.DB).catch(() => ({
    // Fail closed if settings cannot be loaded.
    disableSignUp: true,
    disableImplicitSignUp: true
  }))
  const genericConfigs = providers.map((p) =>
    toGenericOAuthConfig(p, env.DB, {
      disableSignUp: oauthSignupPolicy.disableSignUp,
      disableImplicitSignUp: oauthSignupPolicy.disableImplicitSignUp
    })
  )
  const passkeyRp = resolvePasskeyRp(env)

  const plugins = [
    passkey({
      rpID: passkeyRp.rpID,
      rpName: passkeyRp.rpName,
      origin: passkeyRp.origin
    }),
    ...(genericConfigs.length > 0
      ? [
          genericOAuth({
            config: genericConfigs
          })
        ]
      : [])
  ]

  return betterAuth({
    appName: env.APP_NAME || 'hide-port-tool',
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      // Keep false so admin-created users and public registration do not replace
      // the current browser session. Setup explicitly signs in after creation.
      autoSignIn: false
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            // Assign sequential numeric user ids: "1", "2", "3", ...
            // createWithHooks uses forceAllowId, so this id is persisted.
            const id = await allocateNextUserId(env.DB)
            return {
              data: {
                ...user,
                id
              }
            }
          }
        }
      }
    },
    session: {
      // 设置页添加 Passkey / 解绑账号会走 fresh session 校验；关闭以避免长会话无法操作
      freshAge: 0
    },
    account: {
      accountLinking: {
        enabled: true,
        // OAuth providers often supply synthetic / different emails; allow binding anyway.
        allowDifferentEmails: true
      }
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: false,
          defaultValue: 'user',
          input: false
        },
        super_admin: {
          type: 'number',
          required: false,
          defaultValue: 0,
          input: false
        },
        record_limit: {
          type: 'number',
          required: false,
          defaultValue: null,
          input: false
        }
      }
    },
    plugins
  })
}

export type AuthUser = {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image?: string | null | undefined
  role?: string | null | undefined
  super_admin?: number | null | undefined
  record_limit?: number | null | undefined
  createdAt: Date
  updatedAt: Date
}

export type AuthSession = {
  session: { id: string; userId: string; expiresAt: Date; token: string }
  user: AuthUser
}

export async function getCurrentSession(env: AuthBindings, headers: Headers): Promise<AuthSession | null> {
  const auth = await createAuth(env)
  return await auth.api.getSession({ headers })
}

export async function getCurrentUser(env: AuthBindings, headers: Headers): Promise<AuthUser | null> {
  const s = await getCurrentSession(env, headers)
  if (!s) return null
  const u = s.user as any
  return {
    ...s.user,
    role: (u.role as string | undefined) ?? 'user',
    super_admin: (u.super_admin as number | null | undefined) ?? 0,
    record_limit: u.record_limit === undefined || u.record_limit === null ? null : Number(u.record_limit)
  }
}

export function isSuperAdminUser(u: AuthUser | null | undefined): boolean {
  return !!u && Number(u.super_admin ?? 0) > 0
}

export async function isAdmin(env: AuthBindings, headers: Headers): Promise<boolean> {
  const user = await getCurrentUser(env, headers)
  return !!user && user.role === 'admin'
}

export async function requireAdmin(env: AuthBindings, headers: Headers): Promise<AuthUser | null> {
  const user = await getCurrentUser(env, headers)
  if (!user || user.role !== 'admin') return null
  return user
}
