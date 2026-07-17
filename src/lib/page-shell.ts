import type { Context } from 'hono'
import { getRequestCsrf, withCsrfCookie } from './csrf'


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
    <link rel="stylesheet" href="/static/app.css" />
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
