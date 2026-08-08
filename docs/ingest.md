# Portfolio ingest pipeline

Prepares portfolio projects for entry: scans GitHub, generates write-ups with
tech tags using Claude, and captures correctly-sized screenshots of the deployed
sites with alt text.

**The generating stages produce files, not database rows.** Everything lands in
the gitignored `ingest/work/<slug>/`, and each project gets an `ENTER-ME.md`
checklist you can follow by hand. Nothing reaches a CMS until you run
[`publish`](#the-publish-command), which sends it to a local database or
straight to production over the REST API.

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
| `DATABASE_URI`, `R2_*`                  | `publish` against a local database              |
| `PAYLOAD_REMOTE_URL`, `PAYLOAD_API_KEY` | `publish --remote` and the `remote` command     |

## Quick start

```bash
pnpm ingest discover                     # scan your GitHub account
$EDITOR ingest/manifest.json             # set titles, unskip what you want
pnpm ingest analyze
pnpm ingest notes                        # optional; then fill the files in
pnpm ingest writeup
pnpm ingest shots
pnpm ingest publish --remote             # straight to production, hidden
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

Entries also grow a `publishedTo` map once you use the
[`publish` command](#the-publish-command); the manual workflow never writes it.

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
   `summary`, `client_name`, `business_challenge`, `contribution_highlights`,
   `outcomes`, `status`, plus a `needsReview` list).

`summary` is the short card blurb, kept free of `<span class="tech">` tags —
only `description_markdown` feeds technology extraction. When the model omits
it, the write-up's opening paragraph is used instead (spans stripped), and
`summary` stays on the `needsReview` list so you give it a second look.

Edit either file freely before pasting into admin; the checklist always points
at the current files. `--force` regenerates both. If case-study generation
fails, a stub sidecar with every field flagged for review is written so the
write-up stage can still succeed.

### Description sections

`writeup.md` always follows the same four-section shape, so `publish` also
splits it into one field per section and stores each alongside the whole
document:

| Field                     | From `writeup.md`               |
| ------------------------- | ------------------------------- |
| `intro_markdown`          | everything above the first `##` |
| `tech_stack_markdown`     | `## Tech Stack & Architecture`  |
| `implementation_markdown` | `## Key Implementation Details` |
| `outcome_markdown`        | `## Outcome`                    |

The split exists so the front end can lay each section out on its own rather
than rendering one markdown blob. `description_markdown` still holds the
complete write-up and is what technology extraction reads, so a project that
doesn't fit the mould loses nothing — it just publishes with fewer section
fields, and `publish` says which ones are missing. Headings that match no field
are reported too; their content stays in `description_markdown` only.

Matching is on heading text, not position, and is loose (`## Architecture` and
`## Results` both land correctly), but renaming sections wholesale is how you
end up with empty fields. `ai/project.summary-instructions.md` tells the model
to keep the headings verbatim for exactly this reason.

**`shots`** — renders each target at a 1280×720 viewport with a 2× device scale
factor, producing 2560×1440 PNGs that match your existing media. Before each
capture it dismisses cookie/consent overlays, scrolls the full page to trigger
lazy-loaded imagery, returns to the top, disables animations, and waits for
fonts. Alt text is generated per image by Claude vision (`--no-alt` to skip).

Targets come from `screenshots` in the manifest when set; otherwise the homepage
plus same-origin nav routes discovered during `analyze`, capped at `maxShots`
(default 5). Pages behind a login can't be captured — pin public URLs instead.

One capture is flagged as the `hero`, filling the Project `hero_image` field.
It defaults to the home page; set `hero` on the manifest entry to point it
somewhere more representative:

```json
{ "slug": "glyphin", "hero": { "label": "Editor", "url": "/editor" } }
```

The hero is captured outside the `maxShots` cap, so pinning it never costs a
gallery slot. When it lands on a route the gallery already covers — the default
case — that existing capture is flagged rather than shot twice, so no duplicate
lands in your media library.

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
   `client_name`, `business_challenge`, `contribution_highlights`, `outcomes`, and
   `status`. Fill anything listed under **Needs review** yourself. (Testimonials
   are not wired yet.)
3. **summary** — paste the sheet's `## summary` block into the `summary` field.
4. **description_markdown** — paste the whole of `writeup.md`. Leave the
   rich-text `description` field empty; your existing projects use
   `description_markdown` only. The sheet includes a one-line `xclip`/`pbcopy`
   command if you'd rather not open the file. Then fill the four **description
   sections** fields from the slices the sheet's table names — `publish` does
   this for you, but manual entry doesn't.
5. **Media** — upload the PNGs from `shots/`. Each one needs `alt` text, and the
   sheet prints it on its own line under the matching filename. Set `thumbnail`
   to the first image, `hero_image` to the one the sheet names, and add all of
   them to `images`.
6. **Save**, then click **Extract Technologies**. Nothing to type — it parses
   the markdown you just pasted, creates missing technology records, and links
   them to the project.

Leave `display.hide` ticked while you review, then untick it to go live.

## The `publish` command

`publish` does all of the above automatically — uploads the screenshots, creates
or updates the project, then runs the technology extraction pass. It reaches a
CMS in one of two ways:

| Mode                           | Route                                 | Use for                    |
| ------------------------------ | ------------------------------------- | -------------------------- |
| `pnpm ingest publish`          | Local API, straight to `DATABASE_URI` | a database on this machine |
| `pnpm ingest publish --remote` | REST API of `PAYLOAD_REMOTE_URL`      | production                 |

`--remote` is the one that removes the copy-paste work. Production's database
isn't reachable from here and its media live in R2 behind the instance's own
storage adapter, so writes go over HTTP to the running instance instead —
authenticated with an API key, exactly as the admin panel would.

```bash
pnpm ingest remote ping                     # check the URL and key first
pnpm ingest publish --remote --dry-run      # report, write nothing
pnpm ingest publish --remote talkspark      # one entry, created hidden
pnpm ingest publish --remote --visible      # everything ready, live immediately
```

Notes that apply to both modes:

- It prints its target before doing anything, and `--dry-run` reports without
  writing.
- It maps manifest `slug` onto the Project `slug`, and maps `case-study.json`
  into `summary` and the case-study fields when present. A missing sidecar still publishes
  the write-up, links, and media (with a warning).
- It writes `writeup.md` to `description_markdown` and, in the same pass, to the
  four [description section](#description-sections) fields. Sections it can't
  find are warned about rather than blocking the publish.
- If no publish is recorded for the target, it looks the slug up first and
  **updates an existing project** rather than colliding on the unique
  constraint — so a project you already entered by hand gets adopted, not
  duplicated.
- Projects are created with `display.hide` set unless you pass `--visible`.
- `publishedTo` in the manifest is keyed by target — `host:port/name` for a
  database, `remote:<host>` for an instance — so a project ID recorded against
  dev is never used to update a row in prod.
- Re-publishing uploads the screenshots again rather than reusing the existing
  media rows, so repeated runs leave orphaned images behind. Prune them with
  `pnpm ingest remote list media` and `remote delete media <id>`.
- An inline `DATABASE_URI=… pnpm ingest publish` overrides `.env`, since dotenv
  doesn't overwrite variables that are already set.

Flags: `--remote`, `--dry-run`, `--visible`, `--no-tech` (skip technology
extraction).

## Reaching the remote instance directly

`pnpm ingest remote` is the same REST client exposed for one-off reads and
writes — checking what's actually live, fixing a field, uploading an image
outside the pipeline.

```bash
pnpm ingest remote ping                       # verify credentials
pnpm ingest remote list projects --limit=50
pnpm ingest remote list projects --where=slug=talkspark
pnpm ingest remote list media --where=alt:like=TalkSpark --json
pnpm ingest remote get projects 12 --depth=2
pnpm ingest remote update projects 12 --data='{"display":{"hide":false}}'
pnpm ingest remote create technologies --data=./new-tech.json
pnpm ingest remote upload ./screenshot.png --alt="Home page"
pnpm ingest remote delete media 88 --yes
```

`--data` takes inline JSON or a path to a JSON file. `--where` takes
`field=value`, or `field:operator=value` for any Payload operator (`like`,
`not_equals`, `greater_than`, …). `delete` shows you what it's about to remove
and does nothing until you add `--yes`.

### Credentials

Both `--remote` publishing and the `remote` command read two variables:

```bash
PAYLOAD_REMOTE_URL=https://cms.andribraun.dev
PAYLOAD_API_KEY=<key>
```

Generate the key in the admin panel under **Third Party Access**: create a
document, tick **Enable API Key**, save, and copy the generated key. The key
authenticates as that document, and the `third-party-access` collection has no
custom access control, so it gets the same create/update/delete rights a
logged-in user has. Treat it as a production credential — `.env` is gitignored,
and revoking it is a matter of deleting the document.

If the key lives on a different collection, set `PAYLOAD_API_KEY_COLLECTION`.

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
