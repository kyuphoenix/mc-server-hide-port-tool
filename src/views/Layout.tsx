import { raw } from 'hono/html'

export const Layout = ({ children, title }: { children: any; title: string }) => (
  <html lang="zh-CN" class="h-full scroll-smooth">
    <head>
      <meta charSet="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title}</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script>{raw(`
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
      `)}</script>
      <style>{raw(`
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
      `)}</style>
    </head>
    <body class="bg-slate-950 text-slate-100 min-h-screen flex flex-col antialiased selection:bg-brand-600 selection:text-white">
      <div class="flex-grow flex flex-col">
        {children}
      </div>
    </body>
  </html>
)
