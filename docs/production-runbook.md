# 生产运行手册

最后核对日期：2026-07-17

适用对象：Cloudflare Worker `mc-server-hide-port-tool`、D1 数据库 `mc-server-hide-port-tool-db`。

## 1. 发布前检查

### 1.1 必需配置

仓库 **Settings → Secrets and variables → Actions** 必须配置：

| 类型 | 名称 | 要求 |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | 仅授予部署 Worker、写入 Worker secret、管理目标 D1/域名所需的最小权限 |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | 目标 Cloudflare 账户 |
| Secret | `CLOUDFLARE_DOMAINS_API_TOKEN` | `domain:token` 逗号分隔；每个 token 仅允许对应 Zone 的 DNS 编辑 |
| Secret | `BETTER_AUTH_URL` | 生产 HTTPS origin，不含路径、查询或 fragment |
| Secret | `BETTER_AUTH_SECRET` | 至少 32 字符的高熵随机值 |
| Secret | `DATA_ENCRYPTION_KEY` | 独立于认证密钥，至少 32 字符的高熵随机值 |
| Secret | `DATA_ENCRYPTION_KEY_PREVIOUS` | 仅在数据密钥轮换窗口存在 |
| Variable | `OAUTH_ALLOWED_HOSTS` | OAuth 端点主机白名单；未使用 OAuth 时可为空 |

Resend API key 与 OAuth client secret 只能通过超级管理员界面写入，禁止写入仓库、CI 日志或普通管理员可见响应。

### 1.2 本地/CI 门禁

发布前必须全部通过：

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm run validate:migrations
pnpm test
pnpm exec tsc --noEmit
pnpm exec wrangler deploy --dry-run
pnpm audit --prod
```

迁移 `0012` 及之后必须保持向后兼容。发布流程先应用迁移，再部署 Worker，因此禁止在同一次发布中删除旧 Worker 仍会读取的表、列、索引或约束。

### 1.3 发布后冒烟检查

1. 打开登录页，确认 HTTPS、静态 CSS/JS、CSP 和安全响应头正常。
2. 用普通用户登录，确认只能查看和管理自己的 DNS 记录。
3. 创建一条测试 DNS 记录，确认 D1 状态最终为 `active`，Cloudflare 上 A/AAAA 与 SRV 记录一致。
4. 更新并删除测试记录，确认远端记录与 D1 状态一致。
5. 用超级管理员打开系统设置和 OAuth 配置，确认敏感值仅显示“已配置”状态，不回显原文。
6. 若启用邮件，发送测试邮件；若启用 OAuth，分别验证登录和同邮箱账号绑定。
7. 检查 Worker 日志与指标，确认发布后没有持续新增错误事件。

## 2. 监控与告警

Wrangler 配置已启用 Worker observability。生产环境至少建立以下面板和告警：

| 信号 | 建议告警条件 | 处置入口 |
| --- | --- | --- |
| Worker 5xx 比例 | 5 分钟持续高于基线或 1% | 查看最新部署、错误事件和 D1/外部服务状态 |
| Worker 延迟 | P95/P99 明显高于 7 日基线 | 区分 D1、Cloudflare API、GitHub、Resend、OAuth 上游延迟 |
| D1 查询错误 | 5 分钟连续出现或突增 | 检查迁移、配额、锁/超时与 D1 状态页 |
| `dns_external_service_failed` | 同一 stage/code 5 分钟 >= 5 次 | 检查 Cloudflare token 权限、Zone、上游状态和同步状态 |
| `mail_external_service_failed` | 10 分钟 >= 3 次 | 检查 Resend 账户、配额、发件域验证和上游状态 |
| `user_deletion_failed` | 任意出现 | 检查删除作业进度并从管理界面重试 |
| `oauth_registration_failed` | 同 provider/failure_type 突增 | 检查邀请策略、回调状态、防重放和 provider 配置 |
| `oauth_provider_runtime_rejected` | 任意出现 | 检查 HTTPS 端点与 `OAUTH_ALLOWED_HOSTS` |
| `first_setup_security` | 生产初始化完成后任意出现 | 检查初始化状态、并发认领和异常访问 |
| `auth_route_failure` / `admin_route_failure` / `settings_route_failure` | 持续出现 | 按 operation 定位路由，关联部署时间与请求 ID |

日志只允许记录代码中的结构化事件字段。禁止临时记录以下内容：Cookie、Authorization header、OAuth token/client secret、Cloudflare/Resend token、邮箱原文、请求/响应 body、完整 URL query、堆栈中的环境变量。

## 3. 事件处置

### 3.1 通用分诊

1. 记录事件开始时间、受影响功能、Worker 部署版本、D1 bookmark 和影响范围。
2. 按事件名、`stage`、`code`、`operation` 聚合，不复制请求 body 或 secret。
3. 判断问题属于 Worker 回归、D1 数据/迁移、外部服务、密钥/权限还是滥用流量。
4. Worker 回归优先回滚 Worker；数据损坏才进入 D1 恢复流程。
5. 恢复后执行第 1.3 节冒烟检查，并记录实际 RTO、数据损失窗口和后续动作。

### 3.2 DNS 同步故障

- 查询 D1 中记录的 `sync_status`、`sync_error_code` 与 pending 字段，不把 token 或上游响应体复制到工单。
- `error` 状态表示本地仍保留期望变更，可由用户或管理员重试。
- Cloudflare 404 删除按幂等成功处理；其他失败不得手工删除本地行来“清状态”。
- 检查聚合 secret 中域名是否与 `DOMAINS` 一致，以及对应 token 是否仍有 Zone DNS 编辑权限。

### 3.3 用户删除作业

- `user_deletion_job` 每次最多处理 5 条 DNS 记录；接口返回 202 时前端会继续轮询。
- `running` 租约有效期为 60 秒。进程中断后等待租约过期，再从管理界面重新点击删除即可恢复。
- `failed` 不代表用户已删除。远端 DNS 删除成功后才删除本地 DNS 行；全部 DNS 清理完成后才执行用户级联删除。
- 不要直接删除 `user_deletion_job` 或用户行。只有确认远端 DNS 已清理且作业无法恢复时，才在维护窗口内进行人工修复并保留审计记录。

## 4. D1 恢复与演练

Cloudflare D1 Time Travel 是原库覆盖恢复；当前不能把生产 bookmark 直接克隆到另一 D1。生产恢复会取消正在执行的查询，因此必须在维护窗口操作。

### 4.1 季度恢复演练

1. 创建独立的演练 D1 数据库，使用脱敏数据或生产导出的受控副本导入。不得把生产 PII 放入低权限测试环境。
2. 在演练库执行写入和误删场景，记录事故前时间与 bookmark。
3. 获取时间点 bookmark：

```powershell
pnpm exec wrangler d1 time-travel info <drill-db-name> --timestamp "2026-07-17T10:00:00+08:00"
```

4. 执行恢复并记录命令返回的“恢复前 bookmark”，它是撤销本次恢复的入口：

```powershell
pnpm exec wrangler d1 time-travel restore <drill-db-name> --bookmark <bookmark>
```

5. 验证表结构、管理员账户、设置、DNS 同步字段、OAuth provider、删除作业与关键行数。
6. 用恢复前 bookmark 撤销一次恢复，确认双向操作可用。
7. 记录演练 RPO、RTO、Wrangler 版本、执行人和验证结果。目标值必须由业务负责人确认，不在代码中假定。

### 4.2 生产恢复

1. 冻结发布和高风险管理操作，公告维护窗口。
2. 确认 D1 使用 production backend：

```powershell
pnpm exec wrangler d1 info mc-server-hide-port-tool-db
```

3. 获取并保存当前 bookmark：

```powershell
pnpm exec wrangler d1 time-travel info mc-server-hide-port-tool-db --json
```

4. 额外导出当前生产状态到受控、加密、限权目录。导出会阻塞数据库请求，应在维护窗口执行：

```powershell
pnpm exec wrangler d1 export mc-server-hide-port-tool-db --remote --output .\incident-pre-restore.sql
```

5. 先查询目标时间对应 bookmark，再由两人复核时间、时区和 bookmark：

```powershell
pnpm exec wrangler d1 time-travel info mc-server-hide-port-tool-db --timestamp "<RFC3339 timestamp>" --json
```

6. 恢复原库：

```powershell
pnpm exec wrangler d1 time-travel restore mc-server-hide-port-tool-db --bookmark <bookmark>
```

7. 保存命令输出中的恢复前 bookmark。若恢复点错误，用该 bookmark 撤销。
8. 重新应用仓库迁移以确认结构完整，然后执行冒烟检查：

```powershell
pnpm exec wrangler d1 migrations apply mc-server-hide-port-tool-db --remote
node scripts/install-d1-triggers.cjs --remote
```

9. 事件关闭后把导出文件移入批准的加密备份位置或按保留策略安全销毁，禁止提交到 Git。

## 5. Worker 回滚

Worker 回归优先回滚 Worker，不对 D1 做破坏性“降级迁移”。

```powershell
pnpm exec wrangler versions list --name mc-server-hide-port-tool
pnpm exec wrangler rollback <version-id> --name mc-server-hide-port-tool --message "incident rollback <ticket>"
```

回滚后：

1. 确认流量已切到目标版本。
2. 执行登录、DNS 增删改、设置读取和管理员分页冒烟检查。
3. 确认旧 Worker 能读取当前 D1 schema。若不能，停止回滚并部署向前修复版本。
4. 保留已应用迁移；后续用新的向前兼容迁移修正数据或结构。

## 6. 密钥与 Token 轮换

### 6.1 `BETTER_AUTH_SECRET`

该值用于 Better Auth 以及旧数据兼容解密。轮换会使现有会话/签名失效，应安排维护窗口并通知用户重新登录。

1. 先确保独立 `DATA_ENCRYPTION_KEY` 已配置，且敏感设置不再依赖 `BETTER_AUTH_SECRET` 作为主数据密钥。
2. 生成至少 32 字符高熵新值并更新 GitHub Actions secret。
3. 触发完整部署，验证登录、注册、OAuth 和 CSRF。
4. 观察认证失败率；不要在日志或工单中记录旧值或新值。

### 6.2 `DATA_ENCRYPTION_KEY`

1. 把当前 `DATA_ENCRYPTION_KEY` 复制到 `DATA_ENCRYPTION_KEY_PREVIOUS`。
2. 生成新 `DATA_ENCRYPTION_KEY`，在同一次部署中同时注入 primary 与 previous。
3. 由超级管理员重新保存一次系统设置，使 Resend key 用新 primary 重封装。
4. 逐个编辑并保存 OAuth provider；client secret 输入可留空，服务会读取旧密文后用新 primary 重封装。
5. 等待所有旧 `email_verification` 记录过期并被清理；轮换窗口内不要移除 previous。
6. 验证邮件发送、OAuth 登录、注册和所有敏感配置读取。
7. 通过受控 D1 查询确认 `settings.resend_api_key` 与 `oauth_provider.client_secret` 均为 `enc:v1:` 密文；不要导出或打印字段原文。
8. 完成复核后删除 previous：

```powershell
pnpm exec wrangler secret delete DATA_ENCRYPTION_KEY_PREVIOUS --name mc-server-hide-port-tool
```

9. 同步清空 GitHub Actions Secrets 中的 `DATA_ENCRYPTION_KEY_PREVIOUS`，重新部署并再次验证。删除 previous 前必须确认所有仍需读取的敏感行已重封装或过期。

### 6.3 Cloudflare 域名 Token

1. 为单个 Zone 创建最小权限新 token。
2. 在 GitHub Actions Secret `CLOUDFLARE_DOMAINS_API_TOKEN` 中原子替换该 `domain:token` 项。
3. 部署后对该域名执行 DNS 创建、更新、删除测试。
4. 确认新 token 生效后撤销旧 token。

不要先撤销旧 token；否则部署或 DNS 操作会出现中断窗口。

### 6.4 Resend 与 OAuth secret

- Resend：在服务商侧创建新 key，通过超级管理员设置替换并发送测试邮件，成功后撤销旧 key。
- OAuth：先在 provider 侧增加/轮换 secret，再通过超级管理员 OAuth 配置保存，验证登录和同邮箱绑定后撤销旧 secret。
- 任一轮换失败都保留旧凭据到验证完成，且不得在聊天、日志或截图中暴露完整值。

## 7. OAuth 主机白名单

`OAUTH_ALLOWED_HOSTS` 是逗号分隔的 DNS hostname 模式，不含 scheme、端口、路径或通配符路径。

示例：

```text
accounts.example.com,*.login.example.net
```

规则：

- 精确项只允许该主机。
- `*.example.com` 只允许其子域，不应当作任意后缀匹配。
- 只允许 HTTPS OAuth/Discovery/UserInfo 端点。
- 不允许 IP literal、localhost、私有/保留地址或运行时 DNS 解析到非公网地址。
- 修改白名单后必须重新验证所有 provider；运行时拒绝会产生 `oauth_provider_runtime_rejected`。

## 8. 恢复完成检查表

- [ ] Worker 版本与事件记录一致。
- [ ] D1 当前 bookmark、恢复目标和撤销 bookmark 已保存。
- [ ] 所有迁移显示已应用，schema 与当前代码兼容。
- [ ] 登录、注册、OAuth、邮件、DNS 增删改冒烟通过。
- [ ] 管理员用户/DNS 分页总数合理，无隐藏记录。
- [ ] 用户删除作业无长期 `running` 或重复 `failed`。
- [ ] Worker 5xx、P95/P99、D1 错误和结构化安全事件恢复基线。
- [ ] secret 未进入日志、工单、导出文件名或 Git 历史。
- [ ] 记录实际 RPO/RTO、影响范围、根因与后续负责人。

## 9. 官方参考

- Cloudflare D1 Time Travel: https://developers.cloudflare.com/d1/reference/time-travel/
- Cloudflare D1 import/export: https://developers.cloudflare.com/d1/best-practices/import-export-data/
- Workers observability: https://developers.cloudflare.com/workers/observability/
- Workers metrics and analytics: https://developers.cloudflare.com/workers/observability/metrics-and-analytics/
- Workers rollbacks: https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/
- Wrangler commands: https://developers.cloudflare.com/workers/wrangler/commands/
