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

const button = document.getElementById('btn');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const rootDomainSelect = document.getElementById('root-domain');
const subdomainInput = document.getElementById('subdomain');
const serverAddressInput = document.getElementById('server-address');
const portInput = document.getElementById('port');
const editingIdInput = document.getElementById('editing-id');
const editingBanner = document.getElementById('editing-banner');
const formTitle = document.getElementById('form-title');

/** @type {{ minSubdomainLength: number, recordLimit: number|null }} */
let domainMeta = {
  minSubdomainLength: 0,
  recordLimit: null
};

/** @type {string|null} */
let editingId = null;

document.addEventListener('DOMContentLoaded', () => {
  loadDomains();
  const tbody = document.getElementById('records-tbody');
  if (tbody) {
    tbody.addEventListener('click', onRecordsClick);
  }
  if (cancelEditBtn) {
    cancelEditBtn.addEventListener('click', () => clearEditMode());
  }
});
button.addEventListener('click', submitDnsForm);

async function loadDomains() {
  setButtonEnabled(false);
  rootDomainSelect.innerHTML = '<option value="">???...</option>';

  try {
    const res = await fetch('/api/domains');
    const data = await res.json();

    if (!res.ok || !data.success || !Array.isArray(data.domains) || data.domains.length === 0) {
      throw new Error(data.message || '???????????');
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
    rootDomainSelect.innerHTML = '<option value="">??????</option>';
    showToast(error instanceof Error ? error.message : '?????????? Worker ??', 'error');
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
  if (titleEl) titleEl.textContent = `???? (${n})`;
  refreshHint();
  ensureEmptyState();
}

function refreshHint() {
  const info = [];
  if (domainMeta.minSubdomainLength > 0) {
    info.push(`????? ${domainMeta.minSubdomainLength} ???`);
  }
  if (domainMeta.recordLimit !== null && domainMeta.recordLimit !== undefined && domainMeta.recordLimit > 0) {
    info.push(`???? ${getRecordCount()}/${domainMeta.recordLimit}`);
  } else if (domainMeta.recordLimit === 0) {
    info.push('??????');
  }
  setHint(info.join('  ?  '));
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
            <span>???????????????</span>
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
    <td class="py-4 px-4 font-mono-custom text-emerald-400 break-all select-all cursor-pointer" title="????????">${escapeHtml(record.host_name)}</td>
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
          ??
        </button>
        <button
          type="button"
          data-delete-id="${escapeAttr(record.id)}"
          class="px-3 py-1.5 text-xs bg-rose-950/40 hover:bg-rose-900/60 text-rose-400 border border-rose-900/30 rounded-lg transition active:scale-[0.98]"
        >
          ??
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
  const empty = tbody.querySelector('tr[data-empty-row]');
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
    el.style.opacity = '0';
    el.style.transition = 'opacity 200ms ease';
    window.setTimeout(() => el.remove(), 220);
  }, 2800);
}

function setEditMode(record) {
  editingId = record.id;
  if (editingIdInput) editingIdInput.value = record.id;
  if (editingBanner) editingBanner.classList.remove('hidden');
  if (cancelEditBtn) cancelEditBtn.classList.remove('hidden');
  if (formTitle) formTitle.textContent = '?? DNS ??';
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
  if (button) button.textContent = '????';
  setButtonEnabled(true);
  if (serverAddressInput) serverAddressInput.focus();
}

function clearEditMode() {
  editingId = null;
  if (editingIdInput) editingIdInput.value = '';
  if (editingBanner) editingBanner.classList.add('hidden');
  if (cancelEditBtn) cancelEditBtn.classList.add('hidden');
  if (formTitle) formTitle.textContent = '??????';
  if (subdomainInput) {
    subdomainInput.disabled = false;
    subdomainInput.classList.remove('opacity-60', 'cursor-not-allowed');
  }
  if (rootDomainSelect) {
    rootDomainSelect.disabled = false;
    rootDomainSelect.classList.remove('opacity-60', 'cursor-not-allowed');
  }
  if (button) button.textContent = '????';
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
  if (!confirm('??????????? Cloudflare DNS ??????')) return;

  btn.setAttribute('disabled', 'true');
  const oldText = btn.textContent;
  btn.textContent = '???...';
  try {
    const res = await fetch(`/api/dns/${encodeURIComponent(id)}/delete`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: csrfHeaders({ Accept: 'application/json' })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.message || '????');
    }
    removeRecord(id);
    if (editingId === id) {
      clearEditMode();
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
    showToast(data.message || '?????', 'success');
  } catch (error) {
    showToast(error instanceof Error ? error.message : '????', 'error');
  } finally {
    btn.removeAttribute('disabled');
    btn.textContent = oldText || '??';
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
  const subdomain = subdomainInput.value.trim();
  const rootDomain = rootDomainSelect.value;
  const serverAddress = serverAddressInput.value.trim();
  const port = portInput.value.trim();

  if (!subdomain || !rootDomain || !serverAddress || !port) {
    showToast('????????', 'error');
    return;
  }

  setButtonEnabled(false);
  button.textContent = '???...';

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
      showToast(data.message || 'DNS ??????', 'error');
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
    showToast(data.message || 'DNS ??????', 'success');
  } catch (error) {
    showToast('?????????? Worker ??', 'error');
  } finally {
    button.textContent = '????';
    setButtonEnabled(Boolean(rootDomainSelect.value));
  }
}

async function updateDnsRecord(id) {
  const serverAddress = serverAddressInput.value.trim();
  const port = portInput.value.trim();
  if (!serverAddress || !port) {
    showToast('??????????', 'error');
    return;
  }

  setButtonEnabled(false);
  button.textContent = '???...';
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
      throw new Error(data.message || '????');
    }
    if (data.record) {
      updateRecordRow(data.record);
    }
    clearEditMode();
    showToast(data.message || 'DNS ?????', 'success');
  } catch (error) {
    showToast(error instanceof Error ? error.message : '????', 'error');
  } finally {
    if (editingId) {
      button.textContent = '????';
      setButtonEnabled(true);
    } else {
      button.textContent = '????';
      setButtonEnabled(Boolean(rootDomainSelect.value));
    }
  }
}

function setButtonEnabled(enabled) {
  button.disabled = !enabled;
  button.style.opacity = enabled ? '1' : '0.6';
  button.style.cursor = enabled ? 'pointer' : 'not-allowed';
}
