import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import type { CapturedShot } from '../../scripts/ingest/lib/types'

import { replaceArtifactSet } from '../../scripts/ingest/lib/artifacts'
import { validateCapturedShots } from '../../scripts/ingest/lib/validation'

async function readJson(target: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(target, 'utf8'))
}

async function screenshotFixture(shots: Array<Pick<CapturedShot, 'alt' | 'file'>>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-shots-'))
  const shotsDir = path.join(root, 'shots')
  const manifest = path.join(root, 'shots.json')
  await fs.mkdir(shotsDir)
  for (const shot of shots) {
    await fs.writeFile(path.join(shotsDir, shot.file), 'old')
  }
  await fs.writeFile(manifest, `${JSON.stringify(shots)}\n`)
  return {
    manifest,
    replace: async (
      build: (staging: { dir: string; manifest: string }) => Promise<CapturedShot[]>,
    ) => await replaceArtifactSet({ build, targetDir: shotsDir, targetManifest: manifest }),
    shotsDir,
  }
}

describe('transactional screenshots', () => {
  it('preserves the previous screenshot set when capture fails', async () => {
    const fixture = await screenshotFixture([{ alt: 'old', file: 'old.png' }])
    await expect(
      fixture.replace(async (staging) => {
        await fs.writeFile(path.join(staging.dir, 'partial.png'), 'partial')
        throw new Error('capture failed')
      }),
    ).rejects.toThrow('capture failed')
    await expect(fs.readFile(path.join(fixture.shotsDir, 'old.png'), 'utf8')).resolves.toBe('old')
    await expect(readJson(fixture.manifest)).resolves.toEqual([{ alt: 'old', file: 'old.png' }])
  })

  it('rejects traversing and missing screenshot filenames before replacement', async () => {
    await expect(
      validateCapturedShots(
        [
          {
            alt: 'x',
            file: '../escape.png',
            height: 1,
            label: 'x',
            url: 'https://x.test',
            width: 1,
          },
        ],
        '/tmp/shots',
      ),
    ).rejects.toThrow('basename')
    await expect(
      validateCapturedShots(
        [{ alt: 'x', file: 'missing.png', height: 1, label: 'x', url: 'https://x.test', width: 1 }],
        '/tmp/shots',
      ),
    ).rejects.toThrow('missing')
  })

  it('restores both old artifacts when the manifest commit fails after the directory swap', async () => {
    const fixture = await screenshotFixture([{ alt: 'old', file: 'old.png' }])
    const png = Buffer.alloc(24)
    Buffer.from('89504e470d0a1a0a', 'hex').copy(png)
    png.writeUInt32BE(1, 16)
    png.writeUInt32BE(1, 20)

    await expect(
      replaceArtifactSet({
        build: async (staging) => {
          await fs.writeFile(path.join(staging.dir, 'new.png'), png)
          return [
            {
              alt: 'new',
              file: 'new.png',
              height: 1,
              hero: true,
              label: 'New',
              url: 'https://example.test',
              width: 1,
            },
          ]
        },
        hooks: {
          beforeManifestCommit: () => {
            throw new Error('manifest commit failed')
          },
        },
        targetDir: fixture.shotsDir,
        targetManifest: fixture.manifest,
      }),
    ).rejects.toThrow('manifest commit failed')
    await expect(fs.readFile(path.join(fixture.shotsDir, 'old.png'), 'utf8')).resolves.toBe('old')
    await expect(readJson(fixture.manifest)).resolves.toEqual([{ alt: 'old', file: 'old.png' }])
  })
})
