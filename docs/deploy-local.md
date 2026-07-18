# 本地 / 服务器部署

适用：首次部署、调试、不方便用 GitHub Actions 的环境。

> 若选 GitHub Actions 一键部署，请改阅 [`deploy-github-actions.md`](deploy-github-actions.md)。

## 前置

- Node.js 22+
- 安装 wrangler（已随 devDependencies 安装）：`pnpm install`
- Cloudflare 账户，并已添加至少一个根域名到 Cloudflare DNS
- 每个根域名一份具有 DNS 编辑权限的 Cloudflare API Token

## 创建 D1 数据库（首次）

```txt
pnpm wrangler d1 create mc-server-hide-port-tool-db
```

将控制台返回的 `database_id` 填入 `wrangler.jsonc` 的 `d1_databases[0].database_id` 字段（替换 `REPLACE_WITH_D1_DATABASE_ID`）。

> 也可以在 `.dev.vars` 配好后用 `pnpm wrangler d1 list` 查看已有 D1 的 UUID。

## 应用迁移

```txt
pnpm wrangler d1 migrations apply mc-server-hide-port-tool-db --remote
```

迁移清单：

- `0000_init.sql` — better-auth 的 `user` / `session` / `account` / `verification` 四张表
- `0001_admin.sql` — `user` 表加 `role` 列，新增 `dns_record` / `settings` / `email_verification` 三张表
- `0002_super_admin_and_limits.sql` — `user` 表加 `super_admin` / `record_limit` 列；`settings` 表加 `max_records_per_user` / `min_subdomain_length`
- `0003_invite_codes.sql` — 邀请码表
- `0004_oauth_providers.sql` — 通用 OAuth 应用配置表
- `0005_oauth_unify_github.sql` — 迁移序号占位（icon_url 已在 0004）
- `0006_schema_hardening.sql` — 唯一索引、冗余索引清理、过期字段索引
- `0007_passkey.sql` — Passkey 表（个人设置）
- `0008_numeric_user_ids.sql` — `user_id_counter`：新用户 id 按注册顺序从 1 递增
- `0009_rate_limit_and_passkey_unique.sql` — 验证限流桶与 Passkey credential 唯一约束
- `0010_oauth_registration_intents.sql` — OAuth 注册 intent、state 绑定、邀请保留与消费状态
- `0011_first_setup_claim.sql` — 首次管理员初始化单例状态机与原子认领
- `0012_dns_sync_state.sql` — DNS pending 变更、同步状态、重试与安全错误码
- `0013_user_deletion_jobs.sql` — 可恢复用户删除作业、进度与租约字段

本地开发用 `--local` 应用同一套迁移。

## 配置本地 `.dev.vars`（或生产 Worker secrets）

### 本地开发

复制 `.dev.vars.example` 为 `.dev.vars` 并填写。每个根域名使用一个独立的 Cloudflare API Token，环境变量名为 `<域名中的点替换为下划线>_CLOUDFLARE_API_TOKEN`：

```
example_com_CLOUDFLARE_API_TOKEN=...
example_net_CLOUDFLARE_API_TOKEN=...
DOMAINS=["example.com","example.net"]
BETTER_AUTH_SECRET=<独立生成的至少 32 字符随机值>
DATA_ENCRYPTION_KEY=<另一份独立生成的至少 32 字符随机值>
# DATA_ENCRYPTION_KEY_PREVIOUS=<仅轮换窗口使用的旧数据密钥>
BETTER_AUTH_URL=http://localhost:8787
# OAUTH_ALLOWED_HOSTS=accounts.example.com,*.login.example.net
```

> 生产环境请用 `wrangler secret put <NAME>` 设置密钥，切勿写入 wrangler.jsonc。
>
> **不要**再配置 `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`。OAuth（含 GitHub）统一在管理后台配置。

### 域名列表的本地写法

也可把域名列表写进 `wrangler.jsonc` 的 `vars` 字段：

```jsonc
{
  "vars": {
    "APP_NAME": "hide-port-tool",
    "DOMAINS": "[\"example1.com\",\"example2.com\"]",
    "BETTER_AUTH_URL": "https://mc.example.com",
    "OAUTH_ALLOWED_HOSTS": "accounts.example.com,*.login.example.net"
  }
}
```

## 注入生产 secrets 并部署

先在 `wrangler.jsonc.vars` 中确认 `DOMAINS`、生产 HTTPS origin `BETTER_AUTH_URL` 与可选的 `OAUTH_ALLOWED_HOSTS`。升级现有生产库时，先按[生产运行手册](production-runbook.md)记录 D1 bookmark 或完成受控备份。

发布前门禁：

```powershell
pnpm build
pnpm run validate:migrations
pnpm test
pnpm exec tsc --noEmit
pnpm exec wrangler deploy --dry-run
pnpm audit --prod
```

注入敏感值；`DATA_ENCRYPTION_KEY_PREVIOUS` 只在数据密钥轮换窗口设置：

```powershell
pnpm exec wrangler secret put example1_com_CLOUDFLARE_API_TOKEN
pnpm exec wrangler secret put example2_com_CLOUDFLARE_API_TOKEN
pnpm exec wrangler secret put BETTER_AUTH_SECRET
pnpm exec wrangler secret put DATA_ENCRYPTION_KEY
# pnpm exec wrangler secret put DATA_ENCRYPTION_KEY_PREVIOUS
```

最后先迁移远端 D1，再发布 Worker；这两步不能颠倒。`0012_dns_sync_state.sql` 与 `0013_user_deletion_jobs.sql` 必须在新 Worker 接流量前完成：

```powershell
pnpm exec wrangler d1 migrations apply mc-server-hide-port-tool-db --remote
pnpm deploy
```

部署完成后访问站点会进入 onboarding 流程；创建管理员后即可在 `/admin` 后台配置：

- 注册开关与模式（`email` / `oauth` / `both`）
- 邀请码
- 邮箱白/黑名单、Resend
- OAuth 登录应用（GitHub / 其他第三方）
- GitHub 账号最短注册天数（仅当存在 `provider_id=github` 的应用时生效）
- 每用户记录上限、最小子域名长度

## 环境变量说明

| 名称 | 用途 | 必需 | 备注 |
|---|---|---|---|
| `<域名点换下划线>_CLOUDFLARE_API_TOKEN` | 对应根域名的 Cloudflare DNS API Token | 是 | 例如 `example_com_CLOUDFLARE_API_TOKEN` |
| `DOMAINS` | 允许使用的根域名 JSON 数组 | 是 | 与 token 覆盖范围一致 |
| `BETTER_AUTH_SECRET` | better-auth 签名密钥 | 是 | 建议 `openssl rand -base64 32` |
| `DATA_ENCRYPTION_KEY` | OAuth secret、邮件 token 与待注册密码的数据加密密钥 | 是 | 至少 32 字符，且不得等于 `BETTER_AUTH_SECRET` |
| `DATA_ENCRYPTION_KEY_PREVIOUS` | 上一版数据加密密钥 | 否 | 仅轮换窗口配置，至少 32 字符且不得等于当前数据密钥 |
| `BETTER_AUTH_URL` | 站点对外 URL | 是 | 生产环境必须是无路径、查询和 fragment 的 HTTPS origin |
| `OAUTH_ALLOWED_HOSTS` | 自定义 OAuth 端点主机白名单 | 否 | 逗号分隔精确主机或 `*.example.com` 子域模式，不含 scheme、端口或路径 |
| `APP_NAME` | 应用名 | 否 | 默认 `hide-port-tool` |

代码中通过 `(env as Record<string, string|undefined>)[key]` 动态读取域名 token。键名以数字开头不影响 `wrangler secret put` 或 `.dev.vars`，仅在 GitHub Actions env 受限——CI 部署见 [`deploy-github-actions.md`](deploy-github-actions.md)。

## 配置 OAuth（部署后）

1. 使用超级管理员/管理员登录 → 打开「管理后台」→「OAuth 登录应用」。
2. 选择模板（如 GitHub）或自定义填写端点，填入 Client ID / Secret，可选填写图标 URL。
3. 在第三方 OAuth 控制台把回调地址设为：

```txt
{BETTER_AUTH_URL}/api/auth/oauth2/callback/{provider_id}
```

GitHub 示例：

```txt
https://mc.example.com/api/auth/oauth2/callback/github
```

4. 若需要 GitHub 账号天数限制：
   - 后台注册设置中填写「GitHub 账号最短注册天数」
   - OAuth 应用的 `provider_id` 必须是 `github`

部署完成后执行登录、DNS 创建/更新/删除、管理员分页、邮件与 OAuth 冒烟检查；监控、密钥轮换、D1 恢复和 Worker 回滚步骤见 [`production-runbook.md`](production-runbook.md)。
