import fs from 'fs/promises'
import path from 'path'
import { chromium, type Page } from 'playwright'

import type { CapturedShot, EntryContext, ManifestEntry, ShotSpec } from '../lib/types'

import { generateAltText } from '../lib/ai'
import { flagNumber, hasFlag, type ParsedArgs } from '../lib/args'
import { log } from '../lib/log'
import {
  loadManifest,
  readJson,
  safeFilename,
  selectEntries,
  updateEntry,
  writeJson,
} from '../lib/manifest'
import { contextPath, rel, shotsDir, shotsManifestPath } from '../lib/paths'
import { writeSheet } from '../lib/sheet'

/**
 * Viewport is half the output size and the device scale factor doubles it, so
 * pages render at a natural desktop width while producing the 2560x1440 assets
 * the existing portfolio entries use.
 */
const VIEWPORT = { height: 720, width: 1280 }
const SCALE = 2
const DEFAULT_MAX_SHOTS = 5

/** Selectors for consent and newsletter overlays that would sit over the page. */
const DISMISS_SELECTORS = [
  '[id*="cookie" i] button:has-text("Accept")',
  '[class*="cookie" i] button:has-text("Accept")',
  'button:has-text("Accept all")',
  'button:has-text("Accept All")',
  'button:has-text("Accept cookies")',
  'button:has-text("I agree")',
  'button:has-text("Got it")',
  '#onetrust-accept-btn-handler',
  '[aria-label="Close" i]',
]

export async function shots(args: ParsedArgs): Promise<void> {
  const manifest = await loadManifest()
  const entries = selectEntries(manifest, args.positionals)
  const force = hasFlag(args, 'force')
  const skipAlt = hasFlag(args, 'no-alt')
  const maxOverride = flagNumber(args, 'max')

  const todo = entries.filter((entry) => {
    if (!entry.liveUrl) {
      log.detail(`${entry.slug}: no liveUrl — skipping screenshots`)
      return false
    }
    if (!force && entry.stages.shotsAt) {
      log.detail(`${entry.slug}: screenshots already captured (--force to redo)`)
      return false
    }
    return true
  })

  if (todo.length === 0) {
    log.warn('Nothing to capture.')
    return
  }

  if (!skipAlt && !process.env.CLAUDE_API_KEY) {
    log.warn('CLAUDE_API_KEY is not set — capturing without alt text (same as --no-alt).')
  }

  const browser = await chromium.launch()
  const context = await browser.newContext({
    deviceScaleFactor: SCALE,
    // A real desktop UA avoids mobile variants and some bot interstitials.
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: VIEWPORT,
  })
  // Animations mid-flight produce inconsistent frames between runs.
  await context.addInitScript(() => {
    const style = document.createElement('style')
    style.textContent =
      '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important}'
    document.addEventListener('DOMContentLoaded', () => document.head.append(style))
  })

  try {
    for (const entry of todo) {
      log.step(`Capturing ${entry.slug}`)

      const targets = await resolveTargets(entry, maxOverride)

      // The hero is a required field rather than a gallery slot, so it sits
      // outside the `max` cap. When it points at a route the gallery already
      // covers — the usual case, since both default to the home page — the
      // existing capture is reused instead of shooting the same pixels twice.
      const hero = resolveHero(entry)
      if (!targets.some((target) => sameRoute(target.url, hero.url))) {
        targets.push(hero)
      }

      if (targets.length === 0) {
        log.warn(`${entry.slug}: no capturable URLs`)
        continue
      }

      const outDir = shotsDir(entry.slug)
      await fs.rm(outDir, { force: true, recursive: true })
      await fs.mkdir(outDir, { recursive: true })

      const captured: CapturedShot[] = []
      const page = await context.newPage()

      for (const target of targets) {
        try {
          await settle(page, target.url)

          const file = `${safeFilename(`${entry.title} - ${target.label}`)}.png`
          const filePath = path.join(outDir, file)
          await page.screenshot({ type: 'png', path: filePath })

          let alt = `${entry.title} — ${target.label}`
          if (!skipAlt && process.env.CLAUDE_API_KEY) {
            alt = await generateAltText(filePath, entry.title, target.label)
          }

          captured.push({
            alt,
            file,
            height: VIEWPORT.height * SCALE,
            label: target.label,
            url: target.url,
            width: VIEWPORT.width * SCALE,
          })
          log.ok(`${file}`)
          log.detail(alt)
        } catch (error) {
          log.error(`${target.url}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      await page.close()

      if (captured.length === 0) {
        log.warn(`${entry.slug}: every capture failed`)
        continue
      }

      // Fall back to the first successful capture so `hero_image` is never
      // empty — a failed hero shot shouldn't leave the field unset.
      const heroShot = captured.find((shot) => sameRoute(shot.url, hero.url)) ?? captured[0]
      heroShot.hero = true
      log.detail(`hero_image → ${heroShot.file}`)

      await writeJson(shotsManifestPath(entry.slug), captured)
      await updateEntry(entry.slug, (target) => {
        target.stages.shotsAt = new Date().toISOString()
      })
      await writeSheet(entry)
      log.info(`${captured.length} screenshots → ${rel(outDir)}`)
    }
  } finally {
    await browser.close()
  }

  log.info('')
  log.detail('Each project now has an ENTER-ME.md checklist in its work directory.')
}

/** Navigates, waits for the page to stop moving, and clears overlays. */
async function settle(page: Page, url: string): Promise<void> {
  await page.goto(url, { timeout: 45_000, waitUntil: 'domcontentloaded' })

  // `networkidle` frequently never fires on sites with polling or live chat, so
  // treat it as best-effort rather than a hard requirement.
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {})

  for (const selector of DISMISS_SELECTORS) {
    const button = page.locator(selector).first()
    try {
      if (await button.isVisible({ timeout: 400 })) {
        await button.click({ timeout: 2000 })
        await page.waitForTimeout(300)
        break
      }
    } catch {
      // Selector didn't match or wasn't clickable — try the next one.
    }
  }

  // Scroll through the page to trigger lazy-loaded imagery, then return to top
  // so the capture is of the hero rather than wherever the scroll ended.
  await page.evaluate(async () => {
    const step = window.innerHeight
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y)
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
    window.scrollTo(0, 0)
  })

  await page.evaluate(() => document.fonts?.ready)
  await page.waitForTimeout(600)
}

/**
 * Resolves what to capture: explicit manifest targets when present, otherwise
 * the homepage plus nav routes discovered during analyze.
 */
async function resolveTargets(entry: ManifestEntry, maxOverride?: number): Promise<ShotSpec[]> {
  const max = maxOverride ?? entry.maxShots ?? DEFAULT_MAX_SHOTS
  const base = entry.liveUrl!

  if (entry.screenshots && entry.screenshots.length > 0) {
    return entry.screenshots
      .map((shot) => ({ ...shot, url: new URL(shot.url, base).toString() }))
      .slice(0, max)
  }

  const targets: ShotSpec[] = [{ label: 'Home', url: base }]

  const context = await readJson<EntryContext>(contextPath(entry.slug))
  const navLinks = context?.site?.navLinks ?? []
  const baseKey = new URL(base).pathname.replace(/\/$/, '')

  for (const link of navLinks) {
    if (targets.length >= max) {
      break
    }
    const url = new URL(link)
    const pathname = url.pathname.replace(/\/$/, '')
    if (pathname === baseKey || pathname === '') {
      continue
    }
    if (targets.some((target) => new URL(target.url).pathname.replace(/\/$/, '') === pathname)) {
      continue
    }
    targets.push({ label: labelFromPath(pathname), url: url.toString() })
  }

  if (targets.length === 1) {
    log.detail('No nav routes discovered — capturing the homepage only.')
  }

  return targets
}

/**
 * Resolves what `hero_image` should show: the manifest override when set,
 * otherwise the home page, which is the most representative view of a site.
 */
function resolveHero(entry: ManifestEntry): ShotSpec {
  const base = entry.liveUrl!
  if (entry.hero) {
    return { ...entry.hero, url: new URL(entry.hero.url, base).toString() }
  }
  return { label: 'Home', url: base }
}

/** Compares two absolute URLs by origin and path, ignoring a trailing slash. */
function sameRoute(a: string, b: string): boolean {
  const left = new URL(a)
  const right = new URL(b)
  return (
    left.origin === right.origin &&
    left.pathname.replace(/\/$/, '') === right.pathname.replace(/\/$/, '')
  )
}

/** `/case-studies/otm` -> `Case Studies Otm`, used in the media filename. */
function labelFromPath(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) {
    return 'Home'
  }
  return segments
    .join(' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\.[a-z]+$/i, '')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
