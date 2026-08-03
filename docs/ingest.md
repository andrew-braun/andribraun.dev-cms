# Portfolio ingest pipeline

Bulk-adds portfolio projects: scans GitHub, generates write-ups and tech tags
with Claude, captures correctly-sized screenshots of the deployed sites, and
publishes the result into Payload.

Every stage is independent, resumable, and writes to `ingest/work/<slug>/` for
review. **Nothing touches the database until `publish`**, and `publish` creates
projects hidden unless you pass `--visible`.

```text
discover ──▶ analyze ──▶ writeup ──▶ shots ──▶ [you review] ──▶ publish
   │            │           │          │                          │
manifest    context.md  writeup.md  shots/*.png              projects + media
                                    shots.json               + technologies
```

## Requirements

| Need                                    | Why                                             |
| --------------------------------------- | ----------------------------------------------- |
| `gh auth login`                         | `discover` and `analyze` read repos via the API |
| `CLAUDE_API_KEY` in .env                | `writeup` and screenshot alt text               |
| `pnpm exec playwright install chromium` | `shots`                                         |
| `DATABASE_URI`, `R2_*`                  | `publish` only                                  |

## Quick start

```bash
pnpm ingest discover                     # scan your GitHub account
$EDITOR ingest/manifest.json             # set titles, unskip what you want
pnpm ingest analyze
pnpm ingest writeup
pnpm ingest shots
$EDITOR ingest/work/<slug>/writeup.md    # review before anything hits the CMS
pnpm ingest publish <slug>
```

Run `pnpm ingest` with no arguments for the full command and flag reference.

Every stage accepts slugs to limit it to specific entries
(`pnpm ingest writeup geobeermap talkspark`). Naming a slug explicitly also
overrides that entry's `skip` flag, so you can process one skipped project
without editing the manifest.

## The manifest

`ingest/manifest.json` is the source of truth and is safe to hand-edit — it is
the thing you're expected to curate between stages. Re-running `discover` only
appends newly-seen repos and URLs; it never overwrites your edits.

```jsonc
{
  "slug": "geobeermap", // stable ID; names the work directory
  "title": "GeoBeerMap", // used in the project title and image filenames
  "repo": "andrew-braun/geobeermap", // owner/name — drives `analyze`
  "liveUrl": "https://geobeermap.com",
  "githubLink": "https://github.com/andrew-braun/geobeermap",
  "snapshotLink": "https://web.archive.org/...", // optional
  "skip": false, // stages ignore this entry when true
  "maxShots": 5,
  "screenshots": [
    // optional: pin exact capture targets
    { "label": "Map", "url": "/" },
    { "label": "Brewery Detail", "url": "/2-tons-mukhiani" },
  ],
  "featured": false,
  "order": 3,
  "cardType": "visual", // "visual" | "text"
  "stages": { "analyzedAt": "...", "writeupAt": "...", "shotsAt": "..." },
  "publishedTo": {
    // written by `publish`, keyed by database
    "localhost:5432/devsite": { "id": 2, "at": "..." },
    "db.example.com:5432/andribraun": { "id": 14, "at": "..." },
  },
}
```

`stages` timestamps are what make the pipeline resumable — a stage skips
entries it has already completed. Pass `--force` to redo one.

`publishedTo` records the Payload project ID per database, because IDs are
per-database. See [Running locally, publishing to production](#running-locally-publishing-to-production).

### Repos with no deployed site

`discover` adds repos without a homepage URL as `skip: true`, because there is
nothing to screenshot. To include one, set `skip: false` and either add a
`liveUrl` or leave it off — the project will publish with a write-up and no
images. Use `--all` to add everything unskipped instead.

## Stage notes

**`discover`** — lists your repos via `gh` and accepts deployed URLs
(`--urls=ingest/urls.txt`, or as positional arguments). A URL that matches a
repo's homepage is linked to that repo rather than duplicated, so a project can
be reached from either direction.

**`analyze`** — fetches repo metadata, the file tree, and the contents of the
files that reveal the stack (README, package manifests, framework configs, CI
workflows, schema files), then probes the live site for its title, meta
description, framework fingerprints, and navigation links. No clone is
performed. Writes `context.json` and the human-readable `context.md`.

**`writeup`** — sends `context.md` to Claude with
`ai/project.summary-instructions.md` as the system prompt, so the output follows
your existing format, including the `<span class="tech" data-tag="...">` tags.
The result lands in `writeup.md` as plain markdown — edit it freely; `publish`
reads whatever the file contains at publish time.

**`shots`** — renders each target at a 1280×720 viewport with a 2× device scale
factor, producing 2560×1440 PNGs that match your existing media. Before each
capture it dismisses cookie/consent overlays, scrolls the full page to trigger
lazy-loaded imagery, returns to the top, disables animations, and waits for
fonts. Alt text is generated per image by Claude vision (`--no-alt` to skip).

Targets come from `screenshots` in the manifest when set; otherwise the homepage
plus same-origin nav routes discovered during `analyze`, capped at `maxShots`
(default 5). Pages behind a login can't be captured — pin public URLs instead.

**`publish`** — uploads each PNG to the `media` collection with its alt text,
creates or updates the project, then runs the existing
`extractTechnologiesFromProject` service to create and link `technologies`
records. It prints the target database first, and re-running against that same
database updates the recorded project rather than creating a duplicate — though
it does upload a fresh set of images each time.

Flags: `--dry-run` (report only), `--visible` (skip the hidden default),
`--no-tech` (skip technology extraction).

## Running locally, publishing to production

**You don't need export/import.** Only `publish` touches a database — `discover`,
`analyze`, `writeup`, `shots`, and `status` work entirely on local files. So the
expensive, reviewable work happens locally, and you point only the final step at
production:

```bash
pnpm ingest analyze && pnpm ingest writeup && pnpm ingest shots   # no DB at all
# ...review ingest/work/<slug>/writeup.md and the PNGs...
DATABASE_URI="postgresql://…prod…" pnpm ingest publish geobeermap
```

An inline `DATABASE_URI` wins over the one in `.env` (dotenv does not overwrite
variables that are already set), so nothing needs editing to switch targets.

Two details make this safe:

- **`publishedTo` is keyed by database** (`host:port/name`). Publishing to dev
  records the dev project ID under the dev key; publishing to prod creates a
  _separate_ project there. A dev ID is never used to update a prod row.
- **`publish` prints its target first**, and `status` shows the publish column
  for the current target plus an `also in …` note for any other database an
  entry has been published to.

### Why not export/import

The `@payloadcms/plugin-import-export` route is available in the admin panel,
but it works poorly for this pipeline because projects are mostly
_relationships_: `images` points at `media` IDs and `metadata.technologies`
points at `technologies` IDs. Those IDs are per-database, and the media rows and
technology records wouldn't exist in the target instance at all — so an
imported project would arrive with broken image and technology links that you'd
have to repair by hand.

Publishing directly sidesteps this: `publish` creates the media rows and runs
technology extraction against the target database, so every relationship is
correct by construction. It also uploads to the same R2 bucket either way,
since `R2_BUCKET_NAME` is shared.

Export/import is still the right tool for a one-off backup or for moving
already-correct data between two instances that share IDs — just not for
promoting freshly ingested projects.

## Costs and models

`writeup` and alt text call the Anthropic API with `claude-opus-5` — one
write-up request per project at `high` effort, and one small vision request per
screenshot at `low` effort. `--no-alt` and reviewing before re-running `--force`
are the main levers if you're batching a lot of projects at once.

## Working files

`ingest/work/` is gitignored. `ingest/manifest.json` and `ingest/urls.txt` are
tracked, so the record of what you've ingested lives in the repo.
