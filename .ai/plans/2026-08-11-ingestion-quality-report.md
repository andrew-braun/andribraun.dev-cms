# Ingestion Quality Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use $superpowers-executing-plans to implement this plan sequentially in the active session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add advisory, persistent ingestion-quality reporting while fixing stale-prose invalidation, summary handling, and screenshot-capture resiliency.

**Architecture:** Keep quality policy in a pure `lib/quality.ts` evaluator and make the command an artifact reader/writer. Screenshot capture records its own detectable page-state issues in the existing `shots.json`; the evaluator combines those with context and case-study artifacts to produce one current `ingest/quality-report.json` snapshot. No warning changes stage completion or publish eligibility.

**Tech Stack:** TypeScript, Node.js filesystem APIs, Playwright, Vitest, existing Payload `pnpm ingest` CLI.

## Global Constraints

- Warnings never prevent ingestion, `status`, or `publish`.
- `status` remains a manual-entry readiness indicator; it is not a publication-approval gate.
- `ingest/quality-report.json` is overwritten atomically on each `pnpm ingest quality` run.
- `ingest/work/` remains regenerable and ignored; the report is a persistent, repository-visible review artifact.
- Do not publish, stage, or commit content while implementing or auditing.

---

## File Structure

| File                                      | Responsibility                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `scripts/ingest/lib/types.ts`             | Add the optional capture-issue metadata stored with a screenshot.                                   |
| `scripts/ingest/lib/artifacts.ts`         | Correct generated-artifact dependency fingerprints and invalidation.                                |
| `scripts/ingest/lib/caseStudy.ts`         | Keep a valid 20–45-word generated summary; safely create a review-marked fallback only when needed. |
| `scripts/ingest/lib/screenshotQuality.ts` | Pure page-text detection for consent/error overlays.                                                |
| `scripts/ingest/lib/quality.ts`           | Pure quality-report types and warning evaluation.                                                   |
| `scripts/ingest/commands/shots.ts`        | Record page-state issues and turn alt-generation failures into visible fallback alt text.           |
| `scripts/ingest/commands/quality.ts`      | Load artifacts, preserve per-entry load errors as warnings, and atomically write the report.        |
| `scripts/ingest/commands/status.ts`       | Show the latest quality-report location and warning total without changing readiness.               |
| `scripts/ingest/cli.ts`                   | Register and document the `quality` command.                                                        |
| `scripts/ingest/lib/paths.ts`             | Define `QUALITY_REPORT_PATH`.                                                                       |
| `tests/unit/*.spec.ts`                    | Regression tests for each pure behavior and CLI wiring.                                             |
| `docs/ingest.md`                          | Document the report, warning semantics, and corrected invalidation table.                           |

### Task 1: Correct dependency and summary semantics

**Files:**

- Modify: `scripts/ingest/lib/artifacts.ts:114-161,189-202`
- Modify: `scripts/ingest/lib/caseStudy.ts:92-145`
- Test: `tests/unit/ingestArtifacts.spec.ts:137-193`
- Test: `tests/unit/caseStudy.spec.ts:124-137`

**Interfaces:**

- Consumes: `ManifestEntry`, `CaseStudySidecar`, and the existing stage fingerprint contract.
- Produces: `isSummaryWithinWordRange(summary: string): boolean`, `summaryFromWriteup(markdown: string): string | undefined`, and unchanged public `preferWriteupSummary(caseStudy, markdown)` semantics that preserve valid generated summaries.

- [ ] **Step 1: Write the failing invalidation and summary tests**

Replace the screenshot assertions with the expected dependency graph and add valid-summary coverage:

```ts
it('does not invalidate prose when screenshots are refreshed', () => {
  expect(invalidateDerivedArtifacts('shots')).toEqual([])
})

it('preserves a valid 20–45 word generated summary', () => {
  const summary =
    'A focused platform for advisors to guide students through applications, deadlines, and next steps with practical one-to-one support.'
  expect(
    preferWriteupSummary({ needsReview: [], summary }, 'A much longer writeup introduction.')
      .summary,
  ).toBe(summary)
})

it('uses a review-marked 20–45 word fallback when the generated summary is invalid', () => {
  const result = preferWriteupSummary(
    { needsReview: [], summary: 'Too brief.' },
    'The platform gives advisors a focused workspace for coordinating student applications, deadlines, and decisions while keeping every applicant informed about the next practical step.',
  )
  expect(result.needsReview).toContain('summary')
  expect(result.summary?.trim().split(/\s+/)).toHaveLength(24)
})
```

Add a `recordStageCompletion(..., 'shots', ...)` fixture assertion that `writeupAt`, `caseStudyAt`, `writeup.md`, and `case-study.json` remain present.

- [ ] **Step 2: Run the focused tests and confirm red**

Run: `pnpm exec vitest run tests/unit/ingestArtifacts.spec.ts tests/unit/caseStudy.spec.ts --config ./vitest.config.mts`

Expected: failures showing screenshot completion still removes prose and the valid model summary is replaced.

- [ ] **Step 3: Implement the minimal dependency and summary fixes**

In `fingerprintsFor`, remove `shotsInput` from the `writeup` digest. Change the screenshot invalidation branch to return an empty list:

```ts
writeup: digest({
  analysisInput: entry.stages.analysisInput,
  notes: notes ?? null,
  title: entry.title,
}),

if (stage === 'shots') {
  return []
}
```

Add the bounded summary helpers and use them in `preferWriteupSummary`:

```ts
export function isSummaryWithinWordRange(value: string): boolean {
  const words = value.trim().split(/\s+/).filter(Boolean)
  return words.length >= 20 && words.length <= 45
}

export function preferWriteupSummary(
  caseStudy: CaseStudySidecar,
  markdown: string,
): CaseStudySidecar {
  if (caseStudy.summary && isSummaryWithinWordRange(caseStudy.summary)) {
    return caseStudy
  }
  const fallback = summaryFromWriteup(markdown)
  if (!fallback)
    return { ...caseStudy, needsReview: [...new Set([...caseStudy.needsReview, 'summary'])] }
  const words = fallback.split(/\s+/).filter(Boolean).slice(0, 45)
  return {
    ...caseStudy,
    summary: words.join(' '),
    needsReview: [...new Set([...caseStudy.needsReview, 'summary'])],
  }
}
```

Make `summaryFromWriteup` return `undefined` for fallbacks under 20 words so a short introduction is not presented as an acceptable summary.

- [ ] **Step 4: Run the focused tests and confirm green**

Run: `pnpm exec vitest run tests/unit/ingestArtifacts.spec.ts tests/unit/caseStudy.spec.ts --config ./vitest.config.mts`

Expected: all tests in both files pass.

- [ ] **Step 5: Suggest a conventional commit message**

```text
fix(ingest): preserve prose on screenshot refresh
```

### Task 2: Preserve screenshot-capture quality evidence

**Files:**

- Create: `scripts/ingest/lib/screenshotQuality.ts`
- Modify: `scripts/ingest/lib/types.ts:5-25`
- Modify: `scripts/ingest/lib/ai.ts:302-346`
- Modify: `scripts/ingest/commands/shots.ts:20-171,180-222`
- Test: `tests/unit/ingestShots.spec.ts`
- Test: `tests/unit/ingestAi.spec.ts`

**Interfaces:**

- Produces `type ScreenshotCaptureIssue = 'cookie-consent' | 'page-error'` and `detectScreenshotCaptureIssues(bodyText: string): ScreenshotCaptureIssue[]`.
- Extends `CapturedShot` with `captureIssues?: ScreenshotCaptureIssue[]`.
- Keeps `generateAltText(imagePath, projectTitle, label): Promise<string>`; it resolves to `${projectTitle} — ${label}` if the vision request or parsing fails.

- [ ] **Step 1: Write failing capture-quality tests**

Create pure detector cases:

```ts
import { detectScreenshotCaptureIssues } from '../../scripts/ingest/lib/screenshotQuality'

it('flags consent and map-error overlays from visible page text', () => {
  expect(
    detectScreenshotCaptureIssues(
      'We use cookies. Accept All. This page can’t load Google Maps correctly.',
    ),
  ).toEqual(['cookie-consent', 'page-error'])
})

it('does not flag ordinary page copy', () => {
  expect(detectScreenshotCaptureIssues('Meet the team and explore our services.')).toEqual([])
})
```

Add an AI client mock that makes `sendMessage` reject and assert `generateAltText('/tmp/image.png', 'Alpha', 'Home')` resolves to `Alpha — Home`. Add a `CapturedShot` fixture with `captureIssues: ['cookie-consent']` to confirm the existing artifact validator accepts compatible extended metadata.

- [ ] **Step 2: Run the screenshot and AI tests and confirm red**

Run: `pnpm exec vitest run tests/unit/ingestShots.spec.ts tests/unit/ingestAi.spec.ts --config ./vitest.config.mts`

Expected: module-not-found and rejected-alt-request failures.

- [ ] **Step 3: Implement page-state detection and non-blocking alt fallback**

Create `screenshotQuality.ts` with visible-text regexes kept deliberately narrow:

```ts
export type ScreenshotCaptureIssue = 'cookie-consent' | 'page-error'

export function detectScreenshotCaptureIssues(bodyText: string): ScreenshotCaptureIssue[] {
  const text = bodyText.replace(/\s+/g, ' ').trim()
  const issues: ScreenshotCaptureIssue[] = []
  if (/\b(accept all|accept cookies|cookie settings|we use cookies)\b/i.test(text))
    issues.push('cookie-consent')
  if (
    /\b(can(?:not|['’]t) load google maps correctly|application error|something went wrong)\b/i.test(
      text,
    )
  )
    issues.push('page-error')
  return issues
}
```

In `generateAltText`, wrap `readFile`, `sendMessage`, and parsing in `try/catch`; return the deterministic fallback in the catch branch. In `shots.ts`, call `detectScreenshotCaptureIssues(await page.locator('body').innerText())` after `settle`, write a non-empty result as `captureIssues` on the captured shot, and log it with `log.warn`. Add `button:has-text("Allow all")` and `[role="dialog"] button:has-text("Accept")` to the dismissal selectors.

- [ ] **Step 4: Run the screenshot and AI tests and confirm green**

Run: `pnpm exec vitest run tests/unit/ingestShots.spec.ts tests/unit/ingestAi.spec.ts --config ./vitest.config.mts`

Expected: all tests in both files pass.

- [ ] **Step 5: Suggest a conventional commit message**

```text
fix(ingest): retain screenshot quality warnings
```

### Task 3: Add advisory report generation and status discovery

**Files:**

- Create: `scripts/ingest/lib/quality.ts`
- Create: `scripts/ingest/commands/quality.ts`
- Modify: `scripts/ingest/lib/paths.ts:28-68`
- Modify: `scripts/ingest/commands/status.ts:1-90`
- Modify: `scripts/ingest/cli.ts:10-122`
- Test: `tests/unit/ingestQuality.spec.ts`
- Test: `tests/unit/ingestStatus.spec.ts`
- Test: `tests/unit/ingestCli.spec.ts`
- Modify: `docs/ingest.md:1-80,133-156,210-240`

**Interfaces:**

- Produces `QUALITY_REPORT_PATH`, `QualityWarning`, `QualityReportEntry`, `QualityReport`, and `evaluateEntryQuality(input): QualityReportEntry`.
- `quality(args)` selects active entries by default, permits explicit slugs, writes `QUALITY_REPORT_PATH`, and logs its relative path plus the warning total.

- [ ] **Step 1: Write failing evaluator and command tests**

Use a pure evaluator fixture with no repo and no notes, a 50-word summary, one contribution highlight, `needsReview: ['outcomes']`, generic alt text, and `captureIssues: ['cookie-consent']`. Assert the codes are exactly:

```ts
expect(result.warnings.map((warning) => warning.code)).toEqual([
  'case-study-needs-review',
  'unverified-authorship',
  'summary-length',
  'generic-screenshot-alt',
  'screenshot-capture-issue',
])
```

Add individual fixtures for a valid fully evidenced entry (no warnings) and an entry whose staged `caseStudyAt` exists but whose sidecar load fails (`missing-artifact`). For the command, use temporary `ArtifactRoots`/paths through an exported `buildQualityReport(entries, loader)` seam and assert atomically written JSON has `version: 1`, `generatedAt`, selected entries, and a summary count. Add a `status` unit test for rendering a known report warning count without changing `isEntryReady`.

- [ ] **Step 2: Run the report, status, and CLI tests and confirm red**

Run: `pnpm exec vitest run tests/unit/ingestQuality.spec.ts tests/unit/ingestStatus.spec.ts tests/unit/ingestCli.spec.ts --config ./vitest.config.mts`

Expected: module-not-found failures for the report and command, followed by a missing CLI command assertion.

- [ ] **Step 3: Implement the evaluator and command**

Define the report contract in `lib/quality.ts`:

```ts
export type QualityWarningCode =
  | 'case-study-needs-review'
  | 'unverified-authorship'
  | 'summary-length'
  | 'generic-screenshot-alt'
  | 'missing-artifact'
  | 'screenshot-capture-issue'

export interface QualityWarning {
  code: QualityWarningCode
  message: string
  remediation: string
}
export interface QualityReportEntry {
  slug: string
  title: string
  warnings: QualityWarning[]
}
export interface QualityReport {
  version: 1
  generatedAt: string
  summary: {
    entries: number
    warnings: number
    byCode: Partial<Record<QualityWarningCode, number>>
  }
  entries: QualityReportEntry[]
}
```

`evaluateEntryQuality` must only add `unverified-authorship` when `(contribution_highlights?.length || outcomes?.length)` and `!context?.notes && !context?.repo`. It must compare each screenshot alt to `${entry.title} — ${shot.label}`, emit one generic-alt warning per affected label, and emit one capture warning per issue code. Use `isSummaryWithinWordRange` for the summary rule.

In `commands/quality.ts`, catch artifact reads per entry rather than failing the batch, append a `missing-artifact` warning naming the unavailable artifact, and use `atomicWriteJson(QUALITY_REPORT_PATH, report)`. Add `QUALITY_REPORT_PATH = resolveContained(INGEST_DIR, 'quality-report.json')`. In `status`, load the report only if it exists; log `Quality report: ingest/quality-report.json (<N> warnings)` after the ready count. Add `quality` to `COMMANDS`, `KNOWN_FLAGS` with an empty array, and CLI usage as `quality    Write advisory data-quality warnings → ingest/quality-report.json`.

- [ ] **Step 4: Document the new review step and corrected dependencies**

Update the quick start to run `pnpm ingest quality` after `shots`. Add a section explaining that warnings are advisory, list all six warning codes, and state that the report is overwritten with the latest snapshot. Change the invalidation table so screenshot targets, hero, and `maxShots` invalidate only screenshots; keep title changes invalidating screenshots, writeups, and case studies because title is an explicit prose-generation input.

- [ ] **Step 5: Run the report, status, CLI, and docs tests and confirm green**

Run: `pnpm exec vitest run tests/unit/ingestQuality.spec.ts tests/unit/ingestStatus.spec.ts tests/unit/ingestCli.spec.ts tests/unit/ingestDocs.spec.ts --config ./vitest.config.mts`

Expected: all tests in the four files pass.

- [ ] **Step 6: Suggest a conventional commit message**

```text
feat(ingest): add persistent quality reporting
```

### Task 4: Verify the implementation and refresh the portfolio audit

**Files:**

- Modify: `ingest/manifest.json` only through the normal ingestion commands.
- Create or modify: `ingest/quality-report.json` through `pnpm ingest quality`.

**Interfaces:**

- Consumes the completed CLI commands and all active manifest entries.
- Produces a fresh nine-entry report and regenerated artifacts; it does not publish.

- [ ] **Step 1: Run the complete integration suite**

Run: `pnpm test:int`

Expected: exit code 0 with all Vitest test files passing.

- [ ] **Step 2: Verify GitHub authentication and refresh source artifacts**

Run:

```bash
gh auth status
pnpm ingest analyze --force
pnpm ingest assess --force
pnpm ingest writeup --force
pnpm ingest shots --force
pnpm ingest quality
pnpm ingest status
```

Expected: source analysis and assessment complete for all nine configured entries, all screenshots and case studies are regenerated without deletion by the screenshot stage, `ingest/quality-report.json` is written, and no publish command runs.

- [ ] **Step 3: Review the generated report and visual captures**

Open `ingest/quality-report.json`, summarize warnings by project/code, and inspect each newly captured PNG named in report warnings. Confirm the report calls out any remaining generic alt text, consent overlays, map/error overlays, unsupported authorship, incomplete fields, and invalid summary length.

- [ ] **Step 4: Re-run final verification commands after audit review**

Run: `pnpm test:int && pnpm ingest quality && pnpm ingest status && git status --short`

Expected: integration tests pass; the quality report and status output reflect the same current artifacts; Git shows only intentional ingestion artifacts, report, and implementation/documentation files.

- [ ] **Step 5: Suggest a conventional commit message**

```text
chore(ingest): refresh quality audit artifacts
```

## Plan Self-Review

- Spec coverage: Task 1 covers stage invalidation and summary quality; Task 2 covers consent/error detection and resilient alt fallback; Task 3 covers persistent advisory reporting, status visibility, tests, and documentation; Task 4 covers the requested complete refresh and audit.
- Placeholder scan: no deferred implementation markers or unspecified error-handling steps remain.
- Type consistency: the report reads `CapturedShot.captureIssues`, uses `isSummaryWithinWordRange`, and exposes `QUALITY_REPORT_PATH` consistently across the command, status, and tests.

## Execution Handoff

This plan will be executed sequentially in the active session with `$superpowers-executing-plans` and inline checkpoints.
