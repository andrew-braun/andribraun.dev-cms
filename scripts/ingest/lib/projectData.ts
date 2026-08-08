import type { RequiredDataFromCollectionSlug } from 'payload'

import type { CaseStudySidecar } from './caseStudy'
import type { ManifestEntry } from './types'

import { splitWriteup } from './writeupSections'

export function buildProjectData(
  entry: ManifestEntry,
  markdown: string,
  mediaIds: number[],
  visible: boolean,
  caseStudy: CaseStudySidecar | null,
  /** Media ID of the shot flagged `hero` in shots.json. */
  heroMediaId?: number,
): RequiredDataFromCollectionSlug<'projects'> {
  // The write-up follows a fixed four-section structure, so each section also
  // lands in its own field. `description_markdown` keeps the whole document —
  // it is what technology extraction reads, and it is the only thing a project
  // that breaks the mould will have.
  const { sections } = splitWriteup(markdown)

  const data: RequiredDataFromCollectionSlug<'projects'> = {
    slug: entry.slug,
    description_markdown: markdown,
    ...sections,
    display: {
      card_type: entry.cardType ?? 'visual',
      featured: entry.featured ?? false,
      hide: !visible,
      order: entry.order,
    },
    github_link: entry.githubLink,
    hero_image: heroMediaId ?? mediaIds[0],
    images: mediaIds,
    live_link: entry.liveUrl,
    snapshot_link: entry.snapshotLink,
    thumbnail: mediaIds[0],
    title: entry.title,
  }

  if (caseStudy?.summary) {
    data.summary = caseStudy.summary
  }
  if (caseStudy?.client_name) {
    data.client_name = caseStudy.client_name
  }
  if (caseStudy?.business_challenge) {
    data.business_challenge = caseStudy.business_challenge
  }
  if (caseStudy?.contribution_highlights) {
    data.contribution_highlights = caseStudy.contribution_highlights
  }
  if (caseStudy?.outcomes) {
    data.outcomes = caseStudy.outcomes
  }
  if (caseStudy?.status) {
    data.status = caseStudy.status
  }

  return data
}
