import { describe, expect, it } from 'vitest'
import { maskEmail, maskUserForAdmin, maskUsersForAdmin } from '../../src/lib/privacy'

describe('maskEmail', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(maskEmail(null)).toBe('')
    expect(maskEmail(undefined)).toBe('')
    expect(maskEmail('')).toBe('')
    expect(maskEmail('   ')).toBe('')
  })

  it('masks a standard email keeping first char of local part and TLD only', () => {
    const masked = maskEmail('alice@example.com')
    expect(masked).toMatch(/^a\*+@/)
    // Non-TLD domain labels are masked; only the TLD (.com) is kept visible
    expect(masked).toMatch(/\.com$/)
    expect(masked).not.toContain('alice')
    expect(masked).not.toContain('example')
  })

  it('masks earlier domain labels but keeps TLD', () => {
    const masked = maskEmail('bob@sub.example.com')
    expect(masked).toMatch(/^b\*+@/)
    // 'sub' and 'example' should be masked, only 'com' (TLD) kept
    expect(masked).toMatch(/\.com$/)
    expect(masked).not.toContain('sub')
    expect(masked).not.toContain('example')
    expect(masked).not.toBe('bob@sub.example.com')
  })

  it('handles single-char local part', () => {
    const masked = maskEmail('a@example.com')
    // Local becomes '*', domain 'example' is masked, TLD 'com' kept
    expect(masked).toBe('*@e******.com')
  })

  it('handles single-label domains (no dot) by masking the label', () => {
    // Single-label domain: the only label is NOT a TLD (parts.length === 1), so it gets masked
    const masked = maskEmail('user@localhost')
    expect(masked).toMatch(/^u\*+@/)
    expect(masked).not.toContain('localhost')
    expect(masked).toMatch(/^u\*+@l\*+$/)
  })

  it('handles short non-email strings', () => {
    expect(maskEmail('ab')).toBe('**')
    expect(maskEmail('abc')).toBe('***')
    expect(maskEmail('abcd')).toBe('****')
  })

  it('handles longer non-email strings keeping first 2 and last 2', () => {
    // 'notanemail' = 10 chars: 'no' + min(6, 10-4)=6 '*' + 'il'
    const masked = maskEmail('notanemail')
    expect(masked).toBe('no******il')
  })

  it('does not leak the full original email', () => {
    const email = 'verylongname@subdomain.example.com'
    const masked = maskEmail(email)
    expect(masked).not.toBe(email)
    expect(masked).not.toContain('verylongname')
    expect(masked).not.toContain('subdomain')
    expect(masked).not.toContain('example')
  })

  it('caps the mask length at 6 characters for local part', () => {
    const masked = maskEmail('superlongusername@example.com')
    // local = 'superlongusername' (18 chars), mask should be 's' + up to 6 '*'
    expect(masked).toMatch(/^s\*{1,6}@/)
  })

  it('caps the mask length at 6 characters for domain labels', () => {
    const masked = maskEmail('a@verylongdomainname.example.com')
    // 'verylongdomainname' should be masked with at most 6 '*'
    expect(masked).not.toContain('verylongdomainname')
  })
})

describe('maskUserForAdmin', () => {
  it('masks email and adds email_masked flag', () => {
    const result = maskUserForAdmin({ id: '1', email: 'alice@example.com', name: 'Alice' })
    expect(result.id).toBe('1')
    expect(result.name).toBe('Alice')
    expect(result.email_masked).toBe(true)
    expect(result.email).not.toBe('alice@example.com')
    expect(result.email).toMatch(/^a\*+@/)
  })

  it('preserves email as empty string when null/undefined', () => {
    const result = maskUserForAdmin({ id: '1', email: null as string | null, name: 'Bob' })
    expect(result.email).toBe('')
    expect(result.email_masked).toBe(true)
  })

  it('preserves email as empty string when undefined', () => {
    const result = maskUserForAdmin({ id: '1', name: 'Bob' } as { id: string; name: string; email?: string | null })
    expect(result.email).toBe('')
    expect(result.email_masked).toBe(true)
  })
})

describe('maskUsersForAdmin', () => {
  it('masks each user in the array', () => {
    const users = [
      { id: '1', email: 'alice@example.com', name: 'Alice' },
      { id: '2', email: 'bob@test.org', name: 'Bob' }
    ]
    const result = maskUsersForAdmin(users)
    expect(result).toHaveLength(2)
    expect(result[0]!.email).not.toBe('alice@example.com')
    expect(result[1]!.email).not.toBe('bob@test.org')
    expect(result.every((u) => u.email_masked === true)).toBe(true)
  })

  it('returns empty array for empty input', () => {
    expect(maskUsersForAdmin([])).toEqual([])
  })

  it('does not mutate the original array', () => {
    const users = [{ id: '1', email: 'alice@example.com', name: 'Alice' }]
    const original = { ...users[0]! }
    maskUsersForAdmin(users)
    expect(users[0]).toEqual(original)
  })
})
