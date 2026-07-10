# Minecraft 端口隐藏工具

基于 Cloudflare Workers + Hono + better-auth 实现的 Minecraft 端口隐藏工具。通过 Cloudflare DNS SRV 记录让玩家无需输入端口号即可连接服务器。

主要特性：

- **首次启动自动 onboarding**：检测到无用户时强制跳转 `/setup` 创建首个管理员并直接登录；首个用户自动被标记为「超级管理员」（不可被其他管理员降级或删除）
- **多角色权限**：普通用户可创建/删除自己的 DNS 记录；管理员可访问后台管理所有用户、所有记录和全局设置；管理员可在后台手动创建用户（无需走注册页）
- **可配置的注册流程**：管理员可在后台开启/关闭注册，选择「邮箱 / GitHub / 邮箱+GitHub」三种方式之一
- **邮箱后缀白/黑名单**：可同时启用，按后缀匹配（支持子域后缀，如填 `gmail.com` 会同时匹配 `mail.gmail.com`）
- **邮箱验证码**：启用 Resend 后，邮箱注册需先收到 6 位验证码；未启用时输入邮箱密码直接完成注册
- **GitHub OAuth 注册**：可限定 GitHub 账号注册最短天数（用 access token 调 `/user` 取 `created_at` 比对，不达标会回滚已创建账号）
- **多根域名支持**：每个根域名使用独立的 Cloudflare API Token（按 `<域名点换下划线>_CLOUDFLARE_API_TOKEN` 命名），可对应不同 Cloudflare 账户
- **记录数量上限**：全局 `max_records_per_user` 控制默认每用户可创建 DNS 记录数；管理员可在后台对单个用户覆盖该上限
- **子域名最小字符长度**：全局 `min_subdomain_length` 限制子域名最短字符数（例如设为 4 时只能用 `1111.example.com` 或更长）
- **D1 持久化**：用户、会话、DNS 记录归属、验证码、全局设置全部存于 Cloudflare D1
- **GitHub Actions 一键部署**：CI 自动创建 D1、应用迁移、注入 secrets/vars 并部署 Worker，详见 [部署方法](#部署方法)

## 技术栈

- 运行时：Cloudflare Workers（`nodejs_compat`）
- Web 框架：Hono（JSX SSR）
- 鉴权：better-auth（邮箱密码 + GitHub social provider）
- 存储：Cloudflare D1（SQLite）
- 邮件：Resend HTTP API（Workers 不支持 TCP，无法直连 SMTP）

## 前置要求

- Node.js 18+
- pnpm
- Cloudflare 账户，并已添加至少一个根域名到 Cloudflare DNS
- 每个根域名一份具有 DNS 编辑权限的 Cloudflare API Token

## 本地开发

1. 安装依赖：

```txt
pnpm install
```

2. 创建 D1 数据库（首次）：

```txt
pnpm wrangler d1 create hide-port-tool-db
```

将控制台返回的 `database_id` 填入 `wrangler.jsonc` 的 `d1_databases[0].database_id` 字段（替换 `REPLACE_WITH_D1_DATABASE_ID`）。

3. 应用迁移：

```txt
pnpm wrangler d1 migrations apply hide-port-tool-db --local
```

迁移建表清单：
- `0000_init.sql` — better-auth 的 `user` / `session` / `account` / `verification` 四张表
- `0001_admin.sql` — `user` 表加 `role` 列，新增 `dns_record` / `settings` / `email_verification` 三张表
- `0002_super_admin_and_limits.sql` — `user` 表加 `super_admin` / `record_limit` 列；`settings` 表加 `max_records_per_user` / `min_subdomain_length`

4. 复制 `.dev.vars.example` 为 `.dev.vars` 并填写。每个根域名使用一个独立的 Cloudflare API Token，环境变量名为 `<域名中的点替换为下划线>_CLOUDFLARE_API_TOKEN`：

```
example_com_CLOUDFLARE_API_TOKEN=...
example_net_CLOUDFLARE_API_TOKEN=...
DOMAINS=["example.com","example.net"]
BETTER_AUTH_SECRET=openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:8787
GITHUB_CLIENT_ID=            # 仅当后台选择 GitHub 注册方式时需要
GITHUB_CLIENT_SECRET=
```

> 生产环境请用 `wrangler secret put BETTER_AUTH_SECRET` 等命令设置密钥，切勿写入 wrangler.jsonc。

5. 启动开发服务器：

```txt
pnpm dev
```

浏览器访问 `http://localhost:8787`：

- **首次启动**（user 表为空）自动跳转 `/setup`，创建第一个管理员账户后直接登录进入主页
- **后续启动**未登录则跳 `/login`，登录后普通用户看自己的 DNS 记录并创建/删除；管理员额外可看到「管理后台」入口

## 部署到生产

```txt
pnpm wrangler d1 migrations apply hide-port-tool-db --remote
pnpm wrangler secret put example_com_CLOUDFLARE_API_TOKEN
pnpm wrangler secret put example_net_CLOUDFLARE_API_TOKEN    # 多域名逐个 put
pnpm wrangler secret put BETTER_AUTH_SECRET
pnpm wrangler secret put GITHUB_CLIENT_ID                    # 可选
pnpm wrangler secret put GITHUB_CLIENT_SECRET                # 可选
pnpm deploy
```

部署完成后访问站点会进入 onboarding 流程；创建管理员后即可在 `/admin` 后台配置注册方式 / 邮箱白名单 / Resend / GitHub 账号年限等。

## 部署方法

支持两种部署方式：本地命令行 / GitHub Actions CI。

### 方式一：本地命令行部署

前置：安装 wrangler（已随 devDependencies 安装），登录 `pnpm wrangler login` 或配置 `CLOUDFLARE_API_TOKEN` 环境变量。

1. 应用迁移到远端 D1：

   ```txt
   pnpm wrangler d1 migrations apply hide-port-tool-db --remote
   ```

2. 设置 Worker secrets（敏感变量用 `wrangler secret put`，切勿写入 wrangler.jsonc）：

   ```txt
   pnpm wrangler secret put example_com_CLOUDFLARE_API_TOKEN
   pnpm wrangler secret put example_net_CLOUDFLARE_API_TOKEN   # 多域名逐个 put
   pnpm wrangler secret put BETTER_AUTH_SECRET
   pnpm wrangler secret put GITHUB_CLIENT_ID                    # 可选
   pnpm wrangler secret put GITHUB_CLIENT_SECRET                # 可选
   ```

3. 编辑 `wrangler.jsonc` 的 `vars` 字段（明文非敏感变量）并部署：

   ```txt
   pnpm deploy
   ```

> ⚠️ 首次部署前需要把 `wrangler.jsonc` 中 `d1_databases[0].database_id` 替换为真实 D1 UUID。可用 `pnpm wrangler d1 create hide-port-tool-db` 创建后复制返回值，或先在 `.dev.vars` 配好后用 `pnpm wrangler d1 list` 查看。

### 方式二：GitHub Actions 一键部署（推荐生产环境）

仓库已附带 `.github/workflows/deploy.yml`，推送到 `main` / `master` 分支或在 Actions 页面手动触发即可自动完成：**幂等创建 D1 并写回 `database_id` → 应用远端迁移 → 部署 Worker → 注入 secrets/vars**。

#### 需要在仓库 Settings → Secrets 中配置的变量

**A. Cloudflare 部署凭据（2 个）**

| Secret 名 | 说明 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 需含 *Workers Scripts: Edit*、*D1: Edit* 权限 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID（dashboard 右下角） |

**B. 业务环境变量**

`.dev.vars.example` 里出现的每个键 `K`，对应在仓库 secrets 中直接用同名（GitHub Actions secret / env 名仅允许 `[A-Z0-9_]`，故把键名全大写即可）：

| `.dev.vars.example` 键 | GitHub Secret 名 | 是否敏感 |
|---|---|---|
| `example1_com_CLOUDFLARE_API_TOKEN` | `EXAMPLE1_COM_CLOUDFLARE_API_TOKEN` | ✅ 走 `wrangler secret put` |
| `example2_com_CLOUDFLARE_API_TOKEN` | `EXAMPLE2_COM_CLOUDFLARE_API_TOKEN` | ✅ 走 `wrangler secret put` |
| `BETTER_AUTH_SECRET` | `BETTER_AUTH_SECRET` | ✅ |
| `GITHUB_CLIENT_ID` | `GITHUB_CLIENT_ID` | ✅ |
| `GITHUB_CLIENT_SECRET` | `GITHUB_CLIENT_SECRET` | ✅ |
| `DOMAINS` | `DOMAINS` | ❌ 明文 var（自动写入 wrangler.jsonc） |
| `BETTER_AUTH_URL` | `BETTER_AUTH_URL` | ❌ 明文 var |

> 判定是否敏感的规则：键名包含 `CLOUDFLARE_API_TOKEN` / `BETTER_AUTH_SECRET` / `GITHUB_CLIENT_SECRET` / `GITHUB_CLIENT_ID` 视为 secret，其余走明文 var。
> `DOMAINS` 等 JSON 数组类变量在写入时会自动 `JSON.parse`，可直接传 `["a.com","b.com"]` 字符串。
> `*_CLOUDFLARE_API_TOKEN` 类键命名约定：GitHub secret 名把 `CLOUDFLARE_API_TOKEN` 前置以避免数字开头，例如 `303302_xyz_CLOUDFLARE_API_TOKEN` → `CLOUDFLARE_API_TOKEN_303302_XYZ`。

**BETTER_AUTH_URL 自动绑定 custom domain**：CI 部署前会把 `BETTER_AUTH_URL` 解析出主机名，写入 `wrangler.jsonc` 的 `routes: [{ pattern, custom_domain: true }]`，由 `wrangler deploy` 一并创建/绑定 custom domain（含 DNS 与证书）。指向 workers.dev 或未配置 BETTER_AUTH_URL 时会安全跳过。

**新增根域名时**：在 `.dev.vars.example` 新增 `<域名点换下划线>_CLOUDFLARE_API_TOKEN=` 一行，并在仓库添加对应同名（大写形式）secret 即可，无需改动 workflow。

详见 [`docs/deploy-github-actions.md`](docs/deploy-github-actions.md)。

## 环境变量配置

本服务依赖以下环境变量。本地开发放 `.dev.vars`（已 gitignore），生产环境用 `wrangler secret put` 或 GitHub Actions（见上）。

### 明文变量（写入 wrangler.jsonc `vars` 或 `.dev.vars`）

| 变量 | 格式 | 示例 | 必需 |
|---|---|---|---|
| `APP_NAME` | 字符串 | `hide-port-tool` | 否 |
| `DOMAINS` | JSON 数组字符串 | `["example.com","example.net"]` | ✅ 至少一个根域名 |
| `BETTER_AUTH_URL` | URL | `http://localhost:8787` / `https://your-worker.workers.dev` | ✅ |

### 敏感变量（`wrangler secret put` 或 GitHub Actions secret）

| 变量 | 用途 | 备注 |
|---|---|---|
| `BETTER_AUTH_SECRET` | better-auth 会话签名密钥 | 至少 32 位随机串，可用 `openssl rand -base64 32` 生成 |
| `<域名点换下划线>_CLOUDFLARE_API_TOKEN` | 该根域名在 Cloudflare DNS 编辑权限的 API Token | 每个 `DOMAINS` 中的根域名都需配一个 |
| `GITHUB_CLIENT_ID` | GitHub OAuth client id | 仅在后台开启 GitHub 注册时需要 |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret | 同上 |

### 多根域名命名约定

每个根域名使用独立的 Cloudflare API Token，变量名按 `<域名中的点替换为下划线>_CLOUDFLARE_API_TOKEN`：

```
example_com_CLOUDFLARE_API_TOKEN=...
example_net_CLOUDFLARE_API_TOKEN=...
303302_xyz_CLOUDFLARE_API_TOKEN=...
```

代码中通过 `(env as Record<string, string|undefined>)[key]` 动态读取，无需额外类型配置。

## 管理后台功能（`/admin`）

仅 `role=admin` 的用户可访问，普通用户访问会被重定向到 `/`。

| 模块 | 说明 |
|---|---|
| 注册设置 | 开关注册、选择模式（邮箱/GitHub/邮箱+GitHub）、GitHub 账号最短注册天数 |
| 邮箱后缀白/黑名单 | 独立开关 + 后缀列表（逗号分隔），子域后缀自动匹配 |
| 邮件服务（Resend） | 开关、API Key（留空保留既有值）、发件人地址；启用后邮箱注册走 6 位验证码流程 |
| 用户管理 | 列出所有用户、设为管理员/降级、删除（级联删除其 DNS 记录和会话）；手动创建用户（无需注册页）；逐用户设置 DNS 记录数上限 |
| 超级管理员 | 首个 onboarding 创建的用户被标记为超级管理员，普通管理员无法降级或删除 |
| 记录数上限 | 全局 `max_records_per_user` 控制默认上限；可对单个用户覆盖 |
| 子域名最小长度 | 全局 `min_subdomain_length` 控制子域名最短字符数 |
| DNS 记录管理 | 列出全站所有 DNS 记录、删除单条（同步删除 Cloudflare 中 A/AAAA/CNAME + SRV 记录） |

## 类型生成

修改 `wrangler.jsonc` 或 `.dev.vars` 后请重新生成类型：

```txt
pnpm cf-typegen
```

`wrangler types` 会自动扫描 `.dev.vars` 将其中的变量注入 `CloudflareBindings`，例如 `303302_xyz_CLOUDFLARE_API_TOKEN` 会以字面量 key 形式出现在 interface 中。代码中通过 `(env as Record<string, string|undefined>)[key]` 动态读取，无需关注类型细节。

实例化 Hono 时使用：

```ts
// src/index.tsx
const app = new Hono<{ Bindings: CloudflareBindings }>()
```

## 项目结构

```
migrations/
  0000_init.sql                       # better-auth 基础表
  0001_admin.sql                      # admin 后台所需表 + 角色字段
  0002_super_admin_and_limits.sql     # 超级管理员 + 记录上限 + 子域名最小长度
src/
  auth.ts                             # better-auth 实例 + 鉴权 helper
  index.tsx                           # Hono 路由 + Cloudflare API 封装
  services/
    settings.ts                       # D1 settings 单行读写 + 邮箱白/黑名单校验
    dns-records.ts                    # DNS 记录归属表 CRUD + 用户管理 + 限额 helpers
    mailer.ts                         # Resend HTTP API 发送验证码
    github.ts                         # 调用 GitHub /user 取 created_at 校验
  views/
    Layout.tsx                        # 通用 HTML 外壳
    SetupView.tsx                     # 首次 onboarding
    LoginView.tsx
    RegisterView.tsx                  # 按 settings.registration_mode 动态渲染
    VerifyEmailView.tsx               # 验证码输入
    IndexView.tsx                     # 普通用户主页（含自己的记录列表）
    AdminView.tsx                     # 管理后台（设置/用户/DNS 记录三合一）
public/static/
  main.js                             # 首页 DNS 表单交互（fetch /api/domains, /api/create-dns）
scripts/
  resolve_env_keys.py                 # 解析 .dev.vars.example 区分 secret/var 键名
.github/workflows/
  deploy.yml                          # CI：自动创建 D1 + 迁移 + 部署 + 注入 secrets
docs/
  deploy-github-actions.md            # GitHub Actions 部署详细说明
```
