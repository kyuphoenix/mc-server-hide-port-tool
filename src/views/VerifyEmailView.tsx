import type { FC } from 'hono/jsx'

export const VerifyEmailView: FC<{ email?: string; error?: string }> = ({ email, error }) => {
  return (
    <div class="min-h-screen flex items-center justify-center p-6 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black">
      <div class="w-full max-w-md bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl p-8 shadow-2xl shadow-emerald-950/20">
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-400 mb-4 border border-emerald-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 19v-8.93a2 2 0 01.89-1.664l8-4a2 2 0 011.78 0l8 4A2 2 0 0121 10.07V19M3 19a2 2 0 002 2h14a2 2 0 002-2M3 19l6.75-4.5M21 19l-6.75-4.5M3 10l6.75 4.5M21 10l-6.75 4.5m0 0l-2.25-1.5a2 2 0 00-2.25 0l-2.25 1.5M12 14.25v-2.625" />
            </svg>
          </div>
          <h2 class="text-2xl font-bold tracking-tight text-white">邮箱验证</h2>
          <p class="mt-2 text-sm text-slate-400">已向您的邮箱发送了 6 位数验证码</p>
        </div>

        {error && (
          <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <p class="text-sm text-slate-300 mb-6 text-center">
          请输入发送到 <strong class="text-emerald-400 font-mono-custom">{email ?? ''}</strong> 的验证码：
        </p>

        <form method="post" action="/verify-email" class="space-y-6">
          <input type="hidden" name="email" value={email ?? ''} />
          
          <div>
            <label for="code" class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 text-center">验证码</label>
            <input
              type="text"
              id="code"
              name="code"
              required
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="000000"
              class="w-full px-4 py-3 bg-slate-950/60 border border-slate-800 rounded-xl text-white font-mono-custom text-center text-3xl tracking-[0.5em] focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition placeholder-slate-800"
            />
          </div>

          <button
            type="submit"
            class="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl transition duration-200 transform active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-900 shadow-lg shadow-emerald-950/50"
          >
            确认注册
          </button>
        </form>
      </div>
    </div>
  )
}
