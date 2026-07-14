import { startAuthentication } from 'https://cdn.jsdelivr.net/npm/@simplewebauthn/browser@13.2.2/+esm';

const passkeyBtn = document.getElementById('passkey-login-btn');
const errorBox = document.getElementById('passkey-login-error');
const nextInput = document.getElementById('passkey-login-next');

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

function redirectTarget() {
  const next = (nextInput?.value || '').trim();
  if (next && next.startsWith('/') && !next.startsWith('//')) {
    return next;
  }
  return '/';
}

async function loginWithPasskey() {
  clearError();
  if (!window.PublicKeyCredential) {
    showError('\u5f53\u524d\u6d4f\u89c8\u5668\u4e0d\u652f\u6301 Passkey / WebAuthn');
    return;
  }

  if (passkeyBtn) {
    passkeyBtn.disabled = true;
    passkeyBtn.textContent = '\u9a8c\u8bc1\u4e2d...';
  }

  try {
    const optionsRes = await fetch('/api/auth/passkey/generate-authenticate-options', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    const optionsData = await readJson(optionsRes);
    if (!optionsRes.ok || !optionsData) {
      throw new Error(errorMessage(optionsData, '\u65e0\u6cd5\u751f\u6210 Passkey \u767b\u5f55\u53c2\u6570'));
    }

    const assertion = await startAuthentication({ optionsJSON: optionsData });
    const { clientExtensionResults, ...responseBody } = assertion;
    const verifyRes = await fetch('/api/auth/passkey/verify-authentication', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ response: responseBody })
    });
    const verifyData = await readJson(verifyRes);
    if (!verifyRes.ok) {
      throw new Error(errorMessage(verifyData, 'Passkey \u767b\u5f55\u5931\u8d25'));
    }

    window.location.href = redirectTarget();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Passkey \u767b\u5f55\u5931\u8d25';
    if (/cancel|abort|notallowed/i.test(msg)) {
      showError('\u5df2\u53d6\u6d88 Passkey \u767b\u5f55');
    } else {
      showError(msg);
    }
  } finally {
    if (passkeyBtn) {
      passkeyBtn.disabled = false;
      passkeyBtn.textContent = '\u4f7f\u7528 Passkey \u767b\u5f55';
    }
  }
}

if (passkeyBtn) {
  passkeyBtn.addEventListener('click', loginWithPasskey);
}
