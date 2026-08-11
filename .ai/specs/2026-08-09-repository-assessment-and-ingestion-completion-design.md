# Repository Assessment and Ingestion Completion Design

## Objective

Complete the project-ingestion pipeline so it can regenerate every eligible portfolio project autonomously without sending a large repository dump to case-study generation, accepting unsupported repository claims, or reporting truncated AI output as success.

The finished pipeline must produce reviewable artifacts, fail loudly and resumably, preserve a previous valid artifact when regeneration fails, and publish every project whose required external inputs are available.

## Scope

This change includes:

- A separate AI repository-assessment stage and `repo-assessment.json` artifact.
- Source-backed structured findings validated against files gathered by `analyze`.
- Compact case-study input assembled from the assessment, completed writeup, notes, and site/project metadata.
- Strict AI completion and structured-output validation.
- Atomic replacement of AI-generated artifacts and truthful stage state.
- Stage fingerprints and downstream invalidation for the assessment and case study.
- CLI, status, documentation, and tests for the new stage and failure semantics.
- A complete forced pipeline run for every eligible manifest project, followed by publication and an outcome audit.

This change does not attempt to infer private business outcomes, invent metrics, crawl arbitrary files outside the existing bounded repository scan, or make unsupported editorial claims appear certain.

## Chosen Architecture

The pipeline becomes:

`discover -> analyze -> assess -> writeup -> case study -> shots -> publish`

`analyze` remains the deterministic evidence-gathering boundary. It collects bounded GitHub metadata, repository paths and selected file contents, authored notes, and live-site observations into the existing raw context artifacts.

`assess` is a separate AI stage. It interprets only the evidence gathered by `analyze` and writes a compact, structured `repo-assessment.json`. Separating assessment from generation makes the interpretation independently inspectable, cacheable, retryable, and testable.

The existing `writeup` command continues to generate the narrative writeup from the richer context. Case-study generation no longer receives rendered raw repository files. It receives the validated repository assessment, completed writeup, authored notes, and compact project/site metadata.

The CLI exposes `assess` as an explicit resumable command. The `writeup` command generates the writeup and case study as two independently validated outputs. If the case study requires a repository assessment and none is valid, it reports that prerequisite instead of silently substituting raw context. Projects without a repository use an explicit no-repository assessment state and may still generate from notes and site evidence.

## Repository Assessment Contract

`repo-assessment.json` contains:

- Artifact version, project slug, repository identity, generation timestamp, and analysis fingerprint.
- A concise project-purpose assessment.
- Architecture and implementation findings.
- Notable technical decisions and capabilities.
- Delivery, deployment, testing, and maintenance observations when evidenced.
- Technology signals.
- Explicit unknowns and limitations.
- Confidence for each finding.
- Evidence references for every substantive repository claim.

Each evidence reference names a source path present in the analyzed repository context and may include a short supporting excerpt or rationale. A deterministic validator rejects unknown paths, empty evidence, malformed confidence values, and substantive findings without evidence. Repository metadata may support narrowly scoped metadata claims but cannot substitute for a file path on implementation claims.

The assessment prompt instructs the model to omit unsupported conclusions and place unresolved questions in `unknowns`. This artifact is evidence synthesis, not marketing copy.

For projects without an accessible repository, the stage writes a valid explicit assessment with status `unavailable`, a reason, no repository findings, and suitable unknowns. This avoids blocking site-only projects while making the evidence limitation visible downstream.

## AI Boundary and Failure Semantics

All structured AI calls pass through one strict boundary that returns both response metadata and parsed content. Success requires:

1. A terminal completion reason accepted by the provider, normally `end_turn`.
2. A nonempty text block.
3. Valid JSON matching the expected schema.
4. Domain validation of references and required content.

`max_tokens`, refusal, tool-use, malformed JSON, schema violations, timeouts, and transport errors are hard stage failures. The failure includes the provider stop reason and a concise actionable message. Raw pathological model output is not dumped to normal logs.

Generation writes to a temporary sibling file, validates it, then atomically replaces the destination. A failed regeneration leaves a previous valid artifact intact but marks the attempted stage unsuccessful/stale; it never updates the stage completion timestamp or downstream fingerprint.

There is no successful fallback stub. Content that genuinely lacks evidence is represented explicitly through `unknowns`, `needsReview`, or the no-repository assessment state inside an otherwise valid artifact.

## Data Flow and Invalidation

Analysis records a fingerprint of the gathered evidence, including the selected repository file paths and contents, repository metadata, live-site evidence, and relevant manifest inputs. This fixes the current blind spot where repository changes can go unnoticed when the repository URL itself is unchanged.

Assessment input is fingerprinted from the validated analysis artifact and assessment contract version. A changed analysis invalidates assessment and case study.

Writeup input remains based on analysis, notes, screenshots where applicable, title, and prompt/contract version. A changed completed writeup invalidates case study.

Case-study input is fingerprinted from:

- Valid repository assessment or explicit unavailable state.
- Completed writeup.
- Authored notes.
- Compact site and project metadata.
- Case-study schema and prompt version.

Case-study generation never receives raw repository file bodies or the full repository tree. Fingerprint mismatches make artifacts visibly stale and prevent publication until regenerated, unless the affected output is genuinely optional by project type.

## Commands and Batch Operation

The CLI usage and status matrix add `assess`. Commands retain slug filtering and `--force` behavior.

The operational full run is:

1. Validate and inventory the manifest.
2. Force `analyze` for all eligible projects so repository evidence is current.
3. Force `assess` for all eligible projects.
4. Force `writeup` for all eligible projects, producing independently validated writeup and case study artifacts.
5. Force screenshots where a reachable live URL is available.
6. Run a publication dry run for the full eligible set.
7. Publish the full eligible set to the configured local CMS target, overwriting generated project fields and replacing screenshot relationships where the existing publication contract allows it.
8. Run status and destination audits and report per-project successes, skips, and irreducible external failures.

Batch commands continue independent projects after a per-project failure and exit nonzero if any hard failure occurred. A project cannot be marked complete or published with stale required artifacts.

## Publication Policy

The user authorizes overwriting existing generated project data. Generated writeup sections, summary, case-study fields, links represented by current ingest input, and current screenshot relationships may therefore replace their prior CMS values.

The pipeline still preserves fields omitted from the manifest under the established create/update semantics. It does not delete unrelated CMS records, media, authored notes, or repository data. Existing project resolution must verify identity by slug before update.

Publication happens only after a successful dry run against the same target. Remote production publication is not inferred: if the configured/default target is local, the completed run publishes locally and reports the exact target. A remote run requires usable remote configuration already present in the environment.

## Testing Strategy

Implementation follows red-green-refactor development.

Unit tests cover:

- Assessment schema and domain validation.
- Required source paths, invalid paths, confidence, unknowns, and no-repository state.
- Strict provider completion-reason handling.
- Invalid/truncated JSON and schema violations.
- Atomic preservation of previous valid artifacts after failed regeneration.
- Analysis, assessment, writeup, and case-study fingerprint/invalidation edges.
- Compact case-study prompt construction proving raw file bodies are absent.
- CLI flag recognition, status rendering, and prerequisite errors.

Integration tests cover successful repository-backed and site-only flows, failed assessment and failed case-study generation, partial batch failure, resumability, and publication refusal for stale artifacts. Existing ingest and application tests must remain green.

Before the live batch run, the implementation must pass the relevant focused tests, full test suite, lint, and TypeScript checks. After ingestion, artifact validators and CMS dry-run/status checks provide a final corpus-level audit.

## Success Criteria

The framework is complete when:

- Case-study generation receives no raw repository dump.
- Every repository claim in an assessment is traceable to analyzed evidence.
- Truncation and malformed structured output produce a nonzero failure and no false completion.
- Previous valid artifacts survive failed regeneration without being represented as fresh.
- Fingerprints detect current repository evidence changes and invalidate downstream output.
- All tests and static checks pass.
- Every eligible project has been processed as far as available repository, site, AI, and CMS access allow.
- The final report identifies the exact destination, per-project publication result, and any project blocked by an external condition rather than hiding it as success.

## Compatibility and Ownership

Existing raw `context.json` and `context.md` remain available for audit and writeup generation. Existing valid projects without repositories remain supported. Generated work stays ignored by Git; the design document, implementation plan, source changes, tests, and authored manifest inputs remain uncommitted and unstaged for user review.
