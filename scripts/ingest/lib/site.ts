import type { SiteProbe } from './types'

import { fetchRead } from './transport'

/**
 * Markers in the served HTML that identify a framework, host, or service. These
 * only inform the write-up — the model is told to treat them as hints.
 */
const SIGNATURES: Array<[label: string, pattern: RegExp]> = [
  ['Next.js', /\/_next\/|__NEXT_DATA__|next\/dist/i],
  ['Astro', /astro-island|<meta name="generator" content="Astro/i],
  ['Nuxt', /__NUXT__|\/_nuxt\//i],
  ['SvelteKit', /\/_app\/immutable\/|__sveltekit/i],
  ['Remix', /__remixContext/i],
  ['Gatsby', /___gatsby|\/page-data\//i],
  ['React', /data-reactroot|react-dom/i],
  ['Vue', /data-v-app|__vue__/i],
  ['WordPress', /wp-content|wp-includes/i],
  ['Shopify', /cdn\.shopify\.com|Shopify\.theme/i],
  ['Tailwind CSS', /tailwind/i],
  ['Vercel', /vercel\.app|x-vercel/i],
  ['Netlify', /netlify\.app|netlify\.com/i],
  ['Cloudflare', /cloudflare|cdn-cgi/i],
  ['Cloudinary', /res\.cloudinary\.com/i],
  ['Clerk', /clerk\.(accounts|com)/i],
  ['Algolia', /algolia(net|\.net|\.com)/i],
  ['Mapbox', /api\.mapbox\.com/i],
  ['Stripe', /js\.stripe\.com/i],
  ['Google Tag Manager', /googletagmanager\.com/i],
  ['Sentry', /sentry-cdn|@sentry/i],
  ['Strapi', /strapi/i],
]

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function extractNavLinks(html: string, base: string): string[] {
  const origin = new URL(base).origin
  const found: string[] = []
  const seen = new Set<string>()

  // Prefer links inside nav/header markup; fall back to the whole document when
  // a site renders navigation without semantic landmarks.
  const navRegions = html.match(/<(?:nav|header)[\s\S]*?<\/(?:nav|header)>/gi) ?? []
  const regions = navRegions.length > 0 ? navRegions : [html]

  for (const region of regions) {
    for (const match of region.matchAll(/<a\s[^>]*href=["']([^"']+)["']/gi)) {
      const href = decodeEntities(match[1]).trim()
      if (!href || href.startsWith('#') || /^(?:mailto|tel|javascript):/i.test(href)) {
        continue
      }

      let resolved: URL
      try {
        resolved = new URL(href, base)
      } catch {
        continue
      }

      if (resolved.origin !== origin) {
        continue
      }
      // Assets and feeds aren't pages worth screenshotting.
      if (/\.(?:png|jpe?g|svg|webp|gif|pdf|zip|xml|json|ico|css|js)$/i.test(resolved.pathname)) {
        continue
      }

      resolved.hash = ''
      const normalized = resolved.toString().replace(/\/$/, '') || resolved.origin
      if (!seen.has(normalized)) {
        seen.add(normalized)
        found.push(normalized)
      }
    }
  }

  return found
}

/**
 * Fetches a deployed site's HTML and derives a title, description, framework
 * hints, and same-origin navigation links.
 */
export async function probeSite(url: string): Promise<SiteProbe> {
  try {
    const response = await fetchRead(url, {
      headers: { 'user-agent': USER_AGENT },
    })

    const finalUrl = response.url || url
    const html = await response.text()

    const signals = SIGNATURES.filter(([, pattern]) => pattern.test(html)).map(([label]) => label)

    // Response headers name hosts the HTML body never mentions.
    const server = response.headers.get('server') ?? ''
    const poweredBy = response.headers.get('x-powered-by') ?? ''
    for (const [label, pattern] of SIGNATURES) {
      if (!signals.includes(label) && pattern.test(`${server} ${poweredBy}`)) {
        signals.push(label)
      }
    }

    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    const description = html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
    )?.[1]

    return {
      description: description ? decodeEntities(description).trim() : undefined,
      navLinks: extractNavLinks(html, finalUrl),
      ok: true,
      signals,
      title: title ? decodeEntities(title).replace(/\s+/g, ' ').trim() : undefined,
      url: finalUrl,
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { navLinks: [], ok: false, reason, signals: [], url }
  }
}
