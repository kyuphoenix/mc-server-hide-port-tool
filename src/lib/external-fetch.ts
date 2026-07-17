export type ExternalFetchFailureCode =
  | 'EXTERNAL_REQUEST_TIMEOUT'
  | 'EXTERNAL_REQUEST_FAILED'
  | 'EXTERNAL_RESPONSE_TOO_LARGE'

export class ExternalFetchError extends Error {
  readonly code: ExternalFetchFailureCode

  constructor(code: ExternalFetchFailureCode) {
    super(code)
    this.name = 'ExternalFetchError'
    this.code = code
  }
}

type ExternalFetchPolicy = {
  timeoutMs: number
  retries?: number
  retryMethods?: readonly string[]
  retryStatuses?: readonly number[] | ((status: number) => boolean)
  retryDelayMs?: number
}

const DEFAULT_RETRY_METHODS = ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']
const DEFAULT_RETRY_STATUSES = (status: number) =>
  status === 408 || status === 429 || status >= 500

export async function fetchWithPolicy(
  input: RequestInfo | URL,
  init: RequestInit = {},
  policy: ExternalFetchPolicy
): Promise<Response> {
  const method = String(init.method || 'GET').toUpperCase()
  const retryMethods = new Set((policy.retryMethods || DEFAULT_RETRY_METHODS).map((value) => value.toUpperCase()))
  const maxRetries = retryMethods.has(method) ? Math.max(0, Math.trunc(policy.retries || 0)) : 0
  const retryStatuses = policy.retryStatuses
  const shouldRetryStatus = typeof retryStatuses === 'function'
    ? retryStatuses
    : (status: number) => retryStatuses
      ? retryStatuses.includes(status)
      : DEFAULT_RETRY_STATUSES(status)

  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController()
    let timedOut = false
    const abortFromCaller = () => controller.abort(init.signal?.reason)
    if (init.signal?.aborted) abortFromCaller()
    else init.signal?.addEventListener('abort', abortFromCaller, { once: true })
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, policy.timeoutMs)

    try {
      const response = await fetch(input, { ...init, signal: controller.signal })
      if (attempt < maxRetries && shouldRetryStatus(response.status)) {
        void response.body?.cancel().catch(() => undefined)
        await waitForRetry(policy.retryDelayMs, attempt)
        continue
      }
      return response
    } catch {
      if (init.signal?.aborted) {
        throw new ExternalFetchError('EXTERNAL_REQUEST_FAILED')
      }
      if (attempt < maxRetries) {
        await waitForRetry(policy.retryDelayMs, attempt)
        continue
      }
      throw new ExternalFetchError(timedOut ? 'EXTERNAL_REQUEST_TIMEOUT' : 'EXTERNAL_REQUEST_FAILED')
    } finally {
      clearTimeout(timeout)
      init.signal?.removeEventListener('abort', abortFromCaller)
    }
  }
}

async function waitForRetry(baseDelayMs = 100, attempt: number): Promise<void> {
  const delay = Math.max(0, Math.min(1_000, baseDelayMs * (attempt + 1)))
  if (delay === 0) return
  await new Promise((resolve) => setTimeout(resolve, delay))
}

export async function readTextWithLimit(
  response: Response,
  maxBytes: number,
  timeoutMs = 5_000
): Promise<string> {
  const safeMaxBytes = Math.max(0, Math.trunc(maxBytes))
  const safeTimeoutMs = Math.max(1, Math.trunc(timeoutMs))
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (Number.isFinite(contentLength) && contentLength > safeMaxBytes) {
    void response.body?.cancel().catch(() => undefined)
    throw new ExternalFetchError('EXTERNAL_RESPONSE_TOO_LARGE')
  }

  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new ExternalFetchError('EXTERNAL_REQUEST_TIMEOUT'))
    }, safeTimeoutMs)
  })

  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline])
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > safeMaxBytes) {
        throw new ExternalFetchError('EXTERNAL_RESPONSE_TOO_LARGE')
      }
      chunks.push(value)
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined)
    if (error instanceof ExternalFetchError) throw error
    throw new ExternalFetchError('EXTERNAL_REQUEST_FAILED')
  } finally {
    if (timeout) clearTimeout(timeout)
    try {
      reader.releaseLock()
    } catch {
      // The stream may still be settling after cancellation.
    }
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}
