import type { FC } from 'hono/jsx'
import type { OAuthProviderPublic } from '../services/oauth-providers'
import type { LinkedAccountRow, PasskeyRow } from '../services/user-settings'

export const SettingsView: FC<{
  name: string
  email: string
  role: string
  linkedAccounts: LinkedAccountRow[]
  availableProviders: OAuthProviderPublic[]
  passkeys: PasskeyRow[]
  profileError?: string
  profileInfo?: string
  oauthError?: string
  oauthInfo?: string
  passkeyError?: string
  passkeyInfo?: string
}> = ({
  name,
  email,
  role,
  linkedAccounts,
  availableProviders,
  passkeys,
  profileError,
  profileInfo,
  oauthError,
  oauthInfo,
  passkeyError,
  passkeyInfo
}) => {
  const linkedProviderIds = new Set(linkedAccounts.map((a) => a.providerId))
  const bindableProviders = availableProviders.filter((p) => !linkedProviderIds.has(p.provider_id))
  const providerName = (providerId: string) =>
    availableProviders.find((p) => p.provider_id === providerId)?.name || providerId
  const providerIcon = (providerId: string) =>
    availableProviders.find((p) => p.provider_id === providerId)?.icon_url || null

  return (
    <div class="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black pb-16">
      <header class="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-10">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold font-mono-custom text-lg">
              S
            </div>
            <span class="font-bold text-white tracking-wide">个人设置</span>
          </div>
          <div class="flex items-center gap-4 text-sm">
            <a href="/" class="text-slate-300 hover:text-white transition font-medium">返回主页</a>
            {role === 'admin' && (
              <a href="/admin" class="text-slate-300 hover:text-white transition font-medium">管理后台</a>
            )}
            <a href="/logout" class="text-rose-400 hover:text-rose-300 transition font-medium">退出登录</a>
          </div>
        </div>
      </header>

      <main class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 mt-10 space-y-8">
        <section class="bg-slate-900/60 backdrop-blur border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl">
          <h3 class="text-lg font-bold text-white mb-6 pb-3 border-b border-slate-800">基本资料</h3>
          {profileError && (
            <div class="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-sm text-rose-400">{profileError}</div>
          )}
          {profileInfo && (
            <div class="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400">{profileInfo}</div>
          )}
          <form method="post" action="/settings/profile" class="space-y-4 max-w-xl">
            <div>
              <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">用户名</label>
              <input
                type="text"
                name="name"
                required
                minLength={1}
                maxLength={64}
                value={name}
                class="w-full px-4 py-3 bg-slate-950/60 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
              />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">邮箱</label>
              <input
                type="email"
                value={email}
                disabled
                class="w-full px-4 py-3 bg-slate-950/40 border border-slate-800 rounded-xl text-slate-400 cursor-not-allowed"
              />
              <p class="mt-1 text-xs text-slate-500">邮箱用于登录标识，当前不支持在此修改。</p>
            </div>
            <div class="flex justify-end">
              <button type="submit" class="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-xl transition active:scale-[0.98]">
                保存用户名
              </button>
            </div>
          </form>
        </section>

        <section class="bg-slate-900/60 backdrop-blur border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl">
          <div class="flex items-center justify-between mb-6 pb-3 border-b border-slate-800">
            <h3 class="text-lg font-bold text-white">社交账号绑定</h3>
            <span class="text-xs text-slate-500">仅显示后台已配置并启用的 OAuth 应用</span>
          </div>
          {oauthError && (
            <div class="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-sm text-rose-400">{oauthError}</div>
          )}
          {oauthInfo && (
            <div class="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400">{oauthInfo}</div>
          )}

          <div class="space-y-3 mb-6">
            <h4 class="text-sm font-semibold text-slate-300">已绑定</h4>
            {linkedAccounts.length === 0 ? (
              <div class="text-sm text-slate-500 py-4 px-3 rounded-xl border border-dashed border-slate-800">暂未绑定任何社交账号</div>
            ) : (
              linkedAccounts.map((account) => {
                const icon = providerIcon(account.providerId)
                return (
                  <div class="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-950/40 border border-slate-800">
                    <div class="flex items-center gap-3 min-w-0">
                      {icon ? (
                        <img src={icon} alt="" class="w-8 h-8 rounded-full bg-transparent object-cover" />
                      ) : (
                        <div class="w-8 h-8 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center text-xs font-bold">
                          {providerName(account.providerId).slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div class="min-w-0">
                        <div class="text-sm text-white font-medium truncate">{providerName(account.providerId)}</div>
                        <div class="text-xs text-slate-500 font-mono-custom truncate" title={account.accountId}>{account.accountId}</div>
                      </div>
                    </div>
                    <form method="post" action="/settings/oauth/unlink" class="shrink-0">
                      <input type="hidden" name="provider_id" value={account.providerId} />
                      <input type="hidden" name="account_id" value={account.accountId} />
                      <button type="submit" class="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition">
                        解绑
                      </button>
                    </form>
                  </div>
                )
              })
            )}
          </div>

          <div class="space-y-3">
            <h4 class="text-sm font-semibold text-slate-300">可绑定</h4>
            {availableProviders.length === 0 ? (
              <div class="text-sm text-slate-500 py-4 px-3 rounded-xl border border-dashed border-slate-800">管理员尚未配置可用的 OAuth 应用</div>
            ) : bindableProviders.length === 0 ? (
              <div class="text-sm text-slate-500 py-4 px-3 rounded-xl border border-dashed border-slate-800">所有可用社交账号均已绑定</div>
            ) : (
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {bindableProviders.map((provider) => (
                  <form method="post" action="/settings/oauth/link" class="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-950/40 border border-slate-800">
                    <div class="flex items-center gap-3 min-w-0">
                      {provider.icon_url ? (
                        <img src={provider.icon_url} alt="" class="w-8 h-8 rounded-full bg-transparent object-cover" />
                      ) : (
                        <div class="w-8 h-8 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center text-xs font-bold">
                          {provider.name.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div class="min-w-0">
                        <div class="text-sm text-white font-medium truncate">{provider.name}</div>
                        <div class="text-xs text-slate-500 font-mono-custom truncate">{provider.provider_id}</div>
                      </div>
                    </div>
                    <input type="hidden" name="provider_id" value={provider.provider_id} />
                    <button type="submit" class="shrink-0 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition">
                      绑定
                    </button>
                  </form>
                ))}
              </div>
            )}
          </div>
        </section>

        <section class="bg-slate-900/60 backdrop-blur border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl">
          <div class="flex items-center justify-between mb-6 pb-3 border-b border-slate-800 gap-3">
            <div>
              <h3 class="text-lg font-bold text-white">Passkey</h3>
              <p class="text-xs text-slate-500 mt-1">使用本机指纹、面容或安全密钥登录辅助凭证</p>
            </div>
            <button
              type="button"
              id="add-passkey-btn"
              class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-xl transition active:scale-[0.98]"
            >
              添加 Passkey
            </button>
          </div>
          {passkeyError && (
            <div class="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-sm text-rose-400">{passkeyError}</div>
          )}
          {passkeyInfo && (
            <div class="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400">{passkeyInfo}</div>
          )}
          <div id="passkey-client-error" class="hidden mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-sm text-rose-400"></div>

          <div class="space-y-3">
            {passkeys.length === 0 ? (
              <div class="text-sm text-slate-500 py-8 text-center rounded-xl border border-dashed border-slate-800">
                尚未添加 Passkey
              </div>
            ) : (
              passkeys.map((item) => (
                <div class="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-950/40 border border-slate-800">
                  <div class="min-w-0">
                    <div class="text-sm text-white font-medium truncate">{item.name || '未命名 Passkey'}</div>
                    <div class="text-xs text-slate-500 mt-0.5">
                      {item.deviceType || 'unknown'}
                      {item.backedUp ? ' · 已备份' : ''}
                      {item.createdAt ? ` · ${new Date(item.createdAt).toLocaleString('zh-CN')}` : ''}
                    </div>
                  </div>
                  <form method="post" action="/settings/passkey/delete" class="shrink-0" onsubmit="return confirm('确认删除该 Passkey？');">
                    <input type="hidden" name="id" value={item.id} />
                    <button type="submit" class="px-3 py-1.5 text-xs bg-rose-950/40 hover:bg-rose-900/60 text-rose-400 border border-rose-900/30 rounded-lg transition">
                      删除
                    </button>
                  </form>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      <script type="module" src="/static/settings.js"></script>
    </div>
  )
}
