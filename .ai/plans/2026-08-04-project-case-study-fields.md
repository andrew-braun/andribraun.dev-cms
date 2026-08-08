# Project Case-Study Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use $superpowers-executing-plans to implement this plan sequentially in the active session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured case-study fields to the Payload `projects` collection and extend ingest so AI fills a `case-study.json` sidecar, `ENTER-ME.md` flags gaps, and `publish` maps slug + sidecar into CMS.

**Architecture:** Schema fields live on `Projects`. Ingest stays file-first: `writeup` still writes `writeup.md`, then a second Claude structured-output call writes `ingest/work/<slug>/case-study.json`. Pure helpers (`normalizeCaseStudy`, `buildProjectData`) keep mapping/review logic testable without Claude or the database. Testimonials are out of scope.

**Tech Stack:** Payload CMS 3.86, Postgres (`@payloadcms/db-postgres`), Next.js 16, Vitest, Claude API via `src/app/lib/ai/claude` (`outputSchema` + `parseJsonFromResponse`).

## Global Constraints

- No Testimonials collection or Project → Testimonials relationship.
- Keep existing technical `description_markdown` write-up structure unchanged.
- `businessChallenge` is markdown `code` (same pattern as `description_markdown`).
- `slug` is required + unique; never AI-generated — always from manifest `entry.slug`.
- `status` enum only: `live` | `ongoing` | `completed` | `archived`.
- Case-study AI failure must not fail the writeup stage if `writeup.md` succeeded.
- Agents never create git commits; end each task with a suggested conventional commit message for the user.
- Do not invent frontend rendering work.

## File Structure

| File                                                    | Responsibility                                      |
| ------------------------------------------------------- | --------------------------------------------------- |
| `src/collections/Projects.ts`                           | Case-study field definitions                        |
| `src/migrations/<timestamp>.ts` (+ `.json`, `index.ts`) | DB columns, slug backfill, unique index             |
| `src/payload-types.ts`                                  | Regenerated types (do not hand-edit)                |
| `ai/project.case-study-instructions.md`                 | Claude system prompt for sidecar                    |
| `scripts/ingest/lib/caseStudy.ts`                       | Sidecar types, schema, normalize/stub helpers       |
| `scripts/ingest/lib/projectData.ts`                     | `buildProjectData` mapping (extracted from publish) |
| `scripts/ingest/lib/ai.ts`                              | `generateCaseStudy()`                               |
| `scripts/ingest/lib/paths.ts`                           | `caseStudyPath`, `CASE_STUDY_INSTRUCTIONS_PATH`     |
| `scripts/ingest/lib/sheet.ts`                           | ENTER-ME case-study + needsReview section           |
| `scripts/ingest/commands/writeup.ts`                    | Write sidecar after writeup                         |
| `scripts/ingest/commands/publish.ts`                    | Load sidecar; call `buildProjectData`               |
| `docs/ingest.md`                                        | Document sidecar + review flow                      |
| `vitest.config.mts`                                     | Include unit tests under `tests/unit/**`            |
| `tests/unit/caseStudy.spec.ts`                          | Normalize/stub tests                                |
| `tests/unit/projectData.spec.ts`                        | Publish mapping tests                               |
| `tests/unit/sheetCaseStudy.spec.ts`                     | Sheet section rendering tests                       |

---

### Task 1: Project schema + migration + types

**Files:**

- Modify: `src/collections/Projects.ts`
- Create: `src/migrations/<timestamp>.ts`, `src/migrations/<timestamp>.json` (via Payload CLI)
- Modify: `src/migrations/index.ts` (CLI usually updates this)
- Regenerate: `src/payload-types.ts`

**Interfaces:**

- Consumes: existing `CollectionConfig` patterns in `Projects.ts`
- Produces: Project fields `slug`, `clientName`, `businessChallenge`, `contributionHighlights`, `outcomes`, `status` available to later tasks via generated types

- [ ] **Step 1: Update `Projects.ts` fields**

Replace the opening of the `fields` array so title/slug and case-study fields come first. Keep existing description, metadata, links, media, and display fields after.

```ts
fields: [
  {
    type: 'row',
    fields: [
      {
        name: 'title',
        type: 'text',
        admin: { width: '60%' },
      },
      {
        name: 'slug',
        type: 'text',
        required: true,
        unique: true,
        admin: { width: '40%' },
      },
    ],
  },
  {
    type: 'collapsible',
    label: 'case study',
    fields: [
      {
        name: 'clientName',
        type: 'text',
      },
      {
        name: 'status',
        type: 'select',
        options: [
          { label: 'Live', value: 'live' },
          { label: 'Ongoing', value: 'ongoing' },
          { label: 'Completed', value: 'completed' },
          { label: 'Archived', value: 'archived' },
        ],
      },
      {
        name: 'businessChallenge',
        type: 'code',
        admin: { language: 'markdown' },
      },
      {
        name: 'contributionHighlights',
        type: 'array',
        labels: { singular: 'Highlight', plural: 'Contribution highlights' },
        fields: [
          {
            name: 'statement',
            type: 'text',
            required: true,
          },
        ],
      },
      {
        name: 'outcomes',
        type: 'array',
        labels: { singular: 'Outcome', plural: 'Outcomes' },
        fields: [
          {
            name: 'statement',
            type: 'text',
            required: true,
          },
          {
            name: 'metric',
            type: 'text',
          },
        ],
      },
    ],
  },
  // ... existing description, description_markdown, metadata, links, media, display
],
```

Also set admin `useAsTitle: 'title'` if not already present (keep current admin components).

- [ ] **Step 2: Create the migration**

Run from repo root (needs DB credentials from `.env`):

```bash
pnpm payload migrate:create
```

Expected: new `src/migrations/<timestamp>.ts` + `.json`, and `src/migrations/index.ts` updated.

- [ ] **Step 3: Ensure slug backfill before NOT NULL / unique**

If the generated migration adds `"slug" varchar NOT NULL` in one step on a non-empty `projects` table, edit the `up` function so it:

1. Adds `slug` as nullable (or without NOT NULL).
2. Backfills unique slugs from title (SQL sketch — adjust table/column names to match generated schema):

```sql
UPDATE projects
SET slug = lower(regexp_replace(coalesce(title, 'project-' || id::text), '[^a-zA-Z0-9]+', '-', 'g'))
WHERE slug IS NULL OR slug = '';
-- then resolve collisions with id suffix if needed
UPDATE projects p
SET slug = p.slug || '-' || p.id::text
WHERE EXISTS (
  SELECT 1 FROM projects o
  WHERE o.slug = p.slug AND o.id < p.id
);
```

3. Then `ALTER COLUMN slug SET NOT NULL` and create the unique index / constraint Payload expects.
4. Keep array tables for `contribution_highlights` / `outcomes` as generated.

Mirror the reverse in `down`.

- [ ] **Step 4: Apply migration and regenerate types**

```bash
pnpm payload migrate
pnpm generate:types
```

Expected: migration succeeds; `src/payload-types.ts` `Project` includes `slug: string` and the optional case-study fields.

- [ ] **Step 5: Suggest a conventional commit message**

```text
feat(projects): add case-study fields and slug
```

---

### Task 2: Case-study normalize helpers + unit tests

**Files:**

- Create: `scripts/ingest/lib/caseStudy.ts`
- Create: `tests/unit/caseStudy.spec.ts`
- Modify: `vitest.config.mts`

**Interfaces:**

- Consumes: none from Task 1 at runtime (field names aligned with schema)
- Produces:
  - `export type ProjectStatus = 'live' | 'ongoing' | 'completed' | 'archived'`
  - `export type CaseStudyFieldKey = 'clientName' | 'businessChallenge' | 'contributionHighlights' | 'outcomes' | 'status'`
  - `export interface CaseStudySidecar { clientName?: string; businessChallenge?: string; contributionHighlights?: { statement: string }[]; outcomes?: { statement: string; metric?: string }[]; status?: ProjectStatus; needsReview: CaseStudyFieldKey[] }`
  - `export const CASE_STUDY_FIELD_KEYS: CaseStudyFieldKey[]`
  - `export const caseStudyOutputSchema: JsonSchema`
  - `export function emptyCaseStudyStub(): CaseStudySidecar`
  - `export function normalizeCaseStudy(raw: unknown): CaseStudySidecar`

- [ ] **Step 1: Extend Vitest to run unit tests**

In `vitest.config.mts`, change `include` to:

```ts
include: ['tests/int/**/*.int.spec.ts', 'tests/unit/**/*.spec.ts'],
```

- [ ] **Step 2: Write the failing unit tests**

Create `tests/unit/caseStudy.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  emptyCaseStudyStub,
  normalizeCaseStudy,
  CASE_STUDY_FIELD_KEYS,
} from '../../scripts/ingest/lib/caseStudy'

describe('emptyCaseStudyStub', () => {
  it('flags every case-study field for review', () => {
    const stub = emptyCaseStudyStub()
    expect(stub.needsReview).toEqual([...CASE_STUDY_FIELD_KEYS])
    expect(stub.clientName).toBeUndefined()
    expect(stub.contributionHighlights).toBeUndefined()
  })
})

describe('normalizeCaseStudy', () => {
  it('keeps valid fields and drops invalid status', () => {
    const result = normalizeCaseStudy({
      clientName: ' WhereNext.ai ',
      businessChallenge: 'Fragmented planning.',
      contributionHighlights: [{ statement: 'Built end-to-end' }, { statement: '  ' }],
      outcomes: [
        { statement: 'End-to-end experience', metric: 'From idea to live product' },
        { statement: '', metric: 'ignored' },
      ],
      status: 'shipping',
      needsReview: ['status'],
    })

    expect(result.clientName).toBe('WhereNext.ai')
    expect(result.businessChallenge).toBe('Fragmented planning.')
    expect(result.contributionHighlights).toEqual([{ statement: 'Built end-to-end' }])
    expect(result.outcomes).toEqual([
      { statement: 'End-to-end experience', metric: 'From idea to live product' },
    ])
    expect(result.status).toBeUndefined()
    expect(result.needsReview).toContain('status')
  })

  it('accepts valid status and merges missing fields into needsReview', () => {
    const result = normalizeCaseStudy({
      status: 'live',
      needsReview: [],
    })
    expect(result.status).toBe('live')
    expect(result.needsReview).toEqual(
      expect.arrayContaining([
        'clientName',
        'businessChallenge',
        'contributionHighlights',
        'outcomes',
      ]),
    )
    expect(result.needsReview).not.toContain('status')
  })

  it('returns a full stub for non-objects', () => {
    expect(normalizeCaseStudy(null).needsReview).toEqual([...CASE_STUDY_FIELD_KEYS])
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm exec vitest run --config ./vitest.config.mts tests/unit/caseStudy.spec.ts
```

Expected: FAIL — cannot resolve `scripts/ingest/lib/caseStudy`.

- [ ] **Step 4: Implement `scripts/ingest/lib/caseStudy.ts`**

```ts
import type { JsonSchema } from '@/app/lib/ai/claude'

export type ProjectStatus = 'live' | 'ongoing' | 'completed' | 'archived'

export type CaseStudyFieldKey =
  'clientName' | 'businessChallenge' | 'contributionHighlights' | 'outcomes' | 'status'

export const CASE_STUDY_FIELD_KEYS: CaseStudyFieldKey[] = [
  'clientName',
  'businessChallenge',
  'contributionHighlights',
  'outcomes',
  'status',
]

export const PROJECT_STATUSES: ProjectStatus[] = ['live', 'ongoing', 'completed', 'archived']

export interface CaseStudySidecar {
  businessChallenge?: string
  clientName?: string
  contributionHighlights?: { statement: string }[]
  needsReview: CaseStudyFieldKey[]
  outcomes?: { metric?: string; statement: string }[]
  status?: ProjectStatus
}

export const caseStudyOutputSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    clientName: { type: 'string' },
    businessChallenge: { type: 'string' },
    contributionHighlights: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { statement: { type: 'string' } },
        required: ['statement'],
      },
    },
    outcomes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          statement: { type: 'string' },
          metric: { type: 'string' },
        },
        required: ['statement'],
      },
    },
    status: { type: 'string', enum: [...PROJECT_STATUSES] },
    needsReview: {
      type: 'array',
      items: { type: 'string', enum: [...CASE_STUDY_FIELD_KEYS] },
    },
  },
  required: ['needsReview'],
}

export function emptyCaseStudyStub(): CaseStudySidecar {
  return { needsReview: [...CASE_STUDY_FIELD_KEYS] }
}

function isStatus(value: unknown): value is ProjectStatus {
  return typeof value === 'string' && (PROJECT_STATUSES as string[]).includes(value)
}

function isFieldKey(value: unknown): value is CaseStudyFieldKey {
  return typeof value === 'string' && (CASE_STUDY_FIELD_KEYS as string[]).includes(value)
}

/**
 * Coerces model / file JSON into a publishable sidecar. Invalid status is
 * dropped and flagged. Empty statements are removed. Any case-study field that
 * is still empty after coercion is added to needsReview (union with model list).
 */
export function normalizeCaseStudy(raw: unknown): CaseStudySidecar {
  if (!raw || typeof raw !== 'object') {
    return emptyCaseStudyStub()
  }

  const input = raw as Record<string, unknown>
  const result: CaseStudySidecar = { needsReview: [] }

  if (typeof input.clientName === 'string' && input.clientName.trim()) {
    result.clientName = input.clientName.trim()
  }

  if (typeof input.businessChallenge === 'string' && input.businessChallenge.trim()) {
    result.businessChallenge = input.businessChallenge.trim()
  }

  if (Array.isArray(input.contributionHighlights)) {
    const highlights = input.contributionHighlights
      .map((row) => {
        if (!row || typeof row !== 'object') return null
        const statement = (row as { statement?: unknown }).statement
        if (typeof statement !== 'string' || !statement.trim()) return null
        return { statement: statement.trim() }
      })
      .filter((row): row is { statement: string } => row !== null)
    if (highlights.length > 0) {
      result.contributionHighlights = highlights
    }
  }

  if (Array.isArray(input.outcomes)) {
    const outcomes = input.outcomes
      .map((row) => {
        if (!row || typeof row !== 'object') return null
        const statement = (row as { statement?: unknown }).statement
        if (typeof statement !== 'string' || !statement.trim()) return null
        const metricRaw = (row as { metric?: unknown }).metric
        const metric =
          typeof metricRaw === 'string' && metricRaw.trim() ? metricRaw.trim() : undefined
        return metric ? { statement: statement.trim(), metric } : { statement: statement.trim() }
      })
      .filter((row): row is { statement: string; metric?: string } => row !== null)
    if (outcomes.length > 0) {
      result.outcomes = outcomes
    }
  }

  if (isStatus(input.status)) {
    result.status = input.status
  } else if (input.status != null && input.status !== '') {
    // Invalid status → must be reviewed
    result.needsReview.push('status')
  }

  const fromModel = Array.isArray(input.needsReview) ? input.needsReview.filter(isFieldKey) : []

  const missing: CaseStudyFieldKey[] = []
  if (!result.clientName) missing.push('clientName')
  if (!result.businessChallenge) missing.push('businessChallenge')
  if (!result.contributionHighlights) missing.push('contributionHighlights')
  if (!result.outcomes) missing.push('outcomes')
  if (!result.status) missing.push('status')

  result.needsReview = [...new Set([...fromModel, ...result.needsReview, ...missing])]
  return result
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm exec vitest run --config ./vitest.config.mts tests/unit/caseStudy.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Suggest a conventional commit message**

```text
feat(ingest): add case-study normalize helpers
```

---

### Task 3: Case-study AI generation + paths + writeup wiring

**Files:**

- Create: `ai/project.case-study-instructions.md`
- Modify: `scripts/ingest/lib/paths.ts`
- Modify: `scripts/ingest/lib/ai.ts`
- Modify: `scripts/ingest/commands/writeup.ts`

**Interfaces:**

- Consumes: `normalizeCaseStudy`, `emptyCaseStudyStub`, `caseStudyOutputSchema` from `caseStudy.ts`; `renderContext` / `EntryContext` from existing AI helpers
- Produces:
  - `caseStudyPath(slug: string): string` → `ingest/work/<slug>/case-study.json`
  - `CASE_STUDY_INSTRUCTIONS_PATH`
  - `generateCaseStudy(context: EntryContext): Promise<CaseStudySidecar>`
  - writeup stage writes both `writeup.md` and `case-study.json`

- [ ] **Step 1: Add path helpers**

In `scripts/ingest/lib/paths.ts`, add:

```ts
export const CASE_STUDY_INSTRUCTIONS_PATH = path.join(ROOT, 'ai/project.case-study-instructions.md')

export function caseStudyPath(slug: string): string {
  return path.join(entryDir(slug), 'case-study.json')
}
```

- [ ] **Step 2: Write `ai/project.case-study-instructions.md`**

Create the file with content covering:

- Output is JSON matching the schema (handled by `outputSchema`; instructions still describe fields).
- Prefer developer notes over scraped evidence.
- Do not invent client names, metrics, or `live` status without evidence (`liveUrl`, notes, README, site).
- `contributionHighlights`: 2–4 short first-person/portfolio statements about what you built.
- `outcomes`: 2–4 rows; omit `metric` when unknown.
- Put uncertain fields in `needsReview`.
- `businessChallenge`: concise markdown (plain paragraphs; no code fences).
- Never invent `slug`.

Keep it concise (~80–120 lines max).

- [ ] **Step 3: Add `generateCaseStudy` to `scripts/ingest/lib/ai.ts`**

```ts
import {
  caseStudyOutputSchema,
  emptyCaseStudyStub,
  normalizeCaseStudy,
  type CaseStudySidecar,
} from './caseStudy'
import { CASE_STUDY_INSTRUCTIONS_PATH, WRITEUP_INSTRUCTIONS_PATH } from './paths'
// WRITEUP_INSTRUCTIONS_PATH already imported — extend the import

export async function generateCaseStudy(context: EntryContext): Promise<CaseStudySidecar> {
  const instructions = await fs.readFile(CASE_STUDY_INSTRUCTIONS_PATH, 'utf8')
  const briefing = renderContext(context)

  try {
    const response = await sendMessage(
      [
        {
          content: `Produce the case-study sidecar JSON for the project below.

Ground every claim in the evidence. If a field is uncertain, omit it and list it in needsReview.

${briefing}`,
          role: 'user',
        },
      ],
      {
        effort: 'medium',
        maxTokens: 4000,
        model: MODEL,
        outputSchema: caseStudyOutputSchema,
        system: instructions,
      },
    )

    const parsed = parseJsonFromResponse<unknown>(response, null)
    return normalizeCaseStudy(parsed)
  } catch {
    return emptyCaseStudyStub()
  }
}
```

If `parseJsonFromResponse` requires a non-null fallback, use `{}` and still run through `normalizeCaseStudy`.

- [ ] **Step 4: Wire `writeup` command**

In `scripts/ingest/commands/writeup.ts`, after writing `writeup.md`, generate and write the sidecar. Case-study failures must not abort a successful writeup:

```ts
import { generateCaseStudy, generateWriteup } from '../lib/ai'
import { caseStudyPath, notesPath, rel, writeupPath } from '../lib/paths'
import { emptyCaseStudyStub } from '../lib/caseStudy'

// inside the try, after writeup.md:
await fs.writeFile(writeupPath(entry.slug), `${markdown}\n`, 'utf8')

let caseStudy
try {
  caseStudy = await generateCaseStudy({ ...context, notes, title: entry.title })
} catch (error) {
  log.warn(
    `${entry.slug}: case-study generation failed (${error instanceof Error ? error.message : String(error)}) — writing stub`,
  )
  caseStudy = emptyCaseStudyStub()
}
await fs.writeFile(caseStudyPath(entry.slug), `${JSON.stringify(caseStudy, null, 2)}\n`, 'utf8')

await updateEntry(...)
await writeSheet(entry)

log.ok(
  `${entry.slug} → ${rel(writeupPath(entry.slug))} (${words} words, ${tags} tech tags); case-study needsReview=${caseStudy.needsReview.join(',') || 'none'}`,
)
```

`--force` already regenerates the whole writeup stage (both artifacts).

- [ ] **Step 5: Smoke-check TypeScript on touched files**

```bash
pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | head -n 40
```

Expected: no new errors in the ingest/case-study files (ignore pre-existing unrelated noise if any).

- [ ] **Step 6: Suggest a conventional commit message**

```text
feat(ingest): generate case-study.json during writeup
```

---

### Task 4: ENTER-ME sheet case-study section

**Files:**

- Modify: `scripts/ingest/lib/sheet.ts`
- Create: `tests/unit/sheetCaseStudy.spec.ts`

**Interfaces:**

- Consumes: `CaseStudySidecar`, `CASE_STUDY_FIELD_KEYS`, `caseStudyPath`, `readJson`
- Produces: `export function renderCaseStudySection(slug: string, caseStudy: CaseStudySidecar | null): string[]` used by `writeSheet`

- [ ] **Step 1: Write failing tests for section rendering**

Create `tests/unit/sheetCaseStudy.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { renderCaseStudySection } from '../../scripts/ingest/lib/sheet'
import type { CaseStudySidecar } from '../../scripts/ingest/lib/caseStudy'

describe('renderCaseStudySection', () => {
  it('lists proposed values and needsReview when sidecar exists', () => {
    const sidecar: CaseStudySidecar = {
      clientName: 'WhereNext.ai',
      businessChallenge: 'Fragmented planning.',
      contributionHighlights: [{ statement: 'Built the platform end-to-end' }],
      outcomes: [{ statement: 'End-to-end experience', metric: 'From idea to live product' }],
      status: 'live',
      needsReview: ['businessChallenge'],
    }

    const md = renderCaseStudySection('wherenext-ai', sidecar).join('\n')
    expect(md).toContain('## Case study')
    expect(md).toContain('`slug`')
    expect(md).toContain('wherenext-ai')
    expect(md).toContain('WhereNext.ai')
    expect(md).toContain('**Needs review:**')
    expect(md).toContain('`businessChallenge`')
    expect(md).toContain('case-study.json')
  })

  it('flags all fields when sidecar is missing', () => {
    const md = renderCaseStudySection('demo', null).join('\n')
    expect(md).toContain('_No case-study.json yet_')
    expect(md).toContain('`clientName`')
    expect(md).toContain('`status`')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm exec vitest run --config ./vitest.config.mts tests/unit/sheetCaseStudy.spec.ts
```

Expected: FAIL — `renderCaseStudySection` not exported.

- [ ] **Step 3: Implement `renderCaseStudySection` and call it from `writeSheet`**

In `scripts/ingest/lib/sheet.ts`:

```ts
import type { CaseStudySidecar } from './caseStudy'
import { CASE_STUDY_FIELD_KEYS } from './caseStudy'
import { caseStudyPath, entryDir, rel, shotsDir, shotsManifestPath, writeupPath } from './paths'

export function renderCaseStudySection(slug: string, caseStudy: CaseStudySidecar | null): string[] {
  const lines: string[] = ['## Case study', '']

  lines.push(
    `| slug | \`${slug}\` |`,
    '',
    'Copy values from **[case-study.json](./case-study.json)** (or the table below) into the',
    'matching Project fields. `slug` is required and unique.',
    '',
  )

  if (!caseStudy) {
    lines.push(
      '_No case-study.json yet — run `pnpm ingest writeup` (or fill these in admin)._',
      '',
      '**Needs review:** ' + CASE_STUDY_FIELD_KEYS.map((k) => `\`${k}\``).join(', '),
      '',
    )
    return lines
  }

  lines.push('| Field | Value |', '| --- | --- |')
  lines.push(`| clientName | ${code(caseStudy.clientName)} |`)
  lines.push(`| status | ${code(caseStudy.status)} |`)
  lines.push(
    `| businessChallenge | ${caseStudy.businessChallenge ? 'see case-study.json / block below' : '—'} |`,
  )
  lines.push(
    `| contributionHighlights | ${caseStudy.contributionHighlights?.length ?? 0} item(s) |`,
  )
  lines.push(`| outcomes | ${caseStudy.outcomes?.length ?? 0} item(s) |`)
  lines.push('')

  if (caseStudy.businessChallenge) {
    lines.push('### businessChallenge', '', caseStudy.businessChallenge, '')
  }

  if (caseStudy.contributionHighlights?.length) {
    lines.push('### contributionHighlights', '')
    for (const row of caseStudy.contributionHighlights) {
      lines.push(`- ${row.statement}`)
    }
    lines.push('')
  }

  if (caseStudy.outcomes?.length) {
    lines.push('### outcomes', '')
    for (const row of caseStudy.outcomes) {
      lines.push(row.metric ? `- **${row.statement}** — ${row.metric}` : `- ${row.statement}`)
    }
    lines.push('')
  }

  const review =
    caseStudy.needsReview.length > 0
      ? caseStudy.needsReview.map((k) => `\`${k}\``).join(', ')
      : '_none_'
  lines.push(`**Needs review:** ${review}`, '')
  return lines
}
```

In `writeSheet`, after the Fields table (and before `description_markdown`), load the sidecar and splice the section:

```ts
const caseStudy = await readJson<CaseStudySidecar>(caseStudyPath(entry.slug))
// after the Fields table blank line:
lines.push(...renderCaseStudySection(entry.slug, caseStudy))
```

Also add `slug` to the top Fields table:

```ts
`| slug | \`${entry.slug}\` |`,
```

Allow `writeSheet` to run when only case-study exists (optional): keep current gate (`hasWriteup || shots.length`) — writeup always writes both, so sheet still regenerates after writeup.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm exec vitest run --config ./vitest.config.mts tests/unit/sheetCaseStudy.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Suggest a conventional commit message**

```text
feat(ingest): surface case-study fields in ENTER-ME
```

---

### Task 5: Publish mapping

**Files:**

- Create: `scripts/ingest/lib/projectData.ts`
- Modify: `scripts/ingest/commands/publish.ts`
- Create: `tests/unit/projectData.spec.ts`

**Interfaces:**

- Consumes: `ManifestEntry`, `CaseStudySidecar`, generated `RequiredDataFromCollectionSlug<'projects'>`
- Produces: `buildProjectData(entry, markdown, mediaIds, visible, caseStudy: CaseStudySidecar | null): RequiredDataFromCollectionSlug<'projects'>`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/projectData.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { buildProjectData } from '../../scripts/ingest/lib/projectData'
import type { ManifestEntry } from '../../scripts/ingest/lib/types'
import type { CaseStudySidecar } from '../../scripts/ingest/lib/caseStudy'

const entry: ManifestEntry = {
  slug: 'wherenext-ai',
  title: 'WhereNext.ai',
  liveUrl: 'https://wherenext.ai',
  githubLink: 'https://github.com/example/wherenext',
  stages: { writeupAt: '2026-01-01T00:00:00.000Z' },
}

describe('buildProjectData', () => {
  it('maps slug, writeup, and sidecar fields', () => {
    const caseStudy: CaseStudySidecar = {
      clientName: 'WhereNext.ai',
      businessChallenge: 'Fragmented planning.',
      contributionHighlights: [{ statement: 'Built end-to-end' }],
      outcomes: [{ statement: 'End-to-end experience', metric: 'Live product' }],
      status: 'live',
      needsReview: [],
    }

    const data = buildProjectData(entry, '# Writeup', [10, 11], false, caseStudy)

    expect(data.slug).toBe('wherenext-ai')
    expect(data.title).toBe('WhereNext.ai')
    expect(data.description_markdown).toBe('# Writeup')
    expect(data.clientName).toBe('WhereNext.ai')
    expect(data.businessChallenge).toBe('Fragmented planning.')
    expect(data.contributionHighlights).toEqual([{ statement: 'Built end-to-end' }])
    expect(data.outcomes).toEqual([{ statement: 'End-to-end experience', metric: 'Live product' }])
    expect(data.status).toBe('live')
    expect(data.display?.hide).toBe(true)
    expect(data.thumbnail).toBe(10)
    expect(data.images).toEqual([10, 11])
  })

  it('omits case-study fields when sidecar is missing but still sets slug', () => {
    const data = buildProjectData(entry, 'body', [], true, null)
    expect(data.slug).toBe('wherenext-ai')
    expect(data.clientName).toBeUndefined()
    expect(data.status).toBeUndefined()
    expect(data.display?.hide).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm exec vitest run --config ./vitest.config.mts tests/unit/projectData.spec.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Extract `buildProjectData` into `scripts/ingest/lib/projectData.ts`**

```ts
import type { RequiredDataFromCollectionSlug } from 'payload'

import type { CaseStudySidecar } from './caseStudy'
import type { ManifestEntry } from './types'

export function buildProjectData(
  entry: ManifestEntry,
  markdown: string,
  mediaIds: number[],
  visible: boolean,
  caseStudy: CaseStudySidecar | null,
): RequiredDataFromCollectionSlug<'projects'> {
  const data: RequiredDataFromCollectionSlug<'projects'> = {
    slug: entry.slug,
    title: entry.title,
    description_markdown: markdown,
    display: {
      card_type: entry.cardType ?? 'visual',
      featured: entry.featured ?? false,
      hide: !visible,
      order: entry.order,
    },
    githubLink: entry.githubLink,
    images: mediaIds,
    liveLink: entry.liveUrl,
    snapshotLink: entry.snapshotLink,
    thumbnail: mediaIds[0],
  }

  if (caseStudy?.clientName) data.clientName = caseStudy.clientName
  if (caseStudy?.businessChallenge) data.businessChallenge = caseStudy.businessChallenge
  if (caseStudy?.contributionHighlights) {
    data.contributionHighlights = caseStudy.contributionHighlights
  }
  if (caseStudy?.outcomes) data.outcomes = caseStudy.outcomes
  if (caseStudy?.status) data.status = caseStudy.status

  return data
}
```

- [ ] **Step 4: Update `publish.ts`**

- Remove local `buildProjectData`.
- Import from `../lib/projectData`.
- Import `caseStudyPath` and `CaseStudySidecar`.
- Before `buildProjectData(...)`:

```ts
const caseStudy = await readJson<CaseStudySidecar>(caseStudyPath(entry.slug))
if (!caseStudy) {
  log.warn(`${entry.slug}: case-study.json missing — publishing without case-study fields`)
}
const data = buildProjectData(entry, markdown, mediaIds, visible, caseStudy)
```

- In dry-run logging, mention whether sidecar is present.

- [ ] **Step 5: Run unit tests**

```bash
pnpm exec vitest run --config ./vitest.config.mts tests/unit/projectData.spec.ts tests/unit/caseStudy.spec.ts tests/unit/sheetCaseStudy.spec.ts
```

Expected: all PASS.

- [ ] **Step 6: Suggest a conventional commit message**

```text
feat(ingest): publish case-study sidecar fields
```

---

### Task 6: Documentation

**Files:**

- Modify: `docs/ingest.md`
- Modify: `scripts/ingest/cli.ts` USAGE string (writeup description)

**Interfaces:**

- Consumes: behaviors from Tasks 3–5
- Produces: docs that match the shipped pipeline

- [ ] **Step 1: Update `docs/ingest.md`**

Add/adjust:

- Pipeline diagram includes `case-study.json` next to `writeup.md`.
- **`writeup`** section: generates both `writeup.md` and `case-study.json`; `--force` regenerates both.
- Manual entry: new Case study section / fields (`slug`, `clientName`, `businessChallenge`, `contributionHighlights`, `outcomes`, `status`); follow `needsReview` in ENTER-ME.
- **`publish`**: maps manifest `slug` + sidecar fields; missing sidecar still publishes other fields.
- Note: testimonials deferred.

- [ ] **Step 2: Update CLI USAGE blurb for writeup**

In `scripts/ingest/cli.ts`:

```text
writeup    Generate description_markdown + case-study.json with Claude
```

- [ ] **Step 3: Suggest a conventional commit message**

```text
docs(ingest): document case-study sidecar flow
```

---

## Spec coverage (self-review)

| Spec requirement                                                    | Task                                            |
| ------------------------------------------------------------------- | ----------------------------------------------- |
| `slug` required unique                                              | Task 1 + Task 5                                 |
| `clientName`, markdown `businessChallenge`, arrays, `status` select | Task 1                                          |
| Skip testimonials                                                   | Global constraint / no task                     |
| Keep technical writeup                                              | Tasks 3–5 leave `writeup.md` instructions alone |
| Sidecar JSON AI-first                                               | Task 3                                          |
| ENTER-ME needs review                                               | Task 4                                          |
| publish maps fields                                                 | Task 5                                          |
| AI failure → stub, don’t fail writeup                               | Task 3                                          |
| Invalid status dropped + flagged                                    | Task 2                                          |
| Missing sidecar at publish                                          | Task 5                                          |
| Slug backfill migration                                             | Task 1                                          |
| Docs                                                                | Task 6                                          |

## Execution handoff

This plan will be executed sequentially in the active session with `$superpowers-executing-plans` and inline checkpoints. Say when to start.
