import fs from 'fs/promises'

import type { ManifestEntry } from '../lib/types'

import { flagBoolean, flagNumber, flagValue, type ParsedArgs } from '../lib/args'
import { assertGhReady, listRepos } from '../lib/github'
import { IngestError, log } from '../lib/log'
import { loadManifest, saveManifest, slugify, uniqueSlug } from '../lib/manifest'
import { MANIFEST_PATH, rel, resolveContained, ROOT } from '../lib/paths'

/**
 * Seeds or refreshes the manifest from your GitHub account and/or a list of
 * deployed URLs. Existing entries are never overwritten — only newly-seen repos
 * and URLs are appended, so your manual edits survive re-runs.
 */
export async function discover(args: ParsedArgs): Promise<void> {
  const manifest = await loadManifest()
  const existingSlugs = new Set(manifest.entries.map((entry) => entry.slug))
  const existingRepos = new Map(
    manifest.entries
      .filter((entry) => entry.repo)
      .map((entry) => [entry.repo!.toLowerCase(), entry]),
  )
  const existingUrls = new Map(
    manifest.entries
      .filter((entry) => entry.liveUrl)
      .map((entry) => [normalizeUrl(entry.liveUrl!), entry]),
  )

  const added: ManifestEntry[] = []
  const linked: string[] = []

  // --- URLs ------------------------------------------------------------
  const urls = await collectUrls(args)
  for (const url of urls) {
    const key = normalizeUrl(url)
    if (existingUrls.has(key)) {
      continue
    }
    const title = titleFromUrl(url)
    const slug = uniqueSlug(slugify(title), existingSlugs)
    existingSlugs.add(slug)

    const entry: ManifestEntry = { slug, liveUrl: url, stages: {}, title }
    manifest.entries.push(entry)
    existingUrls.set(key, entry)
    added.push(entry)
  }

  // --- GitHub ----------------------------------------------------------
  if (!(flagBoolean(args, 'no-github') ?? false)) {
    await assertGhReady()

    const owner = flagValue(args, 'owner')
    const limit = flagNumber(args, 'limit', { integer: true, max: 1000, min: 1 }) ?? 300
    const includeForks = flagBoolean(args, 'forks') ?? false
    const includeArchived = flagBoolean(args, 'archived') ?? false
    const unskipAll = flagBoolean(args, 'all') ?? false

    log.detail(`Listing repos for ${owner ?? 'the authenticated account'}...`)
    const repos = await listRepos(owner, limit)
    log.detail(`GitHub returned ${repos.length} repos`)

    for (const repo of repos) {
      if (!includeForks && repo.fork) {
        continue
      }
      if (!includeArchived && repo.archived) {
        continue
      }

      const key = repo.nameWithOwner.toLowerCase()
      const alreadyLinked = existingRepos.get(key)
      if (alreadyLinked) {
        continue
      }

      // A repo whose homepage matches an entry we already have is the same
      // project reached from the other direction — attach it rather than
      // creating a duplicate.
      const byUrl = repo.homepage ? existingUrls.get(normalizeUrl(repo.homepage)) : undefined
      if (byUrl && !byUrl.repo) {
        byUrl.repo = repo.nameWithOwner
        byUrl.githubLink ??=
          repo.visibility === 'PUBLIC' ? `https://github.com/${repo.nameWithOwner}` : undefined
        existingRepos.set(key, byUrl)
        linked.push(`${byUrl.slug} ← ${repo.nameWithOwner}`)
        continue
      }

      const slug = uniqueSlug(slugify(repo.name), existingSlugs)
      existingSlugs.add(slug)

      const entry: ManifestEntry = {
        slug,
        githubLink:
          repo.visibility === 'PUBLIC' ? `https://github.com/${repo.nameWithOwner}` : undefined,
        liveUrl: repo.homepage,
        repo: repo.nameWithOwner,
        // Without a deployed URL there is nothing to screenshot, so those start
        // skipped — flip `skip` to false for the ones you want.
        skip: unskipAll ? undefined : !repo.homepage,
        stages: {},
        title: repo.name,
      }

      manifest.entries.push(entry)
      existingRepos.set(key, entry)
      if (entry.liveUrl) {
        existingUrls.set(normalizeUrl(entry.liveUrl), entry)
      }
      added.push(entry)
    }
  }

  await saveManifest(manifest)

  log.banner(`Manifest: ${rel(MANIFEST_PATH)}`)
  if (added.length === 0 && linked.length === 0) {
    log.info('No new projects found — the manifest is already up to date.')
  }

  for (const entry of added) {
    const state = entry.skip ? 'skipped' : 'active'
    log.ok(`${entry.slug}  (${state})  ${entry.repo ?? ''} ${entry.liveUrl ?? ''}`.trimEnd())
  }
  for (const link of linked) {
    log.ok(`linked repo to existing entry: ${link}`)
  }

  const active = manifest.entries.filter((entry) => !entry.skip)
  log.info('')
  log.info(`${active.length} active / ${manifest.entries.length} total entries.`)
  log.detail('Edit the manifest to set titles and flip `skip`, then run: pnpm ingest analyze')
}

async function collectUrls(args: ParsedArgs): Promise<string[]> {
  const urls = args.positionals.filter((value) => /^https?:\/\//i.test(value))

  const file = flagValue(args, 'urls')
  if (file) {
    let contents: string
    try {
      contents = await fs.readFile(resolveContained(ROOT, file), 'utf8')
    } catch {
      throw new IngestError(`Could not read the URL list at ${file}`)
    }
    for (const line of contents.split('\n')) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#')) {
        urls.push(trimmed)
      }
    }
  }

  return urls.map((url) => {
    try {
      return new URL(url).toString()
    } catch {
      throw new IngestError(`"${url}" is not a valid URL`)
    }
  })
}

/** Host + path, lowercased and de-slashed, so URL variants compare equal. */
function normalizeUrl(input: string): string {
  try {
    const url = new URL(input)
    const host = url.hostname.replace(/^www\./, '').toLowerCase()
    const path = url.pathname.replace(/\/$/, '')
    return `${host}${path}`
  } catch {
    return input.toLowerCase()
  }
}

/** Derives a human title from a domain, e.g. `https://wherenext.ai` -> `wherenext.ai`. */
function titleFromUrl(input: string): string {
  try {
    return new URL(input).hostname.replace(/^www\./, '')
  } catch {
    return input
  }
}
