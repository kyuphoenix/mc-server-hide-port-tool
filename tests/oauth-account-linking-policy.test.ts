import { describe, expect, it } from 'vitest'
import { OAUTH_ACCOUNT_LINKING_ALLOW_DIFFERENT_EMAILS } from '../src/auth'

describe('OAuth account linking policy', () => {
  it('fails closed for OAuth identities with a different email', () => {
    expect(OAUTH_ACCOUNT_LINKING_ALLOW_DIFFERENT_EMAILS).toBe(false)
  })
})
