import * as migration_20250929_111647 from './20250929_111647';
import * as migration_20260822_083720_pseo_phase0_schema from './20260822_083720_pseo_phase0_schema';

export const migrations = [
  {
    up: migration_20250929_111647.up,
    down: migration_20250929_111647.down,
    name: '20250929_111647',
  },
  {
    up: migration_20260822_083720_pseo_phase0_schema.up,
    down: migration_20260822_083720_pseo_phase0_schema.down,
    name: '20260822_083720_pseo_phase0_schema'
  },
];
