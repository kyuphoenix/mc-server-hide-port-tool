import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('frontend static hardening', () => {
  it('assigns stored mail settings through DOM properties instead of HTML interpolation', async () => {
    const source = await readFile('public/static/admin-mail.js', 'utf8')
    const markup = source.slice(
      source.indexOf('card.innerHTML ='),
      source.indexOf('var removeButton')
    )

    expect(source).toContain("fromInput.value = String(row.from || '')")
    expect(source).toContain("keyInput.value = String(row.key || '')")
    expect(markup).not.toContain('row.from')
    expect(markup).not.toContain('row.key')
  })
})
