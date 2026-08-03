/**
 * Shared types for the portfolio ingest pipeline.
 */

export interface ShotSpec {
  /** Descriptive label used in the media filename: `<Title> - <Label>.png`. */
  label: string
  /** Absolute URL captured. */
  url: string
}

export interface CapturedShot extends ShotSpec {
  /** AI-generated alt text describing the screenshot. */
  alt: string
  /** File name relative to the entry's `shots/` directory. */
  file: string
  height: number
  width: number
}

export interface StageState {
  analyzedAt?: string
  shotsAt?: string
  writeupAt?: string
}

/** Where an entry landed in one specific database. */
export interface PublishRecord {
  at: string
  /** The Payload project ID *in that database*. Never reuse it elsewhere. */
  id: number
}

export interface ManifestEntry {
  /** Card style on the portfolio front end. Defaults to `visual`. */
  cardType?: 'text' | 'visual'
  /** Marks the project as featured. */
  featured?: boolean
  /** Full GitHub URL stored on the project. Derived from `repo` when omitted. */
  githubLink?: string
  /** Deployed site URL. Required for the `shots` stage. */
  liveUrl?: string
  /** Maximum screenshots to capture. Defaults to 5. */
  maxShots?: number
  /** Display order on the portfolio. */
  order?: number
  /**
   * Publish history keyed by database (`host:port/name`). Project IDs are
   * per-database, so publishing to dev and then to prod creates a separate
   * record in each rather than updating the wrong row.
   */
  publishedTo?: Record<string, PublishRecord>
  /** `owner/name` on GitHub. Required for the `analyze` stage. */
  repo?: string
  /**
   * Explicit screenshot targets. When set, route auto-discovery is skipped.
   * A bare path (`/about`) is resolved against `liveUrl`.
   */
  screenshots?: ShotSpec[]
  /** Skip this entry in every stage. */
  skip?: boolean
  slug: string
  /** Archived / Wayback URL, stored on the project. */
  snapshotLink?: string
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
