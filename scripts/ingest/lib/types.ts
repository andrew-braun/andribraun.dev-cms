/**
 * Shared types for the portfolio ingest pipeline.
 */

import type { ScreenshotCaptureIssue } from './screenshotQuality'

export interface ShotSpec {
  /** Descriptive label used in the media filename: `<Title> - <Label>.png`. */
  label: string
  /** Absolute URL captured. */
  url: string
}

export interface CapturedShot extends ShotSpec {
  /** AI-generated alt text describing the screenshot. */
  alt: string
  /** Visible page-state issues detected while the screenshot was captured. */
  captureIssues?: ScreenshotCaptureIssue[]
  /** File name relative to the entry's `shots/` directory. */
  file: string
  height: number
  /** Marks the shot that fills the Project `hero_image` field. */
  hero?: boolean
  width: number
}

export interface StageState {
  analysisArtifact?: string
  analysisInput?: string
  analyzedAt?: string
  assessedAt?: string
  assessmentInput?: string
  caseStudyAt?: string
  caseStudyInput?: string
  shotsAt?: string
  shotsInput?: string
  writeupAt?: string
  writeupInput?: string
}

/** Where an entry landed in one specific database. */
export interface PublishRecord {
  at: string
  /** The Payload project ID *in that database*. Never reuse it elsewhere. */
  id: number
}

export interface ManifestEntry {
  /** Card style on the portfolio front end. Defaults to `visual`. */
  cardType?: 'text' | 'visual' | null
  /** Marks the project as featured. */
  featured?: boolean | null
  /** Full GitHub URL stored on the project. Derived from `repo` when omitted. */
  githubLink?: null | string
  /**
   * What `hero_image` should show. Defaults to the home page. A bare path
   * (`/pricing`) is resolved against `liveUrl`. Captured outside the `maxShots`
   * cap, and reuses an existing capture when it points at a route the gallery
   * already covers.
   */
  hero?: null | ShotSpec
  /** Deployed site URL. Required for the `shots` stage. */
  liveUrl?: null | string
  /** Maximum screenshots to capture. Defaults to 5. */
  maxShots?: null | number
  /** Display order on the portfolio. */
  order?: null | number
  /**
   * Publish history keyed by database (`host:port/name`). Project IDs are
   * per-database, so publishing to dev and then to prod creates a separate
   * record in each rather than updating the wrong row.
   */
  publishedTo?: Record<string, PublishRecord>
  /** `owner/name` on GitHub. Required for the `analyze` stage. */
  repo?: null | string
  /**
   * Explicit screenshot targets. When set, route auto-discovery is skipped.
   * A bare path (`/about`) is resolved against `liveUrl`.
   */
  screenshots?: null | ShotSpec[]
  /** Skip this entry in every stage. */
  skip?: boolean
  slug: string
  /** Archived / Wayback URL, stored on the project. */
  snapshotLink?: null | string
  stages: StageState
  title: string
}

export interface Manifest {
  entries: ManifestEntry[]
  updatedAt: string
  version: 1
}

/** Framework and deployment hints scraped from the live site's HTML. */
export interface SiteProbe {
  description?: string
  /** Same-origin links found in the page's nav/header, in document order. */
  navLinks: string[]
  ok: boolean
  reason?: string
  signals: string[]
  title?: string
  url: string
}

export interface RepoContext {
  defaultBranch: string
  description?: string
  /** Path -> contents for the files worth showing the model. */
  files: Record<string, string>
  homepage?: string
  languages: Record<string, number>
  pushedAt?: string
  repo: string
  topics: string[]
  /** Every path in the repo tree, truncated. */
  tree: string[]
}

export interface EntryContext {
  gatheredAt: string
  /**
   * Contents of `ingest/notes/<slug>.md`, if present. First-hand background the
   * probe and repo scan can't reveal — what the brief was, what you actually
   * built. Weighted above the scraped evidence in the briefing.
   */
  notes?: string
  repo?: RepoContext
  site?: SiteProbe
  slug: string
  title: string
}
