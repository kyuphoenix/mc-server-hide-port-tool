import type { FC } from 'hono/jsx'
import type { OAuthProviderPublic } from '../services/oauth-providers'

export const LoginView: FC<{
  error?: string
  next?: string
  info?: string
  oauthProviders?: OAuthProviderPublic[]
}> = ({ error, next, info, oauthProviders = [] }) => {
  return (
    <div class="min-h-screen flex items-center justify-center p-6 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black">
      <div class="w-full max-w-md bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl p-8 shadow-2xl shadow-emerald-950/20">
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-400 mb-4 border border-emerald-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
            </svg>
          </div>
          <h2 class="text-2xl font-bold tracking-tight text-white">{'\u767b\u5f55\u8d26\u53f7'}</h2>
          <p class="mt-2 text-sm text-slate-400">Minecraft {'\u7aef\u53e3\u9690\u85cf\u670d\u52a1\u5e73\u53f0'}</p>
        </div>

        {info && (
          <div class="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
            </svg>
            <span>{info}</span>
          </div>
        )}

        {error && (
          <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <div id="passkey-login-error" class="hidden mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400"></div>
        <input type="hidden" id="passkey-login-next" value={next || '/'} />

        <form method="post" action={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`} class="space-y-5">
          <div>
            <label for="email" class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{'\u90ae\u7bb1'}</label>
            <input
              type="email"
              id="email"
              name="email"
              required
              autocomplete="email"
              class="w-full px-4 py-3 bg-slate-950/60 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
              placeholder="name@example.com"
            />
          </div>

          <div>
            <div class="flex justify-between items-center mb-2">
              <label for="password" class="block text-xs font-semibold text-slate-400 uppercase tracking-wider">{'\u5bc6\u7801'}</label>
            </div>
            <input
              type="password"
              id="password"
              name="password"
              required
              autocomplete="current-password"
              class="w-full px-4 py-3 bg-slate-950/60 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
              placeholder="********"
            />
          </div>

          <button
            type="submit"
            class="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl transition duration-200 transform active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-900 shadow-lg shadow-emerald-950/50"
          >
            {'\u767b\u5f55'}
          </button>
        </form>

        <div class="mt-4">
          <button
            type="button"
            id="passkey-login-btn"
            class="w-full py-3 px-4 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-xl transition duration-200 border border-slate-700 shadow-md active:scale-[0.98] flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            <span>{'\u4f7f\u7528 Passkey \u767b\u5f55'}</span>
          </button>
        </div>

        {oauthProviders.length > 0 && (
          <div class="mt-6 space-y-3">
            <div class="relative flex items-center justify-center my-2">
              <div class="absolute inset-0 flex items-center">
                <div class="w-full border-t border-slate-800"></div>
              </div>
              <span class="relative px-3 bg-slate-900 text-xs text-slate-500 uppercase tracking-wider">{'\u7b2c\u4e09\u65b9\u767b\u5f55'}</span>
            </div>
            {oauthProviders.map((p) => (
              <form method="post" action={`/login/oauth${next ? `?next=${encodeURIComponent(next)}` : ''}`}>
                <input type="hidden" name="provider_id" value={p.provider_id} />
                <button
                  type="submit"
                  class="w-full py-3 px-4 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-xl transition duration-200 border border-slate-700 shadow-md active:scale-[0.98] flex items-center justify-center gap-3"
                >
                  {p.icon_url ? (
                    <img src={p.icon_url} alt="" class="w-5 h-5 object-contain rounded-full" />
                  ) : null}
                  <span>{'\u4f7f\u7528'} {p.name} {'\u767b\u5f55'}</span>
                </button>
              </form>
            ))}
          </div>
        )}

        <div class="mt-8 pt-6 border-t border-slate-800/60 text-center">
          <p class="text-sm text-slate-400">
            {'\u8fd8\u6ca1\u6709\u8d26\u53f7\uff1f'}{" "}
            <a href="/register" class="font-medium text-emerald-400 hover:text-emerald-300 transition">
              {'\u7acb\u5373\u6ce8\u518c'}
            </a>
          </p>
        </div>
      </div>
      <script type="module" src="/static/login.js"></script>
    </div>
  )
}
