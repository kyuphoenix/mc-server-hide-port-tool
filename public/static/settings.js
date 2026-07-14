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
    showError('\u5f53\u524d\u6d4f\u89c8\u5668\u4e0d\u652f\u6301 Passkey / WebAuthn');
    return;
  }

  const defaultName = `Passkey ${new Date().toLocaleString('zh-CN')}`;
  const name = window.prompt('\u4e3a\u8be5 Passkey \u547d\u540d\uff08\u53ef\u7559\u7a7a\uff09', defaultName) ?? '';

  if (addBtn) {
    addBtn.disabled = true;
    addBtn.textContent = '\u521b\u5efa\u4e2d...';
  }

  try {
    const optionsRes = await fetch('/api/auth/passkey/generate-register-options?name=' + encodeURIComponent(name.trim()), {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    const optionsData = await readJson(optionsRes);
    if (!optionsRes.ok || !optionsData) {
      throw new Error(errorMessage(optionsData, '\u65e0\u6cd5\u751f\u6210 Passkey \u6ce8\u518c\u53c2\u6570'));
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
      throw new Error(errorMessage(verifyData, 'Passkey \u6ce8\u518c\u5931\u8d25'));
    }

    window.location.href = '/settings?passkey_info=' + encodeURIComponent('Passkey \u6dfb\u52a0\u6210\u529f');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Passkey \u6dfb\u52a0\u5931\u8d25';
    if (/cancel|abort|notallowed/i.test(msg)) {
      showError('\u5df2\u53d6\u6d88 Passkey \u521b\u5efa');
    } else {
      showError(msg);
    }
  } finally {
    if (addBtn) {
      addBtn.disabled = false;
      addBtn.textContent = '\u6dfb\u52a0 Passkey';
    }
  }
}

if (addBtn) {
  addBtn.addEventListener('click', addPasskey);
}
