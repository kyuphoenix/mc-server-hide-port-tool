import type { FC } from 'hono/jsx'

export const SetupView: FC<{ error?: string }> = ({ error }) => {
  return (
    <div class="min-h-screen flex items-center justify-center p-6 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black">
      <div class="w-full max-w-md bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl p-8 shadow-2xl shadow-emerald-950/20">
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-400 mb-4 border border-emerald-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h2 class="text-2xl font-bold tracking-tight text-white">初始化管理员</h2>
          <p class="mt-2 text-sm text-slate-400">尚未创建任何账号。请先创建第一个管理员账户。</p>
        </div>

        {error && (
          <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form method="post" action="/setup" class="space-y-5">
          <div>
            <label for="name" class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">用户名</label>
            <input
              type="text"
              id="name"
              name="name"
              required
              autocomplete="name"
              class="w-full px-4 py-3 bg-slate-950/60 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
              placeholder="admin"
            />
          </div>

          <div>
            <label for="email" class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">邮箱</label>
            <input
              type="email"
              id="email"
              name="email"
              required
              autocomplete="email"
              class="w-full px-4 py-3 bg-slate-950/60 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
              placeholder="admin@example.com"
            />
          </div>

          <div>
            <label for="password" class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">密码（至少 8 位）</label>
            <input
              type="password"
              id="password"
              name="password"
              required
              minLength={8}
              autocomplete="new-password"
              class="w-full px-4 py-3 bg-slate-950/60 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
              placeholder="••••••••"
            />
          </div>

          <div>
            <label for="confirm" class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">确认密码</label>
            <input
              type="password"
              id="confirm"
              name="confirm"
              required
              minLength={8}
              autocomplete="new-password"
              class="w-full px-4 py-3 bg-slate-950/60 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            class="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl transition duration-200 transform active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-900 shadow-lg shadow-emerald-950/50"
          >
            创建并登录管理员
          </button>
        </form>
      </div>
    </div>
  )
}
