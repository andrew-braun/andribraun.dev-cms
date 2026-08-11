import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import type { Manifest, ManifestEntry } from '../../scripts/ingest/lib/types'

import {
  atomicWriteFile,
  fingerprintsFor,
  invalidateDerivedArtifacts,
  reconcileEntryArtifacts,
  recordStageCompletion,
} from '../../scripts/ingest/lib/artifacts'

async function fixture(entryChange: Partial<ManifestEntry> = {}, notes = 'old notes') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-artifacts-'))
  const workDir = path.join(root, 'work')
  const manifestPath = path.join(root, 'manifest.json')
  const entry: ManifestEntry = {
    slug: 'alpha',
    githubLink: 'https://github.com/example/alpha',
    liveUrl: 'https://alpha.example/',
    repo: 'example/alpha',
    screenshots: [{ label: 'Home', url: '/' }],
    stages: {},
    title: 'Alpha',
  }
  const inputs = fingerprintsFor(entry, notes)
  entry.stages = {
    analysisArtifact: 'b'.repeat(64),
    analysisInput: inputs.analysis,
    analyzedAt: '2026-08-01T00:00:00.000Z',
    assessedAt: '2026-08-01T00:00:00.000Z',
    caseStudyAt: '2026-08-01T00:00:00.000Z',
    shotsAt: '2026-08-01T00:00:00.000Z',
    shotsInput: inputs.shots,
    writeupAt: '2026-08-01T00:00:00.000Z',
  }
  entry.stages.assessmentInput = fingerprintsFor(entry, notes).assessment
  entry.stages.writeupInput = fingerprintsFor(entry, notes).writeup
  entry.stages.caseStudyInput = fingerprintsFor(entry, notes).caseStudy

  const entryDir = path.join(workDir, entry.slug)
  await fs.mkdir(path.join(entryDir, 'shots'), { recursive: true })
  await Promise.all([
    fs.writeFile(
      path.join(entryDir, 'context.json'),
      JSON.stringify({
        slug: 'alpha',
        gatheredAt: '2026-08-01T00:00:00.000Z',
        repo: {
          defaultBranch: 'main',
          files: { 'package.json': '{}' },
          languages: {},
          repo: 'example/alpha',
          topics: [],
          tree: ['package.json'],
        },
        title: 'Alpha',
      }),
    ),
    fs.writeFile(path.join(entryDir, 'context.md'), 'context'),
    fs.writeFile(
      path.join(entryDir, 'repo-assessment.json'),
      JSON.stringify({
        slug: 'alpha',
        analysisFingerprint: 'b'.repeat(64),
        findings: [
          {
            category: 'technology',
            claim: 'The repository has a package manifest.',
            confidence: 'high',
            evidence: [{ path: 'package.json', rationale: 'The file was analyzed.' }],
          },
        ],
        generatedAt: '2026-08-01T00:00:00.000Z',
        repository: 'example/alpha',
        status: 'assessed',
        technologies: [],
        unknowns: [],
        version: 1,
      }),
    ),
    fs.writeFile(path.join(entryDir, 'shots', 'old.png'), 'old'),
    fs.writeFile(path.join(entryDir, 'shots.json'), '[]'),
    fs.writeFile(path.join(entryDir, 'writeup.md'), 'writeup'),
    fs.writeFile(
      path.join(entryDir, 'case-study.json'),
      JSON.stringify({
        needsReview: [
          'summary',
          'client_name',
          'business_challenge',
          'contribution_highlights',
          'outcomes',
          'status',
        ],
      }),
    ),
  ])

  const changed = { ...entry, ...entryChange }
  const manifest: Manifest = {
    entries: [changed],
    updatedAt: '2026-08-09T00:00:00.000Z',
    version: 1,
  }
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { entryDir, manifestPath, notes, workDir }
}

async function exists(target: string): Promise<boolean> {
  return await fs
    .stat(target)
    .then(() => true)
    .catch(() => false)
}

describe('atomic artifacts', () => {
  it('does not replace a valid target when the temporary write fails', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-atomic-'))
    const target = path.join(root, 'state.json')
    await fs.writeFile(target, '{"old":true}\n')

    await expect(
      atomicWriteFile(target, 'new', {
        beforeRename: () => {
          throw new Error('stop')
        },
      }),
    ).rejects.toThrow('stop')
    await expect(fs.readFile(target, 'utf8')).resolves.toBe('{"old":true}\n')
  })
})

describe('dependency invalidation', () => {
  it('a completed analysis or screenshot run invalidates derived prose', () => {
    expect(invalidateDerivedArtifacts('analysis')).toEqual(['assessment', 'writeup', 'caseStudy'])
    expect(invalidateDerivedArtifacts('assessment')).toEqual(['caseStudy'])
    expect(invalidateDerivedArtifacts('shots')).toEqual(['writeup', 'caseStudy'])
    expect(invalidateDerivedArtifacts('writeup')).toEqual(['caseStudy'])
  })

  it.each([
    [
      'liveUrl',
      { liveUrl: 'https://new.example/' },
      ['analysis', 'assessment', 'shots', 'writeup', 'caseStudy'],
    ],
    [
      'githubLink',
      { githubLink: 'https://github.com/example/new' },
      ['analysis', 'assessment', 'writeup', 'caseStudy'],
    ],
    [
      'screenshots',
      { screenshots: [{ label: 'About', url: '/about' }] },
      ['shots', 'writeup', 'caseStudy'],
    ],
    ['snapshotLink', { snapshotLink: 'https://archive.example/' }, []],
    ['order', { order: 4 }, []],
  ] as const)('changing %s invalidates %j', async (_field, change, expected) => {
    const state = await fixture(change as Partial<ManifestEntry>)
    const result = await reconcileEntryArtifacts('alpha', state.notes, {
      manifestPath: state.manifestPath,
      workDir: state.workDir,
    })
    const invalidated = [
      ['analysis', !result.stages.analyzedAt],
      ['assessment', !result.stages.assessedAt],
      ['shots', !result.stages.shotsAt],
      ['writeup', !result.stages.writeupAt],
      ['caseStudy', !result.stages.caseStudyAt],
    ]
      .filter(([, removed]) => removed)
      .map(([stage]) => stage)
    expect(invalidated).toEqual(expected)
  })

  it('changing notes invalidates generated prose only', async () => {
    const state = await fixture()
    const result = await reconcileEntryArtifacts('alpha', 'new notes', {
      manifestPath: state.manifestPath,
      workDir: state.workDir,
    })
    expect(result.stages.analyzedAt).toBeDefined()
    expect(result.stages.assessedAt).toBeDefined()
    expect(result.stages.shotsAt).toBeDefined()
    expect(result.stages.writeupAt).toBeUndefined()
    expect(result.stages.caseStudyAt).toBeUndefined()
  })

  it('recording an assessment preserves the writeup and invalidates only the case study', async () => {
    const state = await fixture()
    const completed = await recordStageCompletion(
      'alpha',
      'assessment',
      '2026-08-09T01:02:03.000Z',
      state.notes,
      { manifestPath: state.manifestPath, workDir: state.workDir },
    )

    expect(completed.stages.writeupAt).toBeDefined()
    await expect(exists(path.join(state.entryDir, 'writeup.md'))).resolves.toBe(true)
    expect(completed.stages.caseStudyAt).toBeUndefined()
    await expect(exists(path.join(state.entryDir, 'case-study.json'))).resolves.toBe(false)
  })

  it('invalidates a stored assessment whose evidence path is not in analyzed files', async () => {
    const state = await fixture()
    const target = path.join(state.entryDir, 'repo-assessment.json')
    const assessment = JSON.parse(await fs.readFile(target, 'utf8'))
    assessment.findings[0].evidence[0].path = 'src/not-analyzed.ts'
    await fs.writeFile(target, JSON.stringify(assessment))

    const result = await reconcileEntryArtifacts('alpha', state.notes, {
      manifestPath: state.manifestPath,
      workDir: state.workDir,
    })

    expect(result.stages.assessedAt).toBeUndefined()
    expect(result.stages.writeupAt).toBeDefined()
    expect(result.stages.caseStudyAt).toBeUndefined()
    await expect(exists(target)).resolves.toBe(false)
  })

  it('invalidates parseable case-study JSON that does not satisfy the sidecar contract', async () => {
    const state = await fixture()
    const target = path.join(state.entryDir, 'case-study.json')
    await fs.writeFile(target, '{}')

    const result = await reconcileEntryArtifacts('alpha', state.notes, {
      manifestPath: state.manifestPath,
      workDir: state.workDir,
    })

    expect(result.stages.writeupAt).toBeDefined()
    expect(result.stages.caseStudyAt).toBeUndefined()
    await expect(exists(target)).resolves.toBe(false)
  })

  it('baselines a legacy timestamp without deleting its valid artifact', async () => {
    const state = await fixture()
    const raw = JSON.parse(await fs.readFile(state.manifestPath, 'utf8')) as Manifest
    delete raw.entries[0].stages.analysisInput
    await fs.writeFile(state.manifestPath, `${JSON.stringify(raw, null, 2)}\n`)

    const result = await reconcileEntryArtifacts('alpha', state.notes, {
      manifestPath: state.manifestPath,
      workDir: state.workDir,
    })
    await expect(fs.stat(path.join(state.entryDir, 'context.json'))).resolves.toBeDefined()
    expect(result.stages.analysisInput).toMatch(/^[a-f0-9]{64}$/)
  })

  it('records a completed analysis last and removes prose derived from the old result', async () => {
    const state = await fixture()
    const completed = await recordStageCompletion(
      'alpha',
      'analysis',
      '2026-08-09T01:02:03.000Z',
      state.notes,
      { manifestPath: state.manifestPath, workDir: state.workDir },
    )

    expect(completed.stages.analyzedAt).toBe('2026-08-09T01:02:03.000Z')
    expect(completed.stages.analysisInput).toMatch(/^[a-f0-9]{64}$/)
    expect(completed.stages.assessedAt).toBeUndefined()
    await expect(exists(path.join(state.entryDir, 'repo-assessment.json'))).resolves.toBe(false)
    expect(completed.stages.writeupAt).toBeUndefined()
    await expect(exists(path.join(state.entryDir, 'writeup.md'))).resolves.toBe(false)
    await expect(exists(path.join(state.entryDir, 'case-study.json'))).resolves.toBe(false)
  })
})
