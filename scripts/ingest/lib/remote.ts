/**
 * Client for a remote Payload instance's REST API.
 *
 * The pipeline's other write path is the Local API, which opens a Postgres
 * connection to whatever `DATABASE_URI` points at. That works for a database on
 * this machine, but the production instance at cms.andribraun.dev isn't
 * reachable that way — so remote reads, writes, and uploads go over HTTP,
 * authenticated with an API key belonging to a `third-party-access` document.
 *
 * Generate the key in the admin panel: Third Party Access → new document →
 * tick "Enable API Key", save, copy the key into `PAYLOAD_API_KEY`.
 */

import { IngestError } from './log'
import { type FetchImplementation, fetchRead } from './transport'

export interface RemoteConfig {
  apiKey: string
  /** Slug of the API-key-enabled collection the key belongs to. */
  authCollection: string
  /** Origin only, no trailing slash or `/api` suffix. */
  baseUrl: string
}

export interface PaginatedDocs<T> {
  docs: T[]
  hasNextPage: boolean
  limit: number
  page: number
  totalDocs: number
  totalPages: number
}

export interface UploadFile {
  data: Buffer | Uint8Array
  mimetype: string
  name: string
}

/** Every document the pipeline reads back has at least an ID. */
export interface RemoteDoc {
  [key: string]: unknown
  id: number
}

export class RemoteHTTPError extends IngestError {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'RemoteHTTPError'
  }
}

const DEFAULT_AUTH_COLLECTION = 'third-party-access'

/**
 * Reads the remote instance's location and credentials from the environment.
 *
 * @throws IngestError when either variable is missing, naming the variable, so
 *   a misconfigured `.env` fails before anything is uploaded rather than after.
 */
export function remoteConfig(): RemoteConfig {
  const rawUrl = process.env.PAYLOAD_REMOTE_URL
  const apiKey = process.env.PAYLOAD_API_KEY

  if (!rawUrl) {
    throw new IngestError(
      'PAYLOAD_REMOTE_URL is not set — add it to .env (e.g. https://cms.andribraun.dev).',
    )
  }
  if (!apiKey) {
    throw new IngestError(
      'PAYLOAD_API_KEY is not set — generate one in the admin panel under Third Party Access.',
    )
  }

  let baseUrl: string
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new IngestError('PAYLOAD_REMOTE_URL must use http or https')
    }
    if (parsed.username || parsed.password) {
      throw new IngestError('PAYLOAD_REMOTE_URL must not contain credentials')
    }
    baseUrl = parsed.origin
  } catch {
    if (rawUrl.includes('://')) {
      const protocol = rawUrl.slice(0, rawUrl.indexOf(':'))
      if (protocol !== 'http' && protocol !== 'https') {
        throw new IngestError('PAYLOAD_REMOTE_URL must use http or https')
      }
    }
    throw new IngestError(`PAYLOAD_REMOTE_URL is not a valid URL: ${rawUrl}`)
  }

  return {
    apiKey,
    authCollection: process.env.PAYLOAD_API_KEY_COLLECTION || DEFAULT_AUTH_COLLECTION,
    baseUrl,
  }
}

/** Appends one value to a query string, expanding objects into `a[b][c]` keys. */
function appendQuery(search: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) {
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendQuery(search, `${key}[${index}]`, item))
    return
  }
  if (typeof value === 'object') {
    for (const [name, nested] of Object.entries(value as Record<string, unknown>)) {
      appendQuery(search, `${key}[${name}]`, nested)
    }
    return
  }
  // Arrays and objects returned above, so what's left stringifies cleanly.
  search.append(key, String(value as bigint | boolean | number | string))
}

/**
 * Builds a Payload-compatible query string. Nested objects become bracketed
 * keys, so `{ where: { slug: { equals: 'x' } } }` serialises to
 * `?where[slug][equals]=x`.
 */
export function buildQuery(params: Record<string, unknown> = {}): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    appendQuery(search, key, value)
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

/** Pulls the most useful message out of a Payload error response body. */
async function describeError(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '')

  try {
    const parsed = JSON.parse(raw) as {
      errors?: { data?: unknown; message?: string }[]
      message?: string
    }

    if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      return parsed.errors
        .map((error) => {
          // Validation failures nest the per-field messages one level deeper.
          const nested = (error.data as { errors?: { message?: string; path?: string }[] })?.errors
          const fields = Array.isArray(nested)
            ? nested
                .map((field) => [field.path, field.message].filter(Boolean).join(': '))
                .filter(Boolean)
                .join('; ')
            : ''
          const message = error.message ?? 'unknown error'
          return fields ? `${message} (${fields})` : message
        })
        .join('; ')
    }

    if (typeof parsed.message === 'string') {
      return parsed.message
    }
  } catch {
    // Not JSON — fall through to the raw body.
  }

  return raw.slice(0, 300).trim() || response.statusText
}

export class RemoteClient {
  private readonly apiKey: string
  private readonly authCollection: string
  private readonly transport: {
    backoffMs?: number
    fetchImpl: FetchImplementation
    timeoutMs: number
  }
  readonly baseUrl: string
  readonly host: string

  constructor(
    config: RemoteConfig,
    options: { backoffMs?: number; fetchImpl?: FetchImplementation; timeoutMs?: number } = {},
  ) {
    this.baseUrl = config.baseUrl
    this.apiKey = config.apiKey
    this.authCollection = config.authCollection
    this.host = new URL(config.baseUrl).host
    this.transport = {
      backoffMs: options.backoffMs,
      fetchImpl: options.fetchImpl ?? fetch,
      timeoutMs: options.timeoutMs ?? 20_000,
    }
  }

  private async writeRequest(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort(new Error('timeout'))
    }, this.transport.timeoutMs)
    const caller = init.signal
    const abort = () => controller.abort(caller?.reason)
    caller?.addEventListener('abort', abort, { once: true })
    if (caller?.aborted) {
      abort()
    }
    try {
      return await this.transport.fetchImpl(url, { ...init, signal: controller.signal })
    } catch (error) {
      if (timedOut) {
        throw new IngestError(
          `${init.method ?? 'POST'} ${url} timed out after ${this.transport.timeoutMs}ms`,
        )
      }
      throw error
    } finally {
      clearTimeout(timer)
      caller?.removeEventListener('abort', abort)
    }
  }

  async create<T = RemoteDoc>(collection: string, data: unknown): Promise<T> {
    const result = await this.request<{ doc: T }>(collection, {
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    return result.doc
  }

  async delete<T = RemoteDoc>(collection: string, id: number | string): Promise<T> {
    const result = await this.request<{ doc: T }>(`${collection}/${id}`, { method: 'DELETE' })
    return result.doc
  }

  async find<T = RemoteDoc>(
    collection: string,
    query: Record<string, unknown> = {},
  ): Promise<PaginatedDocs<T>> {
    return await this.request<PaginatedDocs<T>>(collection, { method: 'GET' }, query)
  }

  async findByID<T = RemoteDoc>(
    collection: string,
    id: number | string,
    query: Record<string, unknown> = {},
  ): Promise<T> {
    return await this.request<T>(`${collection}/${id}`, { method: 'GET' }, query)
  }

  /** Identity of the API key's own document — used to verify credentials. */
  async me(): Promise<{ user?: RemoteDoc }> {
    return await this.request<{ user?: RemoteDoc }>(`${this.authCollection}/me`, { method: 'GET' })
  }

  /** POSTs JSON to a non-collection endpoint, e.g. `extract-technologies`. */
  async post<T>(path: string, body: unknown): Promise<T> {
    return await this.request<T>(path, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
  }

  /**
   * Performs an authenticated request against `<baseUrl>/api/<path>`.
   *
   * @throws IngestError on transport failure or any non-2xx response, with the
   *   server's own error message attached.
   */
  async request<T>(
    path: string,
    init: RequestInit = {},
    query?: Record<string, unknown>,
  ): Promise<T> {
    const method = init.method ?? 'GET'
    const url = `${this.baseUrl}/api/${path.replace(/^\//, '')}${buildQuery(query)}`

    let response: Response
    try {
      const requestInit = {
        ...init,
        headers: {
          Authorization: `${this.authCollection} API-Key ${this.apiKey}`,
          ...init.headers,
        },
      }
      if (method === 'GET' || method === 'HEAD') {
        response = await fetchRead(url, requestInit, {
          backoffMs: this.transport.backoffMs,
          fetchImpl: this.transport.fetchImpl,
          throwHttpErrors: false,
          timeoutMs: this.transport.timeoutMs,
        })
      } else {
        response = await this.writeRequest(url, requestInit)
      }
    } catch (error) {
      throw new IngestError(
        `${method} ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    if (!response.ok) {
      throw new RemoteHTTPError(
        `${method} /api/${path} → ${response.status} ${await describeError(response)}`,
        response.status,
      )
    }

    if (response.status === 204) {
      return undefined as T
    }

    return (await response.json()) as T
  }

  async update<T = RemoteDoc>(collection: string, id: number | string, data: unknown): Promise<T> {
    const result = await this.request<{ doc: T }>(`${collection}/${id}`, {
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
    })
    return result.doc
  }

  /**
   * Creates a document in an upload-enabled collection.
   *
   * Payload expects `multipart/form-data` with the binary under `file` and all
   * other fields JSON-encoded under `_payload`. The Content-Type header is left
   * unset deliberately so fetch can add the multipart boundary.
   */
  async upload<T = RemoteDoc>(
    collection: string,
    file: UploadFile,
    data: Record<string, unknown> = {},
  ): Promise<T> {
    const form = new FormData()
    form.append('_payload', JSON.stringify(data))
    form.append('file', new Blob([new Uint8Array(file.data)], { type: file.mimetype }), file.name)

    const result = await this.request<{ doc: T }>(collection, { body: form, method: 'POST' })
    return result.doc
  }
}

/** Builds a client from the environment. */
export function createRemoteClient(): RemoteClient {
  return new RemoteClient(remoteConfig())
}
