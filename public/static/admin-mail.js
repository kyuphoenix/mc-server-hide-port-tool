(function () {
  function $(id) {
    return document.getElementById(id);
  }

  function openModal(modal) {
    if (!modal) return;
    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  }

  var KEEP = '__KEEP__';

  function splitLines(v) {
    return String(v || '').split(/\r?\n/);
  }

  function readAccountsFromHidden() {
    var hiddenFroms = $('resend-account-froms');
    var hiddenKeys = $('resend-account-keys');
    var primaryFrom = $('resend-primary-from');
    var primaryKey = $('resend-primary-key');
    var froms = splitLines(hiddenFroms ? hiddenFroms.value : '');
    var keys = splitLines(hiddenKeys ? hiddenKeys.value : '');
    var rows = [];
    var n = Math.max(froms.length, keys.length, 1);
    for (var i = 0; i < n; i++) {
      var from = (froms[i] || '').trim();
      var key = (keys[i] || '').trim();
      if (!from && !key && i > 0) continue;
      rows.push({
        from: from,
        key: key === KEEP ? '' : key,
        keep: key === KEEP || (!key && !!from)
      });
    }
    if (rows.length === 0) rows.push({ from: '', key: '', keep: false });
    if (primaryFrom && primaryFrom.value) rows[0].from = primaryFrom.value;
    if (primaryKey && primaryKey.value) {
      rows[0].key = primaryKey.value;
      rows[0].keep = false;
    }
    return rows;
  }

  function collectAccounts() {
    var listEl = $('resend-accounts-list');
    if (!listEl) return [];
    var fromInputs = listEl.querySelectorAll('[data-from]');
    var keyInputs = listEl.querySelectorAll('[data-key]');
    var rows = [];
    for (var i = 0; i < fromInputs.length; i++) {
      var keyInput = keyInputs[i];
      var typed = keyInput ? String(keyInput.value || '') : '';
      var keep = !!(keyInput && keyInput.getAttribute('data-keep') === '1' && !typed.trim());
      rows.push({
        from: (fromInputs[i].value || '').trim(),
        key: typed,
        keep: keep
      });
    }
    return rows;
  }

  function renderAccounts(rows) {
    var listEl = $('resend-accounts-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    rows.forEach(function (row, idx) {
      var card = document.createElement('div');
      card.className = 'rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3';
      var keyPlaceholder = row.keep ? '已配置（留空则保留原密钥）' : 're_xxxxxxxx';
      card.innerHTML =
        '<div class="flex items-center justify-between gap-2">' +
          '<div class="text-xs font-semibold text-slate-400">账号 #' + (idx + 1) + (idx === 0 ? '（主账号）' : '') + '</div>' +
          '<button type="button" data-remove class="text-xs text-rose-400 hover:text-rose-300 transition">删除</button>' +
        '</div>' +
        '<div>' +
          '<label class="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">发件邮箱</label>' +
          '<input data-from type="email" placeholder="noreply@domain.com" class="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-md text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500" />' +
        '</div>' +
        '<div>' +
          '<label class="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">API Key</label>' +
          '<input data-key type="password" class="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-md text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono" />' +
        '</div>';
      var removeButton = card.querySelector('[data-remove]');
      var fromInput = card.querySelector('[data-from]');
      var keyInput = card.querySelector('[data-key]');
      if (removeButton) removeButton.setAttribute('data-remove', String(idx));
      if (fromInput) {
        fromInput.setAttribute('data-from', String(idx));
        fromInput.value = String(row.from || '');
      }
      if (keyInput) {
        keyInput.setAttribute('data-key', String(idx));
        keyInput.setAttribute('data-keep', row.keep ? '1' : '0');
        keyInput.value = String(row.key || '');
        keyInput.placeholder = keyPlaceholder;
      }
      listEl.appendChild(card);
    });

    listEl.querySelectorAll('[data-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var rowsNow = collectAccounts();
        var i = Number(btn.getAttribute('data-remove') || '0');
        rowsNow.splice(i, 1);
        if (rowsNow.length === 0) rowsNow = [{ from: '', key: '', keep: false }];
        renderAccounts(rowsNow);
      });
    });
  }

  function openMailTest(e) {
    if (e) e.preventDefault();
    var mailModal = $('mail-test-modal');
    var mailInput = $('mail-test-to');
    openModal(mailModal);
    if (mailInput) {
      setTimeout(function () {
        mailInput.focus();
      }, 0);
    }
  }

  function openAccounts(e) {
    if (e) e.preventDefault();
    renderAccounts(readAccountsFromHidden());
    openModal($('resend-accounts-modal'));
  }

  function applyAccounts(e) {
    if (e) e.preventDefault();
    var hiddenFroms = $('resend-account-froms');
    var hiddenKeys = $('resend-account-keys');
    var primaryFrom = $('resend-primary-from');
    var primaryKey = $('resend-primary-key');
    var rows = collectAccounts().filter(function (r) {
      return r.from || r.key || r.keep;
    });
    if (rows.length === 0) rows = [{ from: '', key: '', keep: false }];
    if (hiddenFroms) hiddenFroms.value = rows.map(function (r) { return r.from; }).join('\n');
    if (hiddenKeys) {
      hiddenKeys.value = rows.map(function (r) {
        var typed = (r.key || '').trim();
        if (typed) return typed;
        return r.keep ? KEEP : '';
      }).join('\n');
    }
    if (primaryFrom) primaryFrom.value = rows[0] ? rows[0].from : '';
    if (primaryKey) {
      var firstTyped = rows[0] ? String(rows[0].key || '').trim() : '';
      primaryKey.value = firstTyped || '';
      primaryKey.placeholder = (rows[0] && (rows[0].keep || firstTyped))
        ? '已配置（留空则不更新）'
        : 're_xxxxxxxx';
    }
    closeModal($('resend-accounts-modal'));
  }

  // Bind once with live DOM lookups so client-rendered admin pages work.
  if (!window.__adminMailBound) {
    window.__adminMailBound = true;
    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!(target instanceof Element)) return;

      if (target.closest('#mail-test-open')) {
        openMailTest(e);
        return;
      }
      if (target.closest('#resend-accounts-open')) {
        openAccounts(e);
        return;
      }
      if (target.closest('#resend-account-add')) {
        e.preventDefault();
        var rows = collectAccounts();
        rows.push({ from: '', key: '', keep: false });
        renderAccounts(rows);
        return;
      }
      if (target.closest('#resend-accounts-apply')) {
        applyAccounts(e);
        return;
      }
      if (target.closest('#mail-test-backdrop') || target.closest('#mail-test-close') || target.closest('#mail-test-cancel')) {
        e.preventDefault();
        closeModal($('mail-test-modal'));
        return;
      }
      if (target.closest('#resend-accounts-backdrop') || target.closest('#resend-accounts-close') || target.closest('#resend-accounts-cancel')) {
        e.preventDefault();
        closeModal($('resend-accounts-modal'));
        return;
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var mailModal = $('mail-test-modal');
      var accountsModal = $('resend-accounts-modal');
      if (mailModal && !mailModal.classList.contains('hidden')) closeModal(mailModal);
      if (accountsModal && !accountsModal.classList.contains('hidden')) closeModal(accountsModal);
    });
  }

  window.__adminMail = {
    openMailTest: openMailTest,
    openAccounts: openAccounts,
    refresh: function () {
      // no-op hook for re-render compatibility
    }
  };
})();
