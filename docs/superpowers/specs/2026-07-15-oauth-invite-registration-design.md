# OAuth 邀请码注册安全整改设计 - 2026-07-15

## 1. 背景与问题

当前项目通过自定义接口 `POST /api/auth/oauth/register` 检查注册开关、OAuth 注册模式和邀请码，然后调用 Better Auth generic OAuth。OAuth 回调完成后，`GET /register/oauth/done` 才消费邀请码；其他 `/api/auth/*` 请求则直接交给 Better Auth handler。

Better Auth 同时公开原生 `POST /api/auth/sign-in/oauth2`。调用方可以绕过自定义注册接口，直接提交 `requestSignUp: true` 和自定义 `callbackURL`，使新账号在没有邀请码注册意图的情况下被创建。另外，依赖完成页事后消费邀请码不是可靠的安全边界：OAuth callback 已经可以创建用户、Session 并通过响应设置 Session Cookie，客户端可以不继续访问完成页。

本整改将把安全边界前移到账号创建和 Session 签发之前，并确保邀请码在并发条件下只能被一个 OAuth 新用户占用。

## 2. 目标行为

1. 已绑定 OAuth account 的现有用户可以正常登录，不需要邀请码。
2. 只有首次通过 OAuth 创建本地用户时才执行 OAuth 注册授权。
3. 新用户必须同时满足：
   - 全局注册已开启；
   - 注册模式为 `oauth` 或 `both`；
   - OAuth Provider 存在并允许注册；
   - 开启邀请码要求时，邀请码有效、未作废、未使用且未被其他有效注册流程占用；
   - OAuth callback 与服务器发起的注册 intent、Provider、OAuth state 完全匹配。
4. 未经自定义注册入口签发 intent 的原生 Better Auth OAuth 注册必须失败。
5. intent 必须在 OAuth 新用户插入前完成授权，并在 Session 签发前完成最终确认；邀请码必须在 Session 签发前完成最终消费。
6. intent 必须单次使用、短时有效、不可跨 Provider 或 OAuth state 重放。
7. OAuth 登录、OAuth 账号绑定、邮箱注册和管理员创建用户不得被新校验误伤。

## 3. 非目标

本阶段不处理以下独立问题：

- 首次管理员 setup 抢占；
- Passkey fresh session；
- OAuth Client Secret 浏览器披露；
- OAuth Token 静态加密；
- 管理员 RBAC；
- 完整自研 OAuth 协议流程。

这些问题按照审查报告顺序在后续整改阶段处理。

## 4. 安全不变量

实现后必须满足以下不变量：

- 浏览器不能直接调用 Better Auth generic OAuth sign-up 入口。
- OAuth 新用户的 `user.create` 必须持有有效、未过期且绑定当前 state/provider 的注册 intent。
- 一个 intent 最多授权一个本地用户 ID，并且只能完成一次消费。
- 一个邀请码最多被一个已完成的注册 intent 使用。
- OAuth callback 失败时不能产生可登录的未授权账号。
- `/register/oauth/done` 仅负责用户体验、清理和跳转，不再决定账号是否合法。
- 服务器数据库只保存随机 token 的 SHA-256 哈希，不保存可直接重放的明文 token。

## 5. 方案选择

采用“封锁原生入口 + 服务端一次性 OAuth 注册 intent + 邀请码短时预留 + Better Auth 数据库 Hook 最终确认”的方案。

不只采用路由封锁，因为单纯封锁依赖 Better Auth 当前端点结构，无法在账号创建层建立不变量；也不完全重写 OAuth 流程，以避免自行维护 state、PKCE、token exchange 等高风险协议细节。

## 6. 数据模型

新增 migration `0010_oauth_registration_intents.sql`。

### 6.1 `oauth_registration_intent`

字段：

- `id TEXT PRIMARY KEY`：随机 UUID，用于数据库内部关联。
- `token_hash TEXT NOT NULL UNIQUE`：浏览器 Cookie token 的 SHA-256 十六进制哈希。
- `provider_id TEXT NOT NULL`：绑定的 OAuth Provider ID。
- `oauth_state_hash TEXT`：Better Auth 返回授权 URL 后写入的 OAuth state 哈希；绑定完成前为 NULL。
- `invite_code_id TEXT`：未要求邀请码时为 NULL。
- `created_at INTEGER NOT NULL`。
- `expires_at INTEGER NOT NULL`：最长 10 分钟，与 OAuth state 生命周期对齐。
- `authorized_at INTEGER`：`user.create.before` 已完成授权状态转换的时间。
- `authorized_user_id TEXT`：授权给 Better Auth 即将插入的本地用户 ID。
- `consumed_at INTEGER`：用户插入后、Session 签发前完成最终确认的时间。

索引：

- `token_hash` 唯一索引；
- `expires_at` 清理索引；
- `oauth_state_hash` 查询索引；
- `authorized_user_id` 对账索引；
- `consumed_at` 状态索引。

### 6.2 `invite_code` 预留字段

新增：

- `reserved_intent_id TEXT`；
- `reserved_at INTEGER`。

邀请码可用条件扩展为：

- `revoked = 0`；
- `used_by IS NULL`；
- `reserved_intent_id IS NULL`；过期预留必须先由状态感知的清理流程安全回收，预留语句不得仅依据 `reserved_at` 直接覆盖。

预留不是最终消费。只有 pending intent 可以直接释放预留。intent 一旦授权给用户 ID：用户存在时完成邀请码消费；用户暂时不存在时进入 1 小时隔离期，隔离期结束且再次确认用户仍不存在后才允许释放。普通完成页和错误回调不得立即释放 authorized intent，避免与仍在执行的用户插入竞争。

### 6.3 数据库触发器

使用 SQLite trigger 保证“最终消费 intent”和“消费邀请码”是同一个数据库原子操作：

- 当 intent 从未消费状态更新为已消费状态，且关联邀请码时：
  - 要求 `NEW.authorized_user_id` 非空；
  - 要求邀请码仍未使用、未作废且 `reserved_intent_id = intent.id`；
  - 将 `used_by` 设置为 `NEW.authorized_user_id`，写入 `used_at` 并清除预留；
  - 条件不满足时使用 `RAISE(ABORT, ...)` 中止整个 intent 更新。
- 只有删除仍处于 pending 状态的 intent 时，才清除属于该 intent 的邀请码预留；authorized intent 必须先对账，不能通过删除直接释放。

这样不会出现 intent 已消费但邀请码没有消费的部分提交状态。

## 7. 服务端组件

新增 `src/services/oauth-registration-intents.ts`，负责：

- 生成 32 字节密码学安全随机 token；
- SHA-256 哈希 token 和 OAuth state；
- 创建 intent；
- 原子预留邀请码；
- 将 intent 绑定 Better Auth OAuth state；
- 校验 token/state/provider/有效期；
- 将 pending intent 原子转换为 authorized，并绑定待插入用户 ID；
- 在用户插入后、Session 签发前最终消费 intent 和邀请码；
- 删除 pending intent 并释放预留；
- 对 authorized intent 按用户是否存在和 1 小时隔离期执行完成消费或安全释放；
- 清理和对账过期 intent。

服务层返回稳定的领域错误，不向客户端返回 SQL 或底层异常文本。

## 8. 请求与认证流程

### 8.1 发起 OAuth 注册

`POST /api/auth/oauth/register` 执行：

1. 执行 JSON、CSRF 和当前 Session 检查。
2. 读取最新全局设置。
3. 校验注册开关、注册模式和 Provider ID。
4. 如果要求邀请码，规范化邀请码并原子预留；预留失败立即拒绝。
5. 创建 intent 和随机 Cookie token。
6. 通过服务器端 `auth.api.signInWithOAuth2` 发起 OAuth，固定：
   - `requestSignUp: true`；
   - `callbackURL: /register/oauth/done`；
   - `errorCallbackURL: /register/oauth/error`。
7. 从 Better Auth 返回的授权 URL 提取 `state`，将 state 哈希绑定到 intent。
8. 仅在 state 绑定成功后返回授权 URL，并设置 intent Cookie。
9. 任一步失败都删除 intent 并释放邀请码预留。

Cookie 属性：

- 名称：`oauth_registration_intent`；
- `HttpOnly`；
- `SameSite=Lax`，保证顶层 OAuth callback 可以携带；
- HTTPS 环境设置 `Secure`；
- `Path=/`，使 OAuth callback、错误回调和完成页都可以读取或清理；
- `Max-Age=600`。

### 8.2 封锁 Better Auth 原生入口

在 `/api/auth/*` catch-all 交给 `auth.handler` 前：

- 拒绝浏览器直接访问 generic OAuth `POST /sign-in/oauth2`；
- 自定义 OAuth 登录和注册路由使用服务器端 `auth.api`，不经过该公开入口；
- 继续阻止原生 `/sign-up/email`；
- OAuth account linking 保留现有自定义设置接口，不改变其行为。

封锁整个公开 `sign-in/oauth2`，而不只检查 `requestSignUp=true`，以避免客户端控制 callback URL、错误回调或其他注册参数。

### 8.3 OAuth 新用户创建前校验

扩展 `databaseHooks.user.create.before`：

1. 保留现有数字用户 ID 分配逻辑。
2. 仅当 hook context 是 generic OAuth callback 时执行注册 intent 校验。
3. 从 HttpOnly Cookie 获取明文 token，从 callback URL 获取 state，从路径获取 Provider ID。
4. 读取最新注册设置并再次检查 OAuth 注册仍然开放。
5. 在分配数字用户 ID 后，通过单条条件更新将 intent 从 pending 原子转换为 authorized：
   - token 哈希匹配；
   - state 哈希匹配；
   - Provider 匹配；
   - 未过期；
   - 尚未授权和消费；
   - 邀请码预留仍归属该 intent；
   - 写入 `authorized_at` 和 `authorized_user_id`。
6. 校验或状态转换失败时返回 `false` 或抛出稳定认证错误，阻止 Better Auth 创建用户。
7. 返回已分配的用户 ID，供 Better Auth 插入用户行。

一旦 intent 已授权给用户 ID，其邀请码预留不能因普通过期清理而释放。用户暂时不存在也不能立即释放，因为清理可能与 Better Auth 随后的 user 插入并发；只有超过 1 小时隔离期并再次确认用户仍不存在时才允许释放。这样即使 D1 adapter 不提供真实跨语句事务，也不会出现“用户已经存在但邀请码重新可用”的授权绕过。

已有 OAuth 用户登录不会调用 `user.create`，因此不要求 intent。

### 8.4 用户插入后的最终确认

扩展 `databaseHooks.user.create.after`：

1. 只处理 generic OAuth callback 创建的新用户。
2. 重新定位与当前 token/state/provider 匹配、且 `authorized_user_id = user.id` 的 intent。
3. 更新 intent 的 `consumed_at`。
4. 数据库 trigger 在同一原子操作中将预留邀请码写入 `used_by/used_at` 并清除预留。
5. 最终确认失败时抛出错误，使 Better Auth 不继续签发 Session。

Better Auth 当前 D1/Kysely adapter 不提供真实数据库事务；用户插入和 account 插入可能无法自动回滚。因此安全性不依赖回滚：`user.create.before` 已经把有效 intent 和邀请码预留授权给该用户 ID。即使后续 account 创建失败，用户也不能让邀请码重新可用；清理流程在用户存在时完成消费，在用户暂时不存在时保留预留，只有隔离期结束且再次确认用户仍不存在时才释放。

该设计依赖 Better Auth 当前的 hook 生命周期：`user.create.after` 会排队到 `createOAuthUser` 整体结束后执行，并且主流程报错时仍会执行。实现时必须将 Better Auth 固定到已验证版本，并用契约测试覆盖“account 插入失败仍执行最终确认”；升级 Better Auth 前必须重新验证该行为。

OAuth 账号绑定和已有用户登录不会创建 user，因此不会触发上述两个 user create hook，也不要求注册 intent。

### 8.5 OAuth 错误回调

新增服务端 `GET /register/oauth/error`，并将注册发起请求的 `errorCallbackURL` 固定到该路由：

- 清除 intent Cookie；
- pending intent 直接删除并释放邀请码预留；
- authorized intent 只允许完成用户存在时的消费；用户不存在时保留给隔离期后的统一对账，不得在错误回调中释放预留；
- 使用稳定的站内错误码跳回注册页；
- 不向浏览器透传 Provider 原始错误、authorization code 或底层异常文本。

### 8.6 完成页

`GET /register/oauth/done`：

- 获取当前 Session；
- 清除 intent Cookie；
- pending intent 可删除并释放预留；consumed intent 可按保留策略删除；
- authorized intent 不在完成页释放或最终消费，保留给统一对账流程；
- 不再根据 `createdAt < 5 分钟` 判断是否合法；
- 不再通过页面访问消费邀请码；
- 不再通过事后删除用户实现注册授权；
- 成功时跳转首页，失败时跳转登录或注册页面。

如果客户端不访问完成页，安全性不受影响：新用户已在 Session 签发前完成最终确认；pending intent 最迟在过期清理时释放，authorized intent 则通过对账完成消费，或在隔离期结束且确认用户仍不存在后释放。

## 9. 失败与并发处理

- 两个请求使用同一邀请码：条件更新只能让一个 intent 获得有效预留。
- 同一 intent 重放：`authorized_at IS NULL` 和 `consumed_at IS NULL` 条件确保只能授权并完成一次。
- state 被替换：state 哈希不匹配，用户创建 hook 拒绝。
- Provider 被替换：Provider ID 不匹配，用户创建 hook 拒绝。
- 直接请求 Better Auth 注册：没有合法 intent，同时公开端点已封锁。
- OAuth 中途取消：错误回调删除 pending intent 并释放预留；未执行回调时由过期清理处理；authorized intent 必须保留到隔离期后的统一对账。
- 已有 OAuth 用户误走注册入口：不会创建 user；完成页删除仍为 pending 的 intent 并释放邀请码预留。
- 注册设置在 OAuth 跳转期间关闭：callback hook 读取最新设置并拒绝新用户创建。
- Better Auth 已插入 user、但 account 插入失败：不签发 Session；当前版本仍执行已排队的 `user.create.after` 最终确认，因此邀请码不会重新开放。若最终确认也失败，后续对账发现用户存在时只重试完成消费，绝不释放预留。

## 10. 清理策略

本阶段提供服务函数并在以下请求中机会式清理：

- 发起 OAuth 注册前；
- OAuth 完成页；
- OAuth 错误完成路径。

过期判定使用数据库时间或统一的毫秒时间值。清理按状态执行：

- pending 且过期：删除 intent，并释放其邀请码预留；
- authorized 且未消费：按 `authorized_user_id` 查询用户；用户存在则完成 intent 和邀请码消费；用户不存在且 `authorized_at` 距今不足 1 小时时保持不变；隔离期结束后再次确认用户仍不存在，才删除 intent 并释放预留；
- consumed 且超过保留期：删除 intent，但不得修改已归属的邀请码；
- 清理操作必须幂等，并通过条件更新或 trigger 保持并发安全。

后续“隐私数据生命周期整改”阶段再增加 Cloudflare Cron，统一清理所有过期注册、rate-limit 和 OAuth intent 数据。

## 11. 测试要求

建立最小自动测试入口，并至少覆盖：

1. 公开 `POST /api/auth/sign-in/oauth2` 被拒绝。
2. 自定义登录接口仍可生成 OAuth 登录跳转。
3. 自定义注册接口在注册关闭或模式错误时拒绝。
4. 要求邀请码时，无邀请码、无效邀请码、已使用邀请码均被拒绝。
5. 一个邀请码的两个并发 intent 只有一个能预留成功。
6. intent Cookie 缺失、token 错误、state 错误、Provider 错误、过期和重放均被拒绝。
7. 新 OAuth 用户只有在 intent 授权成功后才能插入，并且只有最终确认成功后才能获得 Session。
8. 最终确认原子写入 intent 和邀请码使用状态。
9. account 创建失败时不签发 Session，且已授权邀请码不会重新开放。
10. authorized intent 在用户插入并发窗口内不会因“暂未查到用户”而提前释放。
11. authorized intent 对账时：用户存在则完成消费；用户不存在时在 1 小时隔离期内不得释放，隔离期后再次确认仍不存在才释放。
12. 已有 OAuth 用户登录不需要 intent。
13. OAuth 账号绑定不被注册 hook 拦截。
14. OAuth 错误回调清除 Cookie、只返回稳定错误码且不泄露 Provider 原始错误。
15. 完成页不会再次消费邀请码。
16. TypeScript、测试和 Wrangler dry-run 全部通过。

## 12. 可观测性与隐私

安全日志只记录：

- 随机 intent ID；
- Provider ID；
- 失败类型；
- 时间；
- 可选 correlation ID。

不得记录：

- 明文 Cookie token；
- 明文邀请码；
- OAuth authorization code；
- access/refresh/id token；
- 完整用户邮箱。

## 13. 回滚策略

- 代码回滚时保留新增表和字段不会影响旧逻辑。
- migration 不执行破坏性删除。
- 如果新 hook 造成异常，可临时关闭 OAuth 新用户注册，但不得恢复公开原生注册入口。
- 数据库中的 pending intent 可安全删除并释放预留；authorized intent 必须先按 `authorized_user_id` 和隔离期对账，不能直接删除或释放。

## 14. 验收标准

第 1 项整改只有在以下证据全部成立时才完成：

- 回归测试证明原生 OAuth 注册绕过失败；
- 回归测试证明正常新用户注册和现有用户登录行为正确；
- 并发测试证明邀请码只能由一个 intent 预留和消费；
- 代码检查证明 `/register/oauth/done` 不再承担注册授权；
- `pnpm test`、`pnpm exec tsc --noEmit` 和 Wrangler dry-run 成功；
- Git diff 中不包含 Secret、明文 token 或 `.dev.vars` 内容。
