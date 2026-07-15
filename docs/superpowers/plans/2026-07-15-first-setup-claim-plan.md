# First Setup Claim Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Steps use checkbox (`- [ ]`) syntax for tracking. Do not dispatch subagents for this repository task.

**Goal:** 用 D1 单例状态机、Better Auth 创建门禁、credential 完成触发器和可恢复清理，保证首次管理员初始化只有一个胜者，且普通邮箱/OAuth 注册不能抢占首用户。

**Architecture:** `first_setup` 固定单行保存 `open -> claimed -> completed` 状态；setup 路由只持有内存中的明文 claim token，数据库仅保存 SHA-256。Better Auth `user.create.before` 在分配用户 ID 前执行统一门禁，setup 用户插入时直接写入管理员字段，`account` credential 触发器原子完成初始化；拥有者释放与 10 分钟超时协调负责清理无 credential 的孤儿用户。

**Tech Stack:** TypeScript 7、Hono 4、Better Auth 1.6.23、Cloudflare Workers/D1（SQLite）、Miniflare 4、Vitest 4、Wrangler 4、pnpm。

---

## 文件结构与职责

### 创建

- `migrations/0011_first_setup_claim.sql`：建立 `first_setup` 单例状态表、状态约束、completed 终态保护触发器和 credential 完成触发器；迁移时区分空库与已有用户库。
- `src/services/first-setup.ts`：唯一的初始化状态机边界，负责读取、协调、原子认领、token 校验、用户 ID 绑定、完成门禁、拥有者释放以及安全日志事件。
- `tests/first-setup-migration.test.ts`：验证迁移初始化、约束、终态保护、触发器和禁止破坏性 SQL。
- `tests/first-setup-service.test.ts`：验证 token、并发认领、绑定、释放、超时恢复、幂等性及 cleanup/credential 竞态。
- `tests/better-auth-first-setup-hooks.test.ts`：验证 Better Auth Hook 在分配 ID 前门禁、setup 直接赋权、OAuth 冲突和 completed 回归。
- `tests/first-setup-routes.test.ts`：验证 setup/邮箱/OAuth/页面入口、并发、失败补偿、固定错误和日志隐私。

### 修改

- `tests/helpers/d1.ts`：支持只应用到指定迁移、单独应用迁移，以及显式把 OAuth 回归测试库标记为 completed。
- `tests/better-auth-oauth-hooks.test.ts`：现有 OAuth Hook 场景显式进入 completed，保持“初始化后”测试语义。
- `tests/oauth-registration-routes.test.ts`：现有 OAuth 路由场景显式进入 completed，避免被新门禁误判为未初始化。
- `src/auth.ts`：增加内部 `AuthCreationContext`，在 `user.create.before` 中先执行初始化门禁，再分配 ID；setup 上下文直接写管理员字段。
- `src/routes/auth.ts`：重构 setup 路由，给邮箱、验证码和 OAuth 注册增加无副作用前置门禁，并采用安全初始化日志。
- `src/routes/pages.ts`：使用 `first_setup.status` 替代 `countUsers()` 作为页面初始化真相来源。
- `src/services/dns-records.ts`：删除整改后无引用的 `countUsers` 与 `setSuperAdmin`；保留后台管理仍使用的 `listAllUsers` 与 `setUserRole`。
- `README.md`：补充 `0011`、初始化状态机、10 分钟恢复和隐私边界。

## 稳定公共 API

`src/services/first-setup.ts` 必须导出：

```ts
export const FIRST_SETUP_CLAIM_TTL_MS = 10 * 60 * 1000

export type FirstSetupStatus = 'open' | 'claimed' | 'completed'
export type FirstSetupStage =
  | 'claim'
  | 'bind-user'
  | 'create-user'
  | 'release'
  | 'reconcile'
  | 'guard'

export type FirstSetupState = {
  status: FirstSetupStatus
  claimedAt: number | null
  claimedUserId: string | null
  completedAt: number | null
}

export type FirstSetupClaim = { token: string; expiresAt: number }

export class FirstSetupError extends Error {
  readonly code:
    | 'SETUP_DONE'
    | 'SETUP_IN_PROGRESS'
    | 'SETUP_NOT_READY'
    | 'SETUP_CLAIM_INVALID'
    | 'SETUP_INCONSISTENT'
    | 'SETUP_FAILED'
}

export async function getFirstSetupState(db: D1Database): Promise<FirstSetupState>
export async function reconcileFirstSetup(db: D1Database, now?: number): Promise<FirstSetupState>
export async function claimFirstSetup(db: D1Database, now?: number): Promise<FirstSetupClaim>
export async function assertFirstSetupClaimActive(db: D1Database, token: string, now?: number): Promise<void>
export async function bindFirstSetupUser(
  db: D1Database,
  input: { token: string; userId: string; now?: number }
): Promise<void>
export async function assertFirstSetupCompleted(db: D1Database): Promise<void>
export async function releaseOwnedFirstSetupClaim(
  db: D1Database,
  token: string
): Promise<FirstSetupState>
export function createFirstSetupSecurityEvent(
  error: unknown,
  input: { stage: FirstSetupStage; now?: number }
): {
  event: 'first_setup_security'
  code: FirstSetupError['code']
  stage: FirstSetupStage
  timestamp: string
}
```

`src/auth.ts` 必须公开：

```ts
export type AuthCreationContext = {
  firstSetupClaimToken?: string
}

export async function createAuth(
  env: AuthBindings,
  oauthProviders?: OAuthProviderRow[],
  creationContext: AuthCreationContext = {}
)
```

---

### Task 1: 扩展 D1 测试迁移基础设施

**Files:**
- Modify: `tests/helpers/d1.ts`
- Test: `tests/first-setup-migration.test.ts`

- [ ] **Step 1: 写 selective migration 的失败测试**

创建 `tests/first-setup-migration.test.ts`，先只覆盖辅助器契约：

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { createTestD1, applyMigrationFile, type TestD1 } from './helpers/d1'

const instances: TestD1[] = []
afterEach(async () => Promise.all(instances.splice(0).map((item) => item.dispose())))

describe('first setup migration', () => {
  it('can stop before 0011 and apply it explicitly', async () => {
    const instance = await createTestD1({ through: '0010_oauth_registration_intents.sql' })
    instances.push(instance)
    expect(await instance.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'first_setup'"
    ).first()).toBeNull()

    await applyMigrationFile(instance.db, '0011_first_setup_claim.sql')
    expect(await instance.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'first_setup'"
    ).first()).toEqual({ name: 'first_setup' })
  })
})
```

- [ ] **Step 2: 运行测试并确认失败原因是辅助器 API/迁移不存在**

Run: `pnpm exec vitest run tests/first-setup-migration.test.ts`  
Expected: FAIL；TypeScript/运行时指出 `createTestD1` 不接受参数、`applyMigrationFile` 未导出，或 `0011_first_setup_claim.sql` 不存在。

- [ ] **Step 3: 最小实现 migration helper**

将 `tests/helpers/d1.ts` 的迁移循环提取为以下 API；`through` 包含指定文件本身，未知文件必须抛错：

```ts
export type MigrationOptions = { through?: string }

export async function applyMigrationFile(db: D1Database, file: string): Promise<void> {
  const path = resolve(process.cwd(), 'migrations', file)
  const sql = (await readFile(path, 'utf8')).replace(/\r\n/g, '\n')
  const statements = unstable_splitSqlQuery(sql)
  if (statements.length > 0) {
    await db.batch(statements.map((statement) => db.prepare(statement)))
  }
}

export async function applyMigrations(
  db: D1Database,
  options: MigrationOptions = {}
): Promise<void> {
  const dir = resolve(process.cwd(), 'migrations')
  const files = (await readdir(dir)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()
  const selected = options.through
    ? files.slice(0, files.indexOf(options.through) + 1)
    : files
  if (options.through && !files.includes(options.through)) {
    throw new Error('Unknown migration: ' + options.through)
  }
  for (const file of selected) await applyMigrationFile(db, file)
}

export async function createTestD1(options: MigrationOptions = {}): Promise<TestD1> {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-07-08',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: crypto.randomUUID() }
  })
  const db = await mf.getD1Database('DB')
  await applyMigrations(db, options)
  return { db, dispose: async () => mf.dispose() }
}
```

- [ ] **Step 4: 再运行目标测试**

Run: `pnpm exec vitest run tests/first-setup-migration.test.ts`  
Expected: 仍 FAIL，但唯一失败应是 `0011_first_setup_claim.sql` 不存在；辅助器类型错误消失。


- [ ] **Step 5: 提交测试辅助器（暂不提交红测）**

Run: `git add tests/helpers/d1.ts && git commit -m "test: support selective D1 migrations"`  
Expected: commit succeeds；`tests/first-setup-migration.test.ts` 保持未暂存，供下一任务继续 TDD。

---

### Task 2: 增加首次初始化迁移、约束和完成触发器

**Files:**
- Create: `migrations/0011_first_setup_claim.sql`
- Modify: `tests/first-setup-migration.test.ts`

- [ ] **Step 1: 扩充迁移失败测试**

在已有测试顶部补充 `import { readFile } from 'node:fs/promises'`、`import { resolve } from 'node:path'`，并增加以下场景：

```ts
it('initializes an empty database as open', async () => {
  const instance = await createTestD1()
  instances.push(instance)
  expect(await instance.db.prepare(
    'SELECT status, claim_token_hash, claimed_at, claimed_user_id, completed_at FROM first_setup WHERE id = 1'
  ).first()).toEqual({
    status: 'open', claim_token_hash: null, claimed_at: null,
    claimed_user_id: null, completed_at: null
  })
})

it('initializes an existing database as completed without reopening setup', async () => {
  const instance = await createTestD1({ through: '0010_oauth_registration_intents.sql' })
  instances.push(instance)
  const now = Date.now()
  await instance.db.prepare(
    `INSERT INTO user
     (id, name, email, emailVerified, createdAt, updatedAt, role, super_admin)
     VALUES ('9001', 'Existing', 'existing@example.test', 1, ?, ?, 'admin', 1)`
  ).bind(now, now).run()
  await applyMigrationFile(instance.db, '0011_first_setup_claim.sql')
  const state = await instance.db.prepare(
    'SELECT status, claim_token_hash, completed_at FROM first_setup WHERE id = 1'
  ).first<Record<string, unknown>>()
  expect(state?.status).toBe('completed')
  expect(state?.claim_token_hash).toBeNull()
  expect(Number(state?.completed_at)).toBeGreaterThan(0)
})

it('enforces singleton and legal state combinations', async () => {
  const instance = await createTestD1()
  instances.push(instance)
  await expect(instance.db.prepare(
    "INSERT INTO first_setup (id, status) VALUES (2, 'open')"
  ).run()).rejects.toThrow()
  await expect(instance.db.prepare(
    "UPDATE first_setup SET status = 'claimed' WHERE id = 1"
  ).run()).rejects.toThrow()
})

it('does not allow completed to reopen', async () => {
  const instance = await createTestD1({ through: '0010_oauth_registration_intents.sql' })
  instances.push(instance)
  const now = Date.now()
  await instance.db.prepare(
    `INSERT INTO user
     (id, name, email, emailVerified, createdAt, updatedAt, role, super_admin)
     VALUES ('9001', 'Existing', 'existing@example.test', 1, ?, ?, 'admin', 1)`
  ).bind(now, now).run()
  await applyMigrationFile(instance.db, '0011_first_setup_claim.sql')
  await expect(instance.db.prepare(
    "UPDATE first_setup SET status = 'open', completed_at = NULL WHERE id = 1"
  ).run()).rejects.toThrow(/first_setup_completed_is_final/)
})

it('completes only for the claimed super administrator credential', async () => {
  const instance = await createTestD1()
  instances.push(instance)
  const now = Date.now()
  await instance.db.prepare(
    "UPDATE first_setup SET status='claimed', claim_token_hash='hash', claimed_at=?, claimed_user_id='1' WHERE id=1"
  ).bind(now).run()
  await instance.db.prepare(
    `INSERT INTO user
     (id, name, email, emailVerified, createdAt, updatedAt, role, super_admin)
     VALUES ('1', 'Setup', 'setup@example.test', 0, ?, ?, 'admin', 1)`
  ).bind(now, now).run()

  await instance.db.prepare(
    `INSERT INTO account
     (id, accountId, providerId, userId, password, createdAt, updatedAt)
     VALUES ('oauth', 'oauth', 'fixture', '1', NULL, ?, ?)`
  ).bind(now, now).run()
  expect((await instance.db.prepare('SELECT status FROM first_setup WHERE id=1').first())?.status)
    .toBe('claimed')

  await instance.db.prepare(
    `INSERT INTO account
     (id, accountId, providerId, userId, password, createdAt, updatedAt)
     VALUES ('credential', '1', 'credential', '1', 'hashed', ?, ?)`
  ).bind(now, now).run()
  expect(await instance.db.prepare(
    'SELECT status, claim_token_hash, claimed_user_id FROM first_setup WHERE id=1'
  ).first()).toEqual({ status: 'completed', claim_token_hash: null, claimed_user_id: '1' })
})

it('contains no destructive schema statements', async () => {
  const sql = await readFile(resolve(process.cwd(), 'migrations/0011_first_setup_claim.sql'), 'utf8')
  expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i)
})
```

补充一个“非 claimed 用户、普通角色用户、错误 userId credential 均不完成”的表驱动断言，不通过直接改写 completed 状态来绕过触发器。

- [ ] **Step 2: 运行迁移测试确认失败**

Run: `pnpm exec vitest run tests/first-setup-migration.test.ts`  
Expected: FAIL，原因是迁移文件不存在或表/触发器不存在。

- [ ] **Step 3: 写完整迁移**

创建 `migrations/0011_first_setup_claim.sql`，使用以下确定性结构：

```sql
-- Migration: 0011_first_setup_claim
-- Atomic first-administrator claim state and credential completion.

CREATE TABLE "first_setup" (
  "id" INTEGER PRIMARY KEY NOT NULL CHECK ("id" = 1),
  "status" TEXT NOT NULL CHECK ("status" IN ('open', 'claimed', 'completed')),
  "claim_token_hash" TEXT,
  "claimed_at" INTEGER,
  "claimed_user_id" TEXT,
  "completed_at" INTEGER,
  CHECK (
    ("status" = 'open'
      AND "claim_token_hash" IS NULL
      AND "claimed_at" IS NULL
      AND "claimed_user_id" IS NULL
      AND "completed_at" IS NULL)
    OR
    ("status" = 'claimed'
      AND "claim_token_hash" IS NOT NULL
      AND "claimed_at" IS NOT NULL
      AND "completed_at" IS NULL)
    OR
    ("status" = 'completed'
      AND "claim_token_hash" IS NULL
      AND "completed_at" IS NOT NULL)
  )
);

INSERT INTO "first_setup"
  ("id", "status", "claim_token_hash", "claimed_at", "claimed_user_id", "completed_at")
SELECT
  1,
  CASE WHEN EXISTS (SELECT 1 FROM "user") THEN 'completed' ELSE 'open' END,
  NULL,
  NULL,
  NULL,
  CASE
    WHEN EXISTS (SELECT 1 FROM "user")
    THEN CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    ELSE NULL
  END;

CREATE TRIGGER "first_setup_completed_is_final"
BEFORE UPDATE ON "first_setup"
WHEN OLD."status" = 'completed' AND NEW."status" <> 'completed'
BEGIN
  SELECT RAISE(ABORT, 'first_setup_completed_is_final');
END;

CREATE TRIGGER "first_setup_row_cannot_be_deleted"
BEFORE DELETE ON "first_setup"
BEGIN
  SELECT RAISE(ABORT, 'first_setup_row_cannot_be_deleted');
END;

CREATE TRIGGER "first_setup_complete_on_credential"
AFTER INSERT ON "account"
WHEN NEW."providerId" = 'credential'
BEGIN
  UPDATE "first_setup"
  SET
    "status" = 'completed',
    "claim_token_hash" = NULL,
    "completed_at" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE "id" = 1
    AND "status" = 'claimed'
    AND "claimed_user_id" = NEW."userId"
    AND EXISTS (
      SELECT 1 FROM "user"
      WHERE "id" = NEW."userId"
        AND "role" = 'admin'
        AND COALESCE("super_admin", 0) = 1
    );
END;
```

约束测试若表明 D1 对 `julianday` 毫秒取整有差异，只允许把时间表达式改为等价的 SQLite 毫秒表达式，不得删除状态约束或触发条件。

- [ ] **Step 4: 运行迁移测试并修正 SQL 兼容性**

Run: `pnpm exec vitest run tests/first-setup-migration.test.ts`  
Expected: PASS；空库 open、已有用户 completed、约束和两个触发器均通过。

- [ ] **Step 5: 检查迁移语法与破坏性操作**

Run: `rg -n "DROP\\s+(TABLE|COLUMN)|DELETE\\s+FROM\\s+user" migrations/0011_first_setup_claim.sql`  
Expected: no output。

- [ ] **Step 6: 提交迁移与测试**

Run: `git add migrations/0011_first_setup_claim.sql tests/first-setup-migration.test.ts && git commit -m "feat: add first setup claim schema"`  
Expected: commit succeeds。

---

### Task 3: 实现状态读取、原子 claim 和安全错误事件

**Files:**
- Create: `src/services/first-setup.ts`
- Create: `tests/first-setup-service.test.ts`

- [ ] **Step 1: 写读取、token、并发和隐私失败测试**

创建 `tests/first-setup-service.test.ts`。测试必须包含：

```ts
import { afterEach, describe, expect, it } from 'vitest'
import {
  FIRST_SETUP_CLAIM_TTL_MS,
  claimFirstSetup,
  createFirstSetupSecurityEvent,
  getFirstSetupState
} from '../src/services/first-setup'
import { createTestD1, type TestD1 } from './helpers/d1'

const instances: TestD1[] = []
afterEach(async () => Promise.all(instances.splice(0).map((item) => item.dispose())))

async function setup() {
  const instance = await createTestD1()
  instances.push(instance)
  return instance.db
}

it('stores only a SHA-256 hash of a 32-byte claim token', async () => {
  const db = await setup()
  const claim = await claimFirstSetup(db, 1_000)
  const bytes = Uint8Array.from(atob(claim.token), (char) => char.charCodeAt(0))
  expect(bytes).toHaveLength(32)
  expect(claim.expiresAt).toBe(1_000 + FIRST_SETUP_CLAIM_TTL_MS)
  const row = await db.prepare(
    'SELECT claim_token_hash, claimed_at FROM first_setup WHERE id=1'
  ).first<{ claim_token_hash: string; claimed_at: number }>()
  expect(row?.claim_token_hash).toMatch(/^[0-9a-f]{64}$/)
  expect(row?.claim_token_hash).not.toBe(claim.token)
  expect(row?.claimed_at).toBe(1_000)
})

it('allows exactly one concurrent claimant', async () => {
  const db = await setup()
  const results = await Promise.allSettled([
    claimFirstSetup(db, 2_000),
    claimFirstSetup(db, 2_000)
  ])
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  const rejection = results.find((result) => result.status === 'rejected')
  expect(rejection && rejection.status === 'rejected' && rejection.reason)
    .toMatchObject({ code: 'SETUP_IN_PROGRESS' })
})

it('serializes only allowlisted security event fields', () => {
  const secretError = Object.assign(new Error('raw-secret-message'), {
    email: 'private@example.test', token: 'clear-token', stack: 'secret-stack'
  })
  const event = createFirstSetupSecurityEvent(secretError, { stage: 'claim', now: 0 })
  expect(event).toEqual({
    event: 'first_setup_security', code: 'SETUP_FAILED',
    stage: 'claim', timestamp: '1970-01-01T00:00:00.000Z'
  })
  expect(JSON.stringify(event)).not.toMatch(/private|clear-token|raw-secret|secret-stack/)
})
```

另加：初始 `getFirstSetupState` 返回 open；completed 返回 `SETUP_DONE`；数据库已有 user 但状态 open 时 claim 失败为 `SETUP_DONE`；第二 claim 不覆盖首个哈希。

- [ ] **Step 2: 运行服务测试确认失败**

Run: `pnpm exec vitest run tests/first-setup-service.test.ts`  
Expected: FAIL，原因是 `src/services/first-setup.ts` 不存在。


- [ ] **Step 3: 实现类型、哈希、状态读取、原子认领和错误归一化**

在 `src/services/first-setup.ts` 中先实现本任务所需最小逻辑：

```ts
export const FIRST_SETUP_CLAIM_TTL_MS = 10 * 60 * 1000

export type FirstSetupStatus = 'open' | 'claimed' | 'completed'
export type FirstSetupStage =
  | 'claim' | 'bind-user' | 'create-user' | 'release' | 'reconcile' | 'guard'
export type FirstSetupState = {
  status: FirstSetupStatus
  claimedAt: number | null
  claimedUserId: string | null
  completedAt: number | null
}
export type FirstSetupClaim = { token: string; expiresAt: number }

type FirstSetupErrorCode =
  | 'SETUP_DONE' | 'SETUP_IN_PROGRESS' | 'SETUP_NOT_READY'
  | 'SETUP_CLAIM_INVALID' | 'SETUP_INCONSISTENT' | 'SETUP_FAILED'

export class FirstSetupError extends Error {
  constructor(readonly code: FirstSetupErrorCode) {
    super(code)
    this.name = 'FirstSetupError'
  }
}

type StateRow = {
  status: FirstSetupStatus
  claimed_at: number | null
  claimed_user_id: string | null
  completed_at: number | null
}

function asFirstSetupError(error: unknown): FirstSetupError {
  return error instanceof FirstSetupError ? error : new FirstSetupError('SETUP_FAILED')
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function getFirstSetupState(db: D1Database): Promise<FirstSetupState> {
  const row = await db.prepare(
    'SELECT status, claimed_at, claimed_user_id, completed_at FROM first_setup WHERE id=1'
  ).first<StateRow>()
  if (!row) throw new FirstSetupError('SETUP_INCONSISTENT')
  return {
    status: row.status,
    claimedAt: row.claimed_at == null ? null : Number(row.claimed_at),
    claimedUserId: row.claimed_user_id,
    completedAt: row.completed_at == null ? null : Number(row.completed_at)
  }
}

export async function claimFirstSetup(
  db: D1Database,
  now = Date.now()
): Promise<FirstSetupClaim> {
  await reconcileFirstSetup(db, now)
  const token = randomToken()
  const tokenHash = await sha256Hex(token)
  const result = await db.prepare(
    `UPDATE first_setup
     SET status='claimed', claim_token_hash=?, claimed_at=?,
         claimed_user_id=NULL, completed_at=NULL
     WHERE id=1 AND status='open'
       AND NOT EXISTS (SELECT 1 FROM user)`
  ).bind(tokenHash, now).run()
  if (Number(result.meta.changes ?? 0) === 1) {
    return { token, expiresAt: now + FIRST_SETUP_CLAIM_TTL_MS }
  }
  const user = await db.prepare('SELECT 1 AS present FROM user LIMIT 1').first()
  const state = await getFirstSetupState(db)
  if (state.status === 'completed' || user) throw new FirstSetupError('SETUP_DONE')
  if (state.status === 'claimed') throw new FirstSetupError('SETUP_IN_PROGRESS')
  throw new FirstSetupError('SETUP_INCONSISTENT')
}

export function createFirstSetupSecurityEvent(
  error: unknown,
  input: { stage: FirstSetupStage; now?: number }
) {
  return {
    event: 'first_setup_security' as const,
    code: asFirstSetupError(error).code,
    stage: input.stage,
    timestamp: new Date(input.now ?? Date.now()).toISOString()
  }
}
```

本任务加入以下明确实现，仅负责读取且不改变未过期 claim；Task 4 将以测试驱动方式扩展同一函数的 stale/credential 协调分支：

```ts
export async function reconcileFirstSetup(
  db: D1Database,
  _now = Date.now()
): Promise<FirstSetupState> {
  return await getFirstSetupState(db)
}
```

不得在错误对象上保存 token/hash 或原始 cause。

- [ ] **Step 4: 运行服务测试**

Run: `pnpm exec vitest run tests/first-setup-service.test.ts`  
Expected: PASS；重复执行一次仍 PASS。

- [ ] **Step 5: 类型检查服务边界**

Run: `pnpm exec tsc --noEmit`  
Expected: PASS。

- [ ] **Step 6: 提交原子 claim**

Run: `git add src/services/first-setup.ts tests/first-setup-service.test.ts && git commit -m "feat: add atomic first setup claims"`  
Expected: commit succeeds。

---

### Task 4: 实现绑定、完成协调、拥有者释放和超时恢复

**Files:**
- Modify: `src/services/first-setup.ts`
- Modify: `tests/first-setup-service.test.ts`

- [ ] **Step 1: 写绑定与有效期失败测试**

增加测试：正确 token 在 TTL 内绑定一次；错误 token、过期 token、非 claimed 状态失败；第二个 userId 不能覆盖首次绑定；clear token 不出现在数据库结果中。核心断言：

```ts
const claim = await claimFirstSetup(db, 10_000)
await bindFirstSetupUser(db, { token: claim.token, userId: '1', now: 10_001 })
expect(await getFirstSetupState(db)).toMatchObject({
  status: 'claimed', claimedUserId: '1'
})
await expect(bindFirstSetupUser(db, {
  token: claim.token, userId: '2', now: 10_002
})).rejects.toMatchObject({ code: 'SETUP_CLAIM_INVALID' })
```

- [ ] **Step 2: 写 owner release 与 stale reconcile 失败测试**

覆盖四组状态：

1. 未绑定 owner：`releaseOwnedFirstSetupClaim` 恢复 open。
2. 已绑定、无 credential：删除 setup user 并恢复 open。
3. 已有 credential/completed：release 不删除用户、不回退 completed。
4. claimed 未过期：`reconcileFirstSetup` 不抢占；超过 `FIRST_SETUP_CLAIM_TTL_MS` 后，无 credential 恢复 open，有 credential 协调 completed。

插入 setup fixture 时必须直接使用 `role='admin', super_admin=1`；不得通过现有 `setUserRole` 提升。

- [ ] **Step 3: 写 cleanup 与 credential 插入竞态失败测试**

每轮新建独立 D1，先 claim、bind、插入管理员 user，再并发执行：

```ts
const results = await Promise.allSettled([
  releaseOwnedFirstSetupClaim(db, claim.token),
  db.prepare(
    `INSERT INTO account
     (id, accountId, providerId, userId, password, createdAt, updatedAt)
     VALUES (?, ?, 'credential', ?, 'hashed', ?, ?)`
  ).bind(crypto.randomUUID(), '1', '1', now, now).run()
])
const state = await getFirstSetupState(db)
const userCount = Number((await db.prepare('SELECT COUNT(*) AS n FROM user').first<{ n: number }>())?.n)
const credentialCount = Number((await db.prepare(
  "SELECT COUNT(*) AS n FROM account WHERE providerId='credential'"
).first<{ n: number }>())?.n)
expect([
  { status: 'completed', users: 1, credentials: 1 },
  { status: 'open', users: 0, credentials: 0 }
]).toContainEqual({ status: state.status, users: userCount, credentials: credentialCount })
expect(results.some((result) => result.status === 'fulfilled')).toBe(true)
```

该测试循环至少 20 次以覆盖 D1 调度差异；另对 `releaseOwnedFirstSetupClaim` 和 `reconcileFirstSetup` 各重复调用两次验证幂等。

- [ ] **Step 4: 运行新增测试确认失败**

Run: `pnpm exec vitest run tests/first-setup-service.test.ts`  
Expected: FAIL，缺少绑定/释放/真实协调实现。

- [ ] **Step 5: 实现 claim 校验和一次性用户绑定**

新增内部 `readClaimRow`；所有 token 比较只比较 SHA-256 十六进制值。绑定使用单条条件更新：

```ts
export async function assertFirstSetupClaimActive(
  db: D1Database,
  token: string,
  now = Date.now()
): Promise<void> {
  const hash = await sha256Hex(token)
  const row = await db.prepare(
    `SELECT claimed_at FROM first_setup
     WHERE id=1 AND status='claimed' AND claim_token_hash=?`
  ).bind(hash).first<{ claimed_at: number }>()
  if (!row || now - Number(row.claimed_at) >= FIRST_SETUP_CLAIM_TTL_MS) {
    throw new FirstSetupError('SETUP_CLAIM_INVALID')
  }
}

export async function bindFirstSetupUser(
  db: D1Database,
  input: { token: string; userId: string; now?: number }
): Promise<void> {
  const now = input.now ?? Date.now()
  const hash = await sha256Hex(input.token)
  const result = await db.prepare(
    `UPDATE first_setup
     SET claimed_user_id=?
     WHERE id=1 AND status='claimed' AND claim_token_hash=?
       AND claimed_user_id IS NULL
       AND claimed_at > ?
       AND NOT EXISTS (SELECT 1 FROM user)`
  ).bind(input.userId, hash, now - FIRST_SETUP_CLAIM_TTL_MS).run()
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new FirstSetupError('SETUP_CLAIM_INVALID')
  }
}
```

- [ ] **Step 6: 实现 completed 门禁和幂等协调**

`assertFirstSetupCompleted` 必须先调用 `reconcileFirstSetup`，仅 completed 返回；open/claimed 统一抛 `SETUP_NOT_READY`。`reconcileFirstSetup` 顺序为：

1. 若 completed，直接返回。
2. 若 claimed 且绑定用户存在 credential、且用户为 admin/super_admin，条件更新为 completed。
3. 若 claimed 未超时，直接返回。
4. 若 stale 且无 credential，执行条件 `db.batch()`：删除认领 user，再把仍属于同一 hash/claimed_at/userId 的状态恢复 open。
5. 批处理后重读；credential 存在但权限不符合触发器条件时抛 `SETUP_INCONSISTENT`，不得删除完整 credential 用户或重新开放。

完成协调 SQL 清空 `claim_token_hash`，保留 `claimed_user_id`，写入传入 `now` 作为 `completed_at`。

- [ ] **Step 7: 实现拥有者安全释放**

`releaseOwnedFirstSetupClaim` 计算 owner hash，先尝试幂等完成，再通过 D1 batch 执行以下语义：

```sql
DELETE FROM user
WHERE id = (
  SELECT claimed_user_id FROM first_setup
  WHERE id=1 AND status='claimed' AND claim_token_hash=?
)
AND NOT EXISTS (
  SELECT 1 FROM account
  WHERE userId=user.id AND providerId='credential'
);

UPDATE first_setup
SET status='open', claim_token_hash=NULL, claimed_at=NULL,
    claimed_user_id=NULL, completed_at=NULL
WHERE id=1 AND status='claimed' AND claim_token_hash=?
  AND (
    claimed_user_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM user WHERE id=first_setup.claimed_user_id)
  )
  AND NOT EXISTS (
    SELECT 1 FROM account
    WHERE userId=first_setup.claimed_user_id AND providerId='credential'
  );
```

两条语句必须绑定同一个 hash；不得先读取 userId 后无条件删除。batch 完成后调用 `reconcileFirstSetup` 并返回状态。

- [ ] **Step 8: 运行服务竞态测试**

Run: `pnpm exec vitest run tests/first-setup-service.test.ts --testTimeout=20000`  
Expected: PASS；20 轮竞态全部只落入两个合法终态。

- [ ] **Step 9: 连续运行服务测试五次**

Run: `1..5 | ForEach-Object { pnpm exec vitest run tests/first-setup-service.test.ts --testTimeout=20000; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }`  
Expected: 五次全部 PASS。

- [ ] **Step 10: 提交恢复逻辑**

Run: `git add src/services/first-setup.ts tests/first-setup-service.test.ts && git commit -m "feat: recover interrupted first setup claims"`  
Expected: commit succeeds。


---

### Task 5: 为既有 OAuth 回归测试显式建立 completed 前置条件

**Files:**
- Modify: `tests/helpers/d1.ts`
- Modify: `tests/better-auth-oauth-hooks.test.ts`
- Modify: `tests/oauth-registration-routes.test.ts`

- [ ] **Step 1: 写 helper 行为测试**

在 `tests/first-setup-migration.test.ts` 的 helper import 中加入 `markFirstSetupCompleted`，并增加：

```ts
it('marks an open fixture as completed only for initialized-flow tests', async () => {
  const instance = await createTestD1()
  instances.push(instance)
  await markFirstSetupCompleted(instance.db)
  expect(await instance.db.prepare(
    'SELECT status, claim_token_hash, completed_at FROM first_setup WHERE id=1'
  ).first()).toMatchObject({ status: 'completed', claim_token_hash: null })
})
```

- [ ] **Step 2: 实现显式 helper**

在 `tests/helpers/d1.ts` 增加：

```ts
export async function markFirstSetupCompleted(db: D1Database): Promise<void> {
  await db.prepare(
    `UPDATE first_setup
     SET status='completed', claim_token_hash=NULL, claimed_at=NULL,
         claimed_user_id=NULL, completed_at=?
     WHERE id=1 AND status <> 'completed'`
  ).bind(Date.now()).run()
}
```

该 helper 只供测试显式调用；禁止在 `createTestD1()` 默认调用，否则 open 状态测试失真。

- [ ] **Step 3: 更新现有 OAuth suite setup**

在两个 suite 的 `setup()` 中，创建 D1 后立即执行：

```ts
await markFirstSetupCompleted(instance.db)
```

并更新 import。这个调用必须先于任何 OAuth/邮箱用户创建；`seedUser` 仍按原场景使用。

- [ ] **Step 4: 运行现有回归测试**

Run: `pnpm exec vitest run tests/first-setup-migration.test.ts tests/better-auth-oauth-hooks.test.ts tests/oauth-registration-routes.test.ts`  
Expected: PASS；OAuth 测试数量与现状相同，不因新 helper 被跳过。

- [ ] **Step 5: 提交测试前置条件**

Run: `git add tests/helpers/d1.ts tests/first-setup-migration.test.ts tests/better-auth-oauth-hooks.test.ts tests/oauth-registration-routes.test.ts && git commit -m "test: model completed setup in auth fixtures"`  
Expected: commit succeeds。

---

### Task 6: 在 Better Auth Hook 中建立最终用户创建门禁

**Files:**
- Modify: `src/auth.ts`
- Create: `tests/better-auth-first-setup-hooks.test.ts`
- Modify: `tests/better-auth-oauth-hooks.test.ts`

- [ ] **Step 1: 写普通创建门禁与 ID 不消耗测试**

创建 `tests/better-auth-first-setup-hooks.test.ts`，使用真实 D1 与 `createAuth`。验证 open 和 claimed 状态下普通 `signUpEmail` 均失败、user/account 都为 0、`user_id_counter.value` 仍为 0：

```ts
it.each(['open', 'claimed'] as const)(
  'blocks ordinary email creation while setup is %s before allocating an id',
  async (status) => {
    const { db, env } = await setupOpen()
    if (status === 'claimed') await claimFirstSetup(db)
    const auth = await createAuth(env)
    await expect(auth.api.signUpEmail({
      body: { name: 'Blocked', email: 'blocked@example.test', password: 'password123' }
    })).rejects.toMatchObject({ message: 'SETUP_NOT_READY' })
    expect(await counts(db)).toEqual({ users: 0, accounts: 0, nextId: 0 })
  }
)
```

Better Auth 若把 Hook error 包装为 APIError，测试只断言外层固定安全码 `SETUP_NOT_READY` 与数据库无副作用；不得读取或快照原始 `cause`、D1 文案或堆栈。

- [ ] **Step 2: 写 setup 插入即赋权和 credential 完成测试**

```ts
it('creates the claimed user as super administrator and completes on credential insert', async () => {
  const { db, env } = await setupOpen()
  const claim = await claimFirstSetup(db)
  const auth = await createAuth(env, undefined, { firstSetupClaimToken: claim.token })
  const result = await auth.api.signUpEmail({
    body: { name: 'Setup Admin', email: 'setup-admin@example.test', password: 'password123' }
  })
  expect(result.user.id).toBe('1')
  expect(await db.prepare(
    'SELECT role, super_admin FROM user WHERE id=?'
  ).bind(result.user.id).first()).toEqual({ role: 'admin', super_admin: 1 })
  expect(await getFirstSetupState(db)).toMatchObject({
    status: 'completed', claimedUserId: result.user.id
  })
})
```

- [ ] **Step 3: 写伪造/冲突/回归测试**

必须覆盖：

- 无 setup context 的首用户不能成为 admin。
- 错误或过期 token 的 setup context 不能创建用户，且不消耗 ID。
- 同一 token 第二次创建用户失败。
- setup context 与 `readGenericOAuthCallback(context)` 同时存在时，在 OAuth intent 授权前失败关闭。
- completed 后普通 email signup 仍获得顺序数字 ID 且 role=user/super_admin=0。
- completed 后现有 OAuth 注册完整流程仍通过。

为“同时存在”场景复用现有 generic OAuth fixture，构造 `createAuth(env, providers, { firstSetupClaimToken })` 后走 callback；断言 user、account、intent 均未被消费。

- [ ] **Step 4: 运行新 Hook 测试确认失败**

Run: `pnpm exec vitest run tests/better-auth-first-setup-hooks.test.ts`  
Expected: FAIL；普通 signup 当前仍可创建，`createAuth` 尚无第三参数。

- [ ] **Step 5: 扩展 createAuth 签名并在 ID 分配前门禁**

在 `src/auth.ts` 导入：

```ts
import {
  assertFirstSetupClaimActive,
  assertFirstSetupCompleted,
  bindFirstSetupUser,
  FirstSetupError
} from './services/first-setup'

export type AuthCreationContext = { firstSetupClaimToken?: string }
```

把 `createAuth` 改为三参数。`user.create.before` 的顺序必须精确为：

```ts
const callback = readGenericOAuthCallback(context)
const setupToken = creationContext.firstSetupClaimToken

if (setupToken && callback) {
  throw new FirstSetupError('SETUP_CLAIM_INVALID')
}
if (setupToken) {
  await assertFirstSetupClaimActive(env.DB, setupToken)
} else {
  await assertFirstSetupCompleted(env.DB)
}

const id = await allocateNextUserId(env.DB)

if (setupToken) {
  await bindFirstSetupUser(env.DB, { token: setupToken, userId: id })
  return { data: { ...user, id, role: 'admin', super_admin: 1 } }
}

if (callback) {
  try {
    await authorizeOAuthRegistrationIntent(env.DB, {
      token: callback.intentToken,
      providerId: callback.providerId,
      state: callback.state,
      userId: id
    })
  } catch (error) {
    logOAuthRegistrationFailure(error, callback.providerId)
    throw error
  }
}
return { data: { ...user, id } }
```

不要把 token 复制到 user、context metadata、异常或日志。普通创建路径的 `assertFirstSetupCompleted` 必须在 `allocateNextUserId` 前。

- [ ] **Step 6: 保持现有 OAuth after hook 不变**

`user.create.after` 的 `consumeAuthorizedOAuthRegistrationIntent` 逻辑和以下日志形式必须原样保留：

```ts
console.error(JSON.stringify(createOAuthRegistrationSecurityEvent(error, { providerId })))
```

不得改为 `console.error(error)`，不得把 state/token/email 放入事件。

- [ ] **Step 7: 运行 Hook 与 OAuth 回归测试**

Run: `pnpm exec vitest run tests/better-auth-first-setup-hooks.test.ts tests/better-auth-oauth-hooks.test.ts`  
Expected: PASS。

- [ ] **Step 8: 类型检查**

Run: `pnpm exec tsc --noEmit`  
Expected: PASS。

- [ ] **Step 9: 提交 Hook 门禁**

Run: `git add src/auth.ts tests/better-auth-first-setup-hooks.test.ts tests/better-auth-oauth-hooks.test.ts && git commit -m "fix: gate user creation on first setup"`  
Expected: commit succeeds。

---

### Task 7: 原子重构 setup 路由及失败补偿

**Files:**
- Modify: `src/routes/auth.ts`
- Create: `tests/first-setup-routes.test.ts`

- [ ] **Step 1: 写无效输入不认领测试**

用 `app.request` 和 `sameOriginJsonHeaders` 对 `POST /api/auth/setup` 测试缺字段、密码不一致、短密码。每次断言 400 固定业务消息，且：

```ts
expect(await getFirstSetupState(db)).toMatchObject({ status: 'open' })
expect(await db.prepare('SELECT COUNT(*) AS n FROM user').first()).toEqual({ n: 0 })
```

- [ ] **Step 2: 写成功、并发和固定错误测试**

至少覆盖：

- 成功返回 redirect `/` 或 `/login`，数据库恰好 1 user、1 credential，user 插入后最终为 admin/super_admin。
- 两个并发 setup 最多一个成功；另一个只能是 `SETUP_IN_PROGRESS` 或胜者已完成后的 `SETUP_DONE`。
- 重复运行并发场景 5 轮，每轮新建数据库。
- completed setup 返回 400 + `SETUP_DONE`，不泄露已有用户数据。
- held claimed setup 返回 409 + `SETUP_IN_PROGRESS`，数据库哈希不改变。

- [ ] **Step 3: 写 Better Auth 失败补偿测试**

为 route 提供可控故障点时不要改生产 API；用 `vi.spyOn` mock `createAuth` 不可行时，使用 D1 trigger 制造真实失败：

1. 用户插入前：把 `user_id_counter` 更新触发器设为 abort，断言 claim 立即回 open、无 user。
2. 用户插入后 credential 前：创建 `BEFORE INSERT ON account WHEN NEW.providerId='credential'` abort trigger，断言 route 返回固定 `SETUP_FAILED`、孤儿 user 被删除、状态 open。
3. 登录失败：只让 session 插入失败；管理员和 credential 保留、状态 completed，响应仍为“管理员已创建，请登录”的成功语义。

- [ ] **Step 4: 写日志与响应隐私测试**

注入包含姓名、邮箱、密码、clear token、hash、Cookie、IP、UA 和 stack 的错误；spy `console.error`。断言每条初始化错误日志都可 JSON parse 且 key 集合严格等于：

```ts
['event', 'code', 'stage', 'timestamp']
```

日志调用必须来自：

```ts
console.error(JSON.stringify(createFirstSetupSecurityEvent(error, { stage })))
```

响应不得包含原始错误文本、D1 表名、SQL、邮箱、密码或 token。

- [ ] **Step 5: 运行 route 测试确认失败**

Run: `pnpm exec vitest run tests/first-setup-routes.test.ts --testTimeout=20000`  
Expected: FAIL；当前 route 仍使用 `countUsers/listAllUsers/post-hoc promotion`。


- [ ] **Step 6: 增加固定错误映射与安全日志 helper**

在 `src/routes/auth.ts` 顶部增加：

```ts
import type { Context } from 'hono'
import {
  claimFirstSetup,
  createFirstSetupSecurityEvent,
  FirstSetupError,
  reconcileFirstSetup,
  releaseOwnedFirstSetupClaim,
  type FirstSetupStage
} from '../services/first-setup'

type AuthRouteContext = Context<{ Bindings: Bindings }>

function logFirstSetupFailure(error: unknown, stage: FirstSetupStage): void {
  console.error(JSON.stringify(createFirstSetupSecurityEvent(error, { stage })))
}

function firstSetupErrorResponse(c: AuthRouteContext, error: unknown): Response {
  const code = error instanceof FirstSetupError ? error.code : 'SETUP_FAILED'
  if (code === 'SETUP_DONE') return apiErr(c, '已完成初始化', 400, { code })
  if (code === 'SETUP_IN_PROGRESS') {
    return apiErr(c, '初始化正在进行，请稍后重试', 409, { code })
  }
  if (code === 'SETUP_NOT_READY') {
    return apiErr(c, '请先完成管理员初始化', 409, { code })
  }
  return apiErr(c, '创建管理员失败', 500, { code: 'SETUP_FAILED' })
}
```

`AuthRouteContext` 在同一代码块中定义并复用于 Task 8 的 guard；不得使用 `any` 规避 Hono context 类型。

- [ ] **Step 7: 按确定顺序重写 setup handler**

handler 必须按以下结构实现：

```ts
app.post('/api/auth/setup', async (c) => {
  const denied = await requireJsonMutation(c)
  if (denied) return denied

  const body = await readJsonBody(c)
  const name = String(body.name ?? '').trim()
  const email = String(body.email ?? '').trim()
  const password = String(body.password ?? '')
  const confirm = String(body.confirm ?? '')
  if (!name || !email || !password) return apiErr(c, '请填写完整')
  if (password !== confirm) return apiErr(c, '两次密码不一致')
  if (password.length < 8) return apiErr(c, '密码至少 8 位')

  let claim: Awaited<ReturnType<typeof claimFirstSetup>> | null = null
  try {
    await reconcileFirstSetup(c.env.DB)
    claim = await claimFirstSetup(c.env.DB)
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

    const signInRes = await auth.api.signInEmail({
      body: { email, password },
      headers: c.req.raw.headers,
      asResponse: true
    })
    return signInRes.ok
      ? apiOkWithHeaders(undefined, signInRes.headers, { redirect: '/', message: '初始化成功' })
      : apiOk(c, undefined, { redirect: '/login', message: '管理员已创建，请登录' })
  } catch (error) {
    logFirstSetupFailure(error, claim ? 'create-user' : 'claim')
    if (claim) {
      await releaseOwnedFirstSetupClaim(c.env.DB, claim.token).catch((releaseError) => {
        logFirstSetupFailure(releaseError, 'release')
      })
    }
    return firstSetupErrorResponse(c, error)
  }
})
```

实现时需要区分“signup 已成功、仅 signin 失败”：signin 的异常不得进入外层补偿并删除 completed 管理员。把 signin 放进独立 try/catch；失败只记录固定安全事件（stage `create-user`）并返回 `/login` 成功响应。删除所有 `listAllUsers`、`firstUser`、`setUserRole`、`setSuperAdmin` setup 分支。

- [ ] **Step 8: 运行 setup route 测试**

Run: `pnpm exec vitest run tests/first-setup-routes.test.ts --testTimeout=20000`  
Expected: PASS。

- [ ] **Step 9: 扫描旧的事后提升逻辑**

Run: `rg -n "firstUser|listAllUsers\(c\.env\.DB\)|setUserRole\(c\.env\.DB, newUser|setSuperAdmin\(c\.env\.DB, newUser" src/routes/auth.ts`  
Expected: no output。

- [ ] **Step 10: 提交 setup route**

Run: `git add src/routes/auth.ts tests/first-setup-routes.test.ts && git commit -m "fix: claim first administrator setup atomically"`  
Expected: commit succeeds。

---

### Task 8: 在所有普通注册入口产生副作用前拒绝未初始化状态

**Files:**
- Modify: `src/routes/auth.ts`
- Modify: `tests/first-setup-routes.test.ts`
- Modify: `tests/oauth-registration-routes.test.ts`

- [ ] **Step 1: 写邮箱注册开始前置门禁测试**

open 与 claimed 各测试 `POST /api/auth/register`。启用 Resend fixture 时断言：

- 返回 409 + `SETUP_NOT_READY`；
- `email_verification` 为 0；
- `invite_code.reserved_intent_id` 未变化；
- mailer/fetch 未调用；
- user/account 和 `user_id_counter` 均未变化。

- [ ] **Step 2: 写邮箱验证码确认门禁测试**

先在 completed fixture 建立待验证 row，再把测试库重建为 open/claimed 状态并提交 `/api/auth/verify-email`。断言在打开 sealed password、记录验证失败、消费邀请码或创建 user 前返回 `SETUP_NOT_READY`。不在响应或日志中出现 row.name、email、password sealed 值。

- [ ] **Step 3: 写 OAuth 注册开始门禁测试**

open/claimed 状态请求 `POST /api/auth/oauth/register`，断言返回 409 + `SETUP_NOT_READY`，且：

```ts
expect(await intentRows(db)).toHaveLength(0)
expect(fetchSpy).not.toHaveBeenCalled()
```

现有 completed OAuth route suite 继续通过。

- [ ] **Step 4: 写 OAuth callback 最终防线测试**

绕过 app-owned OAuth start，直接构造 generic callback（有合法 provider state 和 intent），在 open/claimed 状态触发新用户创建。断言 Hook 拒绝，user/account/session 为 0，intent 未 consumed。此测试放在 `tests/better-auth-first-setup-hooks.test.ts`；route 文件只验证 start 无副作用。

- [ ] **Step 5: 运行门禁测试确认失败**

Run: `pnpm exec vitest run tests/first-setup-routes.test.ts tests/better-auth-first-setup-hooks.test.ts`  
Expected: FAIL；三个 app-owned 注册入口尚未提前检查 completed。

- [ ] **Step 6: 在三个入口最前面调用统一 guard**

在 Task 7 已有 first-setup import 中加入 `assertFirstSetupCompleted`，然后新增 route helper：

```ts
async function requireFirstSetupCompleted(c: AuthRouteContext): Promise<Response | null> {
  try {
    await assertFirstSetupCompleted(c.env.DB)
    return null
  } catch (error) {
    if (error instanceof FirstSetupError && error.code === 'SETUP_NOT_READY') {
      return apiErr(c, '请先完成管理员初始化', 409, { code: error.code })
    }
    logFirstSetupFailure(error, 'guard')
    return apiErr(c, '初始化状态不可用', 503, { code: 'SETUP_NOT_READY' })
  }
}
```

调用位置：

1. `/api/auth/register`：CSRF/已登录检查后、`getSettings` 和 body 读取前。
2. `/api/auth/verify-email`：CSRF/已登录检查后、settings/body/rate-limit 查询前。
3. `/api/auth/oauth/register`：CSRF/已登录检查后、settings/body/provider/intent 前。

保持 Better Auth Hook 作为 callback/未来入口的最终防线。OAuth 登录入口不阻断已有账号登录，但其 callback 若尝试创建新用户会被 Hook 拒绝。

- [ ] **Step 7: 运行邮箱/OAuth 门禁与回归测试**

Run: `pnpm exec vitest run tests/first-setup-routes.test.ts tests/better-auth-first-setup-hooks.test.ts tests/oauth-registration-routes.test.ts tests/better-auth-oauth-hooks.test.ts --testTimeout=20000`  
Expected: PASS。

- [ ] **Step 8: 提交普通注册门禁**

Run: `git add src/routes/auth.ts tests/first-setup-routes.test.ts tests/better-auth-first-setup-hooks.test.ts tests/oauth-registration-routes.test.ts && git commit -m "fix: block registration before first setup"`  
Expected: commit succeeds。

---

### Task 9: 用 first_setup 状态驱动页面导航

**Files:**
- Modify: `src/routes/pages.ts`
- Modify: `tests/first-setup-routes.test.ts`

- [ ] **Step 1: 写页面状态矩阵失败测试**

对页面 shell 与 page API 建立矩阵：

| 状态 | `/` | `/login` | `/register` | `/setup` | `/api/pages/home` | `/api/pages/login` | `/api/pages/register` | `/api/pages/setup` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| open | /setup | /setup | /setup | 200 | redirect /setup | redirect /setup | redirect /setup | 200 |
| claimed（无 user） | /setup | /setup | /setup | 200 | redirect /setup | redirect /setup | redirect /setup | 200 |
| claimed（孤儿 user） | /setup | /setup | /setup | 200 | redirect /setup | redirect /setup | redirect /setup | 200 |
| completed（未登录） | redirect /login | 200 login shell | 200 register shell | redirect / | 401 + redirect /login | 200 login data | 200 register data | 200 + redirect / |

测试 claimed + orphan user 时必须手工 claim/bind/插入无 credential admin user，证明页面不再被 `COUNT(user)>0` 错误关闭。

- [ ] **Step 2: 运行页面矩阵确认失败**

Run: `pnpm exec vitest run tests/first-setup-routes.test.ts -t "page"`  
Expected: FAIL；login/register 当前不看初始化状态，setup 仍依赖 user count。

- [ ] **Step 3: 增加页面状态 helper**

在 `src/routes/pages.ts` 导入 `reconcileFirstSetup`，增加：

```ts
async function firstSetupIsCompleted(db: D1Database): Promise<boolean> {
  return (await reconcileFirstSetup(db)).status === 'completed'
}
```

对 `/`、`/login`、`/register`、`/verify-email` 和对应 API 在 session/settings/provider 等查询前检查状态；未完成统一重定向 `/setup`。`/setup` 与 `/api/pages/setup` 仅在 completed 时转 `/`，open/claimed（即使有 orphan user）都展示。

- [ ] **Step 4: 删除页面初始化授权中的 countUsers**

移除 `src/routes/pages.ts` 对 `countUsers` 的 import 和四处调用。`countUsers` 不得再参与 setup 授权判断。

- [ ] **Step 5: 运行页面与完整 route 测试**

Run: `pnpm exec vitest run tests/first-setup-routes.test.ts tests/oauth-registration-routes.test.ts --testTimeout=20000`  
Expected: PASS。

- [ ] **Step 6: 提交页面状态改造**

Run: `git add src/routes/pages.ts tests/first-setup-routes.test.ts && git commit -m "fix: route pages through first setup state"`  
Expected: commit succeeds。


---

### Task 10: 锁定跨入口竞态并清理旧授权依赖

**Files:**
- Modify: `tests/first-setup-routes.test.ts`
- Modify: `src/services/dns-records.ts`（删除无引用的 `countUsers` 与 `setSuperAdmin`）

- [ ] **Step 1: 写 setup 与普通邮箱注册并发测试**

在同一 open D1 上并发提交合法 setup 与普通 email register。无论调度顺序，最终断言：

```ts
expect(await userRows(db)).toHaveLength(1)
expect(await credentialRows(db)).toHaveLength(1)
expect((await userRows(db))[0]).toMatchObject({ role: 'admin', super_admin: 1 })
expect(await getFirstSetupState(db)).toMatchObject({ status: 'completed' })
```

普通注册只能返回 `SETUP_NOT_READY`，不能成为首用户。

- [ ] **Step 2: 写 setup 与 OAuth callback 并发测试**

提前构造可执行 OAuth callback，在 open D1 上与 setup 并发。最终仍只能存在 setup admin + credential；OAuth intent 不得被 consumed，OAuth account/session 不得存在。允许 callback 返回安全失败或重定向错误页，不允许创建第二个 user。

- [ ] **Step 3: 写五轮跨入口重复测试**

将“两个 setup”“setup + email”“setup + OAuth”三个场景各运行 5 轮，每轮独立数据库。所有轮次断言 user/account 数量、权限与状态，不只断言 HTTP status。

- [ ] **Step 4: 运行竞态测试确认稳定**

Run: `1..5 | ForEach-Object { pnpm exec vitest run tests/first-setup-routes.test.ts --testTimeout=30000; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }`  
Expected: 五次完整 route suite 全部 PASS。

- [ ] **Step 5: 审计并清理 countUsers**

Run: `rg -n "countUsers" src tests`  
Expected: 只剩 `src/services/dns-records.ts` 的定义；删除该导出。

Run: `rg -n "listAllUsers|setUserRole|setSuperAdmin" src`  
Expected: `listAllUsers` 与 `setUserRole` 仅由后台管理路由使用；`setSuperAdmin` 只剩定义，因此与 `countUsers` 一并删除；`src/routes/auth.ts` 不得出现这些 setup 事后提升调用。

- [ ] **Step 6: 运行所有 focused tests**

Run: `pnpm exec vitest run tests/first-setup-migration.test.ts tests/first-setup-service.test.ts tests/better-auth-first-setup-hooks.test.ts tests/first-setup-routes.test.ts tests/better-auth-oauth-hooks.test.ts tests/oauth-registration-routes.test.ts --testTimeout=30000`  
Expected: PASS。

- [ ] **Step 7: 提交竞态锁定与旧逻辑清理**

Run: `git add tests/first-setup-routes.test.ts src/services/dns-records.ts && git commit -m "test: lock first setup race guarantees"`  
Expected: `src/services/dns-records.ts` 已删除两个无引用导出；commit succeeds。

---

### Task 11: 更新运行文档与迁移说明

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 写文档契约检查命令**

Run: `rg -n "0011_first_setup_claim|10 分钟|first_setup|claim" README.md`  
Expected: no output（证明文档尚未更新）。

- [ ] **Step 2: 更新迁移清单**

在 README 的迁移清单追加：

```md
- `0011_first_setup_claim.sql` — 首次管理员初始化单例状态机、原子认领与 credential 完成触发器
```

同时补齐已存在但清单遗漏的 `0009_rate_limit_and_passkey_unique.sql` 与 `0010_oauth_registration_intents.sql`，名称与文件系统完全一致。

- [ ] **Step 3: 更新首次启动说明**

将“无用户即开放 setup”的描述替换为：

```md
- 首次部署由 D1 `first_setup` 状态机开放一次管理员初始化。
- 初始化请求先原子认领；首个用户插入时已是超级管理员，credential 创建后永久完成。
- 若 Worker 在 user 与 credential 之间中断，当前请求会立即补偿；无法补偿时进入 10 分钟隔离，超时后仅在确认无 credential 时清理孤儿并重新开放。
- 普通邮箱注册、邮箱验证完成和 OAuth 新用户创建在初始化完成前全部关闭。
```

- [ ] **Step 4: 更新隐私说明**

明确 claim token 只存在于单次 Worker 内存，D1 仅保存 SHA-256，安全日志只含 event/code/stage/timestamp，不记录姓名、邮箱、密码、token/hash、请求元数据或原始异常。

- [ ] **Step 5: 检查 README 与依赖版本**

Run: `rg -n "0011_first_setup_claim|10 分钟|SHA-256|first_setup_security" README.md`  
Expected: 每一项至少一处匹配。

Run: `node -e "const p=require('./package.json'); if(p.dependencies['better-auth']!=='1.6.23'||p.dependencies['@better-auth/passkey']!=='1.6.23') process.exit(1)"`  
Expected: exit 0。

- [ ] **Step 6: 提交文档**

Run: `git add README.md && git commit -m "docs: document safe first setup recovery"`  
Expected: commit succeeds。

---

### Task 12: 最终验证、迁移审计和隐私验收

**Files:**
- Verify only; fix failures in the owning files above and commit the fix with a narrowly scoped message.

- [ ] **Step 1: 运行完整测试一次**

Run: `pnpm test`  
Expected: all test files PASS；无 unhandled rejection、Worker disposal 警告或随机竞态失败。

- [ ] **Step 2: 连续运行完整测试五次**

Run: `1..5 | ForEach-Object { pnpm test; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }`  
Expected: 五次全部 PASS。

- [ ] **Step 3: 运行 TypeScript 检查**

Run: `pnpm exec tsc --noEmit`  
Expected: PASS，无 diagnostics。

- [ ] **Step 4: 运行 Wrangler dry-run**

Run: `pnpm exec wrangler deploy --dry-run --outdir .wrangler-dry-run`  
Expected: exit 0，并生成 Worker bundle；随后只删除项目内 `D:\hide-port-tool\.wrangler-dry-run`，删除前用 `Resolve-Path` 确认路径位于工作区根目录。

- [ ] **Step 5: 审计迁移和状态授权**

Run: `rg -n "DROP\\s+(TABLE|COLUMN)|DELETE\\s+FROM\\s+user" migrations/0011_first_setup_claim.sql`  
Expected: no output。

Run: `rg -n "countUsers|firstUser|createdAt.*first|setUserRole.*newUser|setSuperAdmin.*newUser" src/routes/auth.ts src/routes/pages.ts`  
Expected: no output。

Run: `rg -n "first_setup_complete_on_credential|first_setup_completed_is_final|providerId.*credential|super_admin" migrations/0011_first_setup_claim.sql`  
Expected: trigger 和全部必要条件均有匹配。

- [ ] **Step 6: 审计隐私与安全日志**

Run: `rg -n "console\\.(error|log).*first|console\\.(error|log).*setup|createFirstSetupSecurityEvent" src tests`  
Expected: 生产初始化错误日志只采用 `console.error(JSON.stringify(createFirstSetupSecurityEvent(...)))`。

Run: `rg -n "claim\.token|claim_token_hash|password|email|Cookie|User-Agent|cf-connecting-ip|stack|cause" src/services/first-setup.ts src/routes/auth.ts`  
Expected: token/hash 只用于哈希比较和参数传递；password/email 只用于 Better Auth 请求，不进入初始化事件；安全事件不复制原始 error/cause/stack 或请求元数据。

- [ ] **Step 7: 审计依赖锁定**

Run: `node -e "const p=require('./package.json'); console.log(p.dependencies['better-auth'],p.dependencies['@better-auth/passkey']); if(p.dependencies['better-auth']!=='1.6.23'||p.dependencies['@better-auth/passkey']!=='1.6.23') process.exit(1)"`  
Expected: `1.6.23 1.6.23`。

Run: `pnpm why better-auth @better-auth/passkey`  
Expected: direct dependencies resolve to 1.6.23；不得执行升级命令。

- [ ] **Step 8: 检查 diff 质量和工作树**

Run: `git diff --check HEAD~10..HEAD`  
Expected: no output。

Run: `git status --short`  
Expected: 仅允许验证产生且尚未删除的 `.wrangler-dry-run`；清理后应无输出。

- [ ] **Step 9: 记录验收结果但保持总体整改目标 active**

在任务回复中列出：测试文件/测试数、五轮结果、TypeScript、Wrangler、迁移审计、隐私审计和版本锁定证据。整改项 2 达标后，将总体计划中的“实施、测试并验证整改项 2”标记 completed，但“继续定位并设计后续整改项”保持 in progress；不要把线程 Goal 标记 complete。

---

## 验收不变量索引

1. 空库迁移 open：Task 2。
2. 已有用户迁移 completed：Task 2。
3. 两个 setup 最多一个 claim：Task 3、Task 7。
4. 最终仅一个 user/credential：Task 7、Task 10。
5. 首用户插入即 admin/super_admin：Task 6、Task 7。
6. 普通邮箱不能抢首用户：Task 8、Task 10。
7. OAuth callback 不能抢首用户：Task 6、Task 8、Task 10。
8. 无效输入不 claim：Task 7。
9. 用户插入前失败立即释放：Task 7。
10. user 后、credential 前失败清孤儿：Task 4、Task 7。
11. 10 分钟内不能抢占：Task 4。
12. stale 无 credential 恢复 open：Task 4。
13. stale 有 credential 收敛 completed：Task 4。
14. cleanup/credential 竞态只有两个合法终态：Task 4。
15. cleanup/reconcile 幂等：Task 4。
16. clear token 不进 DB/响应/日志：Task 3、Task 7、Task 12。
17. 原始异常、邮箱、密码不进日志/响应：Task 3、Task 7、Task 12。
18. completed 后 email/OAuth/admin create user 无回归：Task 6、Task 8、完整测试。
19. Better Auth 精确固定 1.6.23：Task 11、Task 12。
