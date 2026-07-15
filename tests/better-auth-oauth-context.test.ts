import { describe, expect, it } from 'vitest'
import { readGenericOAuthCallback } from '../src/lib/better-auth-oauth-context'

function context(overrides: Record<string, unknown> = {}) {
  return {
    method: 'GET',
    path: '/oauth2/callback/:providerId',
    params: { providerId: 'fixture' },
    query: { state: 'oauth-state' },
    getCookie: (name: string) => name === 'oauth_registration_intent' ? 'intent-token' : null,
    ...overrides
  }
}

describe('readGenericOAuthCallback', () => {
  it('extracts the verified Better Auth 1.6.23 callback fields', () => {
    expect(readGenericOAuthCallback(context())).toEqual({
      providerId: 'fixture', state: 'oauth-state', intentToken: 'intent-token'
    })
  })

  it.each([
    { method: 'POST' },
    { path: '/sign-up/email' },
    { path: '/oauth2/link' },
    { params: { providerId: '' } }
  ])('ignores non-generic-callback context: %o', (overrides) => {
    expect(readGenericOAuthCallback(context(overrides))).toBeNull()
  })

  it('returns empty credentials on a recognized callback so authorization fails closed', () => {
    expect(readGenericOAuthCallback(context({ query: {}, getCookie: () => null }))).toEqual({
      providerId: 'fixture', state: '', intentToken: ''
    })
  })
})