# 本地命令行部署

适用：首次部署、调试、不方便用 GitHub Actions 的环境。

> 若选 GitHub Actions 一键部署，请改阅 [`deploy-github-actions.md`](deploy-github-actions.md)。

## 前置

- 安装 wrangler（已随 devDependencies 安装）：`pnpm install`
- Cloudflare 账户，并已添加至少一个根域名到 Cloudflare DNS
- 每个根域名一份具有 DNS 编辑权限的 Cloudflare API Token

## 创建 D1 数据库（首次）

```txt
pnpm wrangler d1 create mc-server-hide-port-tool-db
```

将控制台返回的 `database_id` 填入 `wrangler.jsonc` 的 `d1_databases[0].database_id` 字段（替换 `REPLACE_WITH_D1_DATABASE_ID`）。

> 也可先在 `.dev.vars` 配好后用 `pnpm wrangler d1 list` 查看已有 D1 的 UUID。

## 应用迁移

```txt
pnpm wrangler d1 migrations apply mc-server-hide-port-tool-db --remote
```

迁移清单：

- `0000_init.sql` — better-auth 的 `user` / `session` / `account` / `verification` 四张表
- `0001_admin.sql` — `user` 表加 `role` 列，新增 `dns_record` / `settings` / `email_verification` 三张表
- `0002_super_admin_and_limits.sql` — `user` 表加 `super_admin` / `record_limit` 列；`settings` 表加 `max_records_per_user` / `min_subdomain_length`

## 配置本地 `.dev.vars`（开发）或 Worker secrets（生产）

### 开发环境

复制 `.dev.vars.example` 为 `.dev.vars` 并填写。每个根域名使用一个独立的 Cloudflare API Token，环境变量名为 `<域名中的点替换为下划线>_CLOUDFLARE_API_TOKEN`：

```
example_com_CLOUDFLARE_API_TOKEN=...
example_net_CLOUDFLARE_API_TOKEN=...
303302_xyz_CLOUDFLARE_API_TOKEN=...
DOMAINS=["example.com","example.net","303302.xyz"]
BETTER_AUTH_SECRET=openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:8787
GITHUB_CLIENT_ID=            # 仅当后台选择 GitHub 注册方式时需要
GITHUB_CLIENT_SECRET=
```

> 生产环境请用 `wrangler secret put <NAME>` 设置密钥，切勿写入 wrangler.jsonc。

### 生产环境（明文变量）

把非敏感变量写入 `wrangler.jsonc` 的 `vars` 字段：

```jsonc
{
  "vars": {
    "APP_NAME": "hide-port-tool",
    "DOMAINS": ["example.com", "example.net", "303302.xyz"],
    "BETTER_AUTH_URL": "https://your-worker.workers.dev"
  }
}
```

### 生产环境（敏感 secrets）

```txt
pnpm wrangler secret put example_com_CLOUDFLARE_API_TOKEN
pnpm wrangler secret put example_net_CLOUDFLARE_API_TOKEN     # 多域名逐个 put
pnpm wrangler secret put 303302_xyz_CLOUDFLARE_API_TOKEN      # 数字开头不影响 secret 名
pnpm wrangler secret put BETTER_AUTH_SECRET
pnpm wrangler secret put GITHUB_CLIENT_ID                     # 可选
pnpm wrangler secret put GITHUB_CLIENT_SECRET                 # 可选
```

## 部署

```txt
pnpm deploy
```

部署完成后访问站点会进入 onboarding 流程；创建管理员后即可在 `/admin` 后台配置注册方式 / 邮箱白名单 / Resend / GitHub 账号年限等。

## 变量键名与说明总览

下表汇总本地部署时所有变量键名、用途与必需性。键名大小写敏感，**本地与 Worker 运行期键名完全一致**——`wrangler secret put`、`.dev.vars`、`wrangler.jsonc.vars` 三处用同一个键。

### 明文变量（写入 `wrangler.jsonc.vars` 或 `.dev.vars`）

| 变量名 | 格式 | 示例 | 必需 | 说明 |
|---|---|---|---|---|
| `APP_NAME` | 字符串 | `hide-port-tool` | 否 | 应用展示名，默认 `hide-port-tool` |
| `DOMAINS` | JSON 数组字符串 | `["example.com","303302.xyz"]` | ✅ | 允许创建 DNS 记录的全部根域名清单，至少一个 |
| `BETTER_AUTH_URL` | URL | `http://localhost:8787` / `https://your-worker.workers.dev` | ✅ | better-auth 回调基础 URL；生产应填 worker 的对外可访问 URL |

> `wrangler.jsonc` 中已提供 `APP_NAME` 默认值；本地 `.dev.vars` 通常不必再写一遍。

### 敏感 secrets（`wrangler secret put <NAME>` 或 `.dev.vars`）

| 变量名 | 用途 | 必需 | 备注 |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | better-auth 会话签名密钥 | ✅ | 至少 32 位随机串，可用 `openssl rand -base64 32` 生成 |
| `<域名点换下划线>_CLOUDFLARE_API_TOKEN` | 该根域名在 Cloudflare DNS 编辑权限的 API Token | ✅（每个根域名各一份） | Worker 运行时按 `<域名中的点→下划线>` 拼接键名读取，例：`303302.xyz` → `303302_xyz_CLOUDFLARE_API_TOKEN` |
| `GITHUB_CLIENT_ID` | GitHub OAuth client id | 否 | 仅在后台开启 GitHub 注册时需要 |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret | 否 | 同上 |

### 多根域名命名约定

每个根域名一个独立 Token，键名按 `<域名中的点替换为下划线>_CLOUDFLARE_API_TOKEN`（小写），无论本地还是生产都遵循同一规则：

```
example_com_CLOUDFLARE_API_TOKEN=...
example_net_CLOUDFLARE_API_TOKEN=...
303302_xyz_CLOUDFLARE_API_TOKEN=...
```

代码中通过 `(env as Record<string, string|undefined>)[key]` 动态读取，无需额外类型配置。键名以数字开头不影响 `wrangler secret put` 或 `.dev.vars`，仅在 GitHub Actions env 受限——CI 部署见 [`deploy-github-actions.md`](deploy-github-actions.md)。
