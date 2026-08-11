import fs from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('ingest operator contract', () => {
  it('ignores generated work but not authored ingest inputs', async () => {
    const ignore = await fs.readFile('.gitignore', 'utf8')
    expect(ignore).toContain('/ingest/work/')
    expect(ignore).not.toMatch(/^\/ingest$/m)
  })

  it('documents explicit clearing and safe visibility updates', async () => {
    const docs = await fs.readFile('docs/ingest.md', 'utf8')
    expect(docs).toContain('"liveUrl": null')
    expect(docs).toContain('--visible=false')
    expect(docs).toContain('omitted fields preserve')
  })

  it('documents the source-backed assessment stage and strict AI failures', async () => {
    const docs = await fs.readFile('docs/ingest.md', 'utf8')
    expect(docs).toContain('repo-assessment.json')
    expect(docs).toContain('must cite an exact file path')
    expect(docs).toContain('`max_tokens`')
    expect(docs).not.toContain('a stub sidecar')
  })

  it('documents the advisory quality-report review step', async () => {
    const docs = await fs.readFile('docs/ingest.md', 'utf8')
    expect(docs).toContain('pnpm ingest quality')
    expect(docs).toContain('ingest/quality-report.json')
    expect(docs).toContain('Warnings are advisory')
  })
})
