import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EntryContext } from '../../scripts/ingest/lib/types'

import { generateCaseStudy, renderAssessmentContext } from '../../scripts/ingest/lib/ai'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('repository assessment briefing', () => {
  it('exposes only files whose contents were read as citeable evidence', () => {
    const context: EntryContext = {
      slug: 'alpha',
      gatheredAt: '2026-08-09T00:00:00.000Z',
      repo: {
        defaultBranch: 'main',
        files: {
          'package.json': '{"scripts":{"test":"vitest"}}',
          'src/app.ts': 'export const app = true',
        },
        languages: { TypeScript: 100 },
        repo: 'example/alpha',
        topics: [],
        tree: ['package.json', 'src/app.ts', 'private/tree-only.ts'],
      },
      title: 'Alpha',
    }

    const rendered = renderAssessmentContext(context)

    expect(rendered).toContain('Allowed evidence paths: package.json, src/app.ts')
    expect(rendered).toContain('### package.json')
    expect(rendered).not.toContain('private/tree-only.ts')
  })
})

describe('case-study generation request', () => {
  it('uses the bounded extraction model and token budget', async () => {
    process.env.CLAUDE_API_KEY = 'test-key'
    let requestBody:
      { max_tokens: number; model: string; output_config?: { effort?: string } } | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: Request | string | URL, init?: RequestInit) => {
        if (typeof init?.body !== 'string') {
          throw new Error('expected a serialized request body')
        }
        requestBody = JSON.parse(init.body) as {
          max_tokens: number
          model: string
          output_config?: { effort?: string }
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ needsReview: ['client_name'], status: 'live' }),
                },
              ],
              model: 'claude-sonnet-4-5',
              stop_reason: 'end_turn',
              usage: { input_tokens: 100, output_tokens: 20 },
            }),
            { headers: { 'content-type': 'application/json' }, status: 200 },
          ),
        )
      }),
    )

    await generateCaseStudy({
      assessment: {
        slug: 'alpha',
        analysisFingerprint: 'a'.repeat(64),
        findings: [],
        generatedAt: '2026-08-09T00:00:00.000Z',
        status: 'unavailable',
        technologies: [],
        unavailableReason: 'No repository configured.',
        unknowns: [],
        version: 1,
      },
      context: {
        slug: 'alpha',
        gatheredAt: '2026-08-09T00:00:00.000Z',
        site: { navLinks: [], ok: true, signals: [], url: 'https://alpha.test/' },
        title: 'Alpha',
      },
      writeup: 'Alpha is a compact public website.',
    })

    expect(requestBody).toMatchObject({ max_tokens: 2500, model: 'claude-sonnet-4-5' })
    expect(requestBody?.output_config).not.toHaveProperty('effort')
  })
})
