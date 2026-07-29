export const ANNOUNCEMENT_STORAGE_KEY = 'hide-port-tool:announcement-preferences:v1';

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeAnnouncementPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { hideDate: '', dismissedVersion: 0 };
  }
  const hideDate = typeof value.hideDate === 'string' ? value.hideDate : '';
  const dismissedVersionRaw = Number(value.dismissedVersion);
  const dismissedVersion = Number.isFinite(dismissedVersionRaw) && dismissedVersionRaw > 0
    ? Math.floor(dismissedVersionRaw)
    : 0;
  return { hideDate, dismissedVersion };
}

export function shouldShowAnnouncement(version, preferences, today = localDateKey()) {
  const normalized = normalizeAnnouncementPreferences(preferences);
  const currentVersion = Math.max(0, Math.floor(Number(version) || 0));
  if (normalized.hideDate === today) return false;
  return currentVersion > normalized.dismissedVersion;
}

export function hideAnnouncementForToday(preferences, today = localDateKey()) {
  return {
    ...normalizeAnnouncementPreferences(preferences),
    hideDate: today
  };
}

export function dismissAnnouncementVersion(preferences, version) {
  const normalized = normalizeAnnouncementPreferences(preferences);
  const currentVersion = Math.max(0, Math.floor(Number(version) || 0));
  return {
    ...normalized,
    dismissedVersion: Math.max(normalized.dismissedVersion, currentVersion)
  };
}

export function isAnnouncementTrigger(page, search = '') {
  if (page === 'home' || page === 'settings' || page === 'admin') return true;
  if (page !== 'login') return false;
  return new URLSearchParams(search).get('registered') === '1';
}

function readPreferences() {
  try {
    const raw = window.localStorage.getItem(ANNOUNCEMENT_STORAGE_KEY);
    return normalizeAnnouncementPreferences(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeAnnouncementPreferences(null);
  }
}

function writePreferences(preferences) {
  try {
    window.localStorage.setItem(
      ANNOUNCEMENT_STORAGE_KEY,
      JSON.stringify(normalizeAnnouncementPreferences(preferences))
    );
  } catch {
    // Private browsing/storage policies may reject localStorage writes.
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function iconClose() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('h-5', 'w-5');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('d', 'M6 18L18 6M6 6l12 12');
  svg.appendChild(path);
  return svg;
}

function formatAnnouncementTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
}

export function renderAnnouncementDialog(announcement, initialPreferences = readPreferences()) {
  if (!announcement || typeof announcement !== 'object') return null;

  const overlay = element(
    'div',
    'fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-950/85 backdrop-blur-sm p-0 sm:p-6 opacity-0 transition-opacity duration-200'
  );
  overlay.setAttribute('data-announcement-dialog', '');

  const dialog = element(
    'section',
    'relative w-full sm:max-w-2xl max-h-[92vh] overflow-hidden rounded-t-2xl sm:rounded-2xl border border-slate-700/80 bg-slate-900 shadow-2xl shadow-black/60 translate-y-4 sm:translate-y-2 transition-transform duration-200'
  );
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'site-announcement-title');
  dialog.setAttribute('aria-describedby', 'site-announcement-content');

  const accent = element('div', 'h-1 w-full bg-gradient-to-r from-emerald-500 via-cyan-400 to-emerald-500');
  dialog.appendChild(accent);

  const closeButton = element(
    'button',
    'absolute right-4 top-5 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-950/70 text-slate-400 hover:border-slate-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/60 transition'
  );
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', '关闭本次公告');
  closeButton.appendChild(iconClose());
  dialog.appendChild(closeButton);

  const main = element('div', 'overflow-y-auto max-h-[calc(92vh-5rem)] px-5 py-6 sm:px-8 sm:py-8');
  const eyebrowRow = element('div', 'mb-4 flex items-center gap-3 pr-12');
  const eyebrow = element(
    'span',
    'inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-300',
    '站点广播'
  );
  const version = element(
    'span',
    'font-mono-custom text-xs text-slate-500',
    `VERSION ${Math.max(0, Number(announcement.version) || 0)}`
  );
  eyebrowRow.append(eyebrow, version);
  main.appendChild(eyebrowRow);

  const title = element(
    'h2',
    'pr-10 text-2xl sm:text-3xl font-black tracking-tight text-white break-words',
    announcement.title || '系统公告'
  );
  title.id = 'site-announcement-title';
  main.appendChild(title);

  const updatedText = formatAnnouncementTime(announcement.updatedAt);
  if (updatedText) {
    main.appendChild(element('p', 'mt-2 text-xs font-mono-custom text-slate-500', `更新时间 ${updatedText}`));
  }

  const divider = element('div', 'my-5 h-px bg-gradient-to-r from-slate-700 via-slate-800 to-transparent');
  main.appendChild(divider);

  const content = element(
    'div',
    'announcement-content break-words text-[15px] leading-7 text-slate-200'
  );
  content.id = 'site-announcement-content';
  if (typeof announcement.contentHtml === 'string') {
    content.innerHTML = announcement.contentHtml;
  } else {
    content.classList.add('whitespace-pre-wrap');
    content.textContent = String(announcement.content || '');
  }
  main.appendChild(content);

  const footer = element(
    'div',
    'mt-7 flex flex-col-reverse gap-3 border-t border-slate-800 pt-5 sm:flex-row sm:items-center sm:justify-between'
  );
  footer.appendChild(element('p', 'text-xs leading-5 text-slate-500', '关闭本次后，下次进入页面仍会显示。'));

  const actions = element('div', 'flex flex-wrap items-center justify-end gap-2 sm:ml-auto');
  const hideTodayButton = element(
    'button',
    'rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:border-slate-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-slate-500/60 transition',
    '今日不见'
  );
  hideTodayButton.type = 'button';
  const dismissButton = element(
    'button',
    'rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-300 hover:border-emerald-400/60 hover:bg-emerald-500/20 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/60 transition',
    '再也不见'
  );
  dismissButton.type = 'button';
  actions.append(hideTodayButton, dismissButton);
  footer.appendChild(actions);
  main.appendChild(footer);

  dialog.appendChild(main);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown);
    overlay.classList.add('opacity-0');
    dialog.classList.add('translate-y-4');
    document.body.style.overflow = previousOverflow;
    window.setTimeout(() => overlay.remove(), 200);
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') close();
  };

  closeButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  hideTodayButton.addEventListener('click', () => {
    writePreferences(hideAnnouncementForToday(initialPreferences));
    close();
  });
  dismissButton.addEventListener('click', () => {
    writePreferences(dismissAnnouncementVersion(initialPreferences, announcement.version));
    close();
  });
  document.addEventListener('keydown', onKeyDown);

  window.requestAnimationFrame(() => {
    overlay.classList.remove('opacity-0');
    dialog.classList.remove('translate-y-4', 'sm:translate-y-2');
    closeButton.focus();
  });

  return overlay;
}

export async function bootAnnouncement() {
  const app = document.getElementById('app');
  const page = app?.dataset?.page || '';
  if (!isAnnouncementTrigger(page, window.location.search)) return;

  try {
    const response = await fetch('/api/announcement/current', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return;
    const payload = await response.json();
    const announcement = payload?.success ? payload.data?.announcement : null;
    if (!announcement) return;

    const preferences = readPreferences();
    if (!shouldShowAnnouncement(announcement.version, preferences)) return;
    renderAnnouncementDialog(announcement, preferences);
  } catch {
    // Announcements should never prevent the application page from loading.
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  void bootAnnouncement();
}
