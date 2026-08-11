# Repository Assessment and Ingestion Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use $superpowers-executing-plans to implement this plan sequentially in the active session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a source-backed AI repository-assessment stage, make structured AI failures truthful and atomic, feed case studies compact evidence, and process every eligible manifest project.

**Architecture:** Keep `analyze` as the bounded raw-evidence scan and add `assess` as an independently cached AI interpretation artifact. Writeups keep their current rich briefing; case studies consume only the validated assessment, finished writeup, notes, and compact site metadata through a strict structured-response boundary.

**Tech Stack:** TypeScript 5.9, Node.js, Payload CMS CLI, Anthropic Messages API, Vitest, PostgreSQL, Playwright.

## Global Constraints

- Every substantive repository finding must cite at least one path present in `EntryContext.repo.files`.
- Case-study requests must not contain raw repository file bodies or the full repository tree.
- `max_tokens`, refusal, malformed JSON, invalid schema/domain data, timeout, and transport errors are hard stage failures.
- Generated artifacts are validated before atomic replacement; failed regeneration preserves a previous valid file but never records fresh stage completion.
- Projects without repositories use an explicit valid `unavailable` assessment state.
- Batch processing continues independent entries and exits nonzero when any entry fails.
- Do not create commits, stage files, or delete unrelated CMS data.

---

## File Structure

- Create `scripts/ingest/lib/repoAssessment.ts`: assessment types, JSON schema, domain validator, evidence-path enforcement, and compact renderer.
- Create `scripts/ingest/commands/assess.ts`: resumable stage orchestration and atomic artifact commit.
- Create `ai/project.repo-assessment-instructions.md`: evidence-synthesis prompt contract.
- Create `tests/unit/repoAssessment.spec.ts`: assessment contract and compact-rendering tests.
- Create `tests/unit/ingestAssess.spec.ts`: command prerequisite, unavailable-state, and failed-regeneration tests.
- Modify `src/app/lib/ai/claude/client.ts`: strict structured response parser and completion-reason validation.
- Modify `scripts/ingest/lib/ai.ts`: assessment generation and compact case-study generation.
- Modify `scripts/ingest/lib/{types,paths,artifacts,validation}.ts`: stage state, paths, fingerprints, invalidation, and manifest parsing.
- Modify `scripts/ingest/commands/{analyze,writeup,status,publish}.ts`: analysis content fingerprinting, assessment prerequisite, stage display, and stale-artifact enforcement.
- Modify `scripts/ingest/cli.ts`, `README.md`, and `docs/ingest.md`: command registration and operating instructions.
- Extend `tests/unit/{claudeClient,ingestArtifacts,ingestCli,ingestDocs,caseStudy,ingestPublish}.spec.ts`.

### Task 1: Strict Structured AI Boundary

**Files:**

- Modify: `src/app/lib/ai/claude/client.ts`
- Test: `tests/unit/claudeClient.spec.ts`

**Interfaces:**

- Consumes: `ClaudeResponse`, `getTextContent(response)`.
- Produces: `parseStructuredResponse<T>(response: ClaudeResponse): T`, which throws `ClaudeAPIError` unless `stop_reason === 'end_turn'`, text is nonempty, and direct JSON parsing succeeds.

- [ ] **Step 1: Write failing completion and parse tests**

Add fixtures with `stop_reason: 'max_tokens'`, empty text, malformed JSON, and valid JSON. Assert failures include the stop reason and do not log raw model text; assert the valid fixture returns its typed value.

```ts
expect(() => parseStructuredResponse(truncated)).toThrow('stop reason: max_tokens')
expect(() => parseStructuredResponse(malformed)).toThrow('invalid structured JSON')
expect(parseStructuredResponse(valid)).toEqual({ value: 'ok' })
```

- [ ] **Step 2: Run the focused test and confirm red**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/unit/claudeClient.spec.ts`

Expected: FAIL because `parseStructuredResponse` is not exported.

- [ ] **Step 3: Implement strict parsing**

Implement direct parsing without regex recovery or fallback:

```ts
export function parseStructuredResponse<T>(response: ClaudeResponse): T {
  if (response.stop_reason !== 'end_turn') {
    throw new ClaudeAPIError(
      `Claude did not complete structured output (stop reason: ${response.stop_reason})`,
    )
  }
  const text = getTextContent(response).trim()
  if (!text) throw new ClaudeAPIError('Claude returned empty structured output')
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ClaudeAPIError('Claude returned invalid structured JSON')
  }
}
```

Keep the legacy fallback parser only for non-critical callers until they are migrated; structured ingest callers must use the strict function.

- [ ] **Step 4: Run the focused test and confirm green**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Suggest a conventional commit message**

`fix: reject incomplete Claude structured responses`

### Task 2: Source-Backed Repository Assessment Contract

**Files:**

- Create: `scripts/ingest/lib/repoAssessment.ts`
- Create: `tests/unit/repoAssessment.spec.ts`
- Modify: `scripts/ingest/lib/types.ts`
- Modify: `scripts/ingest/lib/paths.ts`

**Interfaces:**

- Produces: `RepoAssessment`, `RepoFinding`, `repoAssessmentOutputSchema`, `validateRepoAssessment(raw, context, metadata)`, `unavailableRepoAssessment(metadata, reason)`, `renderRepoAssessment(assessment)` and `repoAssessmentPath(slug)`.

- [ ] **Step 1: Write failing domain-contract tests**

Cover a valid cited finding, an uncited finding, a path absent from `context.repo.files`, empty strings, invalid confidence, and an explicit unavailable assessment. Prove rendered assessment includes findings and paths but not source file bodies.

```ts
expect(() => validateRepoAssessment(uncited, context, meta)).toThrow('requires evidence')
expect(() => validateRepoAssessment(unknownPath, context, meta)).toThrow('unknown source path')
expect(renderRepoAssessment(valid)).not.toContain('SECRET_SOURCE_BODY')
```

- [ ] **Step 2: Run the focused test and confirm red**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/unit/repoAssessment.spec.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the types, schema, and validator**

Use this stable artifact shape:

```ts
type Confidence = 'high' | 'medium' | 'low'
interface RepoEvidence {
  path: string
  rationale: string
}
interface RepoFinding {
  claim: string
  confidence: Confidence
  evidence: RepoEvidence[]
  category: 'architecture' | 'capability' | 'delivery' | 'quality' | 'technology'
}
interface RepoAssessment {
  version: 1
  slug: string
  generatedAt: string
  analysisFingerprint: string
  status: 'assessed' | 'unavailable'
  repository?: string
  purpose?: string
  findings: RepoFinding[]
  technologies: string[]
  unknowns: string[]
  unavailableReason?: string
}
```

Validate generated fields, normalize whitespace and duplicates, and require `evidence.length > 0` for every assessed finding. Evidence paths must be own keys of `context.repo.files`.

- [ ] **Step 4: Run the focused test and confirm green**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Suggest a conventional commit message**

`feat: define source-backed repository assessments`

### Task 3: Assessment Stage, Fingerprints, and Invalidation

**Files:**

- Create: `ai/project.repo-assessment-instructions.md`
- Create: `scripts/ingest/commands/assess.ts`
- Create: `tests/unit/ingestAssess.spec.ts`
- Modify: `scripts/ingest/lib/ai.ts`
- Modify: `scripts/ingest/lib/{types,artifacts,validation}.ts`
- Modify: `scripts/ingest/commands/analyze.ts`
- Extend: `tests/unit/ingestArtifacts.spec.ts`

**Interfaces:**

- Consumes: validated `EntryContext`, analysis artifact fingerprint, `generateRepoAssessment(context, analysisFingerprint)`.
- Produces: `StageState.assessedAt`, `StageState.assessmentInput`, `StageState.analysisArtifact`, and an atomic `repo-assessment.json`.

- [ ] **Step 1: Write failing stage and invalidation tests**

Cover: repository assessment success; site-only unavailable artifact without an AI call; missing/stale analysis; strict AI failure preserving an old assessment; analysis content changes invalidating assessment and case study; assessment completion invalidating only case study.

```ts
expect(invalidateDerivedArtifacts('analysis')).toEqual(['assessment', 'writeup', 'caseStudy'])
expect(invalidateDerivedArtifacts('assessment')).toEqual(['caseStudy'])
```

- [ ] **Step 2: Run focused tests and confirm red**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/unit/ingestArtifacts.spec.ts tests/unit/ingestAssess.spec.ts`

Expected: FAIL because the assessment stage and metadata do not exist.

- [ ] **Step 3: Implement content-aware fingerprints**

After `analyze` assembles `EntryContext`, hash the canonical context content excluding volatile `gatheredAt`, and record that hash as `analysisArtifact`. Compute `assessmentInput` from `analysisArtifact` plus assessment contract/prompt version. Add assessment paths to artifact reconciliation and validate artifact contents before treating timestamps as complete.

- [ ] **Step 4: Implement assessment generation and command**

`generateRepoAssessment` sends bounded analyzed evidence with the assessment JSON schema, uses `parseStructuredResponse`, then applies `validateRepoAssessment`. `assess` writes an unavailable artifact locally when no repository exists; otherwise it requires Claude credentials, writes atomically, and records completion only after validation.

- [ ] **Step 5: Run focused tests and confirm green**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 6: Suggest a conventional commit message**

`feat: add resumable repository assessment stage`

### Task 4: Compact and Truthful Case-Study Generation

**Files:**

- Modify: `scripts/ingest/lib/ai.ts`
- Modify: `scripts/ingest/lib/caseStudy.ts`
- Modify: `scripts/ingest/commands/writeup.ts`
- Test: `tests/unit/caseStudy.spec.ts`
- Extend: `tests/unit/ingestAssess.spec.ts`

**Interfaces:**

- Consumes: `generateCaseStudy({ assessment, context, notes, writeup })` with compact `site` metadata only.
- Produces: independently validated `case-study.json`; no fallback stub on provider or parse failure.

- [ ] **Step 1: Write failing prompt and failure-semantics tests**

Capture the outgoing case-study message and assert it contains the assessment claim/path and completed writeup but excludes a sentinel raw file body and tree path. Assert `max_tokens` and invalid JSON reject, retain an old case-study file, and do not record `writeupAt` for a partially completed run.

- [ ] **Step 2: Run focused tests and confirm red**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/unit/caseStudy.spec.ts tests/unit/ingestAssess.spec.ts`

Expected: FAIL under the current raw-context and fallback behavior.

- [ ] **Step 3: Split writeup and case-study inputs**

Keep `generateWriteup(context)` unchanged. Replace the case-study signature with an explicit compact input type and a renderer that includes only title/slug, notes, site title/description/signals, completed writeup, and `renderRepoAssessment(assessment)`.

- [ ] **Step 4: Remove successful fallback behavior**

Use `parseStructuredResponse`, normalize, and reject a result that cannot satisfy the sidecar domain contract. Remove `emptyCaseStudyStub()` from the command failure path. Generate both artifacts in memory first, validate both, then atomically write them and record completion; a failed case study must leave any prior valid pair in place and return nonzero for that entry.

- [ ] **Step 5: Run focused tests and confirm green**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 6: Suggest a conventional commit message**

`fix: make case-study generation compact and fail-safe`

### Task 5: CLI, Status, Publication Gate, and Documentation

**Files:**

- Modify: `scripts/ingest/cli.ts`
- Modify: `scripts/ingest/commands/{status,publish}.ts`
- Modify: `README.md`
- Modify: `docs/ingest.md`
- Extend: `tests/unit/{ingestCli,ingestDocs,ingestPublish}.spec.ts`

**Interfaces:**

- Produces: `pnpm ingest assess [slugs...] [--force]`, status column `assess`, and publication refusal when required generated artifacts are stale/missing.

- [ ] **Step 1: Write failing CLI, docs, status, and publish tests**

Assert `assess` is registered with only `--force`, help and docs show the stage order, status marks assessment separately, and publish rejects a repository project whose assessment or case study is absent/stale.

- [ ] **Step 2: Run focused tests and confirm red**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/unit/ingestCli.spec.ts tests/unit/ingestDocs.spec.ts tests/unit/ingestPublish.spec.ts`

Expected: FAIL because the new command and gates are absent.

- [ ] **Step 3: Wire the command and truthful status**

Register `assess`, add `KNOWN_FLAGS.assess = ['force']`, update usage/examples, add the status column, and update the analyzed command's next-step hint to `pnpm ingest assess`.

- [ ] **Step 4: Enforce current required artifacts at publication**

Reconcile stage metadata before building publish data. Repository entries require current analysis and assessment; all generated projects require current writeup and case study. Throw an actionable `IngestError` naming the first prerequisite command.

- [ ] **Step 5: Update operator documentation**

Document the artifact contract, source-path evidence requirement, no-repository behavior, strict AI failures, force regeneration, resumability, dry-run-before-publish policy, and the exact full-run sequence.

- [ ] **Step 6: Run focused tests and confirm green**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 7: Suggest a conventional commit message**

`docs: document audited ingestion workflow`

### Task 6: Framework Verification and Full-Corpus Ingestion

**Files:**

- Modify only generated `ingest/work/<slug>/` artifacts, `ingest/manifest.json`, and destination CMS records as normal command outputs.
- Do not modify source code during the corpus run except to fix a reproduced framework defect through a new red-green test cycle.

**Interfaces:**

- Consumes: the completed CLI stages and currently configured credentials/targets.
- Produces: validated artifacts and publication records for every active eligible manifest entry.

- [ ] **Step 1: Run focused and full verification**

Run:

```bash
pnpm test:int
pnpm lint
pnpm exec tsc --noEmit
```

Expected: all tests pass, lint exits zero, and TypeScript exits zero. If stale `.next` generated types alone break TypeScript, move `.next` to a temporary sibling, rerun TypeScript, then restore it without overwriting user data.

- [ ] **Step 2: Inventory the exact corpus and target**

Run `pnpm ingest status`, count active entries, inspect `DATABASE_URI`/remote configuration without printing secrets, and report the selected database identity. Process active entries; skipped entries remain intentionally excluded unless explicitly selected by slug.

- [ ] **Step 3: Force current analysis and assessment**

Run:

```bash
pnpm ingest analyze --force
pnpm ingest assess --force
```

Expected: every eligible active project has valid current `context.json` and `repo-assessment.json`; per-entry external failures are recorded for later retry.

- [ ] **Step 4: Force prose and screenshots**

Run:

```bash
pnpm ingest writeup --force
pnpm ingest shots --force
pnpm ingest sheet
```

Expected: each eligible entry has a validated writeup, case study, and checklist; projects with reachable sites have a valid screenshot set. Retry transient read/AI failures only within the existing bounded policy.

- [ ] **Step 5: Validate all generated artifacts**

Run `pnpm ingest status` and a read-only corpus validator that loads every JSON artifact, verifies assessment evidence paths against context, verifies required stage fingerprints, and confirms nonempty writeups and screenshot files.

- [ ] **Step 6: Dry-run and publish**

Run against the same configured target:

```bash
pnpm ingest publish --dry-run
pnpm ingest publish
```

Expected: dry run has no hard errors; real publication creates or updates only slug-verified project records and records target-specific IDs. If valid remote production configuration is explicitly present and selected, use matching `--remote` on both commands; do not silently switch targets.

- [ ] **Step 7: Final destination and workspace audit**

Run `pnpm ingest status`, repeat publication dry run to confirm stable updates, query the destination projects by slug, and inspect `git status --short`. Report per-project artifact and publication results, exact target, tests, remaining review flags, external blockers, and all changed tracked files.

- [ ] **Step 8: Suggest a conventional commit message**

`feat: complete audited portfolio ingestion pipeline`
