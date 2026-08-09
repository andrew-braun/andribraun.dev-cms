/**
 * Portfolio ingest pipeline.
 *
 * Run via `pnpm ingest <command> [slugs...] [--flags]`. Each stage is
 * independent, resumable, and writes its output to `ingest/work/<slug>/` for
 * review. Nothing touches the database until `publish`.
 */

import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { analyze } from './commands/analyze'
import { discover } from './commands/discover'
import { notes } from './commands/notes'
import { publish } from './commands/publish'
import { remote } from './commands/remote'
import { sheet } from './commands/sheet'
import { shots } from './commands/shots'
import { status } from './commands/status'
import { writeup } from './commands/writeup'
import { flagBoolean, parseArgs, type ParsedArgs } from './lib/args'
import { IngestError, log } from './lib/log'

const COMMANDS: Record<string, (args: ParsedArgs) => Promise<void>> = {
  analyze,
  discover,
  notes,
  publish,
  remote,
  sheet,
  shots,
  status,
  writeup,
}

/**
 * The flags each command accepts.
 *
 * An unrecognised flag is a hard error rather than a silent no-op: `publish
 * --dryrun` would otherwise swallow the typo and write for real, which is the
 * exact mistake the flag was there to prevent. That matters more now that
 * `--remote` points the same command at production.
 */
const KNOWN_FLAGS: Record<string, string[]> = {
  analyze: ['force'],
  discover: ['all', 'archived', 'forks', 'limit', 'no-github', 'owner', 'urls'],
  notes: [],
  publish: ['dry-run', 'no-tech', 'remote', 'visible'],
  remote: ['alt', 'collection', 'data', 'depth', 'json', 'limit', 'page', 'sort', 'where', 'yes'],
  sheet: [],
  shots: ['force', 'max', 'no-alt'],
  status: [],
  writeup: ['force'],
}

function assertKnownFlags(command: string, args: ParsedArgs): void {
  const allowed = KNOWN_FLAGS[command] ?? []
  const unknown = Object.keys(args.flags).filter((flag) => !allowed.includes(flag))

  if (unknown.length === 0) {
    return
  }

  const named = unknown.map((flag) => `--${flag}`).join(', ')
  throw new IngestError(
    `Unknown flag${unknown.length > 1 ? 's' : ''} for "${command}": ${named}\n  ` +
      (allowed.length > 0
        ? `Accepted: ${allowed.map((flag) => `--${flag}`).join(', ')}`
        : `${command} takes no flags.`) +
      `\n  Run "pnpm ingest ${command} --help" for details.`,
  )
}

const USAGE = `
Portfolio ingest pipeline

  pnpm ingest <command> [slugs...] [--flags]

Commands
  discover   Scan GitHub and/or accept site URLs; seed ingest/manifest.json
  analyze    Gather repo context and probe the live site  → work/<slug>/context.{json,md}
  notes      Scaffold hand-written background notes       → ingest/notes/<slug>.md
  writeup    Generate description_markdown + case-study.json with Claude
             → work/<slug>/writeup.md, case-study.json
  shots      Capture 2560x1440 screenshots + alt text     → work/<slug>/shots/
  sheet      Rebuild the manual-entry checklist           → work/<slug>/ENTER-ME.md
  status     Show the stage matrix for every entry

  publish    Write entries into a CMS: uploads the screenshots, creates or
             updates the project, then extracts technologies.
             --remote targets PAYLOAD_REMOTE_URL over the REST API (production);
             without it, writes straight to the DATABASE_URI database.
  remote     Read/write/upload against the remote instance directly:
             ping | list | get | create | update | delete | upload

Passing one or more slugs limits a stage to those entries (and overrides "skip").

Flags
  discover   --owner=<user>  GitHub account to list (default: authenticated user)
             --urls=<file>   Newline-delimited list of deployed site URLs
             --limit=<n>     Max repos to list (default 300)
             --all           Add every repo unskipped, not just ones with a homepage
             --forks         Include forks       --archived  Include archived repos
             --no-github     URLs only; skip the GitHub scan
  analyze    --force         Re-gather even if already analyzed
  writeup    --force         Regenerate an existing write-up
  shots      --force         Recapture       --max=<n>  Override maxShots
             --no-alt        Skip AI alt-text generation
  publish    --remote[=true|false]   Use PAYLOAD_REMOTE_URL
             --dry-run[=true|false]  Report what would happen, write nothing
             --visible[=true|false]  Create visible/hidden; omitted preserves updates
             --no-tech[=true|false]  Skip the technology extraction pass
  remote     list  <collection> [--limit=] [--page=] [--sort=] [--depth=]
                              [--where=field=value | field:operator=value] [--json]
             get   <collection> <id> [--depth=]
             create <collection> --data=<json|file.json>
             update <collection> <id> --data=<json|file.json>
             delete <collection> <id> --yes
             upload <file...> --alt="..." [--collection=media]

Typical run
  pnpm ingest discover --urls=ingest/urls.txt
  $EDITOR ingest/manifest.json          # set titles, unskip what you want
  pnpm ingest analyze
  pnpm ingest notes                     # then fill in ingest/notes/<slug>.md
  pnpm ingest writeup && pnpm ingest shots

Notes are optional but matter most for sites with no repo, where the probe sees
only rendered HTML. They are read fresh by writeup, so editing them needs no
re-analyze — just: pnpm ingest writeup --force <slug>

Then publish straight to production:
  pnpm ingest remote ping               # check PAYLOAD_REMOTE_URL + PAYLOAD_API_KEY
  pnpm ingest publish --remote --dry-run
  pnpm ingest publish --remote          # creates hidden; add --visible to go live

Or enter it by hand: ingest/work/<slug>/ENTER-ME.md lists every field, the
write-up to paste into description_markdown, and each screenshot's alt text.
`

export async function run(argv: string[]): Promise<number> {
  try {
    const [command, ...rest] = argv

    if (!command || command === 'help' || command === '--help') {
      console.log(USAGE)
      return 0
    }

    const handler = COMMANDS[command]
    if (!handler) {
      log.error(`Unknown command "${command}"`)
      console.log(USAGE)
      return 1
    }

    const args = parseArgs(rest)

    // `publish --help` used to fall through and publish for real.
    if (flagBoolean(args, 'help') ?? false) {
      console.log(USAGE)
      return 0
    }

    assertKnownFlags(command, args)
    await handler(args)
    return 0
  } catch (error) {
    if (error instanceof IngestError) {
      log.error(error.message)
    } else {
      log.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
    }
    return 1
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
const invokedByPayloadRun =
  process.argv[1] &&
  path.basename(process.argv[1]) === 'bin.js' &&
  process.argv[1].split(path.sep).slice(-3, -1).join('/') === 'node_modules/payload' &&
  process.env.DISABLE_PAYLOAD_HMR === 'true'

if (invokedDirectly || invokedByPayloadRun) {
  const code = await run(process.argv.slice(2))
  if (code !== 0 && invokedByPayloadRun) {
    // Payload's `run` wrapper ends successful imports with `process.exit(0)`,
    // so a failed command must reject the import to preserve its exit status.
    throw new IngestError(`Ingest command failed with exit code ${code}`)
  }
  process.exitCode = code
}
