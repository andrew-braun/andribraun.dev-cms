import { execFile } from 'child_process'
import { promisify } from 'util'

import type { RepoContext } from './types'

import { IngestError, log } from './log'

const run = promisify(execFile)

/** Max characters kept per fetched file, so one huge lockfile can't dominate. */
const MAX_FILE_CHARS = 12_000
/** Max repo tree paths passed to the model. */
const MAX_TREE_PATHS = 400

/**
 * Root-level files worth reading in full: manifests, lockfile-adjacent
 * metadata, and the deployment descriptors that name the host.
 */
const ROOT_FILE_PATTERNS = [
  /^readme(\.md|\.rst|\.txt)?$/i,
  /^package\.json$/,
  /^pnpm-workspace\.ya?ml$/,
  /^tsconfig\.json$/,
  /^dockerfile$/i,
  /^docker-compose\.ya?ml$/,
  /^(netlify|wrangler|fly|railway)\.toml$/,
  /^(vercel|app|now|firebase|angular|nest-cli|deno)\.json$/,
  /^(requirements\.txt|pyproject\.toml|go\.mod|Cargo\.toml|Gemfile|composer\.json|mix\.exs|pubspec\.yaml)$/,
  // Any framework/tooling config at the root: next.config.mjs, vite.config.ts,
  // gatsby-config.js, svelte.config.js, tailwind.config.cjs, and so on.
  /^[a-z0-9@-]+[.-](config|node|browser|ssr)\.(js|cjs|mjs|ts|mts)$/i,
  /^(gatsby|remix|astro|nuxt|next|vite|svelte|tailwind|drizzle|capacitor|expo)[.-][a-z.]*\.(js|cjs|mjs|ts|json)$/i,
]

/**
 * Path prefixes whose files are also worth pulling in. These carry the CI
 * pipeline, the data model, and the app shell — the parts a write-up's
 * "Key Implementation Details" section draws on.
 */
const INTERESTING_PREFIXES = [
  '.github/workflows/',
  'prisma/',
  'drizzle/',
  'docs/',
  'src/app/layout',
  'src/routes/+layout',
  'src/collections/',
  'app/layout',
]

const MAX_PREFIX_FILES = 6

export interface DiscoveredRepo {
  archived: boolean
  description?: string
  fork: boolean
  homepage?: string
  name: string
  nameWithOwner: string
  pushedAt?: string
  visibility: string
}

async function gh(args: string[]): Promise<string> {
  try {
    const { stdout } = await run('gh', args, { maxBuffer: 32 * 1024 * 1024 })
    return stdout
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new IngestError(`gh ${args.slice(0, 2).join(' ')} failed: ${message}`)
  }
}

export async function assertGhReady(): Promise<void> {
  try {
    await run('gh', ['auth', 'status'])
  } catch {
    throw new IngestError(
      'GitHub CLI is not authenticated. Run `gh auth login` before using this stage.',
    )
  }
}

/** Lists repos for a user (defaults to the authenticated account). */
export async function listRepos(owner?: string, limit = 300): Promise<DiscoveredRepo[]> {
  const target = owner ?? (await gh(['api', 'user', '--jq', '.login'])).trim()
  const stdout = await gh([
    'repo',
    'list',
    target,
    '--limit',
    String(limit),
    '--json',
    'name,nameWithOwner,description,homepageUrl,isFork,isArchived,pushedAt,visibility',
  ])

  const raw = JSON.parse(stdout) as Array<{
    description?: string
    homepageUrl?: string
    isArchived: boolean
    isFork: boolean
    name: string
    nameWithOwner: string
    pushedAt?: string
    visibility: string
  }>

  return raw.map((repo) => ({
    name: repo.name,
    archived: repo.isArchived,
    description: repo.description || undefined,
    fork: repo.isFork,
    homepage: repo.homepageUrl || undefined,
    nameWithOwner: repo.nameWithOwner,
    pushedAt: repo.pushedAt,
    visibility: repo.visibility,
  }))
}

/** Normalizes `owner/name`, a full URL, or a `.git` clone URL to `owner/name`. */
export function normalizeRepo(input: string): string {
  const cleaned = input
    .trim()
    .replace(/^git@github\.com:/, '')
    .replace(/^https?:\/\/(?:www\.)?github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '')
  const parts = cleaned.split('/').filter(Boolean)
  if (parts.length < 2) {
    throw new IngestError(`Cannot parse "${input}" as a GitHub repo (expected owner/name)`)
  }
  return `${parts[0]}/${parts[1]}`
}

async function fetchFile(repo: string, path: string): Promise<string | undefined> {
  try {
    const stdout = await gh([
      'api',
      `repos/${repo}/contents/${encodeURI(path)}`,
      '--jq',
      '.content',
    ])
    const decoded = Buffer.from(stdout.replace(/\s/g, ''), 'base64').toString('utf8')
    return decoded.length > MAX_FILE_CHARS
      ? `${decoded.slice(0, MAX_FILE_CHARS)}\n\n[truncated]`
      : decoded
  } catch {
    return undefined
  }
}

/**
 * Gathers everything needed to write about a repo without cloning it: metadata,
 * the file tree, and the contents of the files that reveal the stack.
 */
export async function gatherRepoContext(repoInput: string): Promise<RepoContext> {
  const repo = normalizeRepo(repoInput)

  const meta = JSON.parse(
    await gh([
      'api',
      `repos/${repo}`,
      '--jq',
      '{description,homepage,default_branch,pushed_at,topics}',
    ]),
  ) as {
    default_branch: string
    description?: string
    homepage?: string
    pushed_at?: string
    topics?: string[]
  }

  const languages = JSON.parse(await gh(['api', `repos/${repo}/languages`])) as Record<
    string,
    number
  >

  let tree: string[] = []
  try {
    const stdout = await gh([
      'api',
      `repos/${repo}/git/trees/${meta.default_branch}?recursive=1`,
      '--jq',
      '[.tree[] | select(.type == "blob") | .path]',
    ])
    tree = JSON.parse(stdout) as string[]
  } catch {
    log.warn(`Could not read the file tree for ${repo}; continuing with metadata only`)
  }

  const wanted = tree.filter(
    (entry) => !entry.includes('/') && ROOT_FILE_PATTERNS.some((pattern) => pattern.test(entry)),
  )

  for (const prefix of INTERESTING_PREFIXES) {
    const matches = tree
      .filter((entry) => entry.startsWith(prefix) && /\.(?:md|ya?ml|tsx?|jsx?|prisma)$/.test(entry))
      .slice(0, MAX_PREFIX_FILES)
    wanted.push(...matches)
  }

  const files: Record<string, string> = {}
  const results = await Promise.all(
    wanted.map(async (file) => [file, await fetchFile(repo, file)] as const),
  )
  for (const [file, contents] of results) {
    if (contents) {
      files[file] = contents
    }
  }

  return {
    defaultBranch: meta.default_branch,
    description: meta.description || undefined,
    files,
    homepage: meta.homepage || undefined,
    languages,
    pushedAt: meta.pushed_at,
    repo,
    topics: meta.topics ?? [],
    tree: tree.slice(0, MAX_TREE_PATHS),
  }
}
