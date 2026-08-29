# AGENTS.md

- 项目类型：Cloudflare Workers 单仓库应用，主入口 `src/index.ts`，使用 Hono 路由；页面 HTML 内容放在 `public/static/pages-*.js`。
- 核心能力：子域名分发系统；普通模式创建 A/AAAA/CNAME/TXT/SRV 记录，A/AAAA/CNAME 可开启 Cloudflare 代理；MC 模式继续创建目标记录 + `_minecraft._tcp` SRV 记录实现免输入端口。
- 主要依赖：`hono`、`better-auth`、`@better-auth/passkey`、`@simplewebauthn/browser`、`marked`、`sanitize-html`。
- 运行环境：Cloudflare Workers，`nodejs_compat`，Cloudflare D1，静态资源绑定 `ASSETS` 指向 `public/`。
- 包管理：使用 `pnpm`；不要混用 `npm`/`yarn` 更新 lockfile。

## 关键目录

- `src/index.ts`：Worker/Hono 应用入口；注册安全响应头、中间件和所有路由。
- `src/auth.ts`：better-auth、passkey、generic OAuth、首次初始化和用户创建 hooks。
- `src/routes/`：页面、认证、DNS、后台管理、个人设置、公告等路由。
- `src/services/`：Cloudflare DNS、D1 业务逻辑、OAuth、邮件、限流、设置、敏感数据、用户删除任务。
- `src/lib/`：安全、CSRF、API 响应、页面 shell、外部服务错误脱敏等共享工具。
- `src/styles/app.css`：Tailwind 输入文件。
- `public/static/`：构建输出 CSS 与浏览器脚本；`public/static/vendor/` 由脚本生成 WebAuthn 浏览器包。
- `migrations/`：D1 SQL 迁移；文件名采用 `0000_name.sql` 顺序，当前 DNS 记录以 `record_mode=dns|mc` 区分普通记录和 MC 模式。
- `0017_site_settings.sql`：站点首页标题/名称、普通 DNS 模式开关
- `migrations/triggers/`：D1 trigger SQL；安装由 `scripts/install-d1-triggers.cjs` 负责。
- `scripts/`：构建浏览器资源、D1/域名部署辅助、迁移安全校验。
- `tests/`：Vitest 测试，包含业务、安全、迁移和前端静态回归。
- `docs/`：本地部署、GitHub Actions 部署、生产 runbook。
- `.github/workflows/deploy.yml`：手动触发的 Cloudflare Workers 生产部署流程。

## 常用命令

- 安装依赖：`pnpm install`
- 构建静态资源：`pnpm run build`
- 构建 Tailwind CSS：`pnpm run build:css`
- 构建浏览器 vendor 资源：`pnpm run build:vendor`
- 本地开发：`pnpm run dev`
- 运行测试：`pnpm test`
- 监听测试：`pnpm run test:watch`
- 校验生产迁移：`pnpm run validate:migrations`
- 生成 Worker 类型：`pnpm run cf-typegen`
- 部署 Worker：`pnpm run deploy`
- 本地应用 D1 迁移：`pnpm wrangler d1 migrations apply domain-system-db --local`
- 远程应用 D1 迁移：`pnpm wrangler d1 migrations apply domain-system-db --remote`
- 本地安装 D1 triggers：`node scripts/install-d1-triggers.cjs --local`
- 远程安装 D1 triggers：`node scripts/install-d1-triggers.cjs --remote`

## 代码风格

- TypeScript 使用 ESM，`strict: true`，模块解析为 `Bundler`。
- TypeScript/浏览器 JS 现有风格偏向无分号、单引号、2 空格缩进；新增代码保持一致。
- 不新增 `.tsx` 文件；需要页面 HTML 时放到 `public/static/pages-*.js`，后端页面路由只挂载 shell 和数据 API。
- 路由注册保持集中在 `src/index.ts`；新增路由优先放入 `src/routes/` 并导出 `register*Routes`。
- 业务逻辑优先放入 `src/services/`，路由层只做认证、校验、响应拼装和流程编排。
- 共享安全/API/page 工具优先放入 `src/lib/`，避免在路由中重复实现。
- 测试文件放在 `tests/`，命名为 `*.test.ts`；D1 测试优先复用 `tests/helpers/d1.ts`。
- SQL 文件按数字前缀递增；`.gitattributes` 要求 `*.sql` 使用 LF。

## 安全与配置

- 不要提交 `.dev.vars`、`.env*`、日志、Wrangler 本地缓存或临时调试产物。
- 生产 secrets 使用 `wrangler secret put` 或 GitHub Actions secrets，不要写进 `wrangler.jsonc`。
- 必填敏感变量：`BETTER_AUTH_SECRET`、`DATA_ENCRYPTION_KEY`、`BETTER_AUTH_URL`、DNS Token 配置。
- `BETTER_AUTH_SECRET` 和 `DATA_ENCRYPTION_KEY` 至少 32 字符，且必须相互独立。
- OAuth 应用配置存储在 D1 `oauth_provider`，不要新增 `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` 环境变量路径。
- DNS 配置推荐使用 `CLOUDFLARE_DOMAINS_API_TOKEN=<domain>:<token>,...`；旧式 `DOMAINS` + 每域名 token 仅作兼容。
- Cookie 鉴权的状态变更必须保留同源校验和 CSRF 校验。
- 外部服务错误、DNS 错误、首次设置错误和 OAuth 注册错误需要脱敏记录；不要记录密码、token、cookie、请求体、原始异常堆栈或 IP/User-Agent。
- 账号绑定当前禁止不同邮箱跨 OAuth 绑定：`OAUTH_ACCOUNT_LINKING_ALLOW_DIFFERENT_EMAILS = false`。

## 数据库与迁移

- 迁移从 `0012` 起必须包含 `-- deployment: backward-compatible` 标记，并通过 `pnpm run validate:migrations`。
- 生产迁移路径禁止 destructive SQL：`DROP`、破坏性 `ALTER TABLE`、schema rewriting pragma、`VACUUM`。
- 生产内联 `ALTER TABLE` 仅允许 `ADD COLUMN`；其他结构变更需要分阶段方案。
- trigger SQL 必须单行、幂等，并以 `CREATE TRIGGER IF NOT EXISTS` 开头。
- 新增或修改 trigger 后，需要确认 `scripts/install-d1-triggers.cjs --local|--remote` 仍能安装。
- 首次管理员初始化依赖 D1 `first_setup` 单例状态机；不要退回到“用户数量判断 setup 是否开放”的逻辑。
- DNS 同步失败应保留本地 pending/sync 状态并允许重试；不要用删除本地行掩盖远端失败。

## 测试约定

- Vitest 配置：Node 环境、fork pool、`fileParallelism: false`、`isolate: true`。
- 涉及 D1 的测试用 Miniflare；注意测试 helper 会避开 Fetch blocked ports。
- 修改认证、注册、OAuth、DNS、迁移、公告、外部请求或敏感数据逻辑时，优先运行相关 `tests/*.test.ts`，再按需运行 `pnpm test`。
- 没有独立 lint/format 脚本；不要新增格式化工具，除非项目明确决定引入。

## 前端资源

- Tailwind 内容扫描范围：`src/**/*.{ts,tsx}` 与 `public/static/**/*.js`。
- 主题色扩展在 `tailwind.config.cjs` 的 `brand` 色板中。
- `public/static/app.css` 由 `pnpm run build:css` 生成；改动样式后需重新构建。
- WebAuthn 浏览器 bundle 由 `scripts/build-browser-assets.cjs` 从 `@simplewebauthn/browser` 生成；不要手改生成文件作为长期方案。

## 部署流程

- GitHub Actions 部署为手动 `workflow_dispatch`。
- CI 使用 Node.js 24、pnpm 9、Wrangler `4.108.0`。
- 部署顺序：校验 secrets/token -> `pnpm install --frozen-lockfile` -> 确保 D1 -> patch custom domain -> 远程迁移 -> 安装远程 triggers -> `wrangler deploy --minify`。
- `wrangler.jsonc` 当前 D1 `database_id` 是占位值 `REPLACE_WITH_D1_DATABASE_ID`，部署脚本会写回/修补；手动部署前需确认真实值。

## 待补充规则

- 编码禁忌：TODO
- 部署/回滚约束：TODO
- Cloudflare DNS 配额、清理策略或风控约束：TODO
- 生产数据手工修复流程：TODO

## 代码测试与 Git 操作

- 不需要每次改动都运行完整 `pnpm test`，有多个任务的情况下，在任务全部完成之后再测试代码
- Git 提交仅在实现新功能，或者修复问题，且通过测试之后可以提交。使用 Conventional Commits（如 `feat: ...`, `fix: ...`），语言优先使用简体中文。
- 网站设置
  - 后台「全局设置」可修改标签栏标题和主页左上角站点名称。
  - DNS 普通模式可全局禁用：关闭后仅允许 MC 记录，已有普通记录不受限。
