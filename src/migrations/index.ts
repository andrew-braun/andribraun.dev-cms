import * as migration_20260118_075847 from './20260118_075847';
import * as migration_20260120_144049 from './20260120_144049';

export const migrations = [
  {
    up: migration_20260118_075847.up,
    down: migration_20260118_075847.down,
    name: '20260118_075847',
  },
  {
    up: migration_20260120_144049.up,
    down: migration_20260120_144049.down,
    name: '20260120_144049'
  },
];
