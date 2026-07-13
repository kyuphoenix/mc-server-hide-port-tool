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
  csrfToken: string
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
  passkeyInfo,
  csrfToken
}) => {
  const csrfField = (
    <input type="hidden" name="csrf_token" value={csrfToken} />
  )

  const linkedProviderIds = new Set(linkedAccounts.map((a) => a.providerId))
  const bindableProviders = availableProviders.filter((p) => !linkedProviderIds.has(p.provider_id))
  const providerName = (providerId: string) =>
    availableProviders.find((p) => p.provider_id === providerId)?.name || providerId
  const providerIcon = (providerId: string) =>
    availableProviders.find((p) => p.provider_id === providerId)?.icon_url || null

  return (
    <div class="min-h-screen bg-slate-950 pb-16 text-slate-100">
      <header class="border-b border-slate-800 bg-slate-950 sticky top-0 z-10">
        <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold font-mono-custom text-base">
              S
            </div>
            <span class="font-bold text-white tracking-wide">个人设置</span>
          </div>
          <div class="flex items-center gap-6 text-sm">
            <a href="/" class="text-slate-300 hover:text-white transition flex items-center gap-1.5 font-medium">
              返回主页
            </a>
            {role === 'admin' && (
              <a href="/admin" class="text-slate-300 hover:text-white transition flex items-center gap-1.5 font-medium">
                管理后台
              </a>
            )}
            <form method="post" action="/logout" class="inline">
                <input type="hidden" name="csrf_token" value={csrfToken} />
                <button type="submit" class="text-rose-400 hover:text-rose-300 transition font-medium">退出登录</button>
              </form>
          </div>
        </div>
      </header>

      <main class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 mt-10">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
          
          {/* Left Column: Profile Card */}
          <div class="md:col-span-1 space-y-6">
            <div class="bg-slate-900/40 border border-slate-800 rounded-lg p-6">
              <div class="flex flex-col items-center text-center">
                <div class="w-20 h-20 rounded-full bg-emerald-950 border border-emerald-800 flex items-center justify-center text-emerald-400 text-2xl font-bold mb-4">
                  {name ? name.slice(0, 1).toUpperCase() : 'U'}
                </div>
                <h2 class="text-xl font-bold text-white mb-1">{name || '未命名用户'}</h2>
                <div class="text-sm text-slate-400 font-mono-custom mb-3">{email}</div>
                {role === 'admin' ? (
                  <span class="px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">管理员</span>
                ) : role === 'super_admin' ? (
                  <span class="px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">超级管理员</span>
                ) : (
                  <span class="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">普通用户</span>
                )}
              </div>
              
              <div class="mt-8 pt-6 border-t border-slate-800 space-y-3">
                <div class="flex justify-between items-center text-sm">
                  <span class="text-slate-400">已绑定社交账号</span>
                  <span class="text-white font-mono-custom">{linkedAccounts.length}</span>
                </div>
                <div class="flex justify-between items-center text-sm">
                  <span class="text-slate-400">Passkey 密钥数量</span>
                  <span class="text-white font-mono-custom">{passkeys.length}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Forms */}
          <div class="md:col-span-2 space-y-6">
            
            {/* Basic Info */}
            <section class="bg-slate-900/40 border border-slate-800 rounded-lg p-6 sm:p-8">
              <h3 class="text-base font-bold text-white mb-6 pb-3 border-b border-slate-800">基本资料修改</h3>
              {profileError && (
                <div class="mb-4 p-3 rounded-md bg-rose-500/10 border border-rose-500/20 text-sm text-rose-400">{profileError}</div>
              )}
              {profileInfo && (
                <div class="mb-4 p-3 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400">{profileInfo}</div>
              )}
              <form method="post" action="/settings/profile" class="space-y-4 max-w-xl">
                {csrfField}

                <div>
                  <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">用户名</label>
                  <input
                    type="text"
                    name="name"
                    required
                    minLength={1}
                    maxLength={64}
                    value={name}
                    class="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-md text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">邮箱</label>
                  <input
                    type="email"
                    value={email}
                    disabled
                    class="w-full px-4 py-2.5 bg-slate-950/50 border border-slate-800 rounded-md text-slate-500 cursor-not-allowed"
                  />
                  <p class="mt-1 text-xs text-slate-500">邮箱用于登录标识，当前不支持在此修改。</p>
                </div>
                <div class="pt-2">
                  <button type="submit" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-md transition active:scale-[0.98]">
                    保存基本资料
                  </button>
                </div>
              </form>
            </section>

            {/* Social Accounts */}
            <section class="bg-slate-900/40 border border-slate-800 rounded-lg p-6 sm:p-8">
              <div class="flex items-center justify-between mb-6 pb-3 border-b border-slate-800">
                <h3 class="text-base font-bold text-white">社交账号绑定</h3>
                <span class="text-xs text-slate-500">仅显示后台已启用且配置了图标的应用</span>
              </div>
              {oauthError && (
                <div class="mb-4 p-3 rounded-md bg-rose-500/10 border border-rose-500/20 text-sm text-rose-400">{oauthError}</div>
              )}
              {oauthInfo && (
                <div class="mb-4 p-3 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400">{oauthInfo}</div>
              )}

              <div class="space-y-4 mb-8">
                <h4 class="text-xs font-semibold text-slate-400 uppercase tracking-wider">已绑定</h4>
                {linkedAccounts.length === 0 ? (
                  <div class="text-sm text-slate-500 py-4 px-3 rounded-md border border-dashed border-slate-800 bg-slate-950/30">暂未绑定任何社交账号</div>
                ) : (
                  linkedAccounts.map((account) => {
                    const icon = providerIcon(account.providerId)
                    return (
                      <div class="flex items-center justify-between gap-3 p-3 rounded-md bg-slate-950 border border-slate-800">
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
                {csrfField}

                          <input type="hidden" name="provider_id" value={account.providerId} />
                          <input type="hidden" name="account_id" value={account.accountId} />
                          <button type="submit" class="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-md transition">
                            解绑
                          </button>
                        </form>
                      </div>
                    )
                  })
                )}
              </div>

              <div class="space-y-4">
                <h4 class="text-xs font-semibold text-slate-400 uppercase tracking-wider">可绑定</h4>
                {availableProviders.length === 0 ? (
                  <div class="text-sm text-slate-500 py-4 px-3 rounded-md border border-dashed border-slate-800 bg-slate-950/30">管理员尚未配置可用的 OAuth 应用</div>
                ) : bindableProviders.length === 0 ? (
                  <div class="text-sm text-slate-500 py-4 px-3 rounded-md border border-dashed border-slate-800 bg-slate-950/30">所有可用社交账号均已绑定</div>
                ) : (
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {bindableProviders.map((provider) => (
                      <form method="post" action="/settings/oauth/link" class="flex items-center justify-between gap-3 p-3 rounded-md bg-slate-950 border border-slate-800 hover:border-emerald-500/50 transition">
                {csrfField}

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
                        <button type="submit" class="shrink-0 px-3 py-1.5 text-xs bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 border border-emerald-500/20 rounded-md transition">
                          绑定
                        </button>
                      </form>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Passkeys */}
            <section class="bg-slate-900/40 border border-slate-800 rounded-lg p-6 sm:p-8">
              <div class="flex items-center justify-between mb-6 pb-3 border-b border-slate-800 gap-3">
                <div>
                  <h3 class="text-base font-bold text-white flex items-center gap-2">
                    Passkey 辅助凭证
                  </h3>
                  <p class="text-xs text-slate-500 mt-1">使用本机的指纹、面容或安全密钥进行快捷登录</p>
                </div>
                <button
                  type="button"
                  id="add-passkey-btn"
                  class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-md transition active:scale-[0.98]"
                >
                  添加 Passkey
                </button>
              </div>
              
              {passkeyError && (
                <div class="mb-4 p-3 rounded-md bg-rose-500/10 border border-rose-500/20 text-sm text-rose-400">{passkeyError}</div>
              )}
              {passkeyInfo && (
                <div class="mb-4 p-3 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400">{passkeyInfo}</div>
              )}
              <div id="passkey-client-error" class="hidden mb-4 p-3 rounded-md bg-rose-500/10 border border-rose-500/20 text-sm text-rose-400"></div>

              <div class="space-y-3">
                {passkeys.length === 0 ? (
                  <div class="text-sm text-slate-500 py-8 text-center rounded-md border border-dashed border-slate-800 bg-slate-950/30">
                    尚未添加任何 Passkey
                  </div>
                ) : (
                  passkeys.map((item) => (
                    <div class="flex items-center justify-between gap-3 p-3 rounded-md bg-slate-950 border border-slate-800">
                      <div class="min-w-0">
                        <div class="text-sm text-white font-medium truncate">{item.name || '未命名 Passkey'}</div>
                        <div class="text-xs text-slate-500 mt-0.5">
                          {item.deviceType || 'unknown'}
                          {item.backedUp ? ' · 已备份' : ''}
                          {item.createdAt ? ` · ${new Date(item.createdAt).toLocaleString('zh-CN')}` : ''}
                        </div>
                      </div>
                      <form method="post" action="/settings/passkey/delete" class="shrink-0" onsubmit="return confirm('确认删除该 Passkey？');">
                {csrfField}

                        <input type="hidden" name="id" value={item.id} />
                        <button type="submit" class="px-3 py-1.5 text-xs bg-rose-950/40 hover:bg-rose-900/60 text-rose-400 border border-rose-900/30 rounded-md transition">
                          删除
                        </button>
                      </form>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      </main>

      <script type="module" src="/static/settings.js"></script>
    </div>
  )
}
