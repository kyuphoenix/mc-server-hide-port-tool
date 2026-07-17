function readCookie(name) {
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

function csrfHeaders(extra = {}) {
  const token = readCookie('csrf_token');
  return {
    ...extra,
    ...(token ? { 'x-csrf-token': token } : {})
  };
}

/** @type {{ minSubdomainLength: number, recordLimit: number|null }} */
let domainMeta = {
  minSubdomainLength: 0,
  recordLimit: null
};

/** @type {string|null} */
let editingId = null;

function el(id) {
  return document.getElementById(id);
}

function getButton() { return el('btn'); }
function getCancelEditBtn() { return el('cancel-edit-btn'); }
function getRootDomainSelect() { return el('root-domain'); }
function getSubdomainInput() { return el('subdomain'); }
function getServerAddressInput() { return el('server-address'); }
function getPortInput() { return el('port'); }
function getEditingIdInput() { return el('editing-id'); }
function getEditingBanner() { return el('editing-banner'); }
function getFormTitle() { return el('form-title'); }

function initHomeDns() {
  const button = getButton();
  const rootDomainSelect = getRootDomainSelect();
  if (!button || !rootDomainSelect) return;

  loadDomains();

  const tbody = el('records-tbody');
  if (tbody && !tbody.dataset.bound) {
    tbody.dataset.bound = '1';
    tbody.addEventListener('click', onRecordsClick);
  }

  const cancelEditBtn = getCancelEditBtn();
  if (cancelEditBtn && !cancelEditBtn.dataset.bound) {
    cancelEditBtn.dataset.bound = '1';
    cancelEditBtn.addEventListener('click', () => clearEditMode());
  }

  if (!button.dataset.bound) {
    button.dataset.bound = '1';
    button.addEventListener('click', submitDnsForm);
  }

  initUserMenu();
}

window.__homeDnsInit = initHomeDns;
document.addEventListener('home:ready', initHomeDns);
document.addEventListener('DOMContentLoaded', () => {
  if (el('btn') && el('root-domain')) initHomeDns();
});


function initUserMenu() {
  const root = el('user-menu');
  const toggle = el('user-menu-toggle');
  const panel = el('user-menu-panel');
  const chevron = el('user-menu-chevron');
  if (!root || !toggle || !panel) return;
  if (toggle.dataset.bound) return;
  toggle.dataset.bound = '1';

  const setOpen = (open) => {
    if (open) {
      panel.classList.remove('hidden');
      toggle.setAttribute('aria-expanded', 'true');
      if (chevron) chevron.classList.add('rotate-180');
    } else {
      panel.classList.add('hidden');
      toggle.setAttribute('aria-expanded', 'false');
      if (chevron) chevron.classList.remove('rotate-180');
    }
  };

  const isOpen = () => !panel.classList.contains('hidden');

  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen(!isOpen());
  });

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (!root.contains(target)) setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
  });
}

async function loadDomains() {
  const rootDomainSelect = getRootDomainSelect();
  const button = getButton();
  if (!rootDomainSelect || !button) return;
  setButtonEnabled(false);
  rootDomainSelect.innerHTML = '<option value="">加载中...</option>';

  try {
    const res = await fetch('/api/domains');
    const data = await res.json();

    if (!res.ok || !data.success || !Array.isArray(data.domains) || data.domains.length === 0) {
      throw new Error(data.message || '后端没有返回可用根域名');
    }

    rootDomainSelect.innerHTML = '';
    for (const domain of data.domains) {
      const option = document.createElement('option');
      option.value = domain;
      option.textContent = domain;
      rootDomainSelect.appendChild(option);
    }

    domainMeta.minSubdomainLength = Number(data.min_subdomain_length || 0);
    domainMeta.recordLimit =
      data.record_limit === null || data.record_limit === undefined
        ? null
        : Number(data.record_limit);

    if (typeof data.record_count === 'number') {
      setRecordCount(data.record_count);
    } else {
      refreshHint();
    }

    setButtonEnabled(true);
  } catch (error) {
    rootDomainSelect.innerHTML = '<option value="">域名加载失败</option>';
    showToast(
      error instanceof Error ? error.message : '域名加载失败，请检查 Worker 配置',
      'error'
    );
  }
}

function setHint(text) {
  const el = document.getElementById('create-hint');
  if (!el) return;
  if (text) {
    el.textContent = text;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function getRecordCount() {
  const countEl = document.getElementById('record-count');
  return countEl ? Number(countEl.textContent || 0) : 0;
}

function setRecordCount(count) {
  const n = Math.max(0, Number(count) || 0);
  const countEl = document.getElementById('record-count');
  if (countEl) countEl.textContent = String(n);
  const titleEl = document.getElementById('records-title');
  if (titleEl) titleEl.textContent = `我的记录 (${n})`;
  refreshHint();
  ensureEmptyState();
}

function refreshHint() {
  const info = [];
  if (domainMeta.minSubdomainLength > 0) {
    info.push(`子域名至少 ${domainMeta.minSubdomainLength} 个字符`);
  }
  if (domainMeta.recordLimit !== null && domainMeta.recordLimit !== undefined && domainMeta.recordLimit > 0) {
    info.push(`记录上限 ${getRecordCount()}/${domainMeta.recordLimit}`);
  } else if (domainMeta.recordLimit === 0) {
    info.push('记录数无上限');
  }
  setHint(info.join('  ·  '));
}

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleString('zh-CN');
  } catch {
    return '';
  }
}

function ensureEmptyState() {
  const tbody = document.getElementById('records-tbody');
  if (!tbody) return;
  const rows = tbody.querySelectorAll('tr[data-record-id]');
  const empty = tbody.querySelector('tr[data-empty-row]');
  if (rows.length === 0) {
    if (!empty) {
      const tr = document.createElement('tr');
      tr.setAttribute('data-empty-row', '1');
      tr.innerHTML = `
        <td colspan="5" class="py-12 text-center text-slate-500">
          <div class="flex flex-col items-center justify-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <span>暂无记录，快去左侧创建一条吧！</span>
          </div>
        </td>`;
      tbody.appendChild(tr);
    }
  } else if (empty) {
    empty.remove();
  }
}

function createRecordRow(record) {
  const tr = document.createElement('tr');
  tr.className = 'hover:bg-slate-900/40 transition';
  tr.setAttribute('data-record-id', record.id);
  tr.innerHTML = `
    <td class="py-4 px-4 font-mono-custom text-emerald-400 break-all select-all cursor-pointer" title="点击即可选择复制">${escapeHtml(record.host_name)}</td>
    <td class="py-4 px-4 font-mono-custom text-slate-300 break-all">${escapeHtml(record.server_address)}</td>
    <td class="py-4 px-4 font-mono-custom text-slate-300">${escapeHtml(String(record.port))}</td>
    <td class="py-4 px-4 text-slate-400 text-xs">${escapeHtml(formatDate(record.created_at))}</td>
    <td class="py-4 px-4 text-right">
      <div class="inline-flex items-center gap-2">
        <button
          type="button"
          data-edit-id="${escapeAttr(record.id)}"
          data-host-name="${escapeAttr(record.host_name)}"
          data-root-domain="${escapeAttr(record.root_domain)}"
          data-subdomain="${escapeAttr(record.subdomain)}"
          data-server-address="${escapeAttr(record.server_address)}"
          data-port="${escapeAttr(String(record.port))}"
          class="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg transition active:scale-[0.98]"
        >
          修改
        </button>
        <button
          type="button"
          data-delete-id="${escapeAttr(record.id)}"
          class="px-3 py-1.5 text-xs bg-rose-950/40 hover:bg-rose-900/60 text-rose-400 border border-rose-900/30 rounded-lg transition active:scale-[0.98]"
        >
          删除
        </button>
      </div>
    </td>`;
  return tr;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#96;');
}

function prependRecord(record) {
  const tbody = document.getElementById('records-tbody');
  if (!tbody || !record?.id) return;
  const empty = tbody.querySelector(`tr[data-record-id="${CSS.escape(record.id)}"]`);
  if (empty) empty.remove();
  const existing = tbody.querySelector(`tr[data-record-id="${CSS.escape(record.id)}"]`);
  if (existing) existing.remove();
  tbody.prepend(createRecordRow(record));
}

function updateRecordRow(record) {
  const tbody = document.getElementById('records-tbody');
  if (!tbody || !record?.id) return;
  const existing = tbody.querySelector(`tr[data-record-id="${CSS.escape(record.id)}"]`);
  if (!existing) {
    prependRecord(record);
    return;
  }
  existing.replaceWith(createRecordRow(record));
}

function removeRecord(id) {
  const tbody = document.getElementById('records-tbody');
  if (!tbody) return;
  const row = tbody.querySelector(`tr[data-record-id="${CSS.escape(id)}"]`);
  if (row) row.remove();
  ensureEmptyState();
}

function showToast(message, type = 'success') {
  const root = document.getElementById('toast-root');
  if (!root) {
    alert(message);
    return;
  }
  const el = document.createElement('div');
  const tone =
    type === 'error'
      ? 'border-rose-500/30 bg-rose-950/90 text-rose-100'
      : type === 'info'
        ? 'border-sky-500/30 bg-sky-950/90 text-sky-100'
        : 'border-emerald-500/30 bg-emerald-950/90 text-emerald-100';
  el.className = `pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur ${tone}`;
  el.textContent = message;
  root.appendChild(el);
  window.setTimeout(() => {
    el.classList.add('opacity-0');
    window.setTimeout(() => el.remove(), 220);
  }, 2800);
}

function setEditMode(record) {
  editingId = record.id;
  const editingIdInput = getEditingIdInput();
  const editingBanner = getEditingBanner();
  const cancelEditBtn = getCancelEditBtn();
  const formTitle = getFormTitle();
  const subdomainInput = getSubdomainInput();
  const rootDomainSelect = getRootDomainSelect();
  const serverAddressInput = getServerAddressInput();
  const portInput = getPortInput();
  const button = getButton();
  if (editingIdInput) editingIdInput.value = record.id;
  if (editingBanner) editingBanner.classList.remove('hidden');
  if (cancelEditBtn) cancelEditBtn.classList.remove('hidden');
  if (formTitle) formTitle.textContent = '修改 DNS 记录';
  if (subdomainInput) {
    subdomainInput.value = record.subdomain || '';
    subdomainInput.disabled = true;
    subdomainInput.classList.add('opacity-60', 'cursor-not-allowed');
  }
  if (rootDomainSelect) {
    if (record.root_domain) rootDomainSelect.value = record.root_domain;
    rootDomainSelect.disabled = true;
    rootDomainSelect.classList.add('opacity-60', 'cursor-not-allowed');
  }
  if (serverAddressInput) serverAddressInput.value = record.server_address || '';
  if (portInput) portInput.value = String(record.port || '');
  if (button) button.textContent = '保存修改';
  setButtonEnabled(true);
  if (serverAddressInput) serverAddressInput.focus();
}

function clearEditMode() {
  editingId = null;
  const editingIdInput = getEditingIdInput();
  const editingBanner = getEditingBanner();
  const cancelEditBtn = getCancelEditBtn();
  const formTitle = getFormTitle();
  const subdomainInput = getSubdomainInput();
  const rootDomainSelect = getRootDomainSelect();
  const button = getButton();
  if (editingIdInput) editingIdInput.value = '';
  if (editingBanner) editingBanner.classList.add('hidden');
  if (cancelEditBtn) cancelEditBtn.classList.add('hidden');
  if (formTitle) formTitle.textContent = '一键隐藏端口';
  if (subdomainInput) {
    subdomainInput.disabled = false;
    subdomainInput.classList.remove('opacity-60', 'cursor-not-allowed');
  }
  if (rootDomainSelect) {
    rootDomainSelect.disabled = false;
    rootDomainSelect.classList.remove('opacity-60', 'cursor-not-allowed');
  }
  if (button) button.textContent = '一键生成';
  setButtonEnabled(Boolean(rootDomainSelect && rootDomainSelect.value));
}

async function onRecordsClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const editBtn = target.closest('[data-edit-id]');
  if (editBtn) {
    setEditMode({
      id: editBtn.getAttribute('data-edit-id') || '',
      host_name: editBtn.getAttribute('data-host-name') || '',
      root_domain: editBtn.getAttribute('data-root-domain') || '',
      subdomain: editBtn.getAttribute('data-subdomain') || '',
      server_address: editBtn.getAttribute('data-server-address') || '',
      port: Number(editBtn.getAttribute('data-port') || 0)
    });
    return;
  }

  const btn = target.closest('[data-delete-id]');
  if (!btn) return;
  const id = btn.getAttribute('data-delete-id');
  if (!id) return;
  if (!confirm('确认删除？此操作也将从 Cloudflare DNS 中移除该解析')) return;

  btn.setAttribute('disabled', 'true');
  const oldText = btn.textContent;
  btn.textContent = '删除中...';
  try {
    const res = await fetch(`/api/dns/${encodeURIComponent(id)}/delete`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: csrfHeaders({ Accept: 'application/json' })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.message || '删除失败');
    }
    removeRecord(id);
    if (editingId === id) {
      clearEditMode();
      const subdomainInput = getSubdomainInput();
      const serverAddressInput = getServerAddressInput();
      if (subdomainInput) subdomainInput.value = '';
      if (serverAddressInput) serverAddressInput.value = '';
    }
    if (typeof data.record_count === 'number') {
      setRecordCount(data.record_count);
    } else {
      setRecordCount(Math.max(0, getRecordCount() - 1));
    }
    if (data.record_limit !== undefined) {
      domainMeta.recordLimit =
        data.record_limit === null || data.record_limit === undefined
          ? null
          : Number(data.record_limit);
      refreshHint();
    }
    showToast(data.message || '记录已删除', 'success');
  } catch (error) {
    showToast(error instanceof Error ? error.message : '删除失败', 'error');
  } finally {
    btn.removeAttribute('disabled');
    btn.textContent = oldText || '删除';
  }
}

async function submitDnsForm() {
  if (editingId) {
    await updateDnsRecord(editingId);
  } else {
    await createDnsRecords();
  }
}

async function createDnsRecords() {
  const subdomainInput = getSubdomainInput();
  const rootDomainSelect = getRootDomainSelect();
  const serverAddressInput = getServerAddressInput();
  const portInput = getPortInput();
  const button = getButton();
  if (!subdomainInput || !rootDomainSelect || !serverAddressInput || !portInput || !button) return;
  const subdomain = subdomainInput.value.trim();
  const rootDomain = rootDomainSelect.value;
  const serverAddress = serverAddressInput.value.trim();
  const port = portInput.value.trim();

  if (!subdomain || !rootDomain || !serverAddress || !port) {
    showToast('请完整填写信息！', 'error');
    return;
  }

  setButtonEnabled(false);
  button.textContent = '创建中...';

  try {
    const res = await fetch('/api/create-dns', {
      method: 'POST',
      headers: csrfHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
      credentials: 'same-origin',
      body: JSON.stringify({
        subdomain,
        rootDomain,
        serverAddress,
        port: Number(port)
      })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      showToast(data.message || 'DNS 记录创建失败', 'error');
      return;
    }

    if (data.record) {
      prependRecord(data.record);
    }
    if (typeof data.record_count === 'number') {
      setRecordCount(data.record_count);
    } else {
      setRecordCount(getRecordCount() + 1);
    }
    if (data.record_limit !== undefined) {
      domainMeta.recordLimit =
        data.record_limit === null || data.record_limit === undefined
          ? null
          : Number(data.record_limit);
      refreshHint();
    }

    subdomainInput.value = '';
    showToast(data.message || 'DNS 记录创建成功', 'success');
  } catch (error) {
    showToast('网络请求失败，请检查 Worker 服务', 'error');
  } finally {
    button.textContent = '一键生成';
    setButtonEnabled(Boolean(rootDomainSelect.value));
  }
}

async function updateDnsRecord(id) {
  const serverAddressInput = getServerAddressInput();
  const portInput = getPortInput();
  const button = getButton();
  const rootDomainSelect = getRootDomainSelect();
  if (!serverAddressInput || !portInput || !button) return;
  const serverAddress = serverAddressInput.value.trim();
  const port = portInput.value.trim();
  if (!serverAddress || !port) {
    showToast('请填写目标地址和端口', 'error');
    return;
  }

  setButtonEnabled(false);
  button.textContent = '保存中...';
  try {
    const res = await fetch(`/api/dns/${encodeURIComponent(id)}/update`, {
      method: 'POST',
      headers: csrfHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
      credentials: 'same-origin',
      body: JSON.stringify({
        serverAddress,
        port: Number(port)
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.message || '更新失败');
    }
    if (data.record) {
      updateRecordRow(data.record);
    }
    clearEditMode();
    showToast(data.message || 'DNS 记录已更新', 'success');
  } catch (error) {
    showToast(error instanceof Error ? error.message : '更新失败', 'error');
  } finally {
    if (editingId) {
      button.textContent = '保存修改';
      setButtonEnabled(true);
    } else {
      button.textContent = '一键生成';
      setButtonEnabled(Boolean(rootDomainSelect.value));
    }
  }
}

function setButtonEnabled(enabled) {
  const button = getButton();
  if (!button) return;
  button.disabled = !enabled;
  button.classList.toggle('opacity-60', !enabled);
  button.classList.toggle('cursor-not-allowed', !enabled);
}
