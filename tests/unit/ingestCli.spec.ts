import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../scripts/ingest/commands/status', () => ({
  status: vi.fn(() => Promise.reject(new Error('fixture failure'))),
}))

vi.mock('../../scripts/ingest/commands/quality', () => ({
  quality: vi.fn(() => Promise.resolve()),
}))

describe('ingest CLI', () => {
  it('returns one for an unknown command', async () => {
    const { run } = await import('../../scripts/ingest/cli')
    await expect(run(['unknown'])).resolves.toBe(1)
  })

  it('returns one when a command throws', async () => {
    const { run } = await import('../../scripts/ingest/cli')
    await expect(run(['status'])).resolves.toBe(1)
  })

  it('runs the advisory quality command', async () => {
    const { run } = await import('../../scripts/ingest/cli')
    await expect(run(['quality'])).resolves.toBe(0)
  })

  it('runs through the Payload wrapper and exits nonzero on failure', async () => {
    const runFile = promisify(execFile)

    await expect(runFile('pnpm', ['ingest', 'unknown-command'])).rejects.toMatchObject({ code: 1 })
  }, 15_000)
})
