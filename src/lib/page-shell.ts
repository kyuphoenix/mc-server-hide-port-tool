import type { Context } from 'hono'
import { getRequestCsrf, withCsrfCookie } from './csrf'

const TAILWIND_CONFIG = `
tailwind.config = {
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#ecfdf5',
          100: '#d1fae5',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          950: '#022c22'
        }
      }
    }
  }
}
`

const PAGE_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
body {
  font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
}
.font-mono-custom {
  font-family: 'JetBrains Mono', monospace;
}
select {
  appearance: none;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%2394a3b8' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3E%3C/svg%3E");
  background-position: right 0.75rem center;
  background-repeat: no-repeat;
  background-size: 1.25em 1.25em;
  padding-right: 2.5rem !important;
}
select option {
  background-color: #0f172a;
  color: #f8fafc;
}
`

export type PageShellOptions = {
  title: string
  page: string
  scripts?: string[]
  loadingText?: string
}

function escapeAttr(value: string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function renderScripts(scripts: string[]): string {
  return scripts
    .map((src) => {
      // main.js / admin-mail.js stay classic so they can attach globals without import/export.
      if (src.endsWith('main.js') || src.endsWith('admin-mail.js') || src.includes('?classic')) {
        const clean = src.replace(/\?classic$/, '')
        return `<script src="${escapeAttr(clean)}" defer></script>`
      }
      return `<script type="module" src="${escapeAttr(src)}"></script>`
    })
    .join('\n')
}

/** Thin HTML shell. Page body is rendered by public/static client modules. */
export function renderPageShell(opts: PageShellOptions): string {
  const scripts = renderScripts(opts.scripts || [])
  const loading = opts.loadingText || '\u52a0\u8f7d\u4e2d...'
  return `<!DOCTYPE html>
<html lang="zh-CN" class="h-full scroll-smooth">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeAttr(opts.title)}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>${TAILWIND_CONFIG}</script>
    <style>${PAGE_STYLES}</style>
  </head>
  <body class="bg-slate-950 text-slate-100 min-h-screen flex flex-col antialiased selection:bg-brand-600 selection:text-white">
    <div id="app" data-page="${escapeAttr(opts.page)}" class="flex-grow flex flex-col">
      <div class="min-h-screen flex items-center justify-center text-slate-400 text-sm">${escapeAttr(loading)}</div>
    </div>
    ${scripts}
  </body>
</html>`
}

export async function pageShellResponse(
  c: Context,
  opts: PageShellOptions,
  status: number = 200
): Promise<Response> {
  const csrf = getRequestCsrf(c)
  const html = renderPageShell(opts)
  const response = c.html(html, status as any)
  return withCsrfCookie(await response, csrf.setCookie)
}
