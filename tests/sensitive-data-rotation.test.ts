import { describe, expect, it } from 'vitest'
import {
  openSensitiveValue,
  sealSensitiveValue,
  sensitiveDataKeysFromEnv
} from '../src/services/sensitive-data'

const AUTH_KEY = 'auth-secret-with-at-least-thirty-two-characters'
const OLD_DATA_KEY = 'old-data-key-with-at-least-thirty-two-characters'
const NEW_DATA_KEY = 'new-data-key-with-at-least-thirty-two-characters'

describe('sensitive data key rotation', () => {
  it.each([
    undefined,
    '',
    'short-data-key',
    AUTH_KEY
  ])('rejects invalid primary data key configuration: %s', (dataKey) => {
    expect(() => sensitiveDataKeysFromEnv({
      BETTER_AUTH_SECRET: AUTH_KEY,
      DATA_ENCRYPTION_KEY: dataKey
    })).toThrow(/DATA_ENCRYPTION_KEY/)
  })

  it('decrypts legacy BETTER_AUTH_SECRET ciphertext after introducing a data key', async () => {
    const stored = await sealSensitiveValue(AUTH_KEY, 'legacy-secret')
    const keys = sensitiveDataKeysFromEnv({
      BETTER_AUTH_SECRET: AUTH_KEY,
      DATA_ENCRYPTION_KEY: NEW_DATA_KEY
    })

    expect(await openSensitiveValue(keys, stored)).toBe('legacy-secret')
  })

  it('decrypts the previous data key while encrypting new values with the current key', async () => {
    const oldCiphertext = await sealSensitiveValue(OLD_DATA_KEY, 'rotated-secret')
    const keys = sensitiveDataKeysFromEnv({
      BETTER_AUTH_SECRET: AUTH_KEY,
      DATA_ENCRYPTION_KEY: NEW_DATA_KEY,
      DATA_ENCRYPTION_KEY_PREVIOUS: OLD_DATA_KEY
    })
    const newCiphertext = await sealSensitiveValue(keys, 'new-secret')

    expect(await openSensitiveValue(keys, oldCiphertext)).toBe('rotated-secret')
    expect(await openSensitiveValue(NEW_DATA_KEY, newCiphertext)).toBe('new-secret')
    await expect(openSensitiveValue(NEW_DATA_KEY, oldCiphertext))
      .rejects.toThrow('sensitive_data_decryption_failed')
  })
})
