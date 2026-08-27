import * as migration_20260824_022230_phase1_payload_schema from './20260824_022230_phase1_payload_schema';
import * as migration_20260825_022400_phase1_locale_risk from './20260825_022400_phase1_locale_risk';
import * as migration_20260825_030000_phase1_golden_approval from './20260825_030000_phase1_golden_approval';
import * as migration_20260826_051335_phase3_projection_persistence from './20260826_051335_phase3_projection_persistence';
import * as migration_20260826_053407_phase3_projection_review_fixes from './20260826_053407_phase3_projection_review_fixes';
import * as migration_20260826_062322_workflow_runs_lease_index from './20260826_062322_workflow_runs_lease_index';
import * as migration_20260826_070000_phase3_phasea_fix_wave from './20260826_070000_phase3_phasea_fix_wave';
import * as migration_20260826_210000_source_provider_public_search from './20260826_210000_source_provider_public_search';
import * as migration_20260826_220000_source_semantic_provenance from './20260826_220000_source_semantic_provenance';
import * as migration_20260826_230000_publication_projection_bindings from './20260826_230000_publication_projection_bindings';
import * as migration_20260826_230100_payload_lock_relation_repair from './20260826_230100_payload_lock_relation_repair';
import * as migration_20260827_070000_payload_enable_rls from './20260827_070000_payload_enable_rls';

export const migrations = [
  {
    up: migration_20260824_022230_phase1_payload_schema.up,
    down: migration_20260824_022230_phase1_payload_schema.down,
    name: '20260824_022230_phase1_payload_schema',
  },
  {
    up: migration_20260825_022400_phase1_locale_risk.up,
    down: migration_20260825_022400_phase1_locale_risk.down,
    name: '20260825_022400_phase1_locale_risk',
  },
  {
    up: migration_20260825_030000_phase1_golden_approval.up,
    down: migration_20260825_030000_phase1_golden_approval.down,
    name: '20260825_030000_phase1_golden_approval',
  },
  {
    up: migration_20260826_051335_phase3_projection_persistence.up,
    down: migration_20260826_051335_phase3_projection_persistence.down,
    name: '20260826_051335_phase3_projection_persistence',
  },
  {
    up: migration_20260826_053407_phase3_projection_review_fixes.up,
    down: migration_20260826_053407_phase3_projection_review_fixes.down,
    name: '20260826_053407_phase3_projection_review_fixes',
  },
  {
    up: migration_20260826_062322_workflow_runs_lease_index.up,
    down: migration_20260826_062322_workflow_runs_lease_index.down,
    name: '20260826_062322_workflow_runs_lease_index'
  },
  {
    up: migration_20260826_070000_phase3_phasea_fix_wave.up,
    down: migration_20260826_070000_phase3_phasea_fix_wave.down,
    name: '20260826_070000_phase3_phasea_fix_wave'
  },
  {
    up: migration_20260826_210000_source_provider_public_search.up,
    down: migration_20260826_210000_source_provider_public_search.down,
    name: '20260826_210000_source_provider_public_search'
  },
  {
    up: migration_20260826_220000_source_semantic_provenance.up,
    down: migration_20260826_220000_source_semantic_provenance.down,
    name: '20260826_220000_source_semantic_provenance'
  },
  {
    up: migration_20260826_230000_publication_projection_bindings.up,
    down: migration_20260826_230000_publication_projection_bindings.down,
    name: '20260826_230000_publication_projection_bindings'
  },
  {
    up: migration_20260826_230100_payload_lock_relation_repair.up,
    down: migration_20260826_230100_payload_lock_relation_repair.down,
    name: '20260826_230100_payload_lock_relation_repair'
  },
  {
    up: migration_20260827_070000_payload_enable_rls.up,
    down: migration_20260827_070000_payload_enable_rls.down,
    name: '20260827_070000_payload_enable_rls'
  },
];
