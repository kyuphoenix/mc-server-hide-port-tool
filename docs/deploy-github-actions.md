# GitHub Actions 一键部署（推荐生产环境）

仓库附带的 `.github/workflows/deploy.yml` 提供自动部署 Worker 的能力：在 Actions 页面手动触发 **Run workflow** 即可完成「幂等创建 D1 → 解析根域名 token → 应用远端迁移 → 部署 Worker → 注入 secrets/vars → 绑定 custom domain」全套流程。

> 若倾向于本地命令行部署，请改阅 [`deploy-local.md`](deploy-local.md)。

## 流程概览

1. 检出代码、安装 pnpm 依赖
2. **Build dynamic var/secret lists**：
   - 解析 `CLOUDFLARE_DOMAINS_API_TOKEN`，输出每根域名 wrangler secret 名（逗号分隔）+ JSON 值文件 + 域名数组清单
   - 探测各固定 secret 是否非空（GitHub OAuth 未配则自动跳过）
3. **Deploy Worker**：
   - `preCommands`：`ensure-d1-and-writeback.cjs`（幂等创建 D1 并写回 database_id）+ `patch-custom-domain.cjs`（按 `BETTER_AUTH_URL` 写入 `routes: [{pattern, custom_domain:true}]`）+ `wrangler d1 migrations apply --remote`
   - `wrangler deploy --minify`
   - `vars` 走 `--var` 注入，`secrets` 走 wrangler-action 内置的 `wrangler secret bulk`
   - `postCommands`：`put_domain_secrets.py` 循环 `wrangler secret put` 注入每根域名 token

## 需要在仓库 Settings → Secrets 中配置的变量

GitHub Actions 中 secret 名必须仅含 `[A-Z0-9_]` 且不能以数字开头，因此**根域名 Token 不再用 `*_CLOUDFLARE_API_TOKEN` 形式直接作为 GitHub secret 名**，而是统一汇总到 `CLOUDFLARE_DOMAINS_API_TOKEN`，由 CI 解析后再以 `<域名点换下划线>_CLOUDFLARE_API_TOKEN`（小写）注入到 Worker（与运行时代码读取的命名一致）。

### A. Cloudflare 部署凭据（2 个，必需）

| GitHub Secret 名 | 是否敏感 | 用途 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | ✅ secret | 用于部署 Worker、操作 D1。需要在 Cloudflare 后台生成，权限须含 *Workers Scripts: Edit* + *D1: Edit* |
| `CLOUDFLARE_ACCOUNT_ID` | ✅ secret | Cloudflare 账户 ID，在 dashboard 右下角复制 |

### B. 业务环境变量

| GitHub Secret 名 | 是否敏感 | 必需 | 对应的 Worker 变量 | 说明 |
|---|---|---|---|---|
| `CLOUDFLARE_DOMAINS_API_TOKEN` | ✅ secret | ✅ | 1. `<域点换下划线>_CLOUDFLARE_API_TOKEN`（每根域名一个）<br>2. `DOMAINS`（明文 var，由 CI 派生） | **核心变量**。格式见下方。同时承担两个职责：注入每根域名 Token + 派生 `DOMAINS` 域名清单 |
| `BETTER_AUTH_URL` | ❌ 明文 var | ✅ | `BETTER_AUTH_URL` | worker 对外访问 URL；若指向非 `*.workers.dev` 的自有域名，CI 会自动把它写入 `wrangler.jsonc` 的 `routes` 让 `wrangler deploy` 绑定为 custom domain（自动建 DNS + 证书） |
| `BETTER_AUTH_SECRET` | ✅ secret | ✅ | `BETTER_AUTH_SECRET` | better-auth 会话签名密钥。可用 `openssl rand -base64 32` 生成 |
| `GITHUB_CLIENT_ID` | ✅ secret | 否 | `GITHUB_CLIENT_ID` | 仅后台开启 GitHub 注册时需要；未配置则 CI 自动跳过，Worker 端不会出现该 secret |
| `GITHUB_CLIENT_SECRET` | ✅ secret | 否 | `GITHUB_CLIENT_SECRET` | 同上 |
| `DOMAINS` | ❌ 明文 var | 否 | （用作校验参考） | 仅当希望显式约束根域名清单时设置；未设 CI 自动从 `CLOUDFLARE_DOMAINS_API_TOKEN` 解析。若设置了，CI 校验其列出的每个域名是否都在 `CLOUDFLARE_DOMAINS_API_TOKEN` 中，缺漏会在日志警告 |

> CI 会探测每个 secret 是否非空，未配置的会自动跳过，不会因缺值而失败。
> `APP_NAME` 已在 `wrangler.jsonc.vars` 中设默认 `hide-port-tool`，无需在 CI 设置。

## `CLOUDFLARE_DOMAINS_API_TOKEN` 详细格式

单一变量汇总所有根域名的 Cloudflare DNS API Token，省去为每个域名单独建 GitHub secret 的麻烦：

```
<域名1>:<token1>,<域名2>:<token2>,...
```

### 例子

仓库 secret `CLOUDFLARE_DOMAINS_API_TOKEN` 的值：

```
303302.xyz:abc123_your_token_here,example.com:def456_your_token_here
```

### CI 解析后的行为

1. **token 注入**：每个域名前的 `:` 切分为「域名:token」，CI 把每个 token 以 `<域名中的点→下划线>_CLOUDFLARE_API_TOKEN`（小写）的 secret 名循环 `wrangler secret put` 注入 Worker，与运行时代码读取的命名一致。例：`303302.xyz` → Worker secret `303302_xyz_CLOUDFLARE_API_TOKEN`。
2. **DOMAINS 派生**：CI 把解析出的域名清单覆盖到 Worker 的 `DOMAINS` 普通环境变量（`["303302.xyz","example.com"]` 形式），无需单独设置 `DOMAINS` secret。

### 必须 DOMAINS ⊆ token 覆盖的域名

最终运行期的 `DOMAINS` 中每个根域名都必须有对应 token，否则该域名创建 DNS 记录时会因找不到 token 而失败。CI 会在日志中：

- 警告 `DOMAINS`（若显式设置）中存在但在 `CLOUDFLARE_DOMAINS_API_TOKEN` 中找不到的域名
- 警告 `CLOUDFLARE_DOMAINS_API_TOKEN` 中存在但 `DOMAINS`（若显式设置）未列出的域名（仍会注入 + 计入派生的 DOMAINS）

## 新增根域名

把对应「`<域名>:<Token>`」拼接到 `CLOUDFLARE_DOMAINS_API_TOKEN` 末尾（英文 `,` 分隔）即可。CI 自动把新域名加入 Worker 的 `DOMAINS` 变量并注入对应 Token，无需改 workflow 或新增 secret。

## 域名清单的单一事实来源

| 来源 | 是否生效 | 备注 |
|---|---|---|
| `CLOUDFLARE_DOMAINS_API_TOKEN` 中的域名 | ✅ 派生为最终 `DOMAINS` | 不论是否设置 `DOMAINS` secret，CI 都以此为准生成 Worker 的 `DOMAINS` 变量 |
| `DOMAINS` secret | ⚠️ 仅一致性校验 | 若设置，CI 检查其每一条是否都被 `CLOUDFLARE_DOMAINS_API_TOKEN` 覆盖；缺漏只在日志警告，不阻塞部署 |

## 示例：单域名最小配置

仓库 Secrets 配置：

| Secret 名 | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | `<部署用账户级 Token，含 Workers + D1 权限>` |
| `CLOUDFLARE_ACCOUNT_ID` | `<你的 Account ID>` |
| `CLOUDFLARE_DOMAINS_API_TOKEN` | `303302.xyz:<该域名 DNS 编辑权限 Token>` |
| `BETTER_AUTH_URL` | `https://mc.303302.xyz` |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` 生成的随机串 |

CI 部署后 Worker 拥有：
- 明文 var `DOMAINS = ["303302.xyz"]`、`BETTER_AUTH_URL = https://mc.303302.xyz`
- secret `303302_xyz_CLOUDFLARE_API_TOKEN`、`BETTER_AUTH_SECRET`
- custom domain `mc.303302.xyz` 绑定到该 Worker（DNS + 证书由 Cloudflare 自动管理）

## 示例：双域名 + GitHub OAuth

仓库 Secrets 配置：

| Secret 名 | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | `<账户级部署 Token>` |
| `CLOUDFLARE_ACCOUNT_ID` | `<Account ID>` |
| `CLOUDFLARE_DOMAINS_API_TOKEN` | `303302.xyz:tok_A,example.com:tok_B` |
| `BETTER_AUTH_URL` | `https://mc.303302.xyz` |
| `BETTER_AUTH_SECRET` | `<32位随机串>` |
| `GITHUB_CLIENT_ID` | `<GitHub OAuth App Client ID>` |
| `GITHUB_CLIENT_SECRET` | `<GitHub OAuth App Client Secret>` |

CI 部署后 Worker 拥有：
- 明文 var `DOMAINS = ["303302.xyz","example.com"]`、`BETTER_AUTH_URL`
- secret `303302_xyz_CLOUDFLARE_API_TOKEN`、`example_com_CLOUDFLARE_API_TOKEN`、`BETTER_AUTH_SECRET`、`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`
- custom domain `mc.303302.xyz` 绑定到该 Worker

## 手动触发

在 **Actions** 页面选择 *Deploy to Cloudflare Workers* → **Run workflow** 即可。
