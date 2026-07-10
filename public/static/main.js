const button = document.getElementById('btn');
const rootDomainSelect = document.getElementById('root-domain');

document.addEventListener('DOMContentLoaded', loadDomains);
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

    // 展示子域名最小长度与记录上限提示
    const info = [];
    if (data.min_subdomain_length && data.min_subdomain_length > 0) {
      info.push(`子域名至少 ${data.min_subdomain_length} 个字符`);
    }
    if (data.record_limit !== null && data.record_limit !== undefined && data.record_limit > 0) {
      const countEl = document.getElementById('record-count');
      const cur = countEl ? Number(countEl.textContent) : 0;
      info.push(`记录上限 ${cur}/${data.record_limit}`);
    } else if (data.record_limit === 0) {
      info.push('记录数无上限');
    }
    setHint(info.join('  ·  '));

    setButtonEnabled(true);
  } catch (error) {
    rootDomainSelect.innerHTML = '<option value="">域名加载失败</option>';
    alert(error instanceof Error ? error.message : '域名加载失败，请检查 Worker 配置');
  }
}

function setHint(text) {
  let el = document.getElementById('create-hint');
  if (!el) return;
  if (text) {
    el.textContent = text;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
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
    alert(data.message || (data.success ? 'DNS 记录创建成功' : 'DNS 记录创建失败'));
    if (data.success) {
      window.location.reload();
    }
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
