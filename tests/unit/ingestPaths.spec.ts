import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { assertNoSymlinkComponents, resolveContained } from '../../scripts/ingest/lib/paths'

describe('resolveContained', () => {
  it('returns a child path', () => {
    expect(resolveContained('/tmp/root', 'safe', 'file.json')).toBe('/tmp/root/safe/file.json')
  })

  it.each(['../outside', '/etc/passwd'])('rejects escape segment %j', (segment) => {
    expect(() => resolveContained('/tmp/root', segment)).toThrow('escapes')
  })

  it('rejects a symlink component inside a write root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-paths-'))
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-outside-'))
    await fs.symlink(outside, path.join(root, 'linked'))

    await expect(
      assertNoSymlinkComponents(root, path.join(root, 'linked', 'file')),
    ).rejects.toThrow('symlink')
  })
})
