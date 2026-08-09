# Ingest Pipeline Safety and Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use $superpowers-executing-plans to implement this plan sequentially in the active session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the local portfolio-ingestion pipeline fail safely, preserve manually curated CMS data, invalidate stale generated work deterministically, and bound every external operation.

**Architecture:** Keep the existing command-stage pipeline, but route it through focused validation, artifact-lifecycle, transport, project-data, and project-resolution boundaries. Manifest input fingerprints drive dependency-specific invalidation; atomic sibling-file/directory replacement prevents partially written local state; publication uses distinct create and partial-update payloads and verifies project identity by slug before any upload or CMS write.

**Tech Stack:** TypeScript 5.9, Node.js 20+, Payload CMS 3.86 Local/REST APIs, Vitest 4, Playwright 1.62, native `fetch`, `AbortSignal`, `fs/promises`, and `child_process.execFile`.

## Global Constraints

- Preserve the existing staged changes in `scripts/ingest/lib/projectData.ts` and `tests/unit/projectData.spec.ts`; do not unstage, overwrite, or weaken their regression coverage.
- Leave API-key authorization unchanged; this batch treats the workflow as a trusted local tool.
- Never stage files or create/rewrite commits. Leave the Git index exactly as received.
- Follow red-green-refactor for every behavior change and observe each targeted test fail for the intended reason before implementation.
- Authored inputs (`ingest/manifest.json`, `ingest/urls.txt`, and `ingest/notes/`) remain tracked; only `ingest/work/` is ignored.
- Omitted update fields preserve CMS values; concrete values replace them; explicit `null` clears nullable values.
- New projects default to `display.hide: true`; updating without `--visible` preserves the current visibility.
- Only idempotent reads may retry automatically. Uploads, creates, updates, and deletes receive timeouts but no automatic retry.
- Generated stale artifacts are deleted and regenerated; authored manifest values and notes are never deleted by invalidation.
- A hard failure in any selected entry makes the command exit nonzero, even when other independent entries continue.

---

## File Structure

- Create `scripts/ingest/lib/validation.ts`: runtime manifest, slug, nullable-field, URL, and screenshot-filename validation.
- Create `scripts/ingest/lib/artifacts.ts`: contained paths, atomic writes, fingerprints, invalidation rules, and transactional directory replacement.
- Create `scripts/ingest/lib/transport.ts`: timeout errors, safe URL resolution, DNS/private-address rejection, redirect validation, and bounded retry for GET/HEAD.
- Create `scripts/ingest/lib/projectResolution.ts`: recorded-ID verification and slug-first destination resolution.
- Create `scripts/ingest/lib/batch.ts`: per-entry failure aggregation without nested process termination.
- Modify `scripts/ingest/lib/types.ts`: nullable manifest intentions and per-stage input fingerprints.
- Modify `scripts/ingest/lib/manifest.ts`: validate on load and save atomically.
- Modify `scripts/ingest/lib/paths.ts`: expose only contained ingest paths.
- Modify `scripts/ingest/lib/args.ts` and `scripts/ingest/cli.ts`: strict typed flags and one top-level exit-code owner.
- Modify `scripts/ingest/lib/site.ts`, `scripts/ingest/lib/github.ts`, `scripts/ingest/lib/remote.ts`, `src/app/lib/ai/claude/client.ts`: bounded external operations.
- Modify `scripts/ingest/commands/analyze.ts`, `writeup.ts`, and `shots.ts`: reconcile fingerprints, commit artifacts atomically, and record timestamps last.
- Modify `scripts/ingest/lib/projectData.ts`, `scripts/ingest/lib/backend.ts`, and `scripts/ingest/commands/publish.ts`: separate create/update payloads and verify project identity.
- Create focused unit tests under `tests/unit/`; keep existing tests intact.
- Modify `.gitignore` and `docs/ingest.md`: document tracked inputs, null clearing, invalidation, retry, and failure behavior.

### Task 1: Strict Arguments and Top-Level Exit Ownership

**Files:**

- Modify: `scripts/ingest/lib/args.ts`
- Modify: `scripts/ingest/cli.ts`
- Modify: `scripts/ingest/commands/publish.ts`
- Modify: `scripts/ingest/commands/writeup.ts`
- Create: `tests/unit/ingestArgs.spec.ts`
- Create: `tests/unit/ingestCli.spec.ts`

**Interfaces:**

- Produces: `flagBoolean(args, name): boolean | undefined` and `flagNumber(args, name, constraints?): number | undefined`.
- Produces: exported `run(argv): Promise<number>` from `cli.ts`; only the module entrypoint assigns `process.exitCode`.
- Consumes: existing `ParsedArgs`, `parseArgs`, `flagValue`, and `IngestError`.

- [ ] **Step 1: Write failing typed-flag tests**

```ts
import { describe, expect, it } from 'vitest'
import { flagBoolean, flagNumber, parseArgs } from '../../scripts/ingest/lib/args'

describe('ingest arguments', () => {
  it.each([
    [['--visible'], true],
    [['--visible=true'], true],
    [['--visible=false'], false],
  ] as const)('parses strict booleans from %j', (argv, expected) => {
    expect(flagBoolean(parseArgs([...argv]), 'visible')).toBe(expected)
  })

  it('rejects non-boolean values', () => {
    expect(() => flagBoolean(parseArgs(['--visible=yes']), 'visible')).toThrow(
      '--visible must be true or false',
    )
  })

  it.each([['--max'], ['--max=NaN'], ['--max=0'], ['--max=2.5']])(
    'rejects invalid bounded integers: %j',
    (argv) => {
      expect(() => flagNumber(parseArgs(argv), 'max', { integer: true, min: 1, max: 20 })).toThrow()
    },
  )
})
```

- [ ] **Step 2: Run the argument tests and verify the intended failure**

Run: `pnpm exec vitest run tests/unit/ingestArgs.spec.ts`

Expected: FAIL because `flagBoolean` and constrained `flagNumber` do not exist.

- [ ] **Step 3: Implement strict typed accessors**

```ts
export interface NumberConstraints {
  integer?: boolean
  max?: number
  min?: number
}

export function flagBoolean(args: ParsedArgs, name: string): boolean | undefined {
  const value = args.flags[name]
  if (value === undefined) return undefined
  if (value === true || value === 'true') return true
  if (value === 'false') return false
  throw new IngestError(`--${name} must be true or false`)
}

export function flagNumber(
  args: ParsedArgs,
  name: string,
  constraints: NumberConstraints = {},
): number | undefined {
  const value = args.flags[name]
  if (value === undefined) return undefined
  if (value === true) throw new IngestError(`--${name} requires a value`)
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new IngestError(`--${name} must be a finite number`)
  if (constraints.integer && !Number.isInteger(parsed)) {
    throw new IngestError(`--${name} must be an integer`)
  }
  if (constraints.min !== undefined && parsed < constraints.min) {
    throw new IngestError(`--${name} must be at least ${constraints.min}`)
  }
  if (constraints.max !== undefined && parsed > constraints.max) {
    throw new IngestError(`--${name} must be at most ${constraints.max}`)
  }
  return parsed
}
```

Import `IngestError` in `args.ts`, replace boolean `hasFlag` reads in commands with `flagBoolean(args, name) ?? false`, and give numeric call sites explicit limits: `discover --limit` integer 1–1000, `shots --max` integer 1–20, remote `limit` integer 1–1000, `page` integer ≥1, and `depth` integer 0–10.

- [ ] **Step 4: Run the argument tests and existing unit tests**

Run: `pnpm exec vitest run tests/unit/ingestArgs.spec.ts tests/unit/projectData.spec.ts tests/unit/caseStudy.spec.ts tests/unit/writeupSections.spec.ts`

Expected: PASS.

- [ ] **Step 5: Write failing CLI exit-code tests**

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../scripts/ingest/commands/status', () => ({
  status: vi.fn(async () => {
    throw new Error('fixture failure')
  }),
}))

describe('ingest CLI', () => {
  it('returns one for an unknown command', async () => {
    const { run } = await import('../../scripts/ingest/cli')
    await expect(run(['unknown'])).resolves.toBe(1)
  })

  it('returns one when a command throws', async () => {
    const { run } = await import('../../scripts/ingest/cli')
    await expect(run(['status'])).resolves.toBe(1)
  })
})
```

- [ ] **Step 6: Run the CLI tests and verify the intended failure**

Run: `pnpm exec vitest run tests/unit/ingestCli.spec.ts`

Expected: FAIL because `cli.ts` executes at import time and does not export `run`.

- [ ] **Step 7: Refactor the CLI into a return-code boundary**

```ts
export async function run(argv: string[]): Promise<number> {
  try {
    const [command, ...rest] = argv
    if (!command || command === 'help' || command === '--help') {
      console.log(USAGE)
      return 0
    }
    const handler = COMMANDS[command]
    if (!handler) {
      log.error(`Unknown command "${command}"`)
      console.log(USAGE)
      return 1
    }
    const args = parseArgs(rest)
    if (flagBoolean(args, 'help') ?? false) {
      console.log(USAGE)
      return 0
    }
    assertKnownFlags(command, args)
    await handler(args)
    return 0
  } catch (error) {
    log.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
    return 1
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2))
}
```

Add `import { pathToFileURL } from 'node:url'`. Make command handlers throw `IngestError` for command-wide hard failures and return normally otherwise. Remove `process.exit`, `process.exitCode`, and terminal ownership from `publish.ts` and `writeup.ts`.

- [ ] **Step 8: Run CLI and unit tests**

Run: `pnpm exec vitest run tests/unit/ingestArgs.spec.ts tests/unit/ingestCli.spec.ts`

Expected: PASS with no process termination during test import.

- [ ] **Step 9: Suggest a conventional commit message**

```text
refactor(ingest): centralize strict CLI parsing and exit codes
```

### Task 2: Manifest Validation, Nullable Intent, and Contained Paths

**Files:**

- Create: `scripts/ingest/lib/validation.ts`
- Modify: `scripts/ingest/lib/types.ts`
- Modify: `scripts/ingest/lib/manifest.ts`
- Modify: `scripts/ingest/lib/paths.ts`
- Create: `tests/unit/ingestValidation.spec.ts`
- Create: `tests/unit/ingestPaths.spec.ts`

**Interfaces:**

- Produces: `validateManifest(value: unknown): Manifest`, `assertSlug(value, field): string`, `assertShotFilename(value, field): string`.
- Produces: `resolveContained(root, ...segments): string` used by every ingest path helper.
- Consumes: `IngestError` and existing manifest interfaces.

- [ ] **Step 1: Write failing manifest-validation tests**

```ts
import { describe, expect, it } from 'vitest'
import { validateManifest } from '../../scripts/ingest/lib/validation'

const valid = {
  version: 1,
  updatedAt: '2026-08-09T00:00:00.000Z',
  entries: [{ slug: 'safe-project', title: 'Safe Project', stages: {} }],
}

describe('validateManifest', () => {
  it('accepts omitted, concrete, and null nullable links', () => {
    expect(validateManifest(valid).entries[0].liveUrl).toBeUndefined()
    expect(
      validateManifest({ ...valid, entries: [{ ...valid.entries[0], liveUrl: null }] }).entries[0]
        .liveUrl,
    ).toBeNull()
  })

  it.each(['../escape', '/absolute', 'A B', 'a/b', ''])('rejects unsafe slug %j', (slug) => {
    expect(() => validateManifest({ ...valid, entries: [{ ...valid.entries[0], slug }] })).toThrow(
      'entries[0].slug',
    )
  })

  it('rejects duplicate slugs', () => {
    expect(() =>
      validateManifest({ ...valid, entries: [valid.entries[0], valid.entries[0]] }),
    ).toThrow('duplicate slug')
  })

  it('rejects unsupported URL schemes and null required fields', () => {
    expect(() =>
      validateManifest({
        ...valid,
        entries: [{ ...valid.entries[0], liveUrl: 'file:///etc/passwd' }],
      }),
    ).toThrow('liveUrl')
    expect(() =>
      validateManifest({ ...valid, entries: [{ ...valid.entries[0], title: null }] }),
    ).toThrow('title')
  })
})
```

- [ ] **Step 2: Run validation tests and verify the intended failure**

Run: `pnpm exec vitest run tests/unit/ingestValidation.spec.ts`

Expected: FAIL because `validation.ts` does not exist.

- [ ] **Step 3: Implement complete runtime validation**

Define nullable manifest properties as `string | null`, `number | null`, boolean/display values `boolean | null`, and `ShotSpec[] | null` only where the CMS field can be cleared. Validate object shape, version `1`, ISO timestamps, required `slug/title/stages`, allowed `cardType`, finite bounded `maxShots`, integer `order`, `owner/name` repos, `http:`/`https:` URLs, `ShotSpec` labels/URLs, numeric publish IDs, and duplicate slugs. Preserve the legacy `payloadId` cleanup only after the raw document passes enough structural validation to mutate safely.

```ts
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function assertSlug(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > 60 || !SLUG.test(value)) {
    throw new IngestError(`${field} must be a lowercase, hyphenated slug up to 60 characters`)
  }
  return value
}

function nullableHttpUrl(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null) return value
  if (typeof value !== 'string') throw new IngestError(`${field} must be a URL or null`)
  const parsed = new URL(value)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new IngestError(`${field} must use http or https`)
  }
  return parsed.toString()
}
```

- [ ] **Step 4: Write failing containment tests**

```ts
import { describe, expect, it } from 'vitest'
import { resolveContained } from '../../scripts/ingest/lib/paths'

describe('resolveContained', () => {
  it('returns a child path', () => {
    expect(resolveContained('/tmp/root', 'safe', 'file.json')).toBe('/tmp/root/safe/file.json')
  })

  it.each(['../outside', '/etc/passwd'])('rejects escape segment %j', (segment) => {
    expect(() => resolveContained('/tmp/root', segment)).toThrow('escapes')
  })
})
```

- [ ] **Step 5: Run containment tests and verify the intended failure**

Run: `pnpm exec vitest run tests/unit/ingestPaths.spec.ts`

Expected: FAIL because `resolveContained` is not exported.

- [ ] **Step 6: Implement contained path resolution and use it everywhere**

```ts
export function resolveContained(root: string, ...segments: string[]): string {
  const absoluteRoot = path.resolve(root)
  const candidate = path.resolve(absoluteRoot, ...segments)
  const relative = path.relative(absoluteRoot, candidate)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)))
    return candidate
  throw new IngestError(`Resolved path escapes ${absoluteRoot}: ${segments.join('/')}`)
}
```

Use this helper in `entryDir`, `notesPath`, all artifact path helpers, URL-list file resolution where repository containment is required, and screenshot file lookup before publication.

- [ ] **Step 7: Validate on load before commands can write**

Replace the cast in `loadManifest` with `validateManifest(JSON.parse(raw))`. Preserve the empty-manifest behavior for `ENOENT`, but let parse and validation errors identify `manifest.json`, the entry index/slug, and the failing field.

- [ ] **Step 8: Run focused and existing tests**

Run: `pnpm exec vitest run tests/unit/ingestValidation.spec.ts tests/unit/ingestPaths.spec.ts tests/unit/projectData.spec.ts`

Expected: PASS.

- [ ] **Step 9: Suggest a conventional commit message**

```text
feat(ingest): validate manifests and contain artifact paths
```

### Task 3: Atomic Writes, Fingerprints, and Dependency Invalidation

**Files:**

- Create: `scripts/ingest/lib/artifacts.ts`
- Modify: `scripts/ingest/lib/types.ts`
- Modify: `scripts/ingest/lib/manifest.ts`
- Modify: `scripts/ingest/commands/analyze.ts`
- Modify: `scripts/ingest/commands/writeup.ts`
- Modify: `scripts/ingest/commands/shots.ts`
- Create: `tests/unit/ingestArtifacts.spec.ts`

**Interfaces:**

- Produces: `atomicWriteFile`, `atomicWriteJson`, `fingerprintsFor`, `reconcileEntryArtifacts(slug, notes, roots): Promise<ManifestEntry>`, and `invalidateDerivedArtifacts`.
- Stage metadata adds `analysisInput`, `shotsInput`, and `writeupInput` SHA-256 strings beside timestamps.
- Consumes: contained path helpers and validated `ManifestEntry`.

- [ ] **Step 1: Write failing atomic-write tests using a temporary directory**

```ts
it('does not replace a valid target when the temporary write fails', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-atomic-'))
  const target = path.join(root, 'state.json')
  await fs.writeFile(target, '{"old":true}\n')
  await expect(
    atomicWriteFile(target, 'new', {
      beforeRename: () => {
        throw new Error('stop')
      },
    }),
  ).rejects.toThrow('stop')
  await expect(fs.readFile(target, 'utf8')).resolves.toBe('{"old":true}\n')
})
```

- [ ] **Step 2: Run atomic-write test and verify the intended failure**

Run: `pnpm exec vitest run tests/unit/ingestArtifacts.spec.ts -t 'does not replace'`

Expected: FAIL because `atomicWriteFile` does not exist.

- [ ] **Step 3: Implement sibling-temp atomic files and route all JSON/text writes through them**

```ts
export async function atomicWriteFile(
  target: string,
  data: string | Uint8Array,
  hooks: { beforeRename?: () => void | Promise<void> } = {},
): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temp, data)
    await hooks.beforeRename?.()
    await fs.rename(temp, target)
  } finally {
    await fs.rm(temp, { force: true })
  }
}
```

Make `saveManifest`, `writeJson`, context markdown, write-up, case-study, and sheet output use atomic writes. Keep timestamp mutation after every related artifact has been validated and renamed.

- [ ] **Step 4: Write failing fingerprint and invalidation matrix tests**

```ts
it.each([
  ['liveUrl', ['analysis', 'shots', 'writeup', 'caseStudy']],
  ['githubLink', ['analysis', 'writeup', 'caseStudy']],
  ['screenshots', ['shots', 'writeup', 'caseStudy']],
  ['notes', ['writeup', 'caseStudy']],
  ['snapshotLink', []],
  ['order', []],
] as const)('changing %s invalidates %j', async (field, expected) => {
  const result = await reconcileFixtureChange(field)
  expect(result.invalidated).toEqual(expected)
})

it('a completed new analysis invalidates derived prose', () => {
  expect(invalidateDerivedArtifacts('analysis')).toEqual(['writeup', 'caseStudy'])
})

it('a completed screenshot run invalidates derived prose', () => {
  expect(invalidateDerivedArtifacts('shots')).toEqual(['writeup', 'caseStudy'])
})

it('baselines a legacy timestamp without deleting its valid artifact', async () => {
  const fixture = await legacyArtifactFixture({ analyzedAt: '2026-08-01T00:00:00.000Z' })
  const entry = await reconcileEntryArtifacts(fixture.entry.slug, undefined, fixture.roots)
  await expect(fs.stat(fixture.contextPath)).resolves.toBeDefined()
  expect(entry.stages.analysisInput).toMatch(/^[a-f0-9]{64}$/)
})
```

- [ ] **Step 5: Run invalidation tests and verify the intended failure**

Run: `pnpm exec vitest run tests/unit/ingestArtifacts.spec.ts -t 'invalidates'`

Expected: FAIL because fingerprint and invalidation functions do not exist.

- [ ] **Step 6: Implement canonical fingerprints and explicit dependency rules**

```ts
export function fingerprintsFor(entry: ManifestEntry, notes: string | undefined) {
  return {
    analysis: digest({ liveUrl: entry.liveUrl, repo: entry.repo, githubLink: entry.githubLink }),
    shots: digest({
      liveUrl: entry.liveUrl,
      screenshots: entry.screenshots,
      hero: entry.hero,
      maxShots: entry.maxShots,
      title: entry.title,
    }),
    writeup: digest({
      analysisInput: entry.stages.analysisInput,
      notes: notes ?? null,
      title: entry.title,
    }),
  }
}

const DOWNSTREAM = {
  analysis: ['writeup', 'caseStudy'],
  shots: ['writeup', 'caseStudy'],
  writeup: [],
} as const
```

Canonicalize object keys and distinguish omission from `null`. `reconcileEntryArtifacts` compares stored/current fingerprints, deletes only generated files for stale stages, clears the matching timestamps/fingerprints, and never touches `manifest.json`, `urls.txt`, or notes. Treat `githubLink` and `repo` as repository-analysis inputs; do not invalidate screenshots for either.

For a legacy stage that has a timestamp and valid artifact but no fingerprint, record the current fingerprint as its baseline without deleting the artifact. If the timestamp exists but its required artifact is missing or invalid, clear that stage state as inconsistent. This one-time migration keeps existing valid manifests compatible while making subsequent hand edits deterministic.

Make reconciliation own its manifest read-modify-write cycle: load the latest manifest, find the slug, mutate only that entry, atomically persist the cleared/baselined stage metadata, and return the refreshed entry. Persist this state before expensive generation starts. Stage-completion calls may then use the existing `updateEntry`, whose fresh read will retain the reconciliation changes instead of clobbering them.

- [ ] **Step 7: Integrate reconciliation at mutating-stage entry and completion**

In `analyze`, `writeup`, and `shots`: load/validate, compute fingerprints, call the slug-based reconciliation and use its returned entry, generate to temporary targets, validate, atomically replace, then update the relevant fingerprint and timestamp. After successful analysis or shots, call the downstream invalidator before recording the new stage state.

- [ ] **Step 8: Run artifact and stage tests**

Run: `pnpm exec vitest run tests/unit/ingestArtifacts.spec.ts tests/unit/writeupSections.spec.ts tests/unit/caseStudy.spec.ts`

Expected: PASS, including preservation of authored notes and non-invalidating publication metadata.

- [ ] **Step 9: Suggest a conventional commit message**

```text
feat(ingest): add atomic artifacts and dependency invalidation
```

### Task 4: Transactional Screenshot Replacement and Filename Safety

**Files:**

- Modify: `scripts/ingest/lib/artifacts.ts`
- Modify: `scripts/ingest/lib/validation.ts`
- Modify: `scripts/ingest/commands/shots.ts`
- Modify: `scripts/ingest/commands/publish.ts`
- Create: `tests/unit/ingestShots.spec.ts`

**Interfaces:**

- Produces: `replaceArtifactSet({ targetDir, targetManifest, build, validate }): Promise<void>`.
- Consumes: `assertShotFilename`, `resolveContained`, `atomicWriteJson`, and Playwright capture callbacks.

- [ ] **Step 1: Write failing transactional replacement tests**

```ts
it('preserves the previous screenshot set when capture fails', async () => {
  const fixture = await screenshotFixture([{ file: 'old.png', alt: 'old' }])
  await expect(
    fixture.replace(async (staging) => {
      await fs.writeFile(path.join(staging.dir, 'partial.png'), 'partial')
      throw new Error('capture failed')
    }),
  ).rejects.toThrow('capture failed')
  await expect(fs.readFile(path.join(fixture.shotsDir, 'old.png'), 'utf8')).resolves.toBe('old')
  await expect(readJson(fixture.manifest)).resolves.toEqual([{ file: 'old.png', alt: 'old' }])
})

it('rejects traversing and missing screenshot filenames before replacement', async () => {
  await expect(validateCapturedShots([{ file: '../escape.png' }], '/tmp/shots')).rejects.toThrow(
    'basename',
  )
  await expect(validateCapturedShots([{ file: 'missing.png' }], '/tmp/shots')).rejects.toThrow(
    'missing',
  )
})
```

- [ ] **Step 2: Run screenshot tests and verify the intended failure**

Run: `pnpm exec vitest run tests/unit/ingestShots.spec.ts`

Expected: FAIL because replacement and screenshot-set validation do not exist.

- [ ] **Step 3: Implement validated directory-plus-manifest replacement**

Capture every selected target into a uniquely named sibling staging directory. Require at least one successful capture and require all selected targets to succeed; validate each file as a basename, ensure it resolves inside staging, exists, is nonempty, has PNG dimensions, and has exactly one hero. Write a staged manifest, rename current outputs to uniquely named backups, rename staged outputs into place, and restore backups if either final rename fails. Always remove staging/backup debris in `finally`.

```ts
if (captured.length !== targets.length) {
  throw new IngestError(
    `${entry.slug}: captured ${captured.length}/${targets.length}; previous screenshots preserved`,
  )
}
await replaceArtifactSet({
  targetDir: shotsDir(entry.slug),
  targetManifest: shotsManifestPath(entry.slug),
  build: async (staging) => captureAll(staging.dir),
  validate: validateCapturedShots,
})
```

- [ ] **Step 4: Validate publication filenames before reading or uploading**

For every `CapturedShot`, call `assertShotFilename`, resolve with `resolveContained(shotsDir(slug), file)`, verify the file is nonempty, and finish all local preflight checks before invoking the first `uploadMedia` call.

- [ ] **Step 5: Run screenshot and project-data tests**

Run: `pnpm exec vitest run tests/unit/ingestShots.spec.ts tests/unit/projectData.spec.ts`

Expected: PASS with previous screenshots intact in every failure fixture.

- [ ] **Step 6: Suggest a conventional commit message**

```text
feat(ingest): replace screenshot sets transactionally
```

### Task 5: Safe URL Fetching, Redirects, Timeouts, and Read Retries

**Files:**

- Create: `scripts/ingest/lib/transport.ts`
- Modify: `scripts/ingest/lib/site.ts`
- Modify: `scripts/ingest/commands/shots.ts`
- Create: `tests/unit/ingestTransport.spec.ts`

**Interfaces:**

- Produces: `assertPublicHttpUrl(url, lookup?): Promise<URL>` and `fetchRead(url, init, options): Promise<Response>`.
- `fetchRead` uses manual redirects so each destination is revalidated.
- Consumes: native `dns.promises.lookup`, `net.isIP`, `fetch`, and `IngestError`.

- [ ] **Step 1: Write failing URL-safety tests with injected DNS**

```ts
it.each([
  ['http://127.0.0.1', 'loopback'],
  ['http://169.254.169.254/latest/meta-data', 'link-local'],
  ['http://10.0.0.1', 'private'],
  ['file:///etc/passwd', 'http or https'],
])('rejects %s', async (url, message) => {
  await expect(assertPublicHttpUrl(url, fakeLookup)).rejects.toThrow(message)
})

it('rejects a redirect to a private destination', async () => {
  const fetchImpl = redirectFixture('https://public.example', 'http://127.0.0.1/admin')
  await expect(
    fetchRead('https://public.example', {}, { fetchImpl, lookup: fakeLookup }),
  ).rejects.toThrow('loopback')
})
```

- [ ] **Step 2: Run transport safety tests and verify the intended failure**

Run: `pnpm exec vitest run tests/unit/ingestTransport.spec.ts -t 'rejects'`

Expected: FAIL because `transport.ts` does not exist.

- [ ] **Step 3: Implement public-address validation**

Reject credentials in URLs, non-HTTP(S) protocols, `localhost`, IPv4 loopback/private/link-local/CGNAT/unspecified/multicast ranges, IPv6 loopback/unique-local/link-local/unspecified/multicast ranges, and any DNS answer in those ranges. Resolve with `{ all: true, verbatim: true }`; reject if any answer is unsafe to prevent address-family rebinding surprises. Before writes, reject any existing symlink component between an ingest root and its target so lexical containment cannot be bypassed through a pre-created link.

- [ ] **Step 4: Write failing timeout/status/retry tests**

```ts
it('turns an abort into an actionable timeout', async () => {
  await expect(
    fetchRead(
      'https://public.example',
      {},
      { timeoutMs: 5, fetchImpl: hangingFetch, lookup: fakeLookup },
    ),
  ).rejects.toThrow('timed out after 5ms')
})

it('retries a GET twice on transient 503 responses', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(new Response('{}'))
  await expect(
    fetchRead(
      'https://public.example',
      { method: 'GET' },
      { fetchImpl, lookup: fakeLookup, backoffMs: 0 },
    ),
  ).resolves.toBeInstanceOf(Response)
  expect(fetchImpl).toHaveBeenCalledTimes(3)
})

it('never retries POST', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 503 }))
  await expect(
    fetchRead('https://public.example', { method: 'POST' }, { fetchImpl, lookup: fakeLookup }),
  ).rejects.toThrow('503')
  expect(fetchImpl).toHaveBeenCalledOnce()
})
```

- [ ] **Step 5: Run transport behavior tests and verify the intended failure**

Run: `pnpm exec vitest run tests/unit/ingestTransport.spec.ts -t 'timeout|retries|POST'`

Expected: FAIL because timeout/retry behavior is absent.

- [ ] **Step 6: Implement bounded GET/HEAD retry and redirect handling**

Use a default 20-second timeout, at most two retries with 150ms then 450ms backoff, and at most five redirects. Retry only GET/HEAD transport errors and `408`, `425`, `429`, `500`, `502`, `503`, `504`; surface all other statuses immediately. Preserve the original abort signal by combining it with the timeout signal.

- [ ] **Step 7: Integrate safe transport into site probing and screenshot navigation**

Use `fetchRead` for `probeSite`. Before Playwright navigation, validate each target URL; configure request routing to abort navigation/resource requests whose resolved URL is unsafe, and re-check `page.url()` after navigation. Keep Playwright's existing 45-second navigation timeout and produce an `IngestError` naming the URL and timeout.

- [ ] **Step 8: Run transport and screenshot tests**

Run: `pnpm exec vitest run tests/unit/ingestTransport.spec.ts tests/unit/ingestShots.spec.ts`

Expected: PASS.

- [ ] **Step 9: Suggest a conventional commit message**

```text
feat(ingest): secure and bound fetched URLs
```

### Task 6: Bound Remote CMS, GitHub, and AI Operations

**Files:**

- Modify: `scripts/ingest/lib/remote.ts`
- Modify: `scripts/ingest/lib/github.ts`
- Modify: `src/app/lib/ai/claude/client.ts`
- Create: `tests/unit/ingestRemote.spec.ts`
- Create: `tests/unit/ingestGithub.spec.ts`
- Create: `tests/unit/claudeClient.spec.ts`

**Interfaces:**

- Remote reads consume `fetchRead`; remote writes use a one-attempt timeout wrapper.
- GitHub commands use `execFile` with `timeout: 30_000` and `killSignal: 'SIGTERM'`.
- Claude calls combine caller cancellation with a 90-second timeout and do not retry automatically.

- [ ] **Step 1: Write failing remote-client contract tests**

Test that `find`, `findByID`, and `me` retry transient read failures; `create`, `update`, `delete`, `post`, and `upload` make one request; every method turns an abort into an actionable timeout; non-2xx errors retain Payload field details.

```ts
it.each(['create', 'update', 'delete', 'post', 'upload'])(
  '%s is attempted once',
  async (method) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 }))
    await expect(callRemoteMethod(method, fetchImpl)).rejects.toThrow('503')
    expect(fetchImpl).toHaveBeenCalledOnce()
  },
)
```

- [ ] **Step 2: Run remote tests and verify the intended failure**

Run: `pnpm exec vitest run tests/unit/ingestRemote.spec.ts`

Expected: FAIL because `RemoteClient` has neither injected transport nor method-specific retry policy.

- [ ] **Step 3: Add injected transport and method-specific policy**

Allow `RemoteClient` to receive a transport in tests. Route GET through `fetchRead`; wrap writes in one timed `fetch` call. Keep authentication/header behavior and `describeError` unchanged.

Also make `remoteConfig()` reject credentials and non-HTTP(S) `PAYLOAD_REMOTE_URL` values before reducing the value to its origin.

- [ ] **Step 4: Write failing GitHub timeout tests and implement the timeout**

Extract/export `runGh(args, exec = execFile)` and assert the options include `{ maxBuffer: 32 * 1024 * 1024, timeout: 30_000, killSignal: 'SIGTERM' }`. Convert timeout errors into `IngestError('gh … timed out after 30000ms')`. Retry only the pipeline's read-only `gh api`, `gh repo list`, and `gh auth status` invocations, at most twice with the shared bounded backoff; never generalize this helper to retry a future mutating `gh` command.

Run: `pnpm exec vitest run tests/unit/ingestGithub.spec.ts`

Expected before implementation: FAIL; expected after implementation: PASS.

- [ ] **Step 5: Write failing Claude timeout tests and implement the timeout**

Inject `fetch` into `sendMessage` options for tests, combine a 90-second timeout signal with any caller signal, and throw an error that names Anthropic and `90000ms`. Do not retry model calls because billing and server-side completion state are not idempotently observable.

Run: `pnpm exec vitest run tests/unit/claudeClient.spec.ts`

Expected before implementation: FAIL; expected after implementation: PASS.

- [ ] **Step 6: Run all transport-focused tests**

Run: `pnpm exec vitest run tests/unit/ingestTransport.spec.ts tests/unit/ingestRemote.spec.ts tests/unit/ingestGithub.spec.ts tests/unit/claudeClient.spec.ts`

Expected: PASS.

- [ ] **Step 7: Suggest a conventional commit message**

```text
feat(ingest): bound CMS GitHub and AI operations
```

### Task 7: Separate Create and Declarative Update Payloads

**Files:**

- Modify: `scripts/ingest/lib/projectData.ts`
- Modify: `scripts/ingest/lib/backend.ts`
- Modify: `tests/unit/projectData.spec.ts`
- Create: `tests/unit/ingestBackend.spec.ts`

**Interfaces:**

- Produces: `buildProjectCreateData(input): ProjectCreateData` and `buildProjectUpdateData(input): ProjectUpdateData`.
- `ProjectUpdateData` is a top-level partial with a partial `display` group that retains explicit `null`; backends pass it through unchanged.
- Consumes: existing write-up splitting and case-study mapping.

- [ ] **Step 1: Extend the existing staged tests without replacing them**

Add tests asserting that create applies `card_type: 'visual'`, `featured: false`, and `hide: true`; update omission preserves links/media/order/card type/featured/hide; concrete false/zero values remain present; explicit null remains an own property and clears nullable links/media/display values.

```ts
it('omits create defaults from an update unless explicitly requested', () => {
  const patch = buildProjectUpdateData({
    entry,
    markdown: 'body',
    media: undefined,
    visibility: undefined,
    caseStudy: null,
  })
  expect(patch.display).toBeUndefined()
  expect('live_link' in patch).toBe(false)
  expect('images' in patch).toBe(false)
})

it('retains explicit null clearing intentions', () => {
  const patch = buildProjectUpdateData({
    entry: { ...entry, liveUrl: null, githubLink: null, snapshotLink: null, screenshots: null },
    markdown: 'body',
    media: null,
    visibility: false,
    caseStudy: null,
  })
  expect(patch).toMatchObject({
    live_link: null,
    github_link: null,
    snapshot_link: null,
    images: null,
    thumbnail: null,
    hero_image: null,
    display: { hide: true },
  })
})
```

- [ ] **Step 2: Run project-data tests and verify the intended failure**

Run: `pnpm exec vitest run tests/unit/projectData.spec.ts`

Expected: FAIL because create/update builders and null-preserving media intent are absent.

- [ ] **Step 3: Split shared mapping from create/update ownership**

Create an internal `buildSharedProjectData` for slug/title/markdown/sections and case-study fields. `buildProjectCreateData` applies safe defaults and nullable empties. `buildProjectUpdateData` includes display subkeys only for explicit manifest/CLI intentions, omits absent media, and writes three media `null`s when `screenshots: null` explicitly requests clearing. Do not encode update semantics with `undefined` properties; omit keys entirely.

Retain `buildProjectData` as a create-semantics compatibility wrapper so the already-staged regression tests remain valid while `publish.ts` migrates to the two explicit builders. Do not rewrite or remove the staged omission assertions; extend them around the new update builder.

```ts
export type ProjectUpdateData = Partial<Omit<ProjectData, 'display'>> & {
  display?: Partial<NonNullable<ProjectData['display']>>
}

function assignNullable<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) target[key] = value
}
```

- [ ] **Step 4: Write backend pass-through tests**

Mock both Payload Local API and `RemoteClient`, send `{ live_link: null }`, and assert each adapter receives an own `live_link` property with value `null`; send an omitted property and assert neither adapter manufactures it.

- [ ] **Step 5: Run backend tests and verify the intended failure, then widen update types**

Run: `pnpm exec vitest run tests/unit/ingestBackend.spec.ts`

Expected before implementation: FAIL because `updateProject` accepts the create-required type. Change only update signatures to `ProjectUpdateData`; leave create signatures required.

- [ ] **Step 6: Run project-data and backend tests**

Run: `pnpm exec vitest run tests/unit/projectData.spec.ts tests/unit/ingestBackend.spec.ts`

Expected: PASS, including all pre-existing staged regressions.

- [ ] **Step 7: Suggest a conventional commit message**

```text
fix(ingest): preserve CMS fields on project updates
```

### Task 8: Verify Project Identity Before Publication

**Files:**

- Create: `scripts/ingest/lib/projectResolution.ts`
- Modify: `scripts/ingest/lib/backend.ts`
- Modify: `scripts/ingest/commands/publish.ts`
- Create: `tests/unit/ingestProjectResolution.spec.ts`

**Interfaces:**

- Backends produce `findProjectById(id): Promise<{ id: number; slug: string } | null>` and `findProjectBySlug(slug): Promise<{ id: number; slug: string } | null>`.
- Backends produce `close(): Promise<void>` so the command can release local Payload/Postgres resources without terminating the process; the remote implementation is a no-op.
- Produces: `resolveProject(backend, slug, hintedId): Promise<{ action: 'create' } | { action: 'update'; id: number }>`.
- Publication consumes a resolved action before reading/uploads/writes.

- [ ] **Step 1: Write failing identity-resolution matrix tests**

```ts
it.each([
  ['matching hint', 7, { id: 7, slug: 'alpha' }, null, { action: 'update', id: 7 }],
  ['stale hint adopts slug match', 7, null, { id: 9, slug: 'alpha' }, { action: 'update', id: 9 }],
  [
    'missing hint adopts slug match',
    undefined,
    null,
    { id: 9, slug: 'alpha' },
    { action: 'update', id: 9 },
  ],
  ['no match creates', undefined, null, null, { action: 'create' }],
] as const)('%s', async (_name, hintedId, byId, bySlug, expected) => {
  await expect(resolveProject(fakeBackend({ byId, bySlug }), 'alpha', hintedId)).resolves.toEqual(
    expected,
  )
})

it('fails when the recorded ID belongs to another slug', async () => {
  await expect(
    resolveProject(fakeBackend({ byId: { id: 7, slug: 'beta' }, bySlug: null }), 'alpha', 7),
  ).rejects.toThrow('belongs to slug "beta"')
})
```

- [ ] **Step 2: Run project-resolution tests and verify the intended failure**

Run: `pnpm exec vitest run tests/unit/ingestProjectResolution.spec.ts`

Expected: FAIL because the resolver and by-ID contract do not exist.

- [ ] **Step 3: Implement strict resolver semantics**

```ts
export async function resolveProject(
  backend: Pick<PublishBackend, 'findProjectById' | 'findProjectBySlug'>,
  slug: string,
  hintedId?: number,
): Promise<ProjectResolution> {
  if (hintedId !== undefined) {
    const hinted = await backend.findProjectById(hintedId)
    if (hinted && hinted.slug !== slug) {
      throw new IngestError(
        `Recorded project #${hintedId} belongs to slug "${hinted.slug}", not "${slug}"`,
      )
    }
    if (hinted) return { action: 'update', id: hinted.id }
  }
  const bySlug = await backend.findProjectBySlug(slug)
  return bySlug ? { action: 'update', id: bySlug.id } : { action: 'create' }
}
```

- [ ] **Step 4: Implement local and remote by-ID/by-slug adapters**

Query at `depth: 0` and return only numeric `id` plus string `slug`. Treat remote 404 for a hinted ID as `null`; preserve authorization, timeout, and other status failures.

Add `close()` to both backend adapters. The local implementation is `async close() { await payload.destroy() }`; the remote implementation is `async close() {}`. Call it from `publish` in `finally`, including after batch failures, and never call `process.exit()` to force the pool closed.

- [ ] **Step 5: Integrate preflight resolution before uploads**

Resolve every ready entry before its first media upload. Use the same resolver in dry-run mode. A mismatch or unresolved hard error must prevent all writes for that entry and must not alter `publishedTo`.

- [ ] **Step 6: Run resolution, backend, and project-data tests**

Run: `pnpm exec vitest run tests/unit/ingestProjectResolution.spec.ts tests/unit/ingestBackend.spec.ts tests/unit/projectData.spec.ts`

Expected: PASS.

- [ ] **Step 7: Suggest a conventional commit message**

```text
feat(ingest): verify project slugs before publication
```

### Task 9: Batch Failure Aggregation and Publication Ordering

**Files:**

- Create: `scripts/ingest/lib/batch.ts`
- Modify: `scripts/ingest/commands/analyze.ts`
- Modify: `scripts/ingest/commands/writeup.ts`
- Modify: `scripts/ingest/commands/shots.ts`
- Modify: `scripts/ingest/commands/publish.ts`
- Create: `tests/unit/ingestBatch.spec.ts`
- Create: `tests/unit/ingestPublish.spec.ts`

**Interfaces:**

- Produces: `runBatch(entries, worker): Promise<{ failures: EntryFailure[] }>`; throws one summarized `IngestError` after all independent entries finish.
- Publication records `publishedTo` only after confirmed create/update, before optional technology extraction.
- Consumes: project resolver and create/update builders.

- [ ] **Step 1: Write failing batch aggregation tests**

```ts
it('continues independent entries and reports an overall failure', async () => {
  const visited: string[] = []
  await expect(
    runBatch([{ slug: 'a' }, { slug: 'b' }], async (entry) => {
      visited.push(entry.slug)
      if (entry.slug === 'a') throw new Error('broken')
    }),
  ).rejects.toThrow('1 of 2 entries failed')
  expect(visited).toEqual(['a', 'b'])
})
```

- [ ] **Step 2: Run batch tests and verify the intended failure**

Run: `pnpm exec vitest run tests/unit/ingestBatch.spec.ts`

Expected: FAIL because `runBatch` does not exist.

- [ ] **Step 3: Implement sequential aggregation with actionable causes**

```ts
export async function runBatch<T extends { slug: string }>(
  entries: T[],
  worker: (entry: T) => Promise<void>,
): Promise<void> {
  const failures: Array<{ slug: string; message: string }> = []
  for (const entry of entries) {
    try {
      await worker(entry)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ slug: entry.slug, message })
      log.error(`${entry.slug}: ${message}`)
    }
  }
  if (failures.length > 0) {
    throw new IngestError(
      `${failures.length} of ${entries.length} entries failed: ${failures.map(({ slug }) => slug).join(', ')}`,
    )
  }
}
```

- [ ] **Step 4: Write failing publication-order tests**

Mock an entry publish and assert call order: validate artifacts → resolve project → upload media → create/update → persist `publishedTo` → extract technologies. Assert failed preflight/upload/project write leaves `publishedTo` untouched. Assert extraction failure logs a warning and returns success after the project write and manifest record succeed.

- [ ] **Step 5: Run publication tests and verify the intended failure**

Run: `pnpm exec vitest run tests/unit/ingestPublish.spec.ts`

Expected: FAIL because publication concerns are inline and cannot be injected or ordered under test.

- [ ] **Step 6: Extract and implement `publishEntry`**

Inject backend, clock, artifact readers, and manifest recorder into a focused `publishEntry` helper. Build create data only for `{ action: 'create' }`, build update data only for `{ action: 'update' }`, and interpret `--visible` via `flagBoolean`: omitted means hidden on create and unchanged on update; explicit/bare true means visible; explicit false means hidden.

- [ ] **Step 7: Apply `runBatch` to mutating commands**

Replace local catch-and-log loops in analyze/writeup/shots/publish with `runBatch`. Keep expected non-errors such as skipped entries out of the worker list. Missing required artifacts, every-capture failure, failed required generation, identity mismatch, and failed CMS write must enter the failure summary.

- [ ] **Step 8: Run batch/publication/CLI tests**

Run: `pnpm exec vitest run tests/unit/ingestBatch.spec.ts tests/unit/ingestPublish.spec.ts tests/unit/ingestCli.spec.ts`

Expected: PASS, with extraction failures remaining warnings after successful writes.

- [ ] **Step 9: Suggest a conventional commit message**

```text
refactor(ingest): aggregate stage and publication failures
```

### Task 10: Version-Control Hygiene and Operator Documentation

**Files:**

- Modify: `.gitignore`
- Modify: `docs/ingest.md`
- Modify: `scripts/ingest/cli.ts`
- Create: `tests/unit/ingestDocs.spec.ts`

**Interfaces:**

- Documentation must match runtime null, invalidation, tracked-input, timeout, retry, and failure semantics.
- CLI usage text must show strict boolean forms and explain update visibility preservation.

- [ ] **Step 1: Write failing ignore/documentation contract tests**

```ts
it('ignores generated work but not authored ingest inputs', async () => {
  const ignore = await fs.readFile('.gitignore', 'utf8')
  expect(ignore).toContain('/ingest/work/')
  expect(ignore).not.toMatch(/^\/ingest$/m)
})

it('documents explicit clearing and safe visibility updates', async () => {
  const docs = await fs.readFile('docs/ingest.md', 'utf8')
  expect(docs).toContain('"liveUrl": null')
  expect(docs).toContain('--visible=false')
  expect(docs).toContain('omitted fields preserve')
})
```

- [ ] **Step 2: Run documentation tests and verify the intended failure**

Run: `pnpm exec vitest run tests/unit/ingestDocs.spec.ts`

Expected: FAIL because `.gitignore` currently ignores all of `/ingest` and docs omit declarative clearing.

- [ ] **Step 3: Correct `.gitignore`**

Replace the broad `/ingest` rule with:

```gitignore
# Generated ingest artifacts; authored manifest, URL lists, and notes are tracked.
/ingest/work/
```

- [ ] **Step 4: Update operator documentation and CLI usage**

Document valid manifest types, explicit null examples, screenshot clearing behavior, fingerprint-driven invalidation matrix, transactional screenshot preservation, strict boolean/numeric forms, create-vs-update visibility behavior, pre-upload slug verification, per-entry continuation with overall nonzero status, default timeouts, and GET/HEAD-only retries. Remove statements implying stale timestamps alone prove readiness or that repeated captures delete the previous valid set before success.

- [ ] **Step 5: Run documentation tests**

Run: `pnpm exec vitest run tests/unit/ingestDocs.spec.ts`

Expected: PASS.

- [ ] **Step 6: Suggest a conventional commit message**

```text
docs(ingest): document safe regeneration and publication
```

### Task 11: Full Regression and Safety Verification

**Files:**

- Verify only; modify the smallest owning source/test file if a regression exposes a Batch 1 defect.

**Interfaces:**

- Consumes every interface introduced above.
- Produces a clean verification record while preserving the pre-existing Git index.

- [ ] **Step 1: Run the complete Vitest suite**

Run: `pnpm exec vitest run --config ./vitest.config.mts`

Expected: all unit tests pass. If integration tests require unavailable PostgreSQL, record that environmental limitation separately; do not describe an unrun integration suite as passing.

- [ ] **Step 2: Run TypeScript without consuming stale Next output**

Run: `pnpm exec tsc --noEmit --pretty false`

Expected: exit 0 for files in Batch 1. If pre-existing generated `.next/types` errors remain, identify them explicitly and verify no error points into a changed Batch 1 file.

- [ ] **Step 3: Run targeted lint on changed TypeScript files**

Run: `pnpm exec eslint scripts/ingest src/app/lib/ai/claude/client.ts tests/unit --max-warnings=0`

Expected: exit 0 for the Batch 1 scope. Do not use the known-broken `next lint` wrapper.

- [ ] **Step 4: Run CLI smoke checks in subprocesses**

Run: `pnpm ingest unknown-command`

Expected: nonzero exit and an unknown-command message.

Run: `pnpm ingest publish --visible=yes --dry-run`

Expected: nonzero exit and `--visible must be true or false`, with no CMS connection or write.

Run: `pnpm ingest shots --max=0`

Expected: nonzero exit and a bounded-integer message before Playwright starts.

- [ ] **Step 5: Verify tracked/untracked ownership and unchanged staging**

Run: `git status --short && git diff --cached -- scripts/ingest/lib/projectData.ts tests/unit/projectData.spec.ts`

Expected: the original two files remain staged; agent-created/modified Batch 1 files remain unstaged; no generated `ingest/work/` file appears; the approved spec and implementation plan remain untracked unless the user staged them independently.

- [ ] **Step 6: Request focused code review and apply only verified findings**

Use `$superpowers-requesting-code-review` to review security boundaries, invalidation coverage, update omission/null behavior, failure aggregation, and timeout/retry policy. For each accepted finding, reproduce it with a failing test before changing production code, then rerun the owning task’s focused suite.

- [ ] **Step 7: Run final verification before completion**

Use `$superpowers-verification-before-completion`, rerun every command from Steps 1–5 that is available in the environment, and report fresh outputs rather than earlier results.

- [ ] **Step 8: Finish the uncommitted branch handoff**

Use `$superpowers-finishing-a-development-branch`; do not commit, stage, merge, reset, or discard files. Summarize changed paths, verification evidence, known environmental limitations, and the remaining Batch 2/3 work.

- [ ] **Step 9: Suggest a conventional commit message**

```text
feat(ingest): harden pipeline safety and reliability
```
