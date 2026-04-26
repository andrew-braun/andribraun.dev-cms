import * as migration_20260118_075847 from './20260118_075847'
import * as migration_20260120_144049 from './20260120_144049'
import * as migration_20260221_073939 from './20260221_073939'
import * as migration_20260221_094701 from './20260221_094701'
import * as migration_20260305_150010 from './20260305_150010'
import * as migration_20260426_062647 from './20260426_062647'

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
  {
    name: '20260221_094701',
    down: migration_20260221_094701.down,
    up: migration_20260221_094701.up,
  },
  {
    name: '20260305_150010',
    down: migration_20260305_150010.down,
    up: migration_20260305_150010.up,
  },
  {
    name: '20260426_062647',
    down: migration_20260426_062647.down,
    up: migration_20260426_062647.up,
  },
]
