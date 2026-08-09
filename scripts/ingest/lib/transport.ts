import { lookup as dnsLookup } from 'node:dns/promises'
import net from 'node:net'

import { IngestError } from './log'

export interface LookupAddress {
  address: string
  family: number
}

export type Lookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<LookupAddress[]>

export type FetchImplementation = (
  input: Request | string | URL,
  init?: RequestInit,
) => Promise<Response>

function ipv4Kind(address: string): string | undefined {
  const parts = address.split('.').map(Number)
  const [a, b] = parts
  if (a === 0) {
    return 'unspecified'
  }
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
    return 'private'
  }
  if (a === 127) {
    return 'loopback'
  }
  if (a === 169 && b === 254) {
    return 'link-local'
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return 'carrier-grade NAT'
  }
  if (a >= 224) {
    return 'multicast or reserved'
  }
  return undefined
}

function unsafeAddressKind(address: string): string | undefined {
  const family = net.isIP(address)
  if (family === 4) {
    return ipv4Kind(address)
  }
  if (family !== 6) {
    return 'invalid'
  }

  const normalized = address.toLowerCase().split('%')[0]
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  if (mapped) {
    return ipv4Kind(mapped)
  }
  if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') {
    return 'unspecified'
  }
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') {
    return 'loopback'
  }
  if (/^f[cd]/.test(normalized)) {
    return 'private'
  }
  if (/^fe[89ab]/.test(normalized)) {
    return 'link-local'
  }
  if (/^ff/.test(normalized)) {
    return 'multicast'
  }
  return undefined
}

export async function assertPublicHttpUrl(
  input: string | URL,
  lookup: Lookup = dnsLookup as Lookup,
): Promise<URL> {
  let url: URL
  try {
    url = input instanceof URL ? new URL(input) : new URL(input)
  } catch {
    throw new IngestError(`URL is invalid: ${String(input)}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new IngestError(`URL must use http or https: ${url.toString()}`)
  }
  if (url.username || url.password) {
    throw new IngestError('URL credentials are not allowed')
  }
  if (url.hostname.toLowerCase() === 'localhost') {
    throw new IngestError('localhost is not public')
  }

  const literalKind = unsafeAddressKind(url.hostname.replace(/^\[|\]$/g, ''))
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0) {
    if (literalKind) {
      throw new IngestError(`${literalKind} address is not allowed: ${url.hostname}`)
    }
    return url
  }

  const answers = await lookup(url.hostname, { all: true, verbatim: true })
  if (answers.length === 0) {
    throw new IngestError(`DNS returned no addresses for ${url.hostname}`)
  }
  for (const answer of answers) {
    const kind = unsafeAddressKind(answer.address)
    if (kind) {
      throw new IngestError(`${kind} address is not allowed: ${answer.address}`)
    }
  }
  return url
}

const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504])
const REDIRECT = new Set([301, 302, 303, 307, 308])

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function timedFetch(
  fetchImpl: FetchImplementation,
  url: URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new Error('timeout'))
  }, timeoutMs)
  const callerSignal = init.signal
  const abortFromCaller = () => controller.abort(callerSignal?.reason)
  callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
  if (callerSignal?.aborted) {
    abortFromCaller()
  }
  try {
    return await fetchImpl(url, { ...init, redirect: 'manual', signal: controller.signal })
  } catch (error) {
    if (timedOut) {
      throw new IngestError(`${init.method ?? 'GET'} ${url} timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', abortFromCaller)
  }
}

export async function fetchRead(
  input: string | URL,
  init: RequestInit = {},
  options: {
    backoffMs?: number
    fetchImpl?: FetchImplementation
    lookup?: Lookup
    maxRedirects?: number
    retries?: number
    throwHttpErrors?: boolean
    timeoutMs?: number
  } = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch
  const lookup = options.lookup ?? (dnsLookup as Lookup)
  const timeoutMs = options.timeoutMs ?? 20_000
  const retries = options.retries ?? 2
  const method = (init.method ?? 'GET').toUpperCase()
  const idempotent = method === 'GET' || method === 'HEAD'

  for (let attempt = 0; ; attempt += 1) {
    try {
      let url = await assertPublicHttpUrl(input, lookup)
      let requestInit = { ...init, method }
      for (let redirects = 0; ; redirects += 1) {
        const response = await timedFetch(fetchImpl, url, requestInit, timeoutMs)
        if (REDIRECT.has(response.status)) {
          if (redirects >= (options.maxRedirects ?? 5)) {
            throw new IngestError(`Too many redirects while fetching ${String(input)}`)
          }
          const location = response.headers.get('location')
          if (!location) {
            throw new IngestError(`Redirect from ${url} has no Location header`)
          }
          url = await assertPublicHttpUrl(new URL(location, url), lookup)
          if (response.status === 303 && method !== 'HEAD') {
            requestInit = { ...requestInit, method: 'GET' }
          }
          continue
        }
        if (response.ok) {
          return response
        }
        if (idempotent && TRANSIENT.has(response.status) && attempt < retries) {
          await response.body?.cancel()
          break
        }
        if (options.throwHttpErrors === false) {
          return response
        }
        throw new IngestError(`${method} ${url} failed with HTTP ${response.status}`)
      }
    } catch (error) {
      if (
        !idempotent ||
        attempt >= retries ||
        init.signal?.aborted ||
        error instanceof IngestError
      ) {
        throw error
      }
    }
    const backoff = options.backoffMs ?? (attempt === 0 ? 150 : 450)
    if (backoff > 0) {
      await delay(backoff)
    }
  }
}
