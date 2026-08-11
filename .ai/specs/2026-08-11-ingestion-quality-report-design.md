# Ingestion Quality Report Design

## Goal

Keep ingestion and publication advisory while recording durable, actionable quality warnings for every configured portfolio project.

## Scope

The ingestion pipeline will gain a `quality` command that writes `ingest/quality-report.json`. The report will be regenerated from current artifacts and will contain a timestamp, portfolio-wide counts, and each project’s warnings. Warnings never prevent ingestion, status reporting, or publication.

`ingest status` will continue to mean that an entry is ready for manual entry. It will surface the quality-report location and warning count when a current report is available; it will not redefine “ready” as publication approval.

## Quality signals

Each warning has a stable machine-readable code, a plain-language message, and remediation guidance. The initial rules are:

- `case-study-needs-review`: a case-study sidecar lists one or more fields in `needsReview`.
- `unverified-authorship`: a case study contains contribution or outcome claims but its gathered context has neither developer notes nor a repository assessment.
- `summary-length`: a case-study summary is shorter than 20 or longer than 45 words.
- `generic-screenshot-alt`: a screenshot uses the fallback `${title} — ${label}` alt text.
- `screenshot-capture-issue`: capture detected a cookie-consent prompt or a known page-error overlay.

The report will also warn when an expected completed-stage artifact is absent or invalid, rather than throwing and abandoning the entire quality run. This makes it useful for auditing a partly completed portfolio.

## Data flow and artifact ownership

Screenshot captures will preserve capture issues in `shots.json` with each screenshot or target. Existing screenshot metadata stays compatible; the additional field is optional so older artifacts remain readable.

The quality command reads the manifest, context, case-study sidecar, and screenshot artifact. It does not call external services, edit project source data, mutate case-study review fields, or recapture screenshots. It overwrites the one current `ingest/quality-report.json` snapshot so the file remains the straightforward reference point for the latest audit.

The dependency graph will be corrected to match real inputs: screenshot capture must not invalidate a completed writeup or case study. Changing a writeup still invalidates its case study; changing analysis, assessment, or developer notes retains their current downstream invalidation behavior.

Case-study summary generation will preserve a valid model summary and only use a writeup-derived fallback when the generated summary is missing or invalid. The fallback will be trimmed to the 20–45 word contract and marked for review.

## Capture behavior

The screenshot command will attempt to dismiss standard consent prompts before capture. It will inspect the captured page state for visible consent and common error text. Detection records a warning; it does not fail the capture. A failed vision-alt request likewise falls back to deterministic alt text and records a warning rather than aborting the whole screenshot stage.

## Verification

Regression tests will cover stage invalidation, report contents and persistence, warning rules, valid summary preservation and fallback behavior, capture issue recording, and AI-alt fallback error handling. The full integration suite will run after the changes. The complete nine-project pipeline will then be refreshed and audited; its generated report will be reviewed before any claim about publication quality.

## Non-goals

This work does not automatically rewrite editorial claims, publish content, make warnings blocking, introduce external storage, or guarantee a screenshot has no visual defects beyond the defined consent/error checks.
