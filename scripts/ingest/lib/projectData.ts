import type { RequiredDataFromCollectionSlug } from 'payload'

import type { CaseStudySidecar } from './caseStudy'
import type { ManifestEntry } from './types'

export function buildProjectData(
  entry: ManifestEntry,
  markdown: string,
  mediaIds: number[],
  visible: boolean,
  caseStudy: CaseStudySidecar | null,
): RequiredDataFromCollectionSlug<'projects'> {
  const data: RequiredDataFromCollectionSlug<'projects'> = {
    slug: entry.slug,
    description_markdown: markdown,
    display: {
      card_type: entry.cardType ?? 'visual',
      featured: entry.featured ?? false,
      hide: !visible,
      order: entry.order,
    },
    github_link: entry.githubLink,
    images: mediaIds,
    live_link: entry.liveUrl,
    snapshot_link: entry.snapshotLink,
    thumbnail: mediaIds[0],
    title: entry.title,
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
