import * as migration_20260118_075847 from './20260118_075847'
import * as migration_20260120_144049 from './20260120_144049'
import * as migration_20260221_073939 from './20260221_073939'

export const migrations = [
  {
    name: '20260118_075847',
    down: migration_20260118_075847.down,
    up: migration_20260118_075847.up,
  },
  {
    name: '20260120_144049',
    down: migration_20260120_144049.down,
    up: migration_20260120_144049.up,
  },
  {
    name: '20260221_073939',
    down: migration_20260221_073939.down,
    up: migration_20260221_073939.up,
  },
]
