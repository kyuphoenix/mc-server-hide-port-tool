import { describe, expect, it } from 'vitest'
import {
  getAllowedDomains,
  getCloudflareApiToken,
  type Bindings
} from '../src/services/cloudflare-dns'

describe('Cloudflare DNS deployment configuration', () => {
  it('reads tokens from the aggregate deployment secret', () => {
    const env = {
      CLOUDFLARE_DOMAINS_API_TOKEN: 'example.com:token-a,other.example:token-b'
    } as Bindings

    expect(getCloudflareApiToken(env, 'EXAMPLE.COM.')).toBe('token-a')
    expect(getCloudflareApiToken(env, 'other.example')).toBe('token-b')
    expect(getCloudflareApiToken(env, 'missing.example')).toBeNull()
  })

  it('derives allowed domains from the aggregate deployment secret', () => {
    const env = {
      CLOUDFLARE_DOMAINS_API_TOKEN: 'Example.COM:token-a,other.example:token-b,example.com:duplicate'
    } as Bindings

    expect(getAllowedDomains(env)).toEqual(['example.com', 'other.example'])
  })

  it('keeps explicit DOMAINS configuration as a backwards-compatible override', () => {
    const env = {
      DOMAINS: '["legacy.example"]',
      CLOUDFLARE_DOMAINS_API_TOKEN: 'new.example:token'
    } as unknown as Bindings

    expect(getAllowedDomains(env)).toEqual(['legacy.example'])
  })

  it('keeps legacy per-domain secrets as a rotation fallback', () => {
    const env = {
      CLOUDFLARE_DOMAINS_API_TOKEN: 'example.com:aggregate-token',
      example_com_CLOUDFLARE_API_TOKEN: 'legacy-token'
    } as unknown as Bindings

    expect(getCloudflareApiToken(env, 'example.com')).toBe('legacy-token')
  })
})
