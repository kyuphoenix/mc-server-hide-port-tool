import { startRegistration } from 'https://cdn.jsdelivr.net/npm/@simplewebauthn/browser@13.2.2/+esm';

const addBtn = document.getElementById('add-passkey-btn');
const errorBox = document.getElementById('passkey-client-error');

function showError(message) {
  if (!errorBox) {
    alert(message);
    return;
  }
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function clearError() {
  if (!errorBox) return;
  errorBox.textContent = '';
  errorBox.classList.add('hidden');
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function errorMessage(data, fallback) {
  if (!data) return fallback;
  return data.message || data.error?.message || data.code || fallback;
}

async function addPasskey() {
  clearError();
  if (!window.PublicKeyCredential) {
    showError('当前浏览器不支持 Passkey / WebAuthn');
    return;
  }

  const defaultName = `Passkey ${new Date().toLocaleString('zh-CN')}`;
  const name = window.prompt('为该 Passkey 命名（可留空）', defaultName) ?? '';

  if (addBtn) {
    addBtn.disabled = true;
    addBtn.textContent = '创建中...';
  }

  try {
    const optionsRes = await fetch('/api/auth/passkey/generate-register-options?name=' + encodeURIComponent(name.trim()), {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    const optionsData = await readJson(optionsRes);
    if (!optionsRes.ok || !optionsData) {
      throw new Error(errorMessage(optionsData, '无法生成 Passkey 注册参数'));
    }

    const attestation = await startRegistration({ optionsJSON: optionsData });
    const verifyRes = await fetch('/api/auth/passkey/verify-registration', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        response: attestation,
        name: name.trim() || undefined
      })
    });
    const verifyData = await readJson(verifyRes);
    if (!verifyRes.ok) {
      throw new Error(errorMessage(verifyData, 'Passkey 注册失败'));
    }

    window.location.href = '/settings?passkey_info=' + encodeURIComponent('Passkey 添加成功');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Passkey 添加失败';
    // user cancel is common
    if (/cancel|abort|notallowed/i.test(msg)) {
      showError('已取消 Passkey 创建');
    } else {
      showError(msg);
    }
  } finally {
    if (addBtn) {
      addBtn.disabled = false;
      addBtn.textContent = '添加 Passkey';
    }
  }
}

if (addBtn) {
  addBtn.addEventListener('click', addPasskey);
}
