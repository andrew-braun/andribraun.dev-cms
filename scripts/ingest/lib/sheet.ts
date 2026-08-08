import fs from 'fs/promises'
import path from 'path'

import type { CaseStudySidecar } from './caseStudy'
import type { CapturedShot, ManifestEntry } from './types'

import { CASE_STUDY_FIELD_KEYS } from './caseStudy'
import { readJson } from './manifest'
import { caseStudyPath, entryDir, rel, shotsDir, shotsManifestPath, writeupPath } from './paths'
import {
  splitWriteup,
  WRITEUP_SECTION_KEYS,
  WRITEUP_SECTION_SOURCES,
  type WriteupSplit,
} from './writeupSections'

/**
 * Writes `ingest/work/<slug>/ENTER-ME.md` — a single checklist for entering the
 * project into the Payload admin by hand.
 *
 * The write-up itself is deliberately *not* duplicated here; the sheet points at
 * `writeup.md` so there is only ever one copy to edit. What the sheet does carry
 * is everything that is otherwise awkward to retrieve: the exact field values,
 * and each screenshot's alt text on its own line ready to copy.
 */
export async function writeSheet(entry: ManifestEntry): Promise<null | string> {
  const dir = entryDir(entry.slug)

  const writeup = await readWriteup(entry.slug)
  const shots = (await readJson<CapturedShot[]>(shotsManifestPath(entry.slug))) ?? []

  if (writeup === null && shots.length === 0) {
    return null
  }

  const caseStudy = await readJson<CaseStudySidecar>(caseStudyPath(entry.slug))

  const lines: string[] = [
    `# ${entry.title}`,
    '',
    'Manual entry checklist. Create a new project at `/admin/collections/projects/create`',
    'and fill in the fields below.',
    '',
    '## Fields',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| title | \`${entry.title}\` |`,
    `| slug | \`${entry.slug}\` |`,
    `| links → live_link | ${code(entry.liveUrl)} |`,
    `| links → github_link | ${code(entry.githubLink)} |`,
    `| links → snapshot_link | ${code(entry.snapshotLink)} |`,
    `| display → card_type | \`${entry.cardType ?? 'visual'}\` |`,
    `| display → featured | \`${entry.featured ?? false}\` |`,
    `| display → order | ${code(entry.order === undefined ? undefined : String(entry.order))} |`,
    '',
    ...renderCaseStudySection(entry.slug, caseStudy),
  ]

  lines.push('## summary', '')
  if (caseStudy?.summary) {
    lines.push(
      'Paste into the `summary` field (sits above `description`):',
      '',
      caseStudy.summary,
      '',
    )
  } else {
    lines.push('_No summary generated yet — run `pnpm ingest writeup`._', '')
  }

  if (writeup !== null) {
    lines.push(
      '## description_markdown',
      '',
      `Copy the entire contents of **[writeup.md](./writeup.md)** into the`,
      '`description_markdown` field.',
      '',
      '```bash',
      `# copies it straight to the clipboard (Linux: xclip, macOS: pbcopy)`,
      `xclip -selection clipboard < "${rel(writeupPath(entry.slug))}"`,
      '```',
      '',
      '> Leave the rich-text `description` field empty — the published projects',
      '> use `description_markdown` only.',
      '',
      ...renderSectionsSection(splitWriteup(writeup)),
    )
  } else {
    lines.push('## description_markdown', '', '_No write-up generated yet._', '')
  }

  if (shots.length > 0) {
    lines.push(
      '## Media',
      '',
      `Upload from \`${rel(shotsDir(entry.slug))}\` — ${shots.length} image${shots.length === 1 ? '' : 's'} at 2560×1440.`,
      '',
      `Set **thumbnail** to \`${shots[0].file}\`, and add all ${shots.length} to **images**.`,
      '',
      `Set **hero_image** to \`${(shots.find((shot) => shot.hero) ?? shots[0]).file}\`.`,
      '',
      'Each upload needs its `alt` text — copy the line under each filename:',
      '',
    )

    shots.forEach((shot, index) => {
      lines.push(`### ${index + 1}. ${shot.file}`, '', shot.alt, '', `<${shot.url}>`, '')
    })
  } else {
    lines.push('## Media', '', '_No screenshots captured._', '')
  }

  lines.push(
    '## Technologies',
    '',
    'Do **not** enter these by hand. Save the project first, then click',
    '**Extract Technologies** at the top of the edit screen — it reads the',
    'markdown you just pasted, creates any missing technology records, and links',
    'them all to the project.',
    '',
  )

  const target = path.join(dir, 'ENTER-ME.md')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(target, `${lines.join('\n')}\n`, 'utf8')
  return target
}

/** Renders the Case study checklist section for ENTER-ME.md. */
export function renderCaseStudySection(slug: string, caseStudy: CaseStudySidecar | null): string[] {
  const lines: string[] = [
    '## Case study',
    '',
    `| slug | \`${slug}\` |`,
    '',
    'Copy values from **[case-study.json](./case-study.json)** (or the table below) into the',
    'matching Project fields. `slug` is required and unique.',
    '',
  ]

  if (!caseStudy) {
    lines.push(
      '_No case-study.json yet — run `pnpm ingest writeup` (or fill these in admin)._',
      '',
      '**Needs review:** ' + CASE_STUDY_FIELD_KEYS.map((k) => `\`${k}\``).join(', '),
      '',
    )
    return lines
  }

  lines.push('| Field | Value |', '| --- | --- |')
  lines.push(`| client_name | ${code(caseStudy.client_name)} |`)
  lines.push(`| status | ${code(caseStudy.status)} |`)
  lines.push(
    `| business_challenge | ${caseStudy.business_challenge ? 'see case-study.json / block below' : '—'} |`,
  )
  lines.push(
    `| contribution_highlights | ${caseStudy.contribution_highlights?.length ?? 0} item(s) |`,
  )
  lines.push(`| outcomes | ${caseStudy.outcomes?.length ?? 0} item(s) |`)
  lines.push('')

  if (caseStudy.business_challenge) {
    lines.push('### business_challenge', '', caseStudy.business_challenge, '')
  }

  if (caseStudy.contribution_highlights?.length) {
    lines.push('### contribution_highlights', '')
    for (const row of caseStudy.contribution_highlights) {
      lines.push(`- ${row.statement}`)
    }
    lines.push('')
  }

  if (caseStudy.outcomes?.length) {
    lines.push('### outcomes', '')
    for (const row of caseStudy.outcomes) {
      lines.push(row.metric ? `- **${row.statement}** — ${row.metric}` : `- ${row.statement}`)
    }
    lines.push('')
  }

  const review =
    caseStudy.needsReview.length > 0
      ? caseStudy.needsReview.map((k) => `\`${k}\``).join(', ')
      : '_none_'
  lines.push(`**Needs review:** ${review}`, '')
  return lines
}

/**
 * Lists the split-out description fields. The bodies are deliberately not
 * reproduced — they are verbatim slices of `writeup.md`, and a second copy here
 * would be one more thing to keep in sync. What the sheet gives you is which
 * slice belongs in which field, and which ones this write-up is missing.
 */
export function renderSectionsSection(split: WriteupSplit): string[] {
  const lines: string[] = [
    '### Description sections',
    '',
    'The same write-up, split for layout. `pnpm ingest publish` fills these',
    'automatically; entering by hand, copy each slice of **[writeup.md](./writeup.md)**',
    'into its field.',
    '',
    '| Field | From writeup.md | Present |',
    '| --- | --- | --- |',
  ]

  for (const key of WRITEUP_SECTION_KEYS) {
    lines.push(`| ${key} | ${WRITEUP_SECTION_SOURCES[key]} | ${split.sections[key] ? '✅' : '—'} |`)
  }
  lines.push('')

  if (split.unmatched.length > 0) {
    lines.push(
      `> Headings with no matching field: ${split.unmatched.map((heading) => `\`${heading}\``).join(', ')}.`,
      '> That content lives in `description_markdown` only.',
      '',
    )
  }

  return lines
}

function code(value?: string): string {
  return value ? `\`${value}\`` : '—'
}

async function readWriteup(slug: string): Promise<null | string> {
  try {
    return await fs.readFile(writeupPath(slug), 'utf8')
  } catch {
    return null
  }
}
