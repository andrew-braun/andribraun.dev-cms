# Ingest Pipeline Safety and Reliability Design

## Objective

Harden the local project-ingestion pipeline against destructive filesystem writes, accidental CMS field resets, stale generated content, misleading success states, and unbounded external operations. Preserve the existing staged `projectData` changes and leave API-key authorization unchanged because this workflow runs in a trusted local environment.

This is Batch 1 of three planned improvements:

1. Pipeline safety and reliability.
2. Output-quality validation and editorial controls.
3. Repository, deployment, and CI tooling.

## Scope

Batch 1 includes:

- Strict validation of manifest entries, slugs, nullable fields, URLs, and generated filenames.
- Contained path resolution for every ingest artifact.
- Strict CLI boolean parsing.
- Distinct CMS create and update payload semantics.
- Declarative clearing through explicit `null` manifest values.
- Atomic manifest and generated-artifact writes.
- Dependency-specific invalidation of stale generated artifacts.
- Transactional local screenshot replacement.
- CMS project resolution that verifies identity by slug before updating.
- Consistent nonzero exit codes for command and per-entry failures.
- Bounded external-operation timeouts and retries for idempotent reads only.
- A `.gitignore` correction that tracks authored ingest inputs and ignores generated work.
- Tests and documentation for all changed behavior.

Batch 1 excludes CMS media deduplication and orphan cleanup, cross-resource CMS transactions, API-key access-control changes, output-quality gates, and CI/deployment repairs.

## Architecture

The command-stage structure remains intact. Mutable operations pass through four focused boundaries:

### Validation

The validation boundary parses and validates the complete manifest and selected CLI arguments before a command performs writes. It owns:

- Manifest structure and duplicate-slug checks.
- A conservative slug format suitable for directory names and CMS identifiers.
- Optional, nullable, and required field semantics.
- `http` and `https` URL validation.
- Redirect destination revalidation and rejection of loopback, link-local, and private-network destinations for fetched site and screenshot URLs.
- Screenshot filename validation as a basename contained within the entry's screenshot directory.
- Strict boolean and numeric CLI values.

Validation errors identify the entry and field, stop the command before writes begin, and produce a nonzero exit code.

### Artifacts

The artifact boundary owns all ingest paths and generated-file lifecycle operations. Paths are resolved against explicit roots and rejected unless they remain contained within those roots.

JSON and generated text writes use a temporary sibling file followed by an atomic rename. Stage timestamps are written only after their corresponding artifacts have been validated and committed. Authored manifest data and notes are never deleted by invalidation.

### Project Data

Project publication exposes separate create and update builders:

- Create payloads apply safe defaults, including hidden visibility when no explicit value is supplied.
- Update payloads include only fields explicitly represented by the current ingest input.
- An omitted field preserves the existing CMS value.
- A concrete value replaces the existing CMS value.
- Explicit `null` clears a nullable CMS field.

This contract applies to links, media relationships, ordering, and optional display settings where clearing is meaningful. It prevents routine republishing from hiding a live project or resetting manually curated card type, featured state, ordering, links, or media.

### Project Resolution

The destination project is resolved by slug before media uploads or project writes. A manifest `publishedTo` ID is only a lookup hint and must be verified to belong to the same slug. A stale or missing recorded ID falls back to slug lookup; an identity mismatch is a hard failure rather than permission to update another project.

## Data Flow

Each mutating stage follows the same flow:

1. Load and fully validate the manifest and command arguments.
2. Select entries and determine input changes.
3. Delete only generated artifacts made stale by those changes and clear their stage timestamps.
4. Generate new output into a temporary sibling location.
5. Validate the completed output.
6. Atomically replace the previous output.
7. Record the stage timestamp last.

Publication follows this flow:

1. Verify required artifacts and their stage state.
2. Resolve the destination project by slug and verify any recorded ID.
3. Upload the current nonempty screenshot set when one exists.
4. Build either a create payload or an update patch.
5. Create or update the project.
6. Atomically record the confirmed project ID and publication timestamp.
7. Run supplementary technology extraction unless disabled.

Technology extraction failure is reported as a warning after a successful project write because it is independently rerunnable. It does not make the already-completed project write appear to have failed.

## Manifest Semantics

Nullable publishable fields distinguish three intentions:

| Manifest state  | Create behavior                                               | Update behavior        |
| --------------- | ------------------------------------------------------------- | ---------------------- |
| Omitted         | Apply a documented safe default when required; otherwise omit | Preserve the CMS value |
| Concrete value  | Set the value                                                 | Replace the CMS value  |
| Explicit `null` | Leave nullable field empty                                    | Clear the CMS value    |

Documentation will show concrete clearing examples such as `"liveUrl": null`. Runtime validation rejects `null` for fields that cannot meaningfully be cleared.

## Dependency-Based Invalidation

Invalidation removes generated downstream artifacts and clears their stage timestamps. It does not preserve or publish stale output.

- Changing `liveUrl` invalidates site analysis, screenshots, write-up, and case study.
- Changing `githubLink` invalidates repository analysis, write-up, and case study, but not screenshots.
- Changing explicit screenshot sources invalidates screenshots, write-up, and case study.
- Changing authored notes invalidates write-up and case study only.
- Changing `snapshotLink`, ordering, display settings, or publication-only metadata invalidates no generated artifacts.
- Completing a new analysis or screenshot run invalidates the write-up and case study derived from previous inputs.

Input snapshots or fingerprints will be stored with stage metadata so hand-edited manifest and notes changes can be detected deterministically. Detection does not trigger expensive automatic regeneration; the affected stage must be rerun.

## Screenshot Replacement

A screenshot run captures into a temporary sibling directory and writes a temporary screenshot manifest. The replacement is accepted only when all selected captures are valid, every manifest filename is contained and exists, and at least one screenshot was produced.

If capture fails, the temporary output is removed and the previous valid screenshot set remains untouched. If capture succeeds, the new directory and manifest replace the old local set as one committed operation as closely as the filesystem permits. CMS media deletion is outside this batch.

## CLI and Failure Semantics

Boolean flags support all of these forms:

- `--visible`
- `--visible=true`
- `--visible=false`

Values other than `true` or `false` are rejected. Bare flags retain their documented meaning. Numeric flags reject missing, non-finite, and out-of-range values instead of silently becoming absent.

Commands may continue processing independent entries after an entry fails. Any hard failure makes the overall process exit nonzero. Unknown commands, invalid flags, missing required artifacts, unsafe paths, unresolved project identity, and failed required stages are hard failures. A failed publication never updates `publishedTo`.

The CLI owns final process termination so nested commands do not call `process.exit` unexpectedly. This ensures errors survive the Payload command wrapper and resources can be closed cleanly.

## External Operations

Site requests, GitHub subprocesses, CMS requests, and AI calls receive explicit time limits with actionable timeout errors. Automatic retries are limited to idempotent reads and use a small bounded backoff. Uploads, creates, updates, and deletes are never retried automatically without an idempotency mechanism.

Fetched site and screenshot URLs are checked before the request and after redirects. Only `http` and `https` are accepted, and local or private-network destinations are rejected.

## Version-Control Hygiene

The repository will track authored ingest inputs, including the manifest, URL definitions, and notes. Only generated work under `ingest/work/` will be ignored. Documentation and `.gitignore` will agree on this boundary.

## Testing Strategy

All behavior changes use red-green-refactor development.

- Unit tests cover strict booleans and numbers, manifest validation, duplicate and malformed slugs, nullable fields, contained paths, URL safety, screenshot filenames, payload create/update behavior, declarative clearing, and invalidation rules.
- Temporary-directory tests prove atomic artifact writes and screenshot replacement behavior, including preservation after failed capture.
- Backend contract tests prove omitted update fields remain unchanged and explicit `null` values clear fields consistently across local and remote adapters.
- Project-resolution tests cover valid recorded IDs, stale IDs, slug adoption, mismatches, and target separation.
- Transport tests cover timeouts, status errors, redirect validation, and read-only retries.
- Subprocess tests assert nonzero exit codes for unknown commands, malformed flags, missing credentials or artifacts, and partial batch failure.
- Existing ingest unit and integration tests remain green, including the staged `projectData` regression tests.

## Compatibility

Existing valid manifests and documented bare CLI flags continue to work. Manifests containing unsafe slugs, paths, unsupported URL schemes, duplicate entries, or invalid types fail early with actionable errors. Update publication becomes intentionally less destructive: omitted fields preserve CMS state rather than receiving create-time defaults.

No production files are committed or staged by the agent. The existing staged user changes remain staged and are incorporated as the baseline for implementation.
