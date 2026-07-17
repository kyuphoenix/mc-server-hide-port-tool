import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto'

const PREFIX = 'enc:v1:'
const MIN_KEY_LENGTH = 32
const EXAMPLE_DATA_KEY = 'replace_with_an_independent_long_random_string'

export type SensitiveDataEnvironment = {
  DATA_ENCRYPTION_KEY?: string
  DATA_ENCRYPTION_KEY_PREVIOUS?: string
  BETTER_AUTH_SECRET?: string
}

export type SensitiveDataKeySource =
  | string
  | undefined
  | {
      primary?: string
      previous?: Array<string | undefined>
    }

function validKey(value: string | undefined): string | null {
  const normalized = String(value ?? '').trim()
  return normalized.length >= MIN_KEY_LENGTH ? normalized : null
}

function resolveKeys(source: SensitiveDataKeySource): string[] {
  if (typeof source === 'string' || source === undefined) {
    const key = validKey(source)
    if (!key) throw new Error('sensitive_data_key_unavailable')
    return [key]
  }

  const keys = [source.primary, ...(source.previous ?? [])]
    .map(validKey)
    .filter((key): key is string => !!key)
  const unique = [...new Set(keys)]
  if (unique.length === 0) throw new Error('sensitive_data_key_unavailable')
  return unique
}

export function assertSensitiveDataConfiguration(
  env: SensitiveDataEnvironment
): { primary: string; previous: string[] } {
  const primary = String(env.DATA_ENCRYPTION_KEY ?? '').trim()
  if (primary.length < MIN_KEY_LENGTH || primary === EXAMPLE_DATA_KEY) {
    throw new Error('DATA_ENCRYPTION_KEY must be a private random value of at least 32 characters')
  }

  const authSecret = String(env.BETTER_AUTH_SECRET ?? '').trim()
  if (authSecret && primary === authSecret) {
    throw new Error('DATA_ENCRYPTION_KEY must be independent from BETTER_AUTH_SECRET')
  }

  const configuredPrevious = String(env.DATA_ENCRYPTION_KEY_PREVIOUS ?? '').trim()
  if (configuredPrevious && configuredPrevious.length < MIN_KEY_LENGTH) {
    throw new Error('DATA_ENCRYPTION_KEY_PREVIOUS must contain at least 32 characters when set')
  }
  if (configuredPrevious && configuredPrevious === primary) {
    throw new Error('DATA_ENCRYPTION_KEY_PREVIOUS must differ from DATA_ENCRYPTION_KEY')
  }

  const previous = [configuredPrevious, validKey(authSecret)]
    .filter((key): key is string => !!key)

  return { primary, previous: [...new Set(previous)] }
}

export function sensitiveDataKeysFromEnv(
  env: SensitiveDataEnvironment
): SensitiveDataKeySource {
  return assertSensitiveDataConfiguration(env)
}

export function isSealedSensitiveValue(value: string | null | undefined): boolean {
  return String(value ?? '').startsWith(PREFIX)
}

export async function sealSensitiveValue(
  source: SensitiveDataKeySource,
  value: string
): Promise<string> {
  if (!value) return ''
  if (isSealedSensitiveValue(value)) return value
  const [primary] = resolveKeys(source)
  const encrypted = await symmetricEncrypt({ key: primary!, data: value })
  return `${PREFIX}${encrypted}`
}

export async function openSensitiveValue(
  source: SensitiveDataKeySource,
  stored: string
): Promise<string> {
  if (!stored) return ''
  if (!isSealedSensitiveValue(stored)) return stored

  const ciphertext = stored.slice(PREFIX.length)
  for (const key of resolveKeys(source)) {
    try {
      return await symmetricDecrypt({ key, data: ciphertext })
    } catch {
      // Try the previous key during a bounded rotation window.
    }
  }
  throw new Error('sensitive_data_decryption_failed')
}
