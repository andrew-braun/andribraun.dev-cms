import type { RequiredDataFromCollectionSlug } from 'payload'

import type { CaseStudySidecar } from './caseStudy'
import type { ManifestEntry } from './types'

import { splitWriteup } from './writeupSections'

export type ProjectCreateData = RequiredDataFromCollectionSlug<'projects'>
export type ProjectUpdateData = {
  display?: Partial<NonNullable<ProjectCreateData['display']>>
} & Partial<Omit<ProjectCreateData, 'display'>>

export interface ProjectDataInput {
  caseStudy: CaseStudySidecar | null
  entry: ManifestEntry
  markdown: string
  media?: { heroId?: number; ids: number[] } | null
  visibility?: boolean
}

function buildSharedProjectData({
  caseStudy,
  entry,
  markdown,
}: Pick<ProjectDataInput, 'caseStudy' | 'entry' | 'markdown'>): ProjectUpdateData {
  const { sections } = splitWriteup(markdown)
  const data: ProjectUpdateData = {
    slug: entry.slug,
    description_markdown: markdown,
    ...sections,
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

function assignLinks(data: ProjectUpdateData, entry: ManifestEntry): void {
  if (entry.githubLink !== undefined) {
    data.github_link = entry.githubLink
  }
  if (entry.liveUrl !== undefined) {
    data.live_link = entry.liveUrl
  }
  if (entry.snapshotLink !== undefined) {
    data.snapshot_link = entry.snapshotLink
  }
}

function assignMedia(data: ProjectUpdateData, media: ProjectDataInput['media']): void {
  if (media === null) {
    data.hero_image = null
    data.images = null
    data.thumbnail = null
  } else if (media && media.ids.length > 0) {
    data.hero_image = media.heroId ?? media.ids[0]
    data.images = media.ids
    data.thumbnail = media.ids[0]
  }
}

export function buildProjectCreateData(input: ProjectDataInput): ProjectCreateData {
  const data = buildSharedProjectData(input) as ProjectCreateData
  data.display = {
    card_type: input.entry.cardType ?? 'visual',
    featured: input.entry.featured ?? false,
    hide: input.visibility !== true,
    ...(input.entry.order !== undefined && { order: input.entry.order }),
  }
  assignLinks(data, input.entry)
  assignMedia(data, input.media)
  return data
}

export function buildProjectUpdateData(input: ProjectDataInput): ProjectUpdateData {
  const data = buildSharedProjectData(input)
  assignLinks(data, input.entry)
  assignMedia(data, input.media)

  const display: NonNullable<ProjectUpdateData['display']> = {}
  if (input.entry.cardType !== undefined) {
    display.card_type = input.entry.cardType
  }
  if (input.entry.featured !== undefined) {
    display.featured = input.entry.featured
  }
  if (input.entry.order !== undefined) {
    display.order = input.entry.order
  }
  if (input.visibility !== undefined) {
    display.hide = !input.visibility
  }
  if (Object.keys(display).length > 0) {
    data.display = display
  }
  return data
}

export function buildProjectData(
  entry: ManifestEntry,
  markdown: string,
  mediaIds: number[],
  visible: boolean,
  caseStudy: CaseStudySidecar | null,
  /** Media ID of the shot flagged `hero` in shots.json. */
  heroMediaId?: number,
): RequiredDataFromCollectionSlug<'projects'> {
  return buildProjectCreateData({
    caseStudy,
    entry,
    markdown,
    media: mediaIds.length > 0 ? { heroId: heroMediaId, ids: mediaIds } : undefined,
    visibility: visible,
  })
}
