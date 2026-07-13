const button = document.getElementById('btn');
const rootDomainSelect = document.getElementById('root-domain');

/** @type {{ minSubdomainLength: number, recordLimit: number|null }} */
let domainMeta = {
  minSubdomainLength: 0,
  recordLimit: null
};

document.addEventListener('DOMContentLoaded', () => {
  loadDomains();
  const tbody = document.getElementById('records-tbody');
  if (tbody) {
    tbody.addEventListener('click', onRecordsClick);
  }
});
button.addEventListener('click', createDnsRecords);

async function loadDomains() {
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
    alert(error instanceof Error ? error.message : '域名加载失败，请检查 Worker 配置');
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
      <button type="button" data-delete-id="${escapeAttr(record.id)}" class="px-3 py-1.5 text-xs bg-rose-950/40 hover:bg-rose-900/60 text-rose-400 border border-rose-900/30 rounded-lg transition active:scale-[0.98]">
        删除
      </button>
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

function removeRecord(id) {
  const tbody = document.getElementById('records-tbody');
  if (!tbody) return;
  const row = tbody.querySelector(`tr[data-record-id="${CSS.escape(id)}"]`);
  if (row) row.remove();
  ensureEmptyState();
}

async function onRecordsClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
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
      headers: { Accept: 'application/json' }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.message || '删除失败');
    }
    removeRecord(id);
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
  } catch (error) {
    alert(error instanceof Error ? error.message : '删除失败');
  } finally {
    btn.removeAttribute('disabled');
    btn.textContent = oldText || '删除';
  }
}

async function createDnsRecords() {
  const subdomain = document.getElementById('subdomain').value.trim();
  const rootDomain = rootDomainSelect.value;
  const serverAddress = document.getElementById('server-address').value.trim();
  const port = document.getElementById('port').value.trim();

  if (!subdomain || !rootDomain || !serverAddress || !port) {
    alert('请完整填写信息！');
    return;
  }

  setButtonEnabled(false);
  button.textContent = '创建中...';

  try {
    const res = await fetch('/api/create-dns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      alert(data.message || 'DNS 记录创建失败');
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

    document.getElementById('subdomain').value = '';
  } catch (error) {
    alert('网络请求失败，请检查 Worker 服务');
  } finally {
    button.textContent = '一键生成';
    setButtonEnabled(Boolean(rootDomainSelect.value));
  }
}

function setButtonEnabled(enabled) {
  button.disabled = !enabled;
  button.style.opacity = enabled ? '1' : '0.6';
  button.style.cursor = enabled ? 'pointer' : 'not-allowed';
}
