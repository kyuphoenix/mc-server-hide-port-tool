import { betterAuth } from 'better-auth'
import { github } from 'better-auth/social-providers'

export type AuthBindings = {
  DB: D1Database
  BETTER_AUTH_SECRET?: string
  APP_NAME?: string
  BETTER_AUTH_URL?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
}

export type Auth = ReturnType<typeof createAuth>

export function createAuth(env: AuthBindings) {
  const githubConfigured = env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
  return betterAuth({
    appName: env.APP_NAME || 'hide-port-tool',
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      autoSignIn: true
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
    socialProviders: githubConfigured
      ? {
          github: {
            clientId: env.GITHUB_CLIENT_ID!,
            clientSecret: env.GITHUB_CLIENT_SECRET!,
            scope: ['user:email']
          }
        }
      : undefined
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
  const auth = createAuth(env)
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
