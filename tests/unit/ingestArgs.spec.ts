import { describe, expect, it } from 'vitest'

import { flagBoolean, flagNumber, parseArgs } from '../../scripts/ingest/lib/args'

describe('ingest arguments', () => {
  it.each([
    [['--visible'], true],
    [['--visible=true'], true],
    [['--visible=false'], false],
  ] as const)('parses strict booleans from %j', (argv, expected) => {
    expect(flagBoolean(parseArgs([...argv]), 'visible')).toBe(expected)
  })

  it('rejects non-boolean values', () => {
    expect(() => flagBoolean(parseArgs(['--visible=yes']), 'visible')).toThrow(
      '--visible must be true or false',
    )
  })

  it.each(['--max', '--max=NaN', '--max=0', '--max=2.5'])(
    'rejects invalid bounded integers: %j',
    (arg) => {
      expect(() =>
        flagNumber(parseArgs([arg]), 'max', { integer: true, max: 20, min: 1 }),
      ).toThrow()
    },
  )
})
