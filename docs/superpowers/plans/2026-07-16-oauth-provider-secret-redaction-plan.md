# OAuth Provider Secret Redaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every browser-facing admin OAuth Provider response is redacted so `client_secret` never leaves the server while runtime OAuth flows still use the stored secret internally.

**Architecture:** Add a service-layer admin-safe DTO in `src/services/oauth-providers.ts`, then route all admin page/create responses through that DTO. Keep existing database row APIs for internal runtime code such as Better Auth provider config.

**Tech Stack:** Hono routes, Cloudflare D1, Better Auth 1.6.23, Vitest, TypeScript.

---

## File Structure

- Modify `src/services/oauth-providers.ts`: define `OAuthProviderAdminView`, `maskOAuthProviderForAdmin`, and `listOAuthProvidersForAdmin` while preserving internal `OAuthProviderRow` APIs.
- Modify `src/routes/pages.ts`: replace `listOAuthProviders` with `listOAuthProvidersForAdmin` in `/api/pages/admin`.
- Modify `src/routes/admin.ts`: return `maskOAuthProviderForAdmin(result.provider)` from `/api/admin/oauth/create`.
- Modify `tests/first-setup-routes.test.ts`: add admin page data response privacy coverage because the file already has page-route fixtures and admin page tests.
- Modify `tests/oauth-registration-routes.test.ts`: add OAuth admin create/update response privacy and runtime secret retention coverage because the file already has OAuth provider fixtures and route helpers.
- No database migration, package change, or frontend redesign is required.

---

### Task 1: Add Failing Admin Page Redaction Test

**Files:**
- Modify: `tests/first-setup-routes.test.ts`

- [ ] **Step 1: Add the failing admin page privacy test**

Add this test near the existing `/api/pages/admin` page-data tests, after the completed setup navigation tests and before the first setup privacy-log test:

```ts
  it('redacts OAuth provider secrets from admin page data', async () => {
    const { db, env } = await setupPageState('completed')
    await seedFixtureOAuthProvider(db)

    const response = await getPage(env, '/api/pages/admin?tab=oauth')
    const text = await response.text()
    const body = JSON.parse(text) as {
      success: boolean
      data?: { oauthProviders?: Array<Record<string, unknown>> }
    }

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data?.oauthProviders).toHaveLength(1)
    expect(body.data?.oauthProviders?.[0]).toMatchObject({
      provider_id: FIXTURE_PROVIDER_ID,
      has_client_secret: true
    })
    expect(body.data?.oauthProviders?.[0]).not.toHaveProperty('client_secret')
    expect(text).not.toContain('fixture-client-secret')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
pnpm exec vitest run tests/first-setup-routes.test.ts -t "redacts OAuth provider secrets from admin page data" --reporter=verbose
```

Expected: FAIL because `oauthProviders[0]` currently includes `client_secret` and does not include `has_client_secret`.

- [ ] **Step 3: Commit the failing test**

Run:

```powershell
git add tests/first-setup-routes.test.ts
git commit -m "test: cover admin oauth provider redaction"
```

---

### Task 2: Add Failing Admin OAuth Mutation Tests

**Files:**
- Modify: `tests/oauth-registration-routes.test.ts`

- [ ] **Step 1: Add admin auth helper**

Add this helper after `jsonBody`:

```ts
async function adminHeaders(db: D1Database, id = 'admin-user'): Promise<Headers> {
  await seedUser(db, { id, email: `${id}@example.test` })
  const sessionToken = `${id}-session-token`
  const now = Date.now()
  await db.prepare(
    `INSERT INTO session
     (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`
  ).bind(
    `${id}-session`,
    new Date(now + 86400000).toISOString(),
    sessionToken,
    now,
    now,
    id
  ).run()
  return sameOriginJsonHeaders(`csrf_token=test-csrf; better-auth.session_token=${sessionToken}`)
}
```

- [ ] **Step 2: Add POST helper accepting headers**

Add this helper after `postJson`:

```ts
async function postJsonWithHeaders(
  env: Bindings,
  path: string,
  body: Record<string, unknown>,
  headers: Headers
) {
  return await request(env, path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })
}
```

- [ ] **Step 3: Add create response redaction test**

Add this test near the existing OAuth route tests, before callback/error cleanup tests:

```ts
  it('redacts OAuth provider secret from admin create response', async () => {
    const { db, env } = await setup()
    await db.prepare('DELETE FROM oauth_provider WHERE provider_id = ?')
      .bind('private-provider')
      .run()
    const headers = await adminHeaders(db)
    const secret = 'private-created-client-secret'

    const response = await postJsonWithHeaders(env, '/api/admin/oauth/create', {
      provider_id: 'private-provider',
      name: 'Private Provider',
      client_id: 'private-client-id',
      client_secret: secret,
      authorization_url: 'https://private.example/authorize',
      token_url: 'https://private.example/token',
      user_info_url: 'https://private.example/userinfo',
      scopes: 'openid profile email',
      pkce: true,
      enabled: true,
      sort_order: 10,
      icon_url: ''
    }, headers)
    const text = await response.text()
    const body = JSON.parse(text) as {
      success: boolean
      data?: { provider?: Record<string, unknown> }
    }

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data?.provider).toMatchObject({
      provider_id: 'private-provider',
      has_client_secret: true
    })
    expect(body.data?.provider).not.toHaveProperty('client_secret')
    expect(text).not.toContain(secret)
  })
```

- [ ] **Step 4: Add update retention and replacement tests**

Add these tests immediately after the create response redaction test:

```ts
  it('retains an OAuth provider secret on blank admin update without exposing it', async () => {
    const { db, env } = await setup()
    const headers = await adminHeaders(db)
    const originalSecret = 'fixture-client-secret'

    const response = await postJsonWithHeaders(env, '/api/admin/oauth/fixture-provider/update', {
      provider_id: FIXTURE_PROVIDER_ID,
      name: 'Fixture OAuth Updated',
      client_id: 'fixture-client-id-updated',
      client_secret: '',
      authorization_url: 'https://provider.example/authorize',
      token_url: 'https://provider.example/token',
      user_info_url: 'https://provider.example/userinfo',
      scopes: 'openid profile email',
      pkce: false,
      enabled: true,
      sort_order: 1,
      icon_url: ''
    }, headers)
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(text).not.toContain(originalSecret)
    expect(text).not.toContain('client_secret')
    expect(await db.prepare(
      'SELECT client_secret FROM oauth_provider WHERE id = ?'
    ).bind('fixture-provider').first()).toEqual({ client_secret: originalSecret })
  })

  it('replaces an OAuth provider secret on admin update without exposing either value', async () => {
    const { db, env } = await setup()
    const headers = await adminHeaders(db)
    const originalSecret = 'fixture-client-secret'
    const nextSecret = 'private-replacement-client-secret'

    const response = await postJsonWithHeaders(env, '/api/admin/oauth/fixture-provider/update', {
      provider_id: FIXTURE_PROVIDER_ID,
      name: 'Fixture OAuth Updated',
      client_id: 'fixture-client-id-updated',
      client_secret: nextSecret,
      authorization_url: 'https://provider.example/authorize',
      token_url: 'https://provider.example/token',
      user_info_url: 'https://provider.example/userinfo',
      scopes: 'openid profile email',
      pkce: false,
      enabled: true,
      sort_order: 1,
      icon_url: ''
    }, headers)
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(text).not.toContain(originalSecret)
    expect(text).not.toContain(nextSecret)
    expect(text).not.toContain('client_secret')
    expect(await db.prepare(
      'SELECT client_secret FROM oauth_provider WHERE id = ?'
    ).bind('fixture-provider').first()).toEqual({ client_secret: nextSecret })
  })
```

- [ ] **Step 5: Run tests to verify they fail**

Run:

```powershell
pnpm exec vitest run tests/oauth-registration-routes.test.ts -t "redacts OAuth provider secret from admin create response|retains an OAuth provider secret|replaces an OAuth provider secret" --reporter=verbose
```

Expected: create response test FAILS because `provider.client_secret` is returned. Update tests may already pass because update currently returns no provider, but keep them as regression coverage for retention/replacement behavior and response privacy.

- [ ] **Step 6: Commit the failing and regression tests**

Run:

```powershell
git add tests/oauth-registration-routes.test.ts
git commit -m "test: cover admin oauth secret response privacy"
```

---

### Task 3: Implement Service-Layer Admin DTO

**Files:**
- Modify: `src/services/oauth-providers.ts`

- [ ] **Step 1: Add admin-safe type**

Add this type after `OAuthProviderPublic`:

```ts
export type OAuthProviderAdminView = {
  id: string
  provider_id: string
  name: string
  client_id: string
  has_client_secret: boolean
  discovery_url: string | null
  authorization_url: string | null
  token_url: string | null
  user_info_url: string | null
  scopes: string
  pkce: number
  enabled: number
  sort_order: number
  icon_url: string | null
  created_at: number
  updated_at: number
}
```

- [ ] **Step 2: Add masking function**

Add this function after `listOAuthProviders`:

```ts
export function maskOAuthProviderForAdmin(row: OAuthProviderRow): OAuthProviderAdminView {
  return {
    id: row.id,
    provider_id: row.provider_id,
    name: row.name,
    client_id: row.client_id,
    has_client_secret: String(row.client_secret ?? '').trim().length > 0,
    discovery_url: row.discovery_url,
    authorization_url: row.authorization_url,
    token_url: row.token_url,
    user_info_url: row.user_info_url,
    scopes: row.scopes,
    pkce: row.pkce,
    enabled: row.enabled,
    sort_order: row.sort_order,
    icon_url: row.icon_url,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}
```

- [ ] **Step 3: Add admin list function**

Add this function after `maskOAuthProviderForAdmin`:

```ts
export async function listOAuthProvidersForAdmin(db: D1Database): Promise<OAuthProviderAdminView[]> {
  const rows = await listOAuthProviders(db)
  return rows.map(maskOAuthProviderForAdmin)
}
```

- [ ] **Step 4: Run focused type check**

Run:

```powershell
pnpm exec tsc --noEmit
```

Expected: PASS or only failures that point to later route imports not yet updated. If TypeScript passes here, continue.

- [ ] **Step 5: Commit service DTO**

Run:

```powershell
git add src/services/oauth-providers.ts
git commit -m "feat: add admin oauth provider view"
```

---

### Task 4: Wire Admin Routes Through Redaction

**Files:**
- Modify: `src/routes/pages.ts`
- Modify: `src/routes/admin.ts`

- [ ] **Step 1: Update page route imports**

In `src/routes/pages.ts`, replace:

```ts
import { listOAuthProviders, listPublicOAuthProviders, OAUTH_TEMPLATES } from '../services/oauth-providers'
```

with:

```ts
import { listOAuthProvidersForAdmin, listPublicOAuthProviders, OAUTH_TEMPLATES } from '../services/oauth-providers'
```

- [ ] **Step 2: Use admin-safe provider list**

In `/api/pages/admin`, replace:

```ts
      listOAuthProviders(c.env.DB)
```

with:

```ts
      listOAuthProvidersForAdmin(c.env.DB)
```

- [ ] **Step 3: Update admin route imports**

In `src/routes/admin.ts`, add `maskOAuthProviderForAdmin` to the OAuth provider import:

```ts
import {
  createOAuthProvider,
  deleteOAuthProvider,
  maskOAuthProviderForAdmin,
  setOAuthProviderEnabled,
  updateOAuthProvider
} from '../services/oauth-providers'
```

- [ ] **Step 4: Redact create response**

In `/api/admin/oauth/create`, replace:

```ts
    return apiOk(c, { provider: result.provider }, { message: "已添加 OAuth 应用 " + result.provider.name })
```

with:

```ts
    return apiOk(c, { provider: maskOAuthProviderForAdmin(result.provider) }, {
      message: "已添加 OAuth 应用 " + result.provider.name
    })
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
pnpm exec vitest run tests/first-setup-routes.test.ts -t "redacts OAuth provider secrets from admin page data" --reporter=verbose
pnpm exec vitest run tests/oauth-registration-routes.test.ts -t "redacts OAuth provider secret from admin create response|retains an OAuth provider secret|replaces an OAuth provider secret" --reporter=verbose
```

Expected: all selected tests PASS.

- [ ] **Step 6: Commit route wiring**

Run:

```powershell
git add src/routes/pages.ts src/routes/admin.ts
git commit -m "fix: redact admin oauth provider responses"
```

---

### Task 5: Add Runtime Secret Retention Coverage

**Files:**
- Modify: `tests/oauth-registration-routes.test.ts`

- [ ] **Step 1: Add runtime config regression test**

Add `toGenericOAuthConfig` and `findOAuthProviderByProviderId` imports from `../src/services/oauth-providers`:

```ts
import {
  findOAuthProviderByProviderId,
  toGenericOAuthConfig
} from '../src/services/oauth-providers'
```

Add this test after the update replacement test:

```ts
  it('keeps runtime OAuth config backed by the stored client secret', async () => {
    const { db } = await setup()
    const row = await findOAuthProviderByProviderId(db, FIXTURE_PROVIDER_ID)
    expect(row).not.toBeNull()

    const config = toGenericOAuthConfig(row!, db) as { clientSecret?: string }

    expect(config.clientSecret).toBe('fixture-client-secret')
  })
```

- [ ] **Step 2: Run runtime regression test**

Run:

```powershell
pnpm exec vitest run tests/oauth-registration-routes.test.ts -t "keeps runtime OAuth config backed by the stored client secret" --reporter=verbose
```

Expected: PASS.

- [ ] **Step 3: Commit runtime coverage**

Run:

```powershell
git add tests/oauth-registration-routes.test.ts
git commit -m "test: cover oauth runtime secret retention"
```

---

### Task 6: Frontend Compatibility Check

**Files:**
- Inspect: `public/static/pages-admin.js`

- [ ] **Step 1: Confirm frontend does not read `client_secret` from provider data**

Run:

```powershell
rg -n "p\.client_secret|provider\.client_secret|client_secret" public/static/pages-admin.js
```

Expected: matches are only form input names and submitted payload field names, not provider data reads such as `p.client_secret`.

- [ ] **Step 2: Patch only if a provider-data read exists**

If the search finds `p.client_secret`, replace the UI dependency with `p.has_client_secret`. Do not change the empty password input semantics.

- [ ] **Step 3: Commit frontend patch only if needed**

If Step 2 changed the file, run:

```powershell
git add public/static/pages-admin.js
git commit -m "fix: stop frontend reading oauth client secrets"
```

If no frontend patch is needed, do not create a commit for this task.

---

### Task 7: Full Verification and Privacy Audit

**Files:**
- Inspect: full repository except `.dev.vars`

- [ ] **Step 1: Run focused OAuth/admin suites**

Run:

```powershell
pnpm exec vitest run tests/first-setup-routes.test.ts tests/oauth-registration-routes.test.ts --reporter=dot
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```powershell
pnpm test
```

Expected: 8 test files pass and all tests pass.

- [ ] **Step 3: Run TypeScript check**

Run:

```powershell
pnpm exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Run diff whitespace check**

Run:

```powershell
git diff --check
```

Expected: no output except possible line-ending warnings from Git; exit 0.

- [ ] **Step 5: Audit production response paths for raw provider rows**

Run:

```powershell
rg -n "listOAuthProviders\(|provider: result\.provider|client_secret" src/routes src/lib public/static
```

Expected:
- No `listOAuthProviders(` match in `src/routes/pages.ts`.
- No `provider: result.provider` match in `src/routes/admin.ts`.
- `client_secret` matches in routes/static files are limited to request-body reads, form input names, or internal service/runtime usage; no browser-facing response uses raw `client_secret`.

- [ ] **Step 6: Audit service boundary**

Run:

```powershell
rg -n "OAuthProviderAdminView|maskOAuthProviderForAdmin|listOAuthProvidersForAdmin|toGenericOAuthConfig" src/services/oauth-providers.ts src/routes/pages.ts src/routes/admin.ts tests
```

Expected: admin routes use masking/list-for-admin; runtime config still uses `toGenericOAuthConfig` with `OAuthProviderRow`.

- [ ] **Step 7: Check dependency pin remains exact**

Run:

```powershell
node -e "const p=require('./package.json'); console.log(p.dependencies['better-auth'],p.dependencies['@better-auth/passkey']); if(p.dependencies['better-auth']!=='1.6.23'||p.dependencies['@better-auth/passkey']!=='1.6.23') process.exit(1)"
```

Expected: prints `1.6.23 1.6.23` and exits 0.

- [ ] **Step 8: Commit final verification-only docs note only if needed**

No docs update is required unless implementation discovers a behavior not covered by the approved spec.

- [ ] **Step 9: Confirm clean worktree**

Run:

```powershell
git status --short
```

Expected: clean worktree.

---

## Completion Notes

After Task 7 passes, report the exact verification outputs and commit hashes. Do not mark the overall long-running goal complete; continue to the next sequential整改 item after updating the plan state.
