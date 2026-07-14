import {
  apiGet,
  bindLogoutButtons,
  escapeAttr,
  escapeHtml,
  formatDate,
  mount,
  showAppError
} from './app-core.js';

function renderRecordRow(r) {
  return `
    <tr class="hover:bg-slate-900/40 transition" data-record-id="${escapeAttr(r.id)}">
      <td class="py-4 px-4 font-mono-custom text-emerald-400 break-all select-all cursor-pointer" title="点击即可选择复制">${escapeHtml(r.host_name)}</td>
      <td class="py-4 px-4 font-mono-custom text-slate-300 break-all">${escapeHtml(r.server_address)}</td>
      <td class="py-4 px-4 font-mono-custom text-slate-300">${escapeHtml(String(r.port))}</td>
      <td class="py-4 px-4 text-slate-400 text-xs">${escapeHtml(formatDate(r.created_at))}</td>
      <td class="py-4 px-4 text-right">
        <div class="inline-flex items-center gap-2">
          <button type="button" data-edit-id="${escapeAttr(r.id)}" data-host-name="${escapeAttr(r.host_name)}" data-root-domain="${escapeAttr(r.root_domain)}" data-subdomain="${escapeAttr(r.subdomain)}" data-server-address="${escapeAttr(r.server_address)}" data-port="${escapeAttr(String(r.port))}" class="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg transition active:scale-[0.98]">修改</button>
          <button type="button" data-delete-id="${escapeAttr(r.id)}" class="px-3 py-1.5 text-xs bg-rose-950/40 hover:bg-rose-900/60 text-rose-400 border border-rose-900/30 rounded-lg transition active:scale-[0.98]">删除</button>
        </div>
      </td>
    </tr>`;
}

function renderHome(data) {
  const user = data.user;
  const records = data.records || [];
  const displayName = (user.name || '').trim() || user.email;
  const isAdmin = user.role === 'admin';
  const rows = records.length
    ? records.map(renderRecordRow).join('')
    : `<tr data-empty-row="1"><td colspan="5" class="py-12 text-center text-slate-500"><div class="flex flex-col items-center justify-center gap-3"><svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg><span>暂无记录，快去左侧创建一条吧！</span></div></td></tr>`;

  return `
  <div class="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black pb-12">
    <header class="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-10">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold font-mono-custom text-lg">M</div>
          <span class="font-bold text-white tracking-wide hidden sm:inline-block">Minecraft 端口隐藏工具</span>
        </div>
        <div class="relative text-sm" id="user-menu">
          <button type="button" id="user-menu-toggle" class="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-slate-200 hover:bg-slate-900 hover:border-slate-700 transition" aria-haspopup="menu" aria-expanded="false">
            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span class="max-w-[10rem] sm:max-w-[14rem] truncate font-medium">${escapeHtml(displayName)}</span>
            ${isAdmin ? '<span class="hidden sm:inline-flex px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">管理员</span>' : ''}
            <svg id="user-menu-chevron" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-400 transition-transform duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
          </button>
          <div id="user-menu-panel" class="hidden absolute right-0 mt-2 w-52 rounded-xl border border-slate-800 bg-slate-950/95 backdrop-blur shadow-2xl shadow-black/40 overflow-hidden z-20 p-0" role="menu">
            <div class="px-3 py-2 border-b border-slate-800">
              <div class="text-xs text-slate-500">当前账号</div>
              <div class="text-sm text-slate-200 truncate" title="${escapeAttr(displayName)}">${escapeHtml(displayName)}</div>
            </div>
            <a href="/settings" class="flex items-center gap-2 px-3 py-2.5 text-slate-300 hover:bg-slate-900 hover:text-white transition" role="menuitem">个人设置</a>
            ${isAdmin ? '<a href="/admin" class="flex items-center gap-2 px-3 py-2.5 text-slate-300 hover:bg-slate-900 hover:text-white transition" role="menuitem">管理后台</a>' : ''}
            <div class="border-t border-slate-800">
              <button type="button" data-action="logout" class="w-full m-0 flex items-center gap-2 px-3 py-2.5 text-left text-rose-400 hover:bg-rose-950/40 hover:text-rose-300 transition leading-none" role="menuitem">退出登录</button>
            </div>
          </div>
        </div>
      </div>
    </header>
    <div id="toast-root" class="fixed top-20 right-4 z-50 space-y-2 w-[min(92vw,22rem)]"></div>
    <main class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 mt-10">
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div class="lg:col-span-1 bg-slate-900/60 backdrop-blur border border-slate-800 rounded-2xl p-6 h-fit shadow-xl">
          <h3 id="form-title" class="text-lg font-bold text-white mb-6 flex items-center gap-2">一键隐藏端口</h3>
          <div class="space-y-4">
            <input type="hidden" id="editing-id" value="" />
            <div id="editing-banner" class="hidden rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">正在修改已有记录：主机名不可更改，仅更新目标地址与端口。</div>
            <div>
              <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">期望的子域名</label>
              <div class="flex items-center bg-slate-950/60 border border-slate-800 rounded-xl focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500 overflow-hidden transition">
                <input type="text" id="subdomain" placeholder="如 play" class="w-full px-4 py-3 bg-transparent text-white placeholder-slate-500 focus:outline-none" />
                <span class="px-2 text-slate-600 font-bold">.</span>
                <select id="root-domain" class="bg-slate-900 border-l border-slate-800 text-slate-300 py-3 px-3 focus:outline-none text-sm cursor-pointer rounded-r-xl"><option value="">加载中...</option></select>
              </div>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">真实服务器地址 (IP/域名)</label>
              <input type="text" id="server-address" placeholder="例如 124.223.x.x 或 sub.domain.com" class="w-full px-4 py-3 bg-slate-950/60 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">端口</label>
              <input type="number" id="port" placeholder="例如 25565" value="" class="w-full px-4 py-3 bg-slate-950/60 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition font-mono-custom" />
            </div>
            <div class="mt-2 flex gap-2">
              <button id="btn" disabled class="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:hover:bg-emerald-600 disabled:cursor-not-allowed text-white font-medium rounded-xl transition duration-200 transform active:scale-[0.98] shadow-lg shadow-emerald-950/50">一键生成</button>
              <button type="button" id="cancel-edit-btn" class="hidden px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium rounded-xl border border-slate-700 transition">取消</button>
            </div>
          </div>
        </div>
        <div class="lg:col-span-2 bg-slate-900/60 backdrop-blur border border-slate-800 rounded-2xl p-6 shadow-xl overflow-hidden">
          <div class="flex items-center justify-between mb-6">
            <h3 class="text-lg font-bold text-white flex items-center gap-2"><span id="records-title">我的记录 (${records.length})</span></h3>
            <span id="record-count" class="hidden">${records.length}</span>
            <span class="text-xs text-slate-500">仅显示您名下的 DNS 解析记录</span>
          </div>
          <div id="create-hint" class="hidden mb-4 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-xs text-emerald-300"></div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm text-left border-collapse">
              <thead>
                <tr class="border-b border-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  <th class="py-4 px-4">主机名</th>
                  <th class="py-4 px-4">目标服务器</th>
                  <th class="py-4 px-4">端口</th>
                  <th class="py-4 px-4">创建时间</th>
                  <th class="py-4 px-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody id="records-tbody" class="divide-y divide-slate-800/60">${rows}</tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  </div>`;
}

async function boot() {
  const { res, data } = await apiGet('/api/pages/home');
  if (res.status === 401 || data?.redirect) {
    window.location.href = data?.redirect || '/login';
    return;
  }
  if (!res.ok || !data?.success) {
    showAppError(data?.message || "主页加载失败");
    return;
  }
  mount(renderHome(data.data));
  bindLogoutButtons();
  if (window.__homeDnsInit) {
    window.__homeDnsInit();
  } else {
    document.dispatchEvent(new Event('home:ready'));
  }
}

boot().catch((err) => showAppError(err instanceof Error ? err.message : "主页加载失败"));
