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

/** @type {{ minSubdomainLength: number, recordLimit: number|null, dnsModeEnabled: boolean }} */
let domainMeta = {
  minSubdomainLength: 0,
  recordLimit: null,
  dnsModeEnabled: true
};

/** @type {string|null} */
let editingId = null;
/** @type {boolean} */ let editingIsDns = false;

function el(id) {
  return document.getElementById(id);
}

function getButton() { return el('btn'); }
function getCancelEditBtn() { return el('cancel-edit-btn'); }
function getRootDomainSelect() { return el('root-domain'); }
function getSubdomainInput() { return el('subdomain'); }
function getServerAddressInput() { return el('server-address'); }
function getPortInput() { return el('port'); }
function getRecordModeSelect() { return el('record-mode'); }
function getRecordTypeSelect() { return el('record-type'); }
function getProxiedInput() { return el('proxied'); }
function getPortGroup() { return el('port-group'); }
function getRecordTypeGroup() { return el('record-type-group'); }
function getProxiedGroup() { return el('proxied-group'); }
function getServerAddressLabel() { return el('server-address-label'); }
function getRemarkInput() { return el('remark'); }
function getEditingIdInput() { return el('editing-id'); }
function getEditingBanner() { return el('editing-banner'); }
function getFormTitle() { return el('form-title'); }
function getRecordModeInfoDns() { return el('record-mode-info-dns'); }
function getRecordModeInfoMc() { return el('record-mode-info-mc'); }

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

  const recordModeSelect = getRecordModeSelect();
  if (recordModeSelect && !recordModeSelect.dataset.bound) {
    recordModeSelect.dataset.bound = '1';
    recordModeSelect.addEventListener('change', refreshModeFields);
  }
  const recordTypeSelect = getRecordTypeSelect();
  if (recordTypeSelect && !recordTypeSelect.dataset.bound) {
    recordTypeSelect.dataset.bound = '1';
    recordTypeSelect.addEventListener('change', refreshModeFields);
  }
  refreshModeFields();

  initUserMenu();
  initRecordModeInfo();
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

function initRecordModeInfo() {
  const root = el('record-mode-info');
  const toggle = el('record-mode-info-toggle');
  const panel = el('record-mode-info-panel');
  if (!root || !toggle || !panel) return;
  if (toggle.dataset.bound) return;
  toggle.dataset.bound = '1';

  const isPinnedOpen = () => !panel.classList.contains('hidden');

  const setOpen = (open) => {
    panel.classList.toggle('hidden', !open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen(!isPinnedOpen());
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

function getRecordMode() {
  const select = getRecordModeSelect();
  return select && select.value === 'mc' ? 'mc' : 'dns';
}

function getRecordType() {
  const select = getRecordTypeSelect();
  return select ? String(select.value || 'A').toUpperCase() : 'A';
}

function needsPort(mode = getRecordMode(), type = getRecordType()) {
  return mode === 'mc' || type === 'SRV';
}

function canProxy(mode = getRecordMode(), type = getRecordType()) {
  return mode === 'dns' && ['A', 'AAAA', 'CNAME'].includes(type);
}

function refreshModeFields() {
  let mode = getRecordMode();
  let type = getRecordType();
  const portGroup = getPortGroup();
  const recordTypeGroup = getRecordTypeGroup();
  const proxiedGroup = getProxiedGroup();
  const subdomainInput = getSubdomainInput();
  const serverAddressLabel = getServerAddressLabel();
  const serverAddressInput = getServerAddressInput();
  const proxiedInput = getProxiedInput();
  const button = getButton();

  const modeSelect = getRecordModeSelect();
  if (modeSelect) {
    const dnsOption = modeSelect.querySelector('option[value="dns"]');
    if (dnsOption) {
      const dnsAvailable = domainMeta.dnsModeEnabled || editingIsDns;
      dnsOption.hidden = !dnsAvailable;
      dnsOption.disabled = !dnsAvailable;
      dnsOption.textContent = domainMeta.dnsModeEnabled ? '普通 DNS' : '普通 DNS（已关闭）';
    }
    if (!domainMeta.dnsModeEnabled && !editingIsDns && modeSelect.value !== 'mc') {
      modeSelect.value = 'mc';
    }
    mode = getRecordMode();
    type = getRecordType();
  }
  if (portGroup) portGroup.classList.toggle('hidden', !needsPort(mode, type));
  if (recordTypeGroup) recordTypeGroup.classList.toggle('hidden', mode !== 'dns');
  if (proxiedGroup) proxiedGroup.classList.toggle('hidden', !canProxy(mode, type));
  if (proxiedInput && !canProxy(mode, type)) proxiedInput.checked = false;
  if (subdomainInput && !subdomainInput.disabled) {
    subdomainInput.placeholder = mode === 'mc'
      ? '如 play'
      : type === 'TXT'
        ? '如 _acme-challenge 或 selector1._domainkey'
        : type === 'SRV'
          ? '如 _sip._tcp.voice'
          : '如 www 或 api';
  }
  if (serverAddressLabel) {
    serverAddressLabel.textContent = mode === 'mc'
      ? '真实服务器地址 (IP/域名)'
      : type === 'TXT'
        ? 'TXT 内容'
        : type === 'SRV'
          ? 'SRV 目标域名'
          : '记录内容';
  }
  if (serverAddressInput) {
    serverAddressInput.placeholder = mode === 'mc'
      ? '例如 124.223.x.x 或 sub.domain.com'
      : type === 'TXT'
        ? '例如 v=spf1 include:_spf.example.com ~all'
        : type === 'SRV'
          ? '例如 target.example.com'
          : '例如 192.0.2.10 或 target.example.com';
  }
  if (button && !editingId) button.textContent = mode === 'mc' ? '创建 MC 记录' : '创建 DNS 记录';
  refreshRecordModeInfo();
}

function refreshRecordModeInfo() {
  const showDns = domainMeta.dnsModeEnabled;
  const dnsSection = getRecordModeInfoDns();
  const mcSection = getRecordModeInfoMc();
  if (dnsSection) dnsSection.hidden = !showDns;
  if (mcSection) {
    mcSection.classList.toggle('border-t', showDns);
    mcSection.classList.toggle('border-slate-800', showDns);
    mcSection.classList.toggle('pt-2.5', showDns);
  }
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
    domainMeta.dnsModeEnabled = data.dns_mode_enabled !== false;

    if (typeof data.record_count === 'number') {
      setRecordCount(data.record_count);
    } else {
      refreshHint();
    }

    setButtonEnabled(true);
    refreshModeFields();
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
        <td colspan="9" class="py-12 text-center text-slate-500">
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
  const mode = record.record_mode === 'dns' ? '普通 DNS' : 'MC 模式';
  const type = String(record.target_type || '');
  const port = record.record_mode === 'mc' || type === 'SRV' ? String(record.port || '') : '-';
  const proxied = record.record_mode === 'dns' && ['A', 'AAAA', 'CNAME'].includes(type) ? (Number(record.proxied || 0) > 0 ? '小黄云' : 'DNS only') : '-';
  const remark = String(record.remark || '').trim();
  tr.innerHTML = `
    <td class="py-4 px-4 font-mono-custom text-emerald-400 break-all select-all cursor-pointer" title="点击即可选择复制">${escapeHtml(record.host_name)}</td>
    <td class="py-4 px-4 text-slate-300 text-xs">${escapeHtml(mode)}</td>
    <td class="py-4 px-4 font-mono-custom text-slate-300">${escapeHtml(type)}</td>
    <td class="py-4 px-4 font-mono-custom text-slate-300 break-all">${escapeHtml(record.server_address)}</td>
    <td class="py-4 px-4 text-slate-300 text-xs">${escapeHtml(proxied)}</td>
    <td class="py-4 px-4 font-mono-custom text-slate-300">${escapeHtml(port)}</td>
    <td class="py-4 px-4 text-slate-300 break-all">${remark ? escapeHtml(remark) : '<span class="text-slate-600">-</span>'}</td>
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
          data-port="${escapeAttr(String(record.port || ''))}"
          data-mode="${escapeAttr(record.record_mode || 'mc')}"
          data-target-type="${escapeAttr(record.target_type || '')}"
          data-proxied="${Number(record.proxied || 0) > 0 ? '1' : '0'}"
          data-remark="${escapeAttr(remark)}"
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
  const recordModeSelect = getRecordModeSelect();
  const recordTypeSelect = getRecordTypeSelect();
  const proxiedInput = getProxiedInput();
  const remarkInput = getRemarkInput();
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
  if (recordModeSelect) recordModeSelect.value = record.record_mode === 'dns' ? 'dns' : 'mc';
  editingIsDns = record.record_mode === 'dns';
  if (recordTypeSelect && record.target_type) recordTypeSelect.value = record.target_type;
  if (proxiedInput) proxiedInput.checked = Number(record.proxied || 0) > 0;
  if (serverAddressInput) serverAddressInput.value = record.server_address || '';
  if (portInput) portInput.value = String(record.port || '');
  if (remarkInput) remarkInput.value = record.remark || '';
  if (button) button.textContent = '保存修改';
  refreshModeFields();
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
  const remarkInput = getRemarkInput();
  if (editingIdInput) editingIdInput.value = '';
  if (editingBanner) editingBanner.classList.add('hidden');
  if (cancelEditBtn) cancelEditBtn.classList.add('hidden');
  if (formTitle) formTitle.textContent = '创建 DNS 记录';
  editingIsDns = false;
  if (subdomainInput) {
    subdomainInput.disabled = false;
    subdomainInput.classList.remove('opacity-60', 'cursor-not-allowed');
  }
  if (rootDomainSelect) {
    rootDomainSelect.disabled = false;
    rootDomainSelect.classList.remove('opacity-60', 'cursor-not-allowed');
  }
  refreshModeFields();
  if (button) button.textContent = getRecordMode() === 'mc' ? '创建 MC 记录' : '创建 DNS 记录';
  if (remarkInput) remarkInput.value = '';
  setButtonEnabled(Boolean(rootDomainSelect && rootDomainSelect.value));
}

async function onRecordsClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const editBtn = target.closest('[data-edit-id]');
  if (editBtn) {
    editingIsDns = String(editBtn.getAttribute('data-mode') || 'mc') === 'dns';
    setEditMode({
      id: editBtn.getAttribute('data-edit-id') || '',
      host_name: editBtn.getAttribute('data-host-name') || '',
      root_domain: editBtn.getAttribute('data-root-domain') || '',
      subdomain: editBtn.getAttribute('data-subdomain') || '',
      server_address: editBtn.getAttribute('data-server-address') || '',
      port: Number(editBtn.getAttribute('data-port') || 0),
      record_mode: editBtn.getAttribute('data-mode') || 'mc',
      target_type: editBtn.getAttribute('data-target-type') || '',
      proxied: editBtn.getAttribute('data-proxied') === '1' ? 1 : 0,
      remark: editBtn.getAttribute('data-remark') || ''
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
      domainMeta.dnsModeEnabled = data.dns_mode_enabled !== false;
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
  const recordTypeSelect = getRecordTypeSelect();
  const proxiedInput = getProxiedInput();
  const remarkInput = getRemarkInput();
  const button = getButton();
  if (!subdomainInput || !rootDomainSelect || !serverAddressInput || !portInput || !button) return;
  const mode = getRecordMode();
  const subdomain = subdomainInput.value.trim();
  const rootDomain = rootDomainSelect.value;
  const serverAddress = serverAddressInput.value.trim();
  const port = portInput.value.trim();
  const recordType = recordTypeSelect ? recordTypeSelect.value : 'A';
  const proxied = Boolean(proxiedInput && proxiedInput.checked);
  const remark = remarkInput ? remarkInput.value.trim() : '';

  if (!subdomain || !rootDomain || !serverAddress || (needsPort(mode, recordType) && !port)) {
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
        mode,
        subdomain,
        rootDomain,
        serverAddress,
        port: needsPort(mode, recordType) ? Number(port) : undefined,
        recordType,
        proxied,
        remark
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
      domainMeta.dnsModeEnabled = data.dns_mode_enabled !== false;
      refreshHint();
    }

    subdomainInput.value = '';
    if (remarkInput) remarkInput.value = '';
    showToast(data.message || 'DNS 记录创建成功', 'success');
  } catch (error) {
    showToast('网络请求失败，请检查 Worker 服务', 'error');
  } finally {
    button.textContent = getRecordMode() === 'mc' ? '创建 MC 记录' : '创建 DNS 记录';
    refreshModeFields();
    setButtonEnabled(Boolean(rootDomainSelect.value));
  }
}

async function updateDnsRecord(id) {
  const serverAddressInput = getServerAddressInput();
  const portInput = getPortInput();
  const recordTypeSelect = getRecordTypeSelect();
  const proxiedInput = getProxiedInput();
  const remarkInput = getRemarkInput();
  const button = getButton();
  const rootDomainSelect = getRootDomainSelect();
  if (!serverAddressInput || !portInput || !button) return;
  const mode = getRecordMode();
  const serverAddress = serverAddressInput.value.trim();
  const port = portInput.value.trim();
  const recordType = recordTypeSelect ? recordTypeSelect.value : 'A';
  const proxied = Boolean(proxiedInput && proxiedInput.checked);
  const remark = remarkInput ? remarkInput.value.trim() : '';
  if (!serverAddress || (needsPort(mode, recordType) && !port)) {
    showToast(needsPort(mode, recordType) ? '请填写目标地址和端口' : '请填写记录内容', 'error');
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
        mode,
        serverAddress,
        port: needsPort(mode, recordType) ? Number(port) : undefined,
        recordType,
        proxied,
        remark
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
      button.textContent = getRecordMode() === 'mc' ? '创建 MC 记录' : '创建 DNS 记录';
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
