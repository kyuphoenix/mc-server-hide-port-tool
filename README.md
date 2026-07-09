# Minecraft 端口隐藏工具

基于 Cloudflare Workers + Hono + better-auth 实现的 Minecraft 端口隐藏工具。通过 Cloudflare DNS SRV 记录让玩家无需输入端口号即可连接服务器。

主要特性：

- **首次启动自动 onboarding**：检测到无用户时强制跳转 `/setup` 创建首个管理员并直接登录
- **多角色权限**：普通用户可创建/删除自己的 DNS 记录；管理员可访问后台管理所有用户、所有记录和全局设置
- **可配置的注册流程**：管理员可在后台开启/关闭注册，选择「邮箱 / GitHub / 邮箱+GitHub」三种方式之一
- **邮箱后缀白/黑名单**：可同时启用，按后缀匹配（支持子域后缀，如填 `gmail.com` 会同时匹配 `mail.gmail.com`）
- **邮箱验证码**：启用 Resend 后，邮箱注册需先收到 6 位验证码；未启用时输入邮箱密码直接完成注册
- **GitHub OAuth 注册**：可限定 GitHub 账号注册最短天数（用 access token 调 `/user` 取 `created_at` 比对，不达标会回滚已创建账号）
- **多根域名支持**：每个根域名使用独立的 Cloudflare API Token（按 `<域名点换下划线>_CLOUDFLARE_API_TOKEN` 命名），可对应不同 Cloudflare 账户
- **D1 持久化**：用户、会话、DNS 记录归属、验证码、全局设置全部存于 Cloudflare D1

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

## 管理后台功能（`/admin`）

仅 `role=admin` 的用户可访问，普通用户访问会被重定向到 `/`。

| 模块 | 说明 |
|---|---|
| 注册设置 | 开关注册、选择模式（邮箱/GitHub/邮箱+GitHub）、GitHub 账号最短注册天数 |
| 邮箱后缀白/黑名单 | 独立开关 + 后缀列表（逗号分隔），子域后缀自动匹配 |
| 邮件服务（Resend） | 开关、API Key（留空保留既有值）、发件人地址；启用后邮箱注册走 6 位验证码流程 |
| 用户管理 | 列出所有用户、设为管理员/降级、删除（级联删除其 DNS 记录和会话） |
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
  0000_init.sql           # better-auth 基础表
  0001_admin.sql          # admin 后台所需表 + 角色字段
src/
  auth.ts                 # better-auth 实例 + 鉴权 helper
  index.tsx               # Hono 路由 + Cloudflare API 封装
  services/
    settings.ts           # D1 settings 单行读写 + 邮箱白/黑名单校验
    dns-records.ts        # DNS 记录归属表 CRUD + 用户管理 helpers
    mailer.ts             # Resend HTTP API 发送验证码
    github.ts             # 调用 GitHub /user 取 created_at 校验
  views/
    Layout.tsx            # 通用 HTML 外壳
    SetupView.tsx         # 首次 onboarding
    LoginView.tsx
    RegisterView.tsx      # 按 settings.registration_mode 动态渲染
    VerifyEmailView.tsx   # 验证码输入
    IndexView.tsx         # 普通用户主页（含自己的记录列表）
    AdminView.tsx         # 管理后台（设置/用户/DNS 记录三合一）
public/static/
  main.js                 # 首页 DNS 表单交互（fetch /api/domains, /api/create-dns）
```
