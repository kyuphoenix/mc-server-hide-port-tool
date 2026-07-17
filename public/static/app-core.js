export function readCookie(name) {
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) {
      try {
        return decodeURIComponent(rest.join('=') || '');
      } catch {
        return rest.join('=') || '';
      }
    }
  }
  return '';
}

export function csrfHeaders(extra = {}) {
  const token = readCookie('csrf_token');
  return {
    ...extra,
    ...(token ? { 'x-csrf-token': token } : {})
  };
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#96;');
}

export function qs(name, fallback = '') {
  const v = new URLSearchParams(window.location.search).get(name);
  return v == null || v === '' ? fallback : v;
}

export function mount(html) {
  const app = document.getElementById('app');
  if (!app) throw new Error('missing #app');
  app.innerHTML = html;
  return app;
}

export function showAppError(message) {
  mount(`
    <div class="min-h-screen flex items-center justify-center p-6">
      <div class="max-w-md w-full rounded-2xl border border-rose-500/20 bg-rose-950/30 p-6 text-center">
        <div class="text-rose-300 text-sm mb-4">${escapeHtml(message || '页面加载失败')}</div>
        <a href="/" class="inline-flex px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm">返回首页</a>
      </div>
    </div>
  `);
}

export async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function apiGet(url) {
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  });
  const data = await readJson(res);
  return { res, data };
}

export async function apiPost(url, body = {}, opts = {}) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: csrfHeaders({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(opts.headers || {})
    }),
    body: JSON.stringify(body)
  });
  const data = await readJson(res);
  return { res, data };
}

export function apiMessage(data, fallback) {
  if (!data) return fallback;
  return data.message || data.error?.message || data.code || fallback;
}

export function ensureToastRoot() {
  let root = document.getElementById('toast-root');
  if (root) return root;
  root = document.createElement('div');
  root.id = 'toast-root';
  root.className = 'fixed top-20 right-4 z-50 space-y-2 w-[min(92vw,22rem)]';
  document.body.appendChild(root);
  return root;
}

export function showToast(message, type = 'success') {
  const root = ensureToastRoot();
  const el = document.createElement('div');
  const tone =
    type === 'error'
      ? 'border-rose-500/30 bg-rose-950/90 text-rose-100'
      : type === 'info'
        ? 'border-sky-500/30 bg-sky-950/90 text-sky-100'
        : 'border-emerald-500/30 bg-emerald-950/90 text-emerald-100';
  el.className = `pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur transition-opacity duration-200 ${tone}`;
  el.textContent = message;
  root.appendChild(el);
  window.setTimeout(() => {
    el.classList.add('opacity-0');
    window.setTimeout(() => el.remove(), 220);
  }, 2800);
}

export function formatDate(ts) {
  try {
    return new Date(ts).toLocaleString('zh-CN');
  } catch {
    return '';
  }
}

export function formatEmailDisplay(email) {
  const full = email || '';
  const lower = full.toLowerCase();
  const isSynthetic =
    lower.includes('users.noreply') ||
    lower.includes('noreply.') ||
    lower.includes('@oauth.') ||
    lower.includes('privateemail') ||
    lower.endsWith('.local') ||
    full.length > 42;

  if (!isSynthetic) {
    return { primary: full, full, isSynthetic: false };
  }

  const at = full.indexOf('@');
  if (at <= 0) {
    const short = full.length > 28 ? full.slice(0, 12) + '…' + full.slice(-8) : full;
    return { primary: short, full, isSynthetic: true };
  }
  const local = full.slice(0, at);
  const domain = full.slice(at + 1);
  const localShort = local.length > 16 ? local.slice(0, 10) + '…' + local.slice(-4) : local;
  const domainShort = domain.length > 18 ? domain.slice(0, 10) + '…' + domain.slice(-6) : domain;
  return { primary: `${localShort}@${domainShort}`, full, isSynthetic: true };
}

export async function logout() {
  const { res, data } = await apiPost('/api/session/logout', {});
  if (data?.redirect) {
    window.location.href = data.redirect;
    return;
  }
  if (res.ok) {
    window.location.href = '/login';
    return;
  }
  showToast(apiMessage(data, '退出登录失败'), 'error');
}

export function bindLogoutButtons(root = document) {
  root.querySelectorAll('[data-action="logout"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });
  });
}
