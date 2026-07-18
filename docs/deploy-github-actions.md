# GitHub Actions 一键部署（推荐生产环境）

在仓库 **Actions** 页面选择 *Deploy to Cloudflare Workers* → **Run workflow** 即可。请先在仓库 **Settings → Secrets and variables → Actions** 中配置本页列出的 Secrets 与 Variables。

## 流程概览

1. 校验必需 Secrets、密钥独立性、生产 HTTPS origin 与 OAuth 主机白名单
2. 安装依赖并构建静态资源
3. 校验迁移向后兼容性，运行全量测试、类型检查与 Wrangler dry-run
4. 解析 `CLOUDFLARE_DOMAINS_API_TOKEN`，生成 `DOMAINS` 与各域名 DNS token
5. 创建或对齐 D1，写回 `database_id`，并准备 `BETTER_AUTH_URL` 对应的 custom domain
6. 在部署新 Worker 前应用全部远端 D1 迁移，包括 `0012_dns_sync_state.sql` 与 `0013_user_deletion_jobs.sql`
7. 部署 Worker，并一次性注入 vars 与 secrets

## 为什么用 `CLOUDFLARE_DOMAINS_API_TOKEN`

GitHub Actions 中 secret 名必须仅含 `[A-Z0-9_]` 且不能以数字开头，因此**根域名 Token 不再用 `*_CLOUDFLARE_API_TOKEN` 形式直接作为 GitHub secret 名**，而是统一汇总到 `CLOUDFLARE_DOMAINS_API_TOKEN`，由 CI 解析后再以 `<域名点换下划线>_CLOUDFLARE_API_TOKEN`（小写）注入到 Worker（与运行时代码读取的命名一致）。

## 需要配置的仓库 Secrets

| GitHub Secret 名 | 是否敏感 | 必需 | 对应的 Worker 变量 | 说明 |
|---|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | 是 | 是 | （部署用） | 需 Workers + D1编辑 和 worker路由编辑 权限 |
| `CLOUDFLARE_ACCOUNT_ID` | 否 | 是 | （部署用） | Cloudflare Account ID |
| `CLOUDFLARE_DOMAINS_API_TOKEN` | 是 | 是 | 各 `<domain>_CLOUDFLARE_API_TOKEN` + 派生 `DOMAINS` | 见下方格式 |
| `BETTER_AUTH_SECRET` | 是 | 是 | secret `BETTER_AUTH_SECRET` | 建议 `openssl rand -base64 32` 生成 |
| `DATA_ENCRYPTION_KEY` | 是 | 是 | secret `DATA_ENCRYPTION_KEY` | 独立生成至少 32 字符，不得等于认证密钥 |
| `DATA_ENCRYPTION_KEY_PREVIOUS` | 是 | 否 | secret `DATA_ENCRYPTION_KEY_PREVIOUS` | 仅轮换窗口配置，不得等于当前数据密钥 |
| `BETTER_AUTH_URL` | 否 | 是 | var `BETTER_AUTH_URL` | 生产 HTTPS origin，不含路径、查询或 fragment |

> workflow 会在安装依赖前校验所有必需 Secrets；缺值、密钥少于 32 字符、数据密钥与认证密钥相同或 `BETTER_AUTH_URL` 不是纯 HTTPS origin 时会立即失败。`DATA_ENCRYPTION_KEY_PREVIOUS` 为空时不会注入 Worker。
>
> `APP_NAME` 已在 `wrangler.jsonc.vars` 中默认 `hide-port-tool`，无需在 CI 设置。

## 需要配置的仓库 Variables

| GitHub Variable 名 | 必需 | 对应的 Worker 变量 | 说明 |
|---|---|---|---|
| `OAUTH_ALLOWED_HOSTS` | 否 | var `OAUTH_ALLOWED_HOSTS` | 逗号分隔精确主机或 `*.example.com` 子域模式；不含 scheme、端口或路径 |

未使用自定义 OAuth 主机时可留空。内置模板主机仍由代码内固定策略校验。

## `CLOUDFLARE_DOMAINS_API_TOKEN` 详细格式

单一变量汇总所有根域名的 Cloudflare DNS API Token：

```
<域名1>:<token1>,<域名2>:<token2>,...
```

### 例子

仓库 secret `CLOUDFLARE_DOMAINS_API_TOKEN` 的值：

```
example1.com:abc123_your_token_here,example2.com:def456_your_token_here
```

### CI 解析后的行为

1. **token 注入**：每个域名前的 `:` 切分为「域名 / token」，CI 把每个 token 以 `<域名中的点→下划线>_CLOUDFLARE_API_TOKEN`（小写）的 secret 名循环 `wrangler secret put` 注入 Worker。例：`303302.xyz` → Worker secret `303302_xyz_CLOUDFLARE_API_TOKEN`。
2. **DOMAINS 派生**：CI 把解析出的域名清单覆盖到 Worker 的 `DOMAINS` 普通环境变量（`["303302.xyz","example.com"]` 形式），无需单独设置 `DOMAINS` secret。

最终运行时的 `DOMAINS` 中每个根域名都必须有对应 token，否则该域名创建 DNS 记录时会因找不到 token 而失败。

## 新增根域名

把对应的 `<域名>:<Token>` 拼接到 `CLOUDFLARE_DOMAINS_API_TOKEN` 末尾（英文 `,` 分隔）即可。CI 自动把新域名加入 Worker 的 `DOMAINS` 变量并注入对应 Token，无需改 workflow 或新增单独 secret。

## 域名清单的单一事实来源

| 来源 | 是否生效 | 备注 |
|---|---|---|
| GitHub Secret `CLOUDFLARE_DOMAINS_API_TOKEN` | 是 | CI 部署时唯一维护入口，派生域名列表和每域 token |
| `wrangler.jsonc.vars.DOMAINS` | CI 中会被覆盖 | 仅手动部署或本地开发时维护 |
| 单独的 GitHub `<domain>_CLOUDFLARE_API_TOKEN` | 否 | workflow 不读取，避免受 GitHub secret 命名限制影响 |

## 迁移与发布顺序

workflow 在 `wrangler-action` 的 `preCommands` 中先执行 D1 对齐和远端迁移，再执行 `deploy --minify`。因此 `0012`/`0013` 会在新 Worker 接收请求前生效。迁移兼容校验禁止同一发布删除旧 Worker 仍依赖的表、列、索引或约束。

生产发布前后的备份、监控、回滚与恢复步骤见 [`production-runbook.md`](production-runbook.md)。

## 示例：单域名最小配置

仓库 Secrets 配置：

| Secret 名 | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | `<部署用账户级 Token，含 Workers + D1 权限>` |
| `CLOUDFLARE_ACCOUNT_ID` | `<你的 Account ID>` |
| `CLOUDFLARE_DOMAINS_API_TOKEN` | `303302.xyz:<该域名 DNS 编辑权限 Token>` |
| `BETTER_AUTH_URL` | `https://mc.303302.xyz` |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` 生成的随机串 |
| `DATA_ENCRYPTION_KEY` | 另一次 `openssl rand -base64 32` 生成的独立随机串 |

CI 部署后 Worker 拥有：

- 明文 var `DOMAINS = ["303302.xyz"]`、`BETTER_AUTH_URL = https://mc.303302.xyz`
- secret `303302_xyz_CLOUDFLARE_API_TOKEN`、`BETTER_AUTH_SECRET`、`DATA_ENCRYPTION_KEY`
- custom domain `mc.303302.xyz` 绑定到该 Worker（DNS + 证书由 Cloudflare 自动管理）

## 示例：双域名 + 后台配置 OAuth

仓库 Secrets 配置：

| Secret 名 | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | `<账户级部署 Token>` |
| `CLOUDFLARE_ACCOUNT_ID` | `<Account ID>` |
| `CLOUDFLARE_DOMAINS_API_TOKEN` | `example1.com:tok_A,example.com:tok_B` |
| `BETTER_AUTH_URL` | `https://mc.example.com` |
| `BETTER_AUTH_SECRET` | `<至少 32 字符随机串>` |
| `DATA_ENCRYPTION_KEY` | `<另一份独立的至少 32 字符随机串>` |

CI 部署后 Worker 拥有：

- 明文 var `DOMAINS = ["example1.com","example2.com"]`、`BETTER_AUTH_URL`
- secret `example1_com_CLOUDFLARE_API_TOKEN`、`example2_com_CLOUDFLARE_API_TOKEN`、`BETTER_AUTH_SECRET`、`DATA_ENCRYPTION_KEY`
- custom domain `mc.example.com` 绑定到该 Worker

### 部署后配置 OAuth

1. 用 onboarding 创建的超级管理员登录站点。
2. 打开管理后台 → **OAuth 登录应用**。
3. 选择模板（GitHub / Google / Microsoft / Discord / Linux.do / Generic OIDC）或自定义端点。
4. 在第三方平台登记回调地址：

```txt
https://mc.example.com/api/auth/oauth2/callback/<provider_id>
```

5. （可选）在注册设置中开启邀请码、配置 GitHub 最短注册天数、选择 `email` / `oauth` / `both` 注册模式。

## 手动触发与发布后检查

在 **Actions** 页面选择 *Deploy to Cloudflare Workers* → **Run workflow**。完成后至少检查：

1. workflow 的迁移步骤早于 Worker deploy，且所有步骤成功。
2. 登录页与静态 CSS/JS 正常，安全响应头存在。
3. 创建、更新、删除一条测试 DNS 记录，确认远端与 D1 一致。
4. 检查 `sync_status = 'error'`、用户删除作业 `failed` 或长期 `running`，以及 Worker 5xx/结构化安全事件。
5. 启用邮件或 OAuth 时执行对应冒烟测试。
