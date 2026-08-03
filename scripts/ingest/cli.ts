/**
 * Portfolio ingest pipeline.
 *
 * Run via `pnpm ingest <command> [slugs...] [--flags]`. Each stage is
 * independent, resumable, and writes its output to `ingest/work/<slug>/` for
 * review. Nothing touches the database until `publish`.
 */

import { analyze } from './commands/analyze'
import { discover } from './commands/discover'
import { publish } from './commands/publish'
import { shots } from './commands/shots'
import { status } from './commands/status'
import { writeup } from './commands/writeup'
import { parseArgs, type ParsedArgs } from './lib/args'
import { IngestError, log } from './lib/log'

const COMMANDS: Record<string, (args: ParsedArgs) => Promise<void>> = {
  analyze,
  discover,
  publish,
  shots,
  status,
  writeup,
}

const USAGE = `
Portfolio ingest pipeline

  pnpm ingest <command> [slugs...] [--flags]

Commands
  discover   Scan GitHub and/or accept site URLs; seed ingest/manifest.json
  analyze    Gather repo context and probe the live site  → work/<slug>/context.{json,md}
  writeup    Generate description_markdown with Claude    → work/<slug>/writeup.md
  shots      Capture 2560x1440 screenshots + alt text     → work/<slug>/shots/
  publish    Upload media, create/update the project, extract technologies
  status     Show the stage matrix for every entry

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
  publish    --dry-run       Report what would happen, write nothing
             --visible       Publish visible instead of hidden
             --no-tech       Skip the technology extraction pass

Typical run
  pnpm ingest discover --urls=ingest/urls.txt
  $EDITOR ingest/manifest.json          # set titles, unskip what you want
  pnpm ingest analyze && pnpm ingest writeup && pnpm ingest shots
  $EDITOR ingest/work/<slug>/writeup.md # review before anything hits the CMS
  pnpm ingest publish <slug>
`

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)

  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE)
    return
  }

  const handler = COMMANDS[command]
  if (!handler) {
    log.error(`Unknown command "${command}"`)
    console.log(USAGE)
    process.exitCode = 1
    return
  }

  await handler(parseArgs(rest))
}

try {
  await main()
} catch (error) {
  if (error instanceof IngestError) {
    log.error(error.message)
  } else {
    log.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
  }
  process.exitCode = 1
}
