import { describe, expect, it } from 'vitest'
import { assertAuthConfiguration } from '../src/auth'

const STRONG_SECRET = 'test-secret-with-at-least-thirty-two-characters'
const DATA_KEY = 'test-data-key-with-at-least-thirty-two-characters'

describe('auth production configuration', () => {
  it.each([
    undefined,
    '',
    'short-secret',
    'better-auth-secret-12345678901234567890'
  ])('rejects missing, weak, or public default secrets: %s', (secret) => {
    expect(() => assertAuthConfiguration({
      DB: {} as D1Database,
      BETTER_AUTH_SECRET: secret,
      BETTER_AUTH_URL: 'https://auth.example.com'
    })).toThrow(/BETTER_AUTH_SECRET/)
  })

  it.each([
    undefined,
    '',
    'http://auth.example.com',
    'https://user:password@auth.example.com',
    'not-a-url'
  ])('rejects missing or unsafe public auth URLs: %s', (baseURL) => {
    expect(() => assertAuthConfiguration({
      DB: {} as D1Database,
      BETTER_AUTH_SECRET: STRONG_SECRET,
      DATA_ENCRYPTION_KEY: DATA_KEY,
      BETTER_AUTH_URL: baseURL
    })).toThrow(/BETTER_AUTH_URL/)
  })

  it.each([
    undefined,
    '',
    'short-data-key',
    'replace_with_an_independent_long_random_string'
  ])('rejects missing, weak, or example data encryption keys: %s', (dataKey) => {
    expect(() => assertAuthConfiguration({
      DB: {} as D1Database,
      BETTER_AUTH_SECRET: STRONG_SECRET,
      DATA_ENCRYPTION_KEY: dataKey,
      BETTER_AUTH_URL: 'https://auth.example.com'
    })).toThrow(/DATA_ENCRYPTION_KEY/)
  })

  it('requires the data encryption key to be independent from the auth secret', () => {
    expect(() => assertAuthConfiguration({
      DB: {} as D1Database,
      BETTER_AUTH_SECRET: STRONG_SECRET,
      DATA_ENCRYPTION_KEY: STRONG_SECRET,
      BETTER_AUTH_URL: 'https://auth.example.com'
    })).toThrow(/independent/)
  })

  it.each([
    'short-previous-key',
    DATA_KEY
  ])('rejects invalid previous data encryption keys: %s', (previousKey) => {
    expect(() => assertAuthConfiguration({
      DB: {} as D1Database,
      BETTER_AUTH_SECRET: STRONG_SECRET,
      DATA_ENCRYPTION_KEY: DATA_KEY,
      DATA_ENCRYPTION_KEY_PREVIOUS: previousKey,
      BETTER_AUTH_URL: 'https://auth.example.com'
    })).toThrow(/DATA_ENCRYPTION_KEY_PREVIOUS/)
  })

  it('accepts HTTPS production origins and returns normalized values', () => {
    expect(assertAuthConfiguration({
      DB: {} as D1Database,
      BETTER_AUTH_SECRET: `  ${STRONG_SECRET}  `,
      DATA_ENCRYPTION_KEY: `  ${DATA_KEY}  `,
      BETTER_AUTH_URL: 'https://auth.example.com/'
    })).toEqual({
      secret: STRONG_SECRET,
      baseURL: 'https://auth.example.com'
    })
  })

  it('allows plain HTTP only for loopback development origins', () => {
    expect(assertAuthConfiguration({
      DB: {} as D1Database,
      BETTER_AUTH_SECRET: STRONG_SECRET,
      DATA_ENCRYPTION_KEY: DATA_KEY,
      BETTER_AUTH_URL: 'http://localhost:8787'
    }).baseURL).toBe('http://localhost:8787')
  })
})
