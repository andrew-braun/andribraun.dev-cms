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
    githubLink: entry.githubLink,
    images: mediaIds,
    liveLink: entry.liveUrl,
    snapshotLink: entry.snapshotLink,
    thumbnail: mediaIds[0],
    title: entry.title,
  }

  if (caseStudy?.clientName) {
    data.clientName = caseStudy.clientName
  }
  if (caseStudy?.businessChallenge) {
    data.businessChallenge = caseStudy.businessChallenge
  }
  if (caseStudy?.contributionHighlights) {
    data.contributionHighlights = caseStudy.contributionHighlights
  }
  if (caseStudy?.outcomes) {
    data.outcomes = caseStudy.outcomes
  }
  if (caseStudy?.status) {
    data.status = caseStudy.status
  }

  return data
}
