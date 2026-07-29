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
node scripts/install-d1-triggers.cjs --remote
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
- `0014_site_announcement.sql` — 管理员维护的单例站点公告、启用状态与版本号

本地开发用 `--local` 应用同一套迁移，并安装本地触发器：

```txt
pnpm wrangler d1 migrations apply mc-server-hide-port-tool-db --local
node scripts/install-d1-triggers.cjs --local
```

## 配置本地 `.dev.vars`（或生产 Worker secrets）

### 本地开发

复制 `.dev.vars.example` 为 `.dev.vars` 后，删除示例中的旧式 DNS 变量和 `DOMAINS`，再按下面的推荐配置填写；推荐把根域名和对应的 Cloudflare API Token 汇总到 `CLOUDFLARE_DOMAINS_API_TOKEN`：

```dotenv
CLOUDFLARE_DOMAINS_API_TOKEN=example.com:<token>,example.net:<token>
BETTER_AUTH_SECRET=<独立生成的至少 32 字符随机值>
DATA_ENCRYPTION_KEY=<另一份独立生成的至少 32 字符随机值>
# DATA_ENCRYPTION_KEY_PREVIOUS=<仅轮换窗口使用的旧数据密钥>
BETTER_AUTH_URL=http://localhost:8787
# OAUTH_ALLOWED_HOSTS=accounts.example.com,*.login.example.net
```

汇总变量的每个条目使用英文逗号 `,` 分隔，域名和 Token 使用条目中的第一个英文冒号 `:` 分隔。程序会将域名标准化为小写、去除末尾的点，并按首次出现的同名域名取值。

使用汇总变量自动推导域名清单时，必须**完全省略** `DOMAINS`。不要写成 `DOMAINS=` 或其他空字符串：显式空值代表空域名清单，不会回退到 `CLOUDFLARE_DOMAINS_API_TOKEN`。

原有的显式域名清单和每域 Token 仍向后兼容，例如：

```dotenv
DOMAINS=["example.com","example.net"]
example_com_CLOUDFLARE_API_TOKEN=...
example_net_CLOUDFLARE_API_TOKEN=...
```

- 显式设置 `DOMAINS` 时，它优先决定可用域名清单。
- 对某个域名读取 Token 时，旧式 `<域名点换下划线>_CLOUDFLARE_API_TOKEN` 优先，汇总变量中的同域名 Token 作为回退。
- 该兼容方式适合保留旧部署，或在 Token 轮换期间临时覆盖单个域名。

> 生产环境请用 `wrangler secret put <NAME>` 设置密钥，切勿写入 wrangler.jsonc。
>
> **不要**再配置 `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`。OAuth（含 GitHub）统一在管理后台配置。

### 显式域名列表的兼容写法

需要继续使用旧式配置时，也可把显式域名列表写进 `wrangler.jsonc` 的 `vars` 字段：

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

此时仍需在 `.dev.vars` 或 Worker secrets 中为列表里的每个域名提供 Token。若使用推荐的汇总变量自动推导域名，请从 `wrangler.jsonc.vars` 中删除 `DOMAINS`，并且不要把包含 Token 的 `CLOUDFLARE_DOMAINS_API_TOKEN` 写入版本控制。

## 注入生产 secrets 并部署

先在 `wrangler.jsonc.vars` 中确认生产 HTTPS origin `BETTER_AUTH_URL` 与可选的 `OAUTH_ALLOWED_HOSTS`。推荐配置不需要 `DOMAINS`；只有继续使用旧式显式域名清单时才保留它。升级现有生产库时，先按[生产运行手册](production-runbook.md)记录 D1 bookmark 或完成受控备份。

发布前门禁：

```powershell
pnpm build
pnpm run validate:migrations
pnpm test
pnpm exec tsc --noEmit
pnpm exec wrangler deploy --dry-run
pnpm audit --prod
```

注入敏感值；变量名称和值无需转换，按程序读取的原名称直接部署到 Worker。`DATA_ENCRYPTION_KEY_PREVIOUS` 只在数据密钥轮换窗口设置：

```powershell
pnpm exec wrangler secret put CLOUDFLARE_DOMAINS_API_TOKEN
pnpm exec wrangler secret put BETTER_AUTH_SECRET
pnpm exec wrangler secret put DATA_ENCRYPTION_KEY
# pnpm exec wrangler secret put DATA_ENCRYPTION_KEY_PREVIOUS
```

第一个命令提示输入值时，填写：

```txt
<域名1>:<Token1>,<域名2>:<Token2>,...
```

旧部署仍可保留每域 Secret；它会优先覆盖汇总变量中的同域名 Token：

```powershell
# pnpm exec wrangler secret put example1_com_CLOUDFLARE_API_TOKEN
# pnpm exec wrangler secret put example2_com_CLOUDFLARE_API_TOKEN
```

最后先应用**全部**远端 D1 迁移，再发布 Worker；这两步不能颠倒。尤其要确保 `0012_dns_sync_state.sql`、`0013_user_deletion_jobs.sql` 和 `0014_site_announcement.sql` 在新 Worker 接流量前完成：

```powershell
pnpm exec wrangler d1 migrations apply mc-server-hide-port-tool-db --remote
node scripts/install-d1-triggers.cjs --remote
pnpm deploy
```

部署完成后访问站点会进入 onboarding 流程；创建管理员后即可在 `/admin` 后台配置：

- 注册开关与模式（`email` / `oauth` / `both`）
- 邀请码
- 邮箱白/黑名单、Resend
- OAuth 登录应用（GitHub / 其他第三方）
- GitHub 账号最短注册天数（仅当存在 `provider_id=github` 的应用时生效）
- 每用户记录上限、最小子域名长度
- 站点公告的标题、正文和启用状态

## 环境变量说明

| 名称 | 用途 | 必需 | 备注 |
|---|---|---|---|
| `CLOUDFLARE_DOMAINS_API_TOKEN` | 汇总根域名和对应的 Cloudflare DNS API Token | DNS 配置二选一 | 推荐；格式为 `<域名>:<Token>,...`，未设置 `DOMAINS` 时自动推导域名清单 |
| `<域名点换下划线>_CLOUDFLARE_API_TOKEN` | 对应根域名的 Cloudflare DNS API Token | DNS 配置二选一 | 旧式每域配置；例如 `example_com_CLOUDFLARE_API_TOKEN`，读取时优先于汇总变量 |
| `DOMAINS` | 显式指定允许使用的根域名 | 使用旧式配置时是 | JSON 数组或兼容的逗号分隔列表；显式设置时优先，自动推导时必须完全省略 |
| `BETTER_AUTH_SECRET` | better-auth 签名密钥 | 是 | 建议 `openssl rand -base64 32` |
| `DATA_ENCRYPTION_KEY` | OAuth secret、邮件 token 与待注册密码的数据加密密钥 | 是 | 至少 32 字符，且不得等于 `BETTER_AUTH_SECRET` |
| `DATA_ENCRYPTION_KEY_PREVIOUS` | 上一版数据加密密钥 | 否 | 仅轮换窗口配置，至少 32 字符且不得等于当前数据密钥 |
| `BETTER_AUTH_URL` | 站点对外 URL | 是 | 生产环境必须是无路径、查询和 fragment 的 HTTPS origin |
| `OAUTH_ALLOWED_HOSTS` | 自定义 OAuth 端点主机白名单 | 否 | 逗号分隔精确主机或 `*.example.com` 子域模式，不含 scheme、端口或路径 |
| `APP_NAME` | 应用名 | 否 | 默认 `hide-port-tool` |

程序不需要把环境变量名称翻译成其他名称：本地 `.dev.vars`、手动 `wrangler secret put` 和 GitHub Actions 部署都直接使用原名称和值。域名配置的解析优先级如下：

1. 若设置了 `DOMAINS`，它显式决定可用域名清单；显式空字符串会得到空清单。
2. 若完全没有设置 `DOMAINS`，程序从 `CLOUDFLARE_DOMAINS_API_TOKEN` 中的域名条目自动推导清单。
3. 读取某个域名的 Token 时，旧式每域 Secret 优先，汇总变量中的同域名 Token 回退。

键名中的点替换为下划线只适用于旧式每域 Secret；它不影响 `wrangler secret put` 或 `.dev.vars`，也不需要在本地或手动部署时额外转换。CI 部署的变量注入规则见 [`deploy-github-actions.md`](deploy-github-actions.md)。

## 配置站点公告（部署后）

使用管理员或超级管理员登录，打开「管理后台」→「公告设置」：

- 勾选「启用公告」，填写标题和正文后保存即可发布；取消勾选可停用当前公告。
- 正文支持 GitHub Flavored Markdown 和受限原始 HTML，例如标题、列表、代码、链接、表格以及 `<strong>` 等安全标签。
- 服务端会在渲染前移除脚本、事件处理器、内联样式、不安全链接和其他不允许的 HTML 属性；不要把公告正文当作可执行 HTML 使用。
- 每次保存都会递增公告版本。选择过「再也不见」的用户会在新版本发布后再次看到公告。

公告会在以下时机检查并弹出：

- 用户登录成功后；
- 用户注册成功后；
- 已登录用户进入首页、个人设置或管理后台时。

弹窗右下角提供两个隐藏选项：

- **今日不见**：按浏览器本地日期保存，当前日期内不再显示任何公告版本；日期变化后会重新检查。
- **再也不见**：记住当前公告版本，当前版本及更早版本不再显示；管理员保存公告产生新版本后会重新弹出。

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

部署完成后执行登录、注册、公告 Markdown/HTML 渲染、公告「今日不见」与「再也不见」规则、DNS 创建/更新/删除、管理员分页、邮件与 OAuth 冒烟检查；监控、密钥轮换、D1 恢复和 Worker 回滚步骤见 [`production-runbook.md`](production-runbook.md)。
