import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'

const ANNOUNCEMENT_ALLOWED_TAGS = [
  'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'code',
  'ul', 'ol', 'li',
  'strong', 'b', 'em', 'i', 's', 'del', 'u', 'mark', 'small',
  'sub', 'sup', 'kbd',
  'a', 'img',
  'div', 'span',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'details', 'summary'
] as const

const ANNOUNCEMENT_ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  ol: ['start'],
  li: ['value'],
  th: ['colspan', 'rowspan'],
  td: ['colspan', 'rowspan'],
  details: ['open']
}

/**
 * Renders administrator-authored announcement source as safe rich HTML.
 * Markdown and a constrained subset of raw HTML are supported; scripts,
 * event handlers, inline styles, document identifiers, and unsafe URLs are removed.
 */
export function renderAnnouncementHtml(source: string): string {
  const markdownHtml = marked.parse(String(source ?? ''), {
    async: false,
    breaks: true,
    gfm: true
  }) as string

  return sanitizeHtml(markdownHtml, {
    allowedTags: [...ANNOUNCEMENT_ALLOWED_TAGS],
    allowedAttributes: ANNOUNCEMENT_ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowProtocolRelative: false,
    enforceHtmlBoundary: true,
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: 'a',
        attribs: {
          ...attribs,
          target: '_blank',
          rel: 'noopener noreferrer'
        }
      })
    }
  })
}
