import fs from 'node:fs/promises'

import type {
  CapturedShot,
  Manifest,
  ManifestEntry,
  PublishRecord,
  ShotSpec,
  StageState,
} from './types'

import { IngestError } from './log'
import { resolveContained } from './paths'

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const REPO = /^[\w.-]+\/[\w.-]+$/

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IngestError(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new IngestError(`${field} must be a non-empty string`)
  }
  return value
}

function timestamp(value: unknown, field: string): string {
  const text = requiredString(value, field)
  if (Number.isNaN(Date.parse(text))) {
    throw new IngestError(`${field} must be an ISO timestamp`)
  }
  return text
}

function optionalTimestamp(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : timestamp(value, field)
}

function optionalFingerprint(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new IngestError(`${field} must be a SHA-256 fingerprint`)
  }
  return value
}

function nullableBoolean(value: unknown, field: string): boolean | null | undefined {
  if (value === undefined || value === null || typeof value === 'boolean') {
    return value
  }
  throw new IngestError(`${field} must be a boolean or null`)
}

function nullableInteger(
  value: unknown,
  field: string,
  { max, min }: { max?: number; min?: number } = {},
): null | number | undefined {
  if (value === undefined || value === null) {
    return value
  }
  if (!Number.isInteger(value)) {
    throw new IngestError(`${field} must be an integer or null`)
  }
  const number = value as number
  if (min !== undefined && number < min) {
    throw new IngestError(`${field} must be at least ${min}`)
  }
  if (max !== undefined && number > max) {
    throw new IngestError(`${field} must be at most ${max}`)
  }
  return number
}

function nullableHttpUrl(value: unknown, field: string): null | string | undefined {
  if (value === undefined || value === null) {
    return value
  }
  if (typeof value !== 'string') {
    throw new IngestError(`${field} must be a URL or null`)
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new IngestError(`${field} must be a valid URL or null`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new IngestError(`${field} must use http or https`)
  }
  return parsed.toString()
}

function shotUrl(value: unknown, field: string): string {
  const text = requiredString(value, field)
  if (text.startsWith('/')) {
    return text
  }
  const parsed = nullableHttpUrl(text, field)
  return parsed as string
}

function shotSpec(value: unknown, field: string): ShotSpec {
  const raw = object(value, field)
  return {
    label: requiredString(raw.label, `${field}.label`),
    url: shotUrl(raw.url, `${field}.url`),
  }
}

function nullableShot(value: unknown, field: string): null | ShotSpec | undefined {
  if (value === undefined || value === null) {
    return value
  }
  return shotSpec(value, field)
}

function nullableShots(value: unknown, field: string): null | ShotSpec[] | undefined {
  if (value === undefined || value === null) {
    return value
  }
  if (!Array.isArray(value)) {
    throw new IngestError(`${field} must be an array or null`)
  }
  return value.map((item, index) => shotSpec(item, `${field}[${index}]`))
}

function stageState(value: unknown, field: string): StageState {
  const raw = object(value, field)
  return {
    analysisInput: optionalFingerprint(raw.analysisInput, `${field}.analysisInput`),
    analyzedAt: optionalTimestamp(raw.analyzedAt, `${field}.analyzedAt`),
    shotsAt: optionalTimestamp(raw.shotsAt, `${field}.shotsAt`),
    shotsInput: optionalFingerprint(raw.shotsInput, `${field}.shotsInput`),
    writeupAt: optionalTimestamp(raw.writeupAt, `${field}.writeupAt`),
    writeupInput: optionalFingerprint(raw.writeupInput, `${field}.writeupInput`),
  }
}

function publishRecord(value: unknown, field: string): PublishRecord {
  const raw = object(value, field)
  if (!Number.isInteger(raw.id) || (raw.id as number) < 1) {
    throw new IngestError(`${field}.id must be a positive integer`)
  }
  return { id: raw.id as number, at: timestamp(raw.at, `${field}.at`) }
}

function publishedTo(value: unknown, field: string): Record<string, PublishRecord> | undefined {
  if (value === undefined) {
    return undefined
  }
  const raw = object(value, field)
  return Object.fromEntries(
    Object.entries(raw).map(([target, record]) => [
      requiredString(target, `${field} key`),
      publishRecord(record, `${field}.${target}`),
    ]),
  )
}

export function assertSlug(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > 60 || !SLUG.test(value)) {
    throw new IngestError(`${field} must be a lowercase, hyphenated slug up to 60 characters`)
  }
  return value
}

export function assertShotFilename(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\')
  ) {
    throw new IngestError(`${field} must be a filename basename`)
  }
  return value
}

export async function validateCapturedShots(
  shots: CapturedShot[],
  directory: string,
): Promise<void> {
  if (shots.length === 0) {
    throw new IngestError('Screenshot set must contain at least one capture')
  }
  let heroes = 0
  for (const [index, shot] of shots.entries()) {
    const file = assertShotFilename(shot.file, `shots[${index}].file`)
    const target = resolveContained(directory, file)
    let data: Buffer
    try {
      data = await fs.readFile(target)
    } catch {
      throw new IngestError(`Screenshot file is missing: ${file}`)
    }
    if (data.length < 24) {
      throw new IngestError(`Screenshot file is empty or invalid: ${file}`)
    }
    if (data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      throw new IngestError(`Screenshot file is not a PNG: ${file}`)
    }
    const width = data.readUInt32BE(16)
    const height = data.readUInt32BE(20)
    if (width !== shot.width || height !== shot.height) {
      throw new IngestError(
        `Screenshot dimensions for ${file} are ${width}x${height}, expected ${shot.width}x${shot.height}`,
      )
    }
    if (shot.hero) {
      heroes += 1
    }
  }
  if (heroes !== 1) {
    throw new IngestError(`Screenshot set must contain exactly one hero; found ${heroes}`)
  }
}

function manifestEntry(value: unknown, index: number): ManifestEntry {
  const field = `entries[${index}]`
  const raw = object(value, field)
  const repo = raw.repo
  if (repo !== undefined && repo !== null && (typeof repo !== 'string' || !REPO.test(repo))) {
    throw new IngestError(`${field}.repo must use owner/name format or null`)
  }
  const cardType = raw.cardType
  if (cardType !== undefined && cardType !== null && cardType !== 'text' && cardType !== 'visual') {
    throw new IngestError(`${field}.cardType must be text, visual, or null`)
  }
  if (raw.skip !== undefined && typeof raw.skip !== 'boolean') {
    throw new IngestError(`${field}.skip must be a boolean`)
  }

  return {
    slug: assertSlug(raw.slug, `${field}.slug`),
    cardType,
    featured: nullableBoolean(raw.featured, `${field}.featured`),
    githubLink: nullableHttpUrl(raw.githubLink, `${field}.githubLink`),
    hero: nullableShot(raw.hero, `${field}.hero`),
    liveUrl: nullableHttpUrl(raw.liveUrl, `${field}.liveUrl`),
    maxShots: nullableInteger(raw.maxShots, `${field}.maxShots`, { max: 20, min: 1 }),
    order: nullableInteger(raw.order, `${field}.order`),
    publishedTo: publishedTo(raw.publishedTo, `${field}.publishedTo`),
    repo,
    screenshots: nullableShots(raw.screenshots, `${field}.screenshots`),
    skip: raw.skip,
    snapshotLink: nullableHttpUrl(raw.snapshotLink, `${field}.snapshotLink`),
    stages: stageState(raw.stages ?? {}, `${field}.stages`),
    title: requiredString(raw.title, `${field}.title`),
  }
}

export function validateManifest(value: unknown): Manifest {
  const raw = object(value, 'manifest.json')
  if (raw.version !== 1) {
    throw new IngestError('manifest.json version must be 1')
  }
  if (!Array.isArray(raw.entries)) {
    throw new IngestError('manifest.json is missing an "entries" array')
  }
  const entries = raw.entries.map(manifestEntry)
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.slug)) {
      throw new IngestError(`manifest.json has duplicate slug "${entry.slug}"`)
    }
    seen.add(entry.slug)
  }
  return { entries, updatedAt: timestamp(raw.updatedAt, 'manifest.json.updatedAt'), version: 1 }
}
