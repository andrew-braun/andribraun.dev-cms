import fs from 'fs/promises'
import path from 'path'

import { flagBoolean, flagNumber, flagValue, type ParsedArgs } from '../lib/args'
import { IngestError, log } from '../lib/log'
import { createRemoteClient, type RemoteClient, type RemoteDoc } from '../lib/remote'

/**
 * Direct access to the remote Payload instance, for the reads and one-off
 * writes that sit outside the publish pipeline — checking what's actually live,
 * fixing a field, uploading an image, deleting a bad row.
 *
 * `publish --remote` is the bulk path; this is the scalpel.
 */
export async function remote(args: ParsedArgs): Promise<void> {
  const [subcommand, ...rest] = args.positionals

  if (!subcommand) {
    throw new IngestError('Usage: pnpm ingest remote <ping|list|get|create|update|delete|upload>')
  }

  const client = createRemoteClient()

  switch (subcommand) {
    case 'create':
      return await create(client, args, rest)
    case 'delete':
      return await remove(client, args, rest)
    case 'get':
      return await get(client, args, rest)
    case 'list':
      return await list(client, args, rest)
    case 'ping':
      return await ping(client)
    case 'update':
      return await update(client, args, rest)
    case 'upload':
      return await upload(client, args, rest)
    default:
      throw new IngestError(`Unknown remote subcommand "${subcommand}"`)
  }
}

const MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

/** Fields worth showing as a label in list output, most specific first. */
const LABEL_FIELDS = ['title', 'name', 'alt', 'filename', 'email', 'slug']

function labelOf(doc: RemoteDoc): string {
  for (const field of LABEL_FIELDS) {
    const value = doc[field]
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }
  return '(untitled)'
}

function requireCollection(rest: string[]): string {
  const collection = rest[0]
  if (!collection) {
    throw new IngestError('A collection slug is required, e.g. projects, media, technologies')
  }
  return collection
}

function requireId(rest: string[]): string {
  const id = rest[1]
  if (!id) {
    throw new IngestError('A document ID is required')
  }
  return id
}

/**
 * Reads the `--data` payload, accepting either inline JSON or a path to a
 * JSON file — long project bodies are unpleasant to quote in a shell.
 */
async function readData(args: ParsedArgs): Promise<Record<string, unknown>> {
  const raw = flagValue(args, 'data')
  if (!raw) {
    throw new IngestError('--data=<json|path/to.json> is required')
  }

  const text = raw.trimStart().startsWith('{') ? raw : await fs.readFile(raw, 'utf8')

  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch (error) {
    throw new IngestError(
      `--data is not valid JSON: ${error instanceof Error ? error.message : ''}`,
    )
  }
}

/**
 * Turns `--where=slug=talkspark` or `--where=title:like=Portfolio` into a
 * Payload where clause. One condition is enough for the ad-hoc lookups this
 * command exists for; anything richer belongs in a script.
 */
function parseWhere(args: ParsedArgs): Record<string, unknown> | undefined {
  const raw = flagValue(args, 'where')
  if (!raw) {
    return undefined
  }

  const separator = raw.indexOf('=')
  if (separator === -1) {
    throw new IngestError(
      `--where must look like field=value or field:operator=value, got "${raw}"`,
    )
  }

  const left = raw.slice(0, separator)
  const value = raw.slice(separator + 1)
  const [field, operator = 'equals'] = left.split(':')

  if (!field) {
    throw new IngestError(`--where is missing a field name: "${raw}"`)
  }

  return { [field]: { [operator]: value } }
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

async function ping(client: RemoteClient): Promise<void> {
  const result = await client.me()
  if (!result.user) {
    throw new IngestError(
      `Connected to ${client.baseUrl} but the API key was not accepted. Check PAYLOAD_API_KEY.`,
    )
  }
  log.ok(`${client.baseUrl} — authenticated as ${labelOf(result.user)} (#${result.user.id})`)
}

async function list(client: RemoteClient, args: ParsedArgs, rest: string[]): Promise<void> {
  const collection = requireCollection(rest)
  const result = await client.find(collection, {
    depth: flagNumber(args, 'depth', { integer: true, max: 10, min: 0 }) ?? 0,
    limit: flagNumber(args, 'limit', { integer: true, max: 1000, min: 1 }) ?? 20,
    page: flagNumber(args, 'page', { integer: true, min: 1 }),
    sort: flagValue(args, 'sort'),
    where: parseWhere(args),
  })

  if (flagBoolean(args, 'json') ?? false) {
    print(result.docs)
    return
  }

  log.banner(`${collection} — ${result.totalDocs} total, page ${result.page}/${result.totalPages}`)
  for (const doc of result.docs) {
    log.info(`#${String(doc.id).padEnd(5)} ${labelOf(doc)}`)
  }
  if (result.hasNextPage) {
    log.detail(`more available — pass --page=${result.page + 1}`)
  }
}

async function get(client: RemoteClient, args: ParsedArgs, rest: string[]): Promise<void> {
  const collection = requireCollection(rest)
  const doc = await client.findByID(collection, requireId(rest), {
    depth: flagNumber(args, 'depth', { integer: true, max: 10, min: 0 }) ?? 1,
  })
  print(doc)
}

async function create(client: RemoteClient, args: ParsedArgs, rest: string[]): Promise<void> {
  const collection = requireCollection(rest)
  const doc = await client.create(collection, await readData(args))
  log.ok(`created ${collection} #${doc.id}`)
  print(doc)
}

async function update(client: RemoteClient, args: ParsedArgs, rest: string[]): Promise<void> {
  const collection = requireCollection(rest)
  const id = requireId(rest)
  const doc = await client.update(collection, id, await readData(args))
  log.ok(`updated ${collection} #${doc.id}`)
  print(doc)
}

async function remove(client: RemoteClient, args: ParsedArgs, rest: string[]): Promise<void> {
  const collection = requireCollection(rest)
  const id = requireId(rest)

  // Deleting from production is not undoable, so make it deliberate.
  if (!(flagBoolean(args, 'yes') ?? false)) {
    const existing = await client.findByID(collection, id, { depth: 0 })
    log.warn(`About to delete ${collection} #${id} — "${labelOf(existing)}" on ${client.host}`)
    log.info('Re-run with --yes to confirm.')
    return
  }

  const doc = await client.delete(collection, id)
  log.ok(`deleted ${collection} #${doc.id}`)
}

async function upload(client: RemoteClient, args: ParsedArgs, rest: string[]): Promise<void> {
  const files = rest
  if (files.length === 0) {
    throw new IngestError('At least one file path is required')
  }

  const alt = flagValue(args, 'alt')
  if (!alt) {
    throw new IngestError('--alt="..." is required — the media collection requires alt text')
  }
  if (files.length > 1) {
    log.warn(`Applying the same alt text to all ${files.length} files`)
  }

  const collection = flagValue(args, 'collection') ?? 'media'

  for (const file of files) {
    const data = await fs.readFile(file)
    const name = path.basename(file)
    const extension = path.extname(name).toLowerCase()

    const doc = await client.upload(
      collection,
      { name, data, mimetype: MIME_TYPES[extension] ?? 'application/octet-stream' },
      { alt },
    )
    const url = typeof doc.url === 'string' ? doc.url : ''
    log.ok(`uploaded ${name} → ${collection} #${doc.id} ${url}`.trimEnd())
  }
}
