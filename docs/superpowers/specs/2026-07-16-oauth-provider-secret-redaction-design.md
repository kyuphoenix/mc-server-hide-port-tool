# OAuth Provider 管理响应脱敏设计

日期：2026-07-16
状态：已批准方案 B，待书面规格批准

## 1. 背景与问题

当前管理后台需要展示、创建、更新、启停和删除 OAuth Provider。后端运行时必须保存并读取 `client_secret`，用于 Better Auth 发起 OAuth token exchange；但管理页面和管理 API 响应不需要把明文 `client_secret` 发回浏览器。

现有代码存在两个明确泄露面：

1. `GET /api/pages/admin` 在 `src/routes/pages.ts` 中直接返回 `listOAuthProviders(c.env.DB)`；该函数返回 `OAuthProviderRow[]`，而 `OAuthProviderRow` 包含 `client_secret`。
2. `POST /api/admin/oauth/create` 在 `src/routes/admin.ts` 中返回 `{ provider: result.provider }`；`result.provider` 同样是包含 `client_secret` 的数据库行。

前端 `public/static/pages-admin.js` 的编辑表单只需要知道 Provider 是否已有密钥，以便用“留空则保留原密钥”的交互继续工作。它不需要、也不应该接收明文 secret。

## 2. 目标

本整改项必须保证：

1. 任何面向浏览器的管理端 OAuth Provider 响应都不包含 `client_secret` 字段。
2. 任何面向浏览器的管理端 OAuth Provider 响应都不包含数据库中保存的明文 secret 值。
3. 管理端仍能展示 Provider 列表、编辑非密钥字段、启停和删除 Provider。
4. 创建 Provider 时必须继续要求提交 `client_secret`，但响应只能返回脱敏后的 Provider。
5. 更新 Provider 时继续支持 `client_secret` 留空保留原密钥，提交新值时替换原密钥；响应仍不返回明文 secret。
6. Better Auth 运行时、OAuth 登录、OAuth 注册和账号绑定继续可以读取明文 secret，不改变认证行为。
7. 公共登录/注册页面继续只使用 public Provider DTO，不扩大公开字段。

## 3. 非目标

本整改项不包括：

- 加密或轮换已存储的 `client_secret`。
- 把 OAuth secret 移入独立密钥表、KV、外部密钥管理服务或 Workers Secret。
- 修改 OAuth Provider 数据库 schema 或迁移历史数据。
- 重做管理后台 UI。
- 改变 OAuth Provider 的校验规则、Better Auth 版本或 OAuth 注册 intent 业务规则。
- 解决 DNS 路由或邮件测试接口中的错误消息脱敏问题；这些可作为后续整改项单独处理。

## 4. 采用方案

采用方案 B：在 OAuth Provider 服务层新增 admin-safe DTO，并要求所有管理端响应只使用该 DTO。

### 4.1 新增 DTO

在 `src/services/oauth-providers.ts` 中新增类型：

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

该 DTO 明确不包含 `client_secret`，只包含 `has_client_secret`。

### 4.2 新增转换函数

在 `src/services/oauth-providers.ts` 中新增：

```ts
export function maskOAuthProviderForAdmin(row: OAuthProviderRow): OAuthProviderAdminView
```

转换规则：

- 复制管理页面需要的非敏感字段。
- `has_client_secret` 为 `String(row.client_secret ?? '').trim().length > 0`。
- 不保留、重命名或部分展示 secret；禁止返回 `client_secret_masked`、后四位、长度、hash 或任何可辅助推断 secret 的信息。

### 4.3 新增列表函数

在 `src/services/oauth-providers.ts` 中新增：

```ts
export async function listOAuthProvidersForAdmin(db: D1Database): Promise<OAuthProviderAdminView[]>
```

实现应调用现有 `listOAuthProviders(db)`，然后对每一行执行 `maskOAuthProviderForAdmin`。运行时内部仍可继续使用 `listOAuthProviders`、`listEnabledOAuthProviders`、`findOAuthProviderById` 和 `findOAuthProviderByProviderId` 获取明文 secret。

### 4.4 管理页面数据

`src/routes/pages.ts` 的 `/api/pages/admin` 必须改为返回 `listOAuthProvidersForAdmin(c.env.DB)`。

响应中的 `oauthProviders` 元素必须满足：

- 包含 `has_client_secret`。
- 不包含 `client_secret`。
- 不包含明文 secret 值。

### 4.5 管理 OAuth mutation 响应

`src/routes/admin.ts` 中 OAuth mutation 响应必须遵循：

- `POST /api/admin/oauth/create` 若返回 provider，只能返回 `maskOAuthProviderForAdmin(result.provider)`。
- `POST /api/admin/oauth/:id/update` 当前不返回 provider，可保持不返回；若未来返回 provider，也必须使用 admin-safe DTO。
- toggle/delete 响应不需要 provider，也不得新增明文 secret。

### 4.6 前端兼容

`public/static/pages-admin.js` 应继续以空的 `client_secret` 密码输入作为“保留原密钥”的交互。

如果前端需要显示密钥状态，只能使用 `has_client_secret`，例如展示“已配置”提示或 placeholder。前端不得依赖 `client_secret` 字段。

## 5. 错误与隐私

本整改项不得新增包含 OAuth secret 的日志、响应或测试快照。

禁止出现在响应 JSON 中的内容包括：

- `client_secret` 字段名。
- 数据库中保存的明文 client secret。
- secret 的后缀、长度、hash、部分掩码或派生值。

允许出现在响应 JSON 中的密钥状态信息仅限：

- `has_client_secret: true | false`

## 6. 兼容性

- `createOAuthProvider` 和 `updateOAuthProvider` 可继续返回 `OAuthProviderRow` 给服务层调用者，但路由层必须在输出前脱敏。
- `toGenericOAuthConfig` 必须继续接收 `OAuthProviderRow`，以便 Better Auth 使用明文 `client_secret`。
- `listPublicOAuthProviders` 行为保持不变。
- 管理页已保存 Provider 的编辑表单继续允许 `client_secret` 留空保留原值。

## 7. 测试要求

至少新增或更新以下测试：

1. 管理页数据响应测试：`GET /api/pages/admin` 返回的 `oauthProviders` 不包含 `client_secret` 字段，包含 `has_client_secret: true`，且序列化响应不包含 fixture secret 值。
2. OAuth Provider 创建响应测试：`POST /api/admin/oauth/create` 返回的 provider 不包含 `client_secret` 字段，包含 `has_client_secret: true`，且序列化响应不包含提交的 secret 值。
3. 更新保留密钥测试：`POST /api/admin/oauth/:id/update` 传空 `client_secret` 后，运行时数据库中的 secret 保持原值；响应不包含 secret。
4. 更新替换密钥测试：传入新 `client_secret` 后，数据库中的 secret 被替换；响应不包含旧 secret 或新 secret。
5. 运行时认证配置测试：脱敏改造后 `toGenericOAuthConfig` 或 OAuth 注册/登录相关路径仍能从内部行读取明文 secret。

## 8. 验收标准

整改项 3 只有在以下条件全部满足后才算完成：

- 所有管理端 OAuth Provider 响应都不包含 `client_secret` 字段。
- 所有管理端 OAuth Provider 响应都不包含已保存或新提交的明文 secret。
- 前端管理页不依赖 `client_secret` 字段，仍能展示、创建、更新、启停和删除 Provider。
- Better Auth OAuth 运行时行为不回归。
- 新增测试覆盖列表响应、创建响应、更新保留密钥、更新替换密钥和运行时内部读取。
- `pnpm test` 通过。
- `pnpm exec tsc --noEmit` 通过。
- `git diff --check` 通过。
- 最终隐私审计搜索确认生产响应路径没有 `client_secret` 明文字段泄露。
