# GitHub Actions 部署说明

仓库根目录的 `.github/workflows/deploy.yml` 提供自动部署 Worker 的能力：推送到 `main`/`master` 或手动触发即可在 GitHub Actions 中完成「创建 D1 → 应用迁移 → 部署 Worker → 注入 secrets/vars」全套流程。

## 需要配置的仓库 Secrets

在仓库 **Settings → Secrets and variables → Actions → New repository secret** 添加以下两类 secret：

### 1. Cloudflare 部署用账号凭据

| Secret 名 | 用途 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 用于部署 Worker、操作 D1。需要在 Cloudflare 后台生成，权限包含 *Workers Scripts: Edit*、*D1: Edit*。 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID，在 dashboard 右下角复制。 |

### 2. 业务环境变量（与 `.dev.vars.example` 同名）

`.dev.vars.example` 中的每个键 `K`，直接在仓库 secrets 中以同名（全大写化后）存放即可——**不再加任何前缀**。GitHub Actions secret / env 名仅允许 `[A-Z0-9_]`，所以把原键名全部大写就行。

> 该映射由 `scripts/resolve_env_keys.py` 同步使用，保持与之一致。

当前 `.dev.vars.example` 中的键 → 仓库 secret 名对照表：

| `.dev.vars.example` 键 | GitHub Secret 名 | 是否敏感 |
|---|---|---|
| `example1_com_CLOUDFLARE_API_TOKEN` | `EXAMPLE1_COM_CLOUDFLARE_API_TOKEN` | ✅ secret put |
| `example2_com_CLOUDFLARE_API_TOKEN` | `EXAMPLE2_COM_CLOUDFLARE_API_TOKEN` | ✅ secret put |
| `BETTER_AUTH_SECRET` | `BETTER_AUTH_SECRET` | ✅ secret put |
| `GITHUB_CLIENT_ID` | `GITHUB_CLIENT_ID` | ✅ secret put |
| `GITHUB_CLIENT_SECRET` | `GITHUB_CLIENT_SECRET` | ✅ secret put |
| `DOMAINS` | `DOMAINS` | ❌ 普通明文 var，写入 wrangler.jsonc |
| `BETTER_AUTH_URL` | `BETTER_AUTH_URL` | ❌ 普通明文 var |

> 若新增根域名，按 `<域名点换下划线>_CLOUDFLARE_API_TOKEN` 写到 `.dev.vars.example`，再添加对应同名（大写、`CLOUDFLARE_API_TOKEN` 前置）secret 即可，无需改 workflow。

> 关于 secret 命名：`*_CLOUDFLARE_API_TOKEN` 类键在 GitHub env 中需把 `CLOUDFLARE_API_TOKEN` 前置（避免数字开头），例：`303302_xyz_CLOUDFLARE_API_TOKEN` → `CLOUDFLARE_API_TOKEN_303302_XYZ`；其余键直接全大写。映射由 `scripts/resolve_env_keys.py` 自动处理。

**BETTER_AUTH_URL 自动绑定 custom domain**：CI 部署后会读取 `BETTER_AUTH_URL`，若指向非 `*.workers.dev` 的自定义主机名，会自动调用 Cloudflare API 把它绑定为 `hide-port-tool` worker 的 custom domain（要求该域名已托管在同一 Cloudflare 账户）。指向 workers.dev 或未配置 zone 时会安全跳过。

## 流程

1. 检出代码、安装 pnpm 依赖
2. 运行 `scripts/resolve_env_keys.py` 区分 secret_keys / var_keys
3. **把 var_keys 写回 `wrangler.jsonc.vars`**：从同名 env 变量读取，把数组类（如 `DOMAINS`）做 JSON.parse 后写入
4. **幂等创建/查找 D1**：通过 Cloudflare API 列出账户下 D1，若不存在则 POST 创建，并把 `database_id` 写回 `wrangler.jsonc`（避免本地占位符 `REPLACE_WITH_D1_DATABASE_ID` 导致部署失败）
5. `wrangler d1 migrations apply hide-port-tool-db --remote` 应用迁移到远端 D1
6. `wrangler deploy --minify` 部署 Worker
7. 循环 `wrangler secret put <key>` 把每个 secret_keys 写入 Worker 作为环境变量

## 手动触发

在 **Actions** 页面选择 *Deploy to Cloudflare Workers* → **Run workflow** 即可。
