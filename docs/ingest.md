# Portfolio ingest pipeline

Prepares portfolio projects for entry: scans GitHub, generates write-ups with
tech tags using Claude, and captures correctly-sized screenshots of the deployed
sites with alt text.

**The pipeline produces files, not database rows.** Everything lands in the
gitignored `ingest/work/<slug>/`, and each project gets an `ENTER-ME.md`
checklist you follow to paste it into the Payload admin. No stage touches a
database unless you explicitly run the optional `publish` command.

```text
discover ──▶ analyze ──▶ writeup ──▶ shots ──▶ ENTER-ME.md ──▶ you, in /admin
   │            │   ▲       │          │
manifest    context.md      │      shots/*.png
                    │    writeup.md  shots.json
                    │    case-study.json
             ingest/notes/<slug>.md
             (optional, hand-written)
```

## Requirements

| Need                                    | Why                                             |
| --------------------------------------- | ----------------------------------------------- |
| `gh auth login`                         | `discover` and `analyze` read repos via the API |
| `CLAUDE_API_KEY` in .env                | `writeup` and screenshot alt text               |
| `pnpm exec playwright install chromium` | `shots`                                         |
| `DATABASE_URI`, `R2_*`                  | the optional `publish` command only             |

## Quick start

```bash
pnpm ingest discover                     # scan your GitHub account
$EDITOR ingest/manifest.json             # set titles, unskip what you want
pnpm ingest analyze
pnpm ingest notes                        # optional; then fill the files in
pnpm ingest writeup
pnpm ingest shots
```

Then, per project, open `ingest/work/<slug>/ENTER-ME.md` and work through it in
the admin panel. It lists every field value (including `slug` and case-study
fields), points at the write-up to paste into `description_markdown`, names which
PNG to use as the thumbnail, and gives each image's alt text on its own line.
Case-study values that the model was unsure about are listed under
**Needs review**.

Technologies stay automated: after saving the project, click the existing
**Extract Technologies** button and it reads the markdown you just pasted,
creates any missing technology records, and links them. On geobeermap that was
23 technologies with no manual entry.

The sheet is rewritten automatically whenever `writeup` or `shots` runs. Run
`pnpm ingest sheet` yourself after hand-editing the manifest, so the field values
on the sheet match what you changed.

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
}
```

`stages` timestamps are what make the pipeline resumable — a stage skips
entries it has already completed. Pass `--force` to redo one.

Entries also grow a `publishedTo` map if you ever use the optional
[`publish` command](#the-optional-publish-command); the manual workflow never
writes it.

Editing `title` changes both the project title and the screenshot filenames, so
set the real titles before running `shots`. Re-run `pnpm ingest sheet` after any
manifest edit to refresh the checklists.

## Background notes

`analyze` can only report what it can see: files in a repo, and HTML served by a
live site. For client work with no public repo — WordPress builds especially —
that's a description of the finished site and nothing about your work on it.

`ingest/notes/<slug>.md` is where you supply the rest.

```bash
pnpm ingest notes                    # scaffold files for every active entry
pnpm ingest notes entity-inc         # or just one
$EDITOR ingest/notes/entity-inc.md
pnpm ingest writeup --force entity-inc
```

Each scaffold is a short list of prompts — what the project was, what you built,
what was hard, anything measurable, anything to keep out. Answer them in prose,
bullets, or fragments; delete the ones that don't apply. `notes` never
overwrites a file that already exists, so re-running it is safe.

The notes are placed at the **top** of the briefing and marked as authoritative,
so where they contradict the scraped evidence, they win. A leading `# Title`,
the HTML comments, and any prompts you left unanswered are stripped before
sending. Leave a file untouched and it's ignored entirely.

`writeup` re-reads the notes each run rather than using the copy captured in
`context.json`, so editing them takes effect without re-running `analyze` —
just `pnpm ingest writeup --force <slug>`.

Unlike `work/`, `ingest/notes/` is **tracked in git**. Everything in `work/` can
be regenerated; your notes can't.

### Repos with no deployed site

`discover` adds repos without a homepage URL as `skip: true`, because there is
nothing to screenshot. To include one, set `skip: false` and either add a
`liveUrl` or leave it off — you'll get a write-up and a checklist with no
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
performed. Writes `context.json` and the human-readable `context.md`, folding in
`ingest/notes/<slug>.md` when one exists.

**`notes`** — scaffolds `ingest/notes/<slug>.md` for entries that don't have one.
See [Background notes](#background-notes).

**`writeup`** — sends the context briefing to Claude twice:

1. With `ai/project.summary-instructions.md` → `writeup.md` (technical
   `description_markdown`, including `<span class="tech" data-tag="...">` tags).
2. With `ai/project.case-study-instructions.md` → `case-study.json` (structured
   `clientName`, `businessChallenge`, `contributionHighlights`, `outcomes`,
   `status`, plus a `needsReview` list).

Edit either file freely before pasting into admin; the checklist always points
at the current files. `--force` regenerates both. If case-study generation
fails, a stub sidecar with every field flagged for review is written so the
write-up stage can still succeed.

**`shots`** — renders each target at a 1280×720 viewport with a 2× device scale
factor, producing 2560×1440 PNGs that match your existing media. Before each
capture it dismisses cookie/consent overlays, scrolls the full page to trigger
lazy-loaded imagery, returns to the top, disables animations, and waits for
fonts. Alt text is generated per image by Claude vision (`--no-alt` to skip).

Targets come from `screenshots` in the manifest when set; otherwise the homepage
plus same-origin nav routes discovered during `analyze`, capped at `maxShots`
(default 5). Pages behind a login can't be captured — pin public URLs instead.

**`sheet`** — regenerates `ENTER-ME.md` from whatever the other stages have
produced. `writeup` and `shots` call it automatically; run it directly after
editing the manifest so the field values on the sheet stay accurate.

**`status`** — stage matrix for every entry. The `ready` column means the
`ENTER-ME.md` checklist exists; whether you've actually typed a project into the
admin panel is something only you know, so the pipeline doesn't guess.

## Manual entry, step by step

For each project, open `ingest/work/<slug>/ENTER-ME.md` and follow it against
`/admin/collections/projects/create`:

1. **Fields** — the sheet lists `title`, `slug`, the three links, and the
   `display` values as a table. Copy them across. `slug` is required and unique.
2. **Case study** — copy from `case-study.json` / the sheet section into
   `clientName`, `businessChallenge`, `contributionHighlights`, `outcomes`, and
   `status`. Fill anything listed under **Needs review** yourself. (Testimonials
   are not wired yet.)
3. **description_markdown** — paste the whole of `writeup.md`. Leave the
   rich-text `description` field empty; your existing projects use
   `description_markdown` only. The sheet includes a one-line `xclip`/`pbcopy`
   command if you'd rather not open the file.
4. **Media** — upload the PNGs from `shots/`. Each one needs `alt` text, and the
   sheet prints it on its own line under the matching filename. Set `thumbnail`
   to the first image and add all of them to `images`.
5. **Save**, then click **Extract Technologies**. Nothing to type — it parses
   the markdown you just pasted, creates missing technology records, and links
   them to the project.

Leave `display.hide` ticked while you review, then untick it to go live.

## The optional `publish` command

`publish` does all of the above automatically against whatever database
`DATABASE_URI` points at. **It is not part of the normal workflow** — the
copy-paste route above is the intended one, and this exists for the day you want
to batch a large number of projects and are comfortable pointing the script at a
real database.

If you do use it, note:

- It prints its target database before doing anything, and `--dry-run` reports
  without writing.
- It maps manifest `slug` onto the Project `slug`, and maps `case-study.json`
  into the case-study fields when present. A missing sidecar still publishes
  the write-up, links, and media (with a warning).
- Projects are created with `display.hide` set unless you pass `--visible`.
- `publishedTo` in the manifest is keyed by database (`host:port/name`), so a
  project ID recorded against dev is never used to update a row in prod, and
  `status` notes which databases an entry has been published to.
- An inline `DATABASE_URI=… pnpm ingest publish` overrides `.env`, since dotenv
  doesn't overwrite variables that are already set.

Flags: `--dry-run`, `--visible`, `--no-tech` (skip technology extraction).

### Why not export/import

Moving projects between databases via `@payloadcms/plugin-import-export` doesn't
work well here, because projects are mostly _relationships_: `images` points at
`media` IDs and `metadata.technologies` points at `technologies` IDs. Those IDs
are per-database, and the media rows and technology records don't exist in the
target instance at all — so an imported project arrives with broken image and
technology links to repair by hand.

Entering a project through the admin panel avoids this completely: uploading an
image creates the media row, and **Extract Technologies** creates and links the
technology records, all against the database you're actually looking at.

## Costs and models

`writeup` and alt text call the Anthropic API with `claude-opus-5` — one
write-up request per project at `high` effort, and one small vision request per
screenshot at `low` effort. `--no-alt` and reviewing before re-running `--force`
are the main levers if you're batching a lot of projects at once.

## Working files

`ingest/work/` is gitignored — everything in it is regenerable.
`ingest/manifest.json`, `ingest/urls.txt`, and `ingest/notes/` are tracked, so
the record of what you've ingested, and everything you wrote by hand, lives in
the repo.
