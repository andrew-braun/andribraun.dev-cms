import * as migration_20260108_155651 from './20260108_155651';
import * as migration_20260108_160002 from './20260108_160002';
import * as migration_20260108_160041_test_migration from './20260108_160041_test_migration';

export const migrations = [
  {
    up: migration_20260108_155651.up,
    down: migration_20260108_155651.down,
    name: '20260108_155651',
  },
  {
    up: migration_20260108_160002.up,
    down: migration_20260108_160002.down,
    name: '20260108_160002',
  },
  {
    up: migration_20260108_160041_test_migration.up,
    down: migration_20260108_160041_test_migration.down,
    name: '20260108_160041_test_migration'
  },
];
