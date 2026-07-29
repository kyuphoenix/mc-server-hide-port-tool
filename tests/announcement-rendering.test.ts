import { describe, expect, it } from 'vitest'
import { renderAnnouncementHtml } from '../src/services/announcement-renderer'

describe('announcement rich-content rendering', () => {
  it('renders GitHub-flavored Markdown and raw HTML', () => {
    const html = renderAnnouncementHtml(`# Service update

**Important** and [details](/settings).

- first
- second

<details open><summary>More</summary><mark>HTML works</mark></details>`)

    expect(html).toContain('<h1>Service update</h1>')
    expect(html).toContain('<strong>Important</strong>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<details open>')
    expect(html).toContain('<mark>HTML works</mark>')
  })

  it('removes scripts, event handlers, unsafe URLs, styles, and document attributes', () => {
    const html = renderAnnouncementHtml(`<script>alert(1)</script>
<img src="https://example.test/banner.png" alt="banner" onerror="alert(2)" style="position:fixed" class="overlay">
<a href="javascript:alert(3)" onclick="alert(4)" id="bad-link">unsafe</a>
<strong>safe</strong>`)

    expect(html).toContain('<img src="https://example.test/banner.png" alt="banner" />')
    expect(html).toContain('<a target="_blank" rel="noopener noreferrer">unsafe</a>')
    expect(html).toContain('<strong>safe</strong>')
    expect(html).not.toMatch(/<script|alert\(|onerror|onclick|javascript:|style=|class=|id=/i)
  })

  it('hardens safe links that open from the announcement', () => {
    const html = renderAnnouncementHtml('[Documentation](https://example.test/docs "Docs")')

    expect(html).toContain('href="https://example.test/docs"')
    expect(html).toContain('title="Docs"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })
})
