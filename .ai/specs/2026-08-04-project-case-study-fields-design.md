# Project case-study fields — design

**Date:** 2026-08-04  
**Status:** Approved — implementation plan at `.ai/plans/2026-08-04-project-case-study-fields.md`  
**Scope:** Payload `projects` schema + ingest pipeline updates so case-study pages can show client, challenge, contribution, outcomes, and status alongside the existing technical write-up.

## Goal

Extend the Project collection with structured case-study fields driven primarily by AI during ingest, with human review for gaps via `ENTER-ME.md`. Keep the existing technical `description_markdown` write-up as-is. Defer testimonials (no collection / relationship in this pass).

## Non-goals

- Testimonials collection or Project → Testimonials relationship (add later).
- Changing the technical write-up structure (intro → tech stack → implementation → outcome).
- Frontend / portfolio site rendering of these fields.
- Manifest overrides for case-study values (v1 is sidecar + manual admin fixes).

## Decisions

| Topic                      | Choice                                                         |
| -------------------------- | -------------------------------------------------------------- |
| Testimonials               | Skip for now                                                   |
| Who fills new fields       | AI-first; humans fill gaps                                     |
| Review flagging            | Extend `ENTER-ME.md` checklist                                 |
| `businessChallenge` format | Markdown `code` field (same pattern as `description_markdown`) |
| Long-form body             | Keep current technical write-up; new fields are additional     |
| AI packaging               | Sidecar JSON next to `writeup.md`                              |

## Schema

Edit `src/collections/Projects.ts`. Place new fields in a “case study” group/collapsible near the top (after title/`slug`, before long-form description).

| Field                    | Payload type                         | Constraints      | Notes                                                                                                   |
| ------------------------ | ------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------- |
| `slug`                   | `text`                               | required, unique | Route segment. Ingest maps from existing manifest `slug` (not AI-generated).                            |
| `clientName`             | `text`                               | optional         | Short client/product label.                                                                             |
| `businessChallenge`      | `code`, `admin.language: 'markdown'` | optional         | Concise challenge copy.                                                                                 |
| `contributionHighlights` | `array`                              | optional         | Rows: `{ statement: text }` (plain text, short).                                                        |
| `outcomes`               | `array`                              | optional         | Rows: `{ statement: text`, `metric?: text }`. Statement required per row when present; metric optional. |
| `status`                 | `select`                             | optional         | Options: `live`, `ongoing`, `completed`, `archived`.                                                    |

Unchanged:

- `description_markdown` — primary long-form technical body (ingest continues to fill from `writeup.md`).
- `description` (Lexical) — left unused by ingest, as today.
- Links, media, display, `metadata.technologies`.

After schema change: create Payload migration, run `generate:types`.

### Existing projects

`slug` is required and unique. Migration / backfill strategy for already-published projects:

- Prefer deriving a unique slug from title (slugify) when publishing/updating via ingest.
- For rows already in the DB with no slug: migration should either (a) backfill from slugified title with collision suffixes, or (b) allow temporary null only if Payload/Postgres constraints force a two-step migrate — prefer (a) so the schema can ship `required` + `unique` cleanly.

## Ingestion architecture

File-first pipeline unchanged. New artifact: `ingest/work/<slug>/case-study.json`.

```
notes / context
  → writeup.md          (unchanged technical body)
  → case-study.json     (new AI artifact)
  → ENTER-ME.md         (flags needsReview / missing fields)
  → publish             (maps writeup + sidecar + manifest.slug → Payload)
```

### Sidecar shape

```json
{
  "clientName": "WhereNext.ai",
  "businessChallenge": "Travel planning is fragmented...",
  "contributionHighlights": [{ "statement": "..." }],
  "outcomes": [{ "statement": "End-to-end experience", "metric": "From idea to live product" }],
  "status": "live",
  "needsReview": ["status"]
}
```

Rules:

- Omit or null unknown values; list them in `needsReview`.
- Do not include `slug` in the sidecar — always from `manifest` entry `slug`.
- Valid `status` values only: `live` | `ongoing` | `completed` | `archived`.

### Stages

**writeup (extended)**  
Same CLI command; second artifact in the same stage:

1. Generate `writeup.md` as today (`generateWriteup`).
2. Second Claude call with the same context briefing + a dedicated case-study system prompt and `outputSchema` (same structured-output pattern as alt text / tech extraction).
3. Write `case-study.json`.
4. On parse failure or empty payload: write a stub with empty fields and `needsReview` listing every case-study field (`clientName`, `businessChallenge`, `contributionHighlights`, `outcomes`, `status`), log a warning, do **not** fail the writeup stage if `writeup.md` succeeded.

Stage tracking: reuse `stages.writeupAt` for both artifacts. `--force` regenerates both.

**sheet**  
`ENTER-ME.md` gains a Case Study section that:

- Shows proposed sidecar values (for copy/paste into admin).
- Calls out `needsReview` and any missing fields.
- Reminds that `slug` comes from the manifest / publish mapping.

**publish**  
Extend `buildProjectData` in `scripts/ingest/commands/publish.ts`:

| Project field                                                                     | Source                         |
| --------------------------------------------------------------------------------- | ------------------------------ |
| `slug`                                                                            | `entry.slug`                   |
| `description_markdown`                                                            | `writeup.md` (unchanged)       |
| `clientName`, `businessChallenge`, `contributionHighlights`, `outcomes`, `status` | `case-study.json` when present |
| existing fields                                                                   | unchanged                      |

If sidecar is missing: publish still writes existing fields + `slug`; sheet (and logs) treat case-study fields as needs-review. Invalid `status` → omit and treat as needs-review.

### Prompt guidance (case-study)

New instructions file under `ai/` (e.g. `ai/project.case-study-instructions.md`):

- Prefer developer notes over scraped evidence when they conflict.
- Do not invent client names, metrics, or “live” status without evidence (`liveUrl`, notes, README, site).
- `contributionHighlights`: typically 2–4 short statements.
- `outcomes`: typically 2–4 rows; omit `metric` when unknown.
- Put uncertain fields in `needsReview`.

### Supporting file updates

| File                                    | Change                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `scripts/ingest/lib/ai.ts`              | `generateCaseStudy()` using `outputSchema` + `parseJsonFromResponse`   |
| `scripts/ingest/commands/writeup.ts`    | Write sidecar after writeup                                            |
| `scripts/ingest/lib/sheet.ts`           | Case study + needs-review section                                      |
| `scripts/ingest/commands/publish.ts`    | Map sidecar + `slug`                                                   |
| `scripts/ingest/lib/paths.ts`           | Path helper for `case-study.json`                                      |
| `scripts/ingest/lib/types.ts`           | Type for sidecar payload (optional manifest fields not required in v1) |
| `docs/ingest.md`                        | Document sidecar, fields, review flow                                  |
| `ai/project.case-study-instructions.md` | New prompt                                                             |

## Error handling

| Failure                            | Behavior                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Case-study AI empty / invalid JSON | Stub sidecar + `needsReview` for all case-study fields; warn; writeup stage still succeeds if markdown ok |
| Invalid `status` enum              | Drop status; add to needs-review                                                                          |
| Missing sidecar at publish         | Publish without case-study fields (except `slug`); warn                                                   |
| Duplicate `slug` on create         | Surface Payload unique constraint error clearly                                                           |

## Verification

- `generate:types` / TypeScript check after schema change.
- Migration applies cleanly (including slug backfill for existing rows if any).
- Spot-check one ingest slug: writeup produces both artifacts → sheet lists case-study + needsReview → `buildProjectData` includes new fields.
- No requirement for full DB publish in CI for this change.

## Out of scope follow-ups

- Testimonials collection + Project relationship.
- Manifest-level overrides for case-study fields.
- Retargeting `description_markdown` to a product narrative.
- Frontend consumption of the new fields.
