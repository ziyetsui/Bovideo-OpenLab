import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { getPayload } from 'payload'

import { SERVICE_SCOPES, USER_ROLES } from '../../src/access/principals'
import { APPLICATION_LOCALES } from '../../src/contracts/locale'
import { RIGHTS_STATES } from '../../src/contracts/rights'
import { WORKFLOW_RUN_JOB_TYPES, WORKFLOW_RUN_STATUSES } from '../../src/contracts/workflow-run'
import {
  assertLocalDisposableTarget,
  assertPrivateOutputDirectory,
  closePhase1PostgresPool,
  canonicalJson,
  PHASE1_COLLECTIONS,
  PHASE1_SCHEMA_VERSION,
  readCheckpoint,
  writePrivateAtomicFile,
  type SeedCheckpoint,
  writeCheckpoint,
} from './recovery-core'

type Pool = { query: (query: string, values?: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }
type TransactionPool = Pool & { release: () => void }
type PostgreSQLPool = Pool & { connect: () => Promise<TransactionPool> }

export class FixtureConflictError extends Error {}

const timestamp = '2026-01-02T03:04:05.000Z'
const hash = (value: string) => `sha256:v1:${createHash('sha256').update(value).digest('hex')}`
const stableID = (number: number) => `01J000000000000000000${String(number).padStart(6, '0')}`
const objectRef = (namespace: 'raw-evidence' | 'public-media', contentHash: string, rights = 'first_party') => ({
  namespace,
  bucket_class: namespace === 'raw-evidence' ? 'private_raw' : 'worker_public',
  key: namespace === 'raw-evidence'
    ? `sha256/${contentHash.slice('sha256:v1:'.length, 'sha256:v1:'.length + 2)}/${contentHash.slice('sha256:v1:'.length)}`
    : `public/${contentHash.slice('sha256:v1:'.length)}.png`,
  content_hash: contentHash,
  version: 'v1',
  size_bytes: 1,
  mime_type: 'image/png',
  rights_state: rights,
  deletion_state: 'active',
})

const required = (value: string | undefined, name: string): string => {
  if (!value) throw new Error(`${name} is required`)
  return value
}
const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function checkSchema(pool: Pool): Promise<void> {
  const result = await pool.query('SELECT schema_version, compatibility FROM phase1_schema_metadata WHERE schema_version = $1', [PHASE1_SCHEMA_VERSION])
  if (result.rows.length !== 1 || result.rows[0].compatibility !== 'phase1-payload-postgres:additive:restore-required-for-rollback')
    throw new Error('required Phase 1 additive PostgreSQL schema metadata is absent')
}

const checkpointKeys = ['run_id', 'database_identity', 'schema_version', 'query_hash', 'input_hash', 'cursor', 'attempt', 'created_at', 'updated_at'] as const

const sameCheckpoint = (left: SeedCheckpoint, right: SeedCheckpoint): boolean =>
  checkpointKeys.every((key) => left[key] === right[key])

const validateCheckpoint = (checkpoint: SeedCheckpoint, expected: Pick<SeedCheckpoint, 'run_id' | 'database_identity' | 'schema_version' | 'query_hash' | 'input_hash'>, batchCount: number): void => {
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    if (checkpoint[key] !== expected[key]) throw new FixtureConflictError(`checkpoint ${key} does not match this run`)
  }
  if (!Number.isInteger(checkpoint.cursor) || checkpoint.cursor < 0 || checkpoint.cursor > batchCount)
    throw new FixtureConflictError('checkpoint cursor is outside the fixture batch range')
  if (!Number.isInteger(checkpoint.attempt) || checkpoint.attempt < 0 || checkpoint.attempt !== checkpoint.cursor)
    throw new FixtureConflictError('checkpoint attempt must advance exactly once per committed batch')
}

const readDatabaseCheckpoint = async (pool: Pool, runID: string): Promise<SeedCheckpoint | undefined> => {
  const result = await pool.query('SELECT run_id, database_identity, schema_version, query_hash, input_hash, cursor, attempt, created_at, updated_at FROM phase1_fixture_checkpoints WHERE run_id = $1', [runID])
  if (result.rows.length > 1) throw new FixtureConflictError('duplicate fixture checkpoint rows')
  const row = result.rows[0]
  if (!row) return undefined
  return {
    ...row,
    created_at: new Date(String(row.created_at)).toISOString(),
    updated_at: new Date(String(row.updated_at)).toISOString(),
  } as SeedCheckpoint
}

const writeDatabaseCheckpoint = async (pool: Pool, checkpoint: SeedCheckpoint, previous: SeedCheckpoint | undefined): Promise<void> => {
  if (!previous) {
    try {
      await pool.query('INSERT INTO phase1_fixture_checkpoints (run_id, database_identity, schema_version, query_hash, input_hash, cursor, attempt, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [checkpoint.run_id, checkpoint.database_identity, checkpoint.schema_version, checkpoint.query_hash, checkpoint.input_hash, checkpoint.cursor, checkpoint.attempt, checkpoint.created_at, checkpoint.updated_at])
    } catch (error) {
      throw new FixtureConflictError(`fixture checkpoint insert conflict: ${error instanceof Error ? error.message : String(error)}`)
    }
    return
  }
  const result = await pool.query('UPDATE phase1_fixture_checkpoints SET cursor = $1, attempt = $2, updated_at = $3 WHERE run_id = $4 AND database_identity = $5 AND schema_version = $6 AND query_hash = $7 AND input_hash = $8 AND cursor = $9 AND attempt = $10 RETURNING run_id', [checkpoint.cursor, checkpoint.attempt, checkpoint.updated_at, checkpoint.run_id, checkpoint.database_identity, checkpoint.schema_version, checkpoint.query_hash, checkpoint.input_hash, previous.cursor, previous.attempt])
  if (result.rows.length !== 1) throw new FixtureConflictError('fixture checkpoint changed concurrently or no longer matches this run')
}

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`

const canonicalFixtureValue = (value: unknown): unknown => {
  if (typeof value === 'string' && (/^[{[]/.test(value))) {
    try { return canonicalFixtureValue(JSON.parse(value)) } catch { return value }
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const instant = new Date(value)
    if (!Number.isNaN(instant.valueOf())) return instant.toISOString()
  }
  if (Array.isArray(value)) return value.map(canonicalFixtureValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== null && item !== undefined)
    .map(([key, item]) => [key, canonicalFixtureValue(item)]))
}

/** Inserts a fixture row once or proves the retained canonical row is identical. */
export async function insertFixtureRow(pool: Pool, table: string, values: Record<string, unknown>): Promise<void> {
  if (values.id === undefined) throw new FixtureConflictError(`${table} fixture row has no canonical id`)
  const existing = await pool.query(`SELECT row_to_json(row) AS value FROM (SELECT * FROM ${quoteIdentifier(table)} WHERE "id" = $1) AS row`, [values.id])
  if (existing.rows.length > 1) throw new FixtureConflictError(`${table} has duplicate canonical fixture id ${String(values.id)}`)
  if (existing.rows.length === 1) {
    const actual = canonicalFixtureValue(existing.rows[0].value) as Record<string, unknown>
    const expected = canonicalFixtureValue(values) as Record<string, unknown>
    if (canonicalJson(actual) !== canonicalJson(expected)) {
      const differentFields = [...new Set([...Object.keys(actual), ...Object.keys(expected)])]
        .filter((field) => canonicalJson(actual[field]) !== canonicalJson(expected[field]))
      throw new FixtureConflictError(`${table} fixture_conflict for canonical id ${String(values.id)} fields: ${differentFields.join(', ')}`)
    }
    return
  }
  const columns = Object.keys(values)
  try {
    await pool.query(`INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})`, columns.map((column) => values[column]))
  } catch (error) {
    throw new FixtureConflictError(`${table} fixture_conflict for canonical id ${String(values.id)}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function fixtureBatches(): Promise<readonly ((pool: Pool) => Promise<void>)[]> {
  const rawHash = hash('phase1-synthetic-raw-evidence')
  const publicHash = hash('phase1-synthetic-public-media')
  const rawRef = objectRef('raw-evidence', rawHash)
  const publicRef = objectRef('public-media', publicHash)
  const locales = APPLICATION_LOCALES
  const rights = RIGHTS_STATES
  const sourceStates = ['active', 'superseded', 'removed']
  const deletionStates = ['active', 'requested', 'removed']
  const workflowStates = ['missing', 'machine_draft', 'review', 'approved', 'published', 'blocked', 'stale', 'withdrawn']

  return [
    async (pool: Pool) => {
      for (const [index, role] of USER_ROLES.entries()) {
        const userID = index + 1
        await insertFixtureRow(pool, 'users', { id: userID, stable_id: stableID(userID), identity_kind: 'human', email: `${role}@fixture.invalid`, login_attempts: 0, created_at: timestamp, updated_at: timestamp })
        await insertFixtureRow(pool, 'users_roles', { id: userID, order: 1, parent_id: userID, value: role })
      }
      for (const [index, scope] of SERVICE_SCOPES.entries()) {
        const userID = USER_ROLES.length + index + 1
        await insertFixtureRow(pool, 'users', { id: userID, stable_id: stableID(userID), identity_kind: 'service', email: `${scope}-service@fixture.invalid`, login_attempts: 0, created_at: timestamp, updated_at: timestamp })
        await insertFixtureRow(pool, 'users_service_scopes', { id: userID, order: 1, parent_id: userID, value: scope })
      }
      await insertFixtureRow(pool, 'media', { id: 1, alt: 'synthetic public media', object_ref: JSON.stringify(publicRef), created_at: timestamp, updated_at: timestamp })
    },
    async (pool: Pool) => {
      for (const [index, right] of rights.entries()) {
        const id = index + 1
        await insertFixtureRow(pool, 'taxonomy_nodes', { id, stable_id: stableID(100 + id), revision: 1, schema_version: 1, source_version: 'fixture-v1', status: index === 6 ? 'retired' : 'active', node_type: ['output', 'model', 'use_case', 'style', 'technique', 'creator', 'subject'][index], stable_key: `fixture-${index}`, label: `Fixture ${index}`, promotion_state: ['candidate', 'reviewed', 'qualified', 'retired', 'candidate', 'reviewed', 'qualified'][index], inventory_count: 0, created_at: timestamp, updated_at: timestamp })
        await insertFixtureRow(pool, 'sources', { id, stable_id: stableID(200 + id), revision: 1, schema_version: 1, source_version: 'fixture-v1', status: sourceStates[index % sourceStates.length], provider: ['twitter241', 'first_party', 'submission', 'official_doc'][index % 4], provider_record_id: `fixture-${id}`, canonical_url: `https://fixture.invalid/source/${id}`, raw_ref: JSON.stringify(rawRef), captured_at: timestamp, content_hash: hash(`source-${id}`), author_ref_id: id, rights_state: right, rights_basis: right === 'display_licensed' || right === 'redistribution_licensed' || right === 'first_party' ? 'synthetic-first-party-basis' : null, deletion_state: deletionStates[index % deletionStates.length], created_at: timestamp, updated_at: timestamp })
        await insertFixtureRow(pool, 'taxonomy_nodes_rels', { id, order: 1, parent_id: id, path: 'evidence_refs', sources_id: id })
        await insertFixtureRow(pool, 'prompt_artifacts', { id, stable_id: stableID(300 + id), revision: 1, schema_version: 1, source_version: 'fixture-v1', status: ['draft', 'review', 'approved', 'published', 'blocked', 'withdrawn', 'draft'][index], kind: ['prompt', 'workflow', 'comparison', 'prompt', 'workflow', 'comparison', 'prompt'][index], canonical_label: `Fixture artifact ${id}`, prompt_original_text: `synthetic prompt ${id}`, original_language: 'en', outcome_media_type: ['image', 'video', 'unresolved'][index % 3], inputs_required: JSON.stringify(['prompt']), inputs_optional: JSON.stringify(['seed']), parameters: JSON.stringify({ quality: 'fixture' }), examples: JSON.stringify([{ id }]), workflow_steps: JSON.stringify([{ order: 1 }]), signals: JSON.stringify(['fixture']), source_id: id, rights_state: right, safety_state: index === 5 ? 'blocked' : index === 6 ? 'pending' : 'approved', evidence_state: index === 6 ? 'insufficient' : index === 0 ? 'pending' : 'verified', created_at: timestamp, updated_at: timestamp })
        await insertFixtureRow(pool, 'prompt_artifacts_prompt_variables', { id: `fixture-variable-${id}`, _order: 1, _parent_id: id, token: `value_${id}`, allowed_values: JSON.stringify(['fixture']), occurrences: 1 })
        await insertFixtureRow(pool, 'prompt_artifacts_rels', { id: id * 10, order: 1, parent_id: id, path: 'model_refs', taxonomy_nodes_id: id })
        await insertFixtureRow(pool, 'prompt_artifacts_rels', { id: id * 10 + 1, order: 2, parent_id: id, path: 'variation_refs', prompt_artifacts_id: id })
      }
    },
    async (pool: Pool) => {
      for (const [index, locale] of locales.entries()) {
        const id = index + 1
        await insertFixtureRow(pool, 'locale_variants', { id, stable_id: stableID(400 + id), revision: 1, schema_version: 1, source_version: 'fixture-v1', status: index === 15 ? 'withdrawn' : 'active', entity_key: `prompt-artifacts:${stableID(300 + ((index % 7) + 1))}`, locale, source_locale: 'en', translation_model: 'fixture-model-v1', translation_prompt_version: 'fixture-prompt-v1', localized_fields: JSON.stringify({ title: `fixture ${locale}` }), content_revision: 1, workflow_state: workflowStates[index % workflowStates.length], is_money_page: index === 0, last_content_editor_id: index === 0 ? 2 : null, last_content_editor_stable_id: index === 0 ? stableID(2) : null, reviewed_by_id: index === 3 || index === 4 ? 4 : null, reviewed_by_stable_id: index === 3 || index === 4 ? stableID(4) : null, reviewed_revision: index === 3 || index === 4 ? 1 : null, published_version: index === 4 ? 1 : null, created_at: timestamp, updated_at: timestamp })
        await insertFixtureRow(pool, 'locale_variants_rels', { id, order: 1, parent_id: id, path: 'entity', prompt_artifacts_id: (index % 7) + 1 })
        await insertFixtureRow(pool, 'locale_variants_rels', { id: id + 100, order: 2, parent_id: id, path: 'taxonomy_context', taxonomy_nodes_id: (index % 7) + 1 })
      }
    },
    async (pool: Pool) => {
      const relations = ['generated_with', 'produces', 'belongs_to', 'variation_of', 'supports', 'authored_by', 'sourced_from']
      for (const [index, relation] of relations.entries()) {
        const id = index + 1
        await insertFixtureRow(pool, 'edges', { id, stable_id: stableID(500 + id), revision: 1, schema_version: 1, source_version: 'fixture-v1', status: index === 6 ? 'retired' : 'active', from_key: `sources:${stableID(200 + id)}`, relation, to_key: `taxonomy-nodes:${stableID(100 + id)}`, confidence: 1, review_state: ['candidate', 'approved', 'rejected', 'candidate', 'approved', 'rejected', 'approved'][index], created_at: timestamp, updated_at: timestamp })
        await insertFixtureRow(pool, 'edges_rels', { id: id * 2, order: 1, parent_id: id, path: 'from', sources_id: id })
        await insertFixtureRow(pool, 'edges_rels', { id: id * 2 + 1, order: 2, parent_id: id, path: 'to', taxonomy_nodes_id: id })
        await insertFixtureRow(pool, 'edges_rels', { id: id * 2 + 100, order: 1, parent_id: id, path: 'evidence', sources_id: id })
      }
      for (const [index, state] of ['not_generated', 'discoverable_noindex', 'index_candidate', 'indexable', 'retired'].entries()) {
        const id = index + 1
        await insertFixtureRow(pool, 'page_records', { id, stable_id: stableID(600 + id), revision: 1, schema_version: 1, source_version: 'fixture-v1', status: state === 'retired' ? 'retired' : 'active', page_type: ['hub', 'gallery', 'entity', 'detail', 'detail'][index], locale: locales[index], root_object_key: `prompt-artifacts:${stableID(300 + id)}`, intent: `fixture ${state}`, inventory: JSON.stringify({ fixture: true }), qualification_score: JSON.stringify({ fixture: true }), qualification_input_hash: hash(`qualification-${id}`), qualification_rule_version: 'fixture-v1', approval_edge_id: 2, index_state: state, reason_codes: JSON.stringify([`fixture_${state}`]), created_at: timestamp, updated_at: timestamp })
        await insertFixtureRow(pool, 'page_records_rels', { id: id * 2, order: 1, parent_id: id, path: 'root_object', prompt_artifacts_id: id })
        await insertFixtureRow(pool, 'page_records_rels', { id: id * 2 + 1, order: 1, parent_id: id, path: 'approval_evidence', sources_id: id })
        await insertFixtureRow(pool, 'page_records_rels', { id: id * 2 + 100, order: 2, parent_id: id, path: 'taxonomy_context', taxonomy_nodes_id: id })
        await insertFixtureRow(pool, 'page_records_primary_keyword_by_locale', { id: `fixture-keyword-${id}`, _order: 1, _parent_id: id, locale: locales[index], keyword: `fixture-${state}` })
      }
      for (const [index] of locales.entries()) {
        const id = index + 1
        await insertFixtureRow(pool, 'locale_variants_rels', { id: id + 200, order: 3, parent_id: id, path: 'page_context', page_records_id: (index % 5) + 1 })
      }
    },
    async (pool: Pool) => {
      for (const [index, outcome] of ['allowed', 'denied', 'failed', 'allowed'].entries()) await insertFixtureRow(pool, 'audit_events', { id: index + 1, stable_id: stableID(700 + index), revision: 1, schema_version: 1, source_version: 'fixture-v1', status: 'recorded', event_id: stableID(710 + index), actor_user_id: index === 1 ? null : index === 3 ? 7 : 1, actor_type: index === 1 ? 'anonymous' : index === 3 ? 'service' : 'user', actor_stable_id: index === 1 ? 'anonymous' : stableID(index === 3 ? 7 : 1), actor_service: index === 3 ? 'ingest' : null, correlation_id: stableID(720 + index), event_type: index === 1 ? 'sources.rights_override' : 'fixture.audit', entity_type: 'sources', entity_stable_id: stableID(201), outcome, prior_state: JSON.stringify({ right: 'unknown' }), new_state: JSON.stringify({ right: 'first_party' }), reason_code: index === 1 ? 'high_risk_denied' : 'fixture', occurred_at: timestamp, created_at: timestamp, updated_at: timestamp })
      for (const [index, moduleType] of ['case', 'tutorial', 'prompt', 'comparison', 'faq', 'examples', 'provenance', 'action'].entries()) {
        const id = index + 1
        await insertFixtureRow(pool, 'module_envelopes', { id, stable_id: stableID(800 + id), revision: 1, schema_version: 1, source_version: 'fixture-v1', status: ['active', 'blocked', 'stale', 'active', 'blocked', 'stale', 'active', 'active'][index], module_id: stableID(810 + id), page_id: stableID(601), locale: locales[index], module_type: moduleType, module_version: 1, rights_state: rights[index % rights.length], content_hash: hash(`module-${id}`), generated_by: ['human', 'rule', 'rpa', 'llm', 'human', 'rule', 'rpa', 'llm'][index], observed_at: timestamp, review_state: ['candidate', 'approved', 'blocked', 'stale', 'candidate', 'approved', 'blocked', 'stale'][index], created_at: timestamp, updated_at: timestamp })
        await insertFixtureRow(pool, 'module_envelopes_rels', { id, order: 1, parent_id: id, path: 'source_refs', sources_id: (index % 7) + 1 })
      }
    },
    async (pool: Pool) => {
      for (const [index, state] of ['draft', 'preparing', 'validated', 'active', 'superseded', 'rolled_back', 'failed'].entries()) {
        const id = index + 1
        await insertFixtureRow(pool, 'publication_snapshots', { id, stable_id: stableID(900 + id), revision: 1, schema_version: 1, source_version: 'fixture-v1', status: 'recorded', publish_version: id, route_manifest_ref: `fixture://route/${id}`, sitemap_manifest_ref: `fixture://sitemap/${id}`, github_manifest_ref: `fixture://github/${id}`, content_tree_hash: hash(`tree-${id}`), validation_report_ref: `fixture://validation/${id}`, created_at: timestamp, updated_at: timestamp })
        await insertFixtureRow(pool, 'publication_states', { id, stable_id: stableID(1000 + id), revision: 1, schema_version: 1, source_version: 'fixture-v1', status: state, publish_version: id, reason_code: `fixture_${state}`, created_at: timestamp, updated_at: timestamp })
      }
      await insertFixtureRow(pool, 'active_publication_pointers', { id: 1, stable_id: stableID(1101), revision: 1, singleton_key: 'active-publication', publish_version: 4, previous_verified_version: 3, created_at: timestamp, updated_at: timestamp })
      for (const [index, status] of ['301', '308', '410'].entries()) await insertFixtureRow(pool, 'redirects', { id: index + 1, stable_id: stableID(1200 + index), revision: 1, schema_version: 1, source_version: 'fixture-v1', status, locale: locales[index], old_path: `/old-${status}`, target_path: status === '410' ? null : `/new-${status}`, reason_code: `fixture_${status}`, audit_correlation_id: stableID(1250 + index), created_at: timestamp, updated_at: timestamp })
      for (const [index, jobType] of WORKFLOW_RUN_JOB_TYPES.entries()) {
        const status = WORKFLOW_RUN_STATUSES[index % WORKFLOW_RUN_STATUSES.length]
        await insertFixtureRow(pool, 'workflow_runs', { id: index + 1, stable_id: stableID(1300 + index), revision: 1, schema_version: 1, source_version: 'fixture-v1', status, job_type: jobType, idempotency_key: `fixture-${jobType}`, attempt: index, input_ref: `fixture://input/${index}`, output_ref: status === 'succeeded' ? `fixture://output/${index}` : null, error_class: status === 'failed' ? 'fixture_error' : null, audit_correlation_id: stableID(1350 + index), created_at: timestamp, updated_at: timestamp })
      }
      for (const [index, status] of ['received', 'validated', 'withdrawing', 'surfaces_pending', 'completed', 'rejected', 'cancelled'].entries()) await insertFixtureRow(pool, 'deletion_requests', { id: index + 1, stable_id: stableID(1400 + index), revision: 1, schema_version: 1, source_version: 'fixture-v1', status, external_request_key: `fixture-delete-${index}`, scope: ['source', 'artifact', 'locale', 'page', 'export', 'source', 'artifact'][index], requested_by_id: 6, legal_basis: 'synthetic fixture legal basis', object_refs: JSON.stringify([rawRef]), reason_code: `fixture_${status}`, created_at: timestamp, updated_at: timestamp })
    },
  ]
}

const assertDistinctCoverage = async (pool: Pool, table: string, column: string, expected: readonly string[]): Promise<void> => {
  const result = await pool.query(`SELECT DISTINCT ${quoteIdentifier(column)} AS value FROM ${quoteIdentifier(table)}`)
  const actual = new Set(result.rows.map((row) => String(row.value)))
  const missing = expected.filter((value) => !actual.has(value))
  if (missing.length > 0) throw new FixtureConflictError(`${table}.${column} fixture coverage is missing: ${missing.join(', ')}`)
}

const assertFixtureTableCount = async (pool: Pool, table: string, expected: number): Promise<void> => {
  const result = await pool.query(`SELECT count(*)::int AS count FROM ${quoteIdentifier(table)}`)
  const actual = Number(result.rows[0]?.count ?? 0)
  if (actual !== expected) throw new FixtureConflictError(`${table} fixture coverage expected ${expected} rows, found ${actual}`)
}

const fixtureTableCounts = (): Readonly<Record<string, number>> => ({
  users: USER_ROLES.length + SERVICE_SCOPES.length,
  media: 1,
  sources: RIGHTS_STATES.length,
  prompt_artifacts: RIGHTS_STATES.length,
  taxonomy_nodes: RIGHTS_STATES.length,
  page_records: 5,
  locale_variants: APPLICATION_LOCALES.length,
  edges: RIGHTS_STATES.length,
  audit_events: 4,
  module_envelopes: 8,
  publication_snapshots: 7,
  publication_states: 7,
  active_publication_pointers: 1,
  redirects: 3,
  workflow_runs: WORKFLOW_RUN_JOB_TYPES.length,
  deletion_requests: 7,
  users_roles: USER_ROLES.length,
  users_service_scopes: SERVICE_SCOPES.length,
  prompt_artifacts_prompt_variables: RIGHTS_STATES.length,
  prompt_artifacts_rels: RIGHTS_STATES.length * 2,
  taxonomy_nodes_rels: RIGHTS_STATES.length,
  page_records_primary_keyword_by_locale: 5,
  page_records_rels: 15,
  locale_variants_rels: APPLICATION_LOCALES.length * 3,
  edges_rels: RIGHTS_STATES.length * 3,
  module_envelopes_rels: 8,
})

/** Machine-checks fixture breadth against the canonical application constants. */
export async function assertFixtureCoverage(pool: Pool): Promise<void> {
  for (const collection of PHASE1_COLLECTIONS) await assertFixtureTableCount(pool, collection.replaceAll('-', '_'), fixtureTableCounts()[collection.replaceAll('-', '_')] ?? 0)
  for (const [table, expected] of Object.entries(fixtureTableCounts())) await assertFixtureTableCount(pool, table, expected)
  await assertDistinctCoverage(pool, 'users', 'identity_kind', ['human', 'service'])
  await assertDistinctCoverage(pool, 'users_roles', 'value', USER_ROLES)
  await assertDistinctCoverage(pool, 'users_service_scopes', 'value', SERVICE_SCOPES)
  await assertDistinctCoverage(pool, 'sources', 'provider', ['twitter241', 'first_party', 'submission', 'official_doc'])
  await assertDistinctCoverage(pool, 'sources', 'rights_state', RIGHTS_STATES)
  await assertDistinctCoverage(pool, 'locale_variants', 'locale', APPLICATION_LOCALES)
  await assertDistinctCoverage(pool, 'prompt_artifacts', 'outcome_media_type', ['image', 'video', 'unresolved'])
  await assertDistinctCoverage(pool, 'workflow_runs', 'job_type', WORKFLOW_RUN_JOB_TYPES)
  await assertDistinctCoverage(pool, 'audit_events', 'actor_type', ['anonymous', 'user', 'service'])
  for (const table of ['prompt_artifacts_prompt_variables', 'prompt_artifacts_rels', 'taxonomy_nodes_rels', 'page_records_primary_keyword_by_locale', 'page_records_rels', 'locale_variants_rels', 'edges_rels', 'module_envelopes_rels']) {
    const result = await pool.query(`SELECT count(*)::int AS count FROM ${quoteIdentifier(table)}`)
    if (Number(result.rows[0]?.count ?? 0) < 1) throw new FixtureConflictError(`${table} relation/array coverage is empty`)
  }
}

export async function seedPhase1Fixture(): Promise<void> {
  const databaseURL = required(process.env.DATABASE_URL, 'DATABASE_URL')
  const runID = required(process.env.PHASE1_RUN_ID, 'PHASE1_RUN_ID')
  const databaseIdentity = required(process.env.PHASE1_DATABASE_IDENTITY, 'PHASE1_DATABASE_IDENTITY')
  assertLocalDisposableTarget(databaseURL, runID, databaseIdentity)
  const batchSize = Number(argument('--batch-size') ?? '1000')
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error('batch-size must be an integer from 1 through 1000')
  const interruptAfter = argument('--interrupt-after')
  const repairCheckpoint = process.argv.includes('--repair-checkpoint')
  const outputDirectory = required(process.env.PHASE1_OUTPUT_DIR, 'PHASE1_OUTPUT_DIR')
  await assertPrivateOutputDirectory(outputDirectory)
  const checkpointPath = path.join(outputDirectory, 'seed-checkpoint.json')
  const queryHash = hash('phase1-synthetic-fixture-v1')
  const inputHash = hash(canonicalJson({ schema_version: PHASE1_SCHEMA_VERSION, batch_size: batchSize }))
  const expected = { run_id: runID, database_identity: databaseIdentity, schema_version: PHASE1_SCHEMA_VERSION, query_hash: queryHash, input_hash: inputHash }
  const { createPayloadConfig } = await import('../../src/payload.config')
  const payload = await getPayload({ config: createPayloadConfig() })
  const livePool = payload.db.pool
  const pool = livePool as unknown as PostgreSQLPool
  try {
    await checkSchema(pool)
    const batches = await fixtureBatches()
    const databaseCheckpoint = await readDatabaseCheckpoint(pool, runID)
    const fileCheckpoint = await readCheckpoint(checkpointPath, expected)
    if (databaseCheckpoint) validateCheckpoint(databaseCheckpoint, expected, batches.length)
    if (fileCheckpoint) validateCheckpoint(fileCheckpoint, expected, batches.length)
    if (databaseCheckpoint && fileCheckpoint && !sameCheckpoint(databaseCheckpoint, fileCheckpoint))
      throw new FixtureConflictError('fixture checkpoint file diverges from the authoritative database checkpoint')
    if (!databaseCheckpoint && fileCheckpoint) throw new FixtureConflictError('fixture checkpoint file exists without an authoritative database checkpoint')
    if (databaseCheckpoint && !fileCheckpoint) {
      if (!repairCheckpoint) throw new FixtureConflictError('fixture checkpoint file is missing; rerun with --repair-checkpoint to mirror the authoritative database checkpoint')
      await writeCheckpoint(checkpointPath, databaseCheckpoint)
      await writePrivateAtomicFile(path.join(outputDirectory, 'seed-checkpoint-repair.json'), `${canonicalJson({ run_id: runID, database_identity: databaseIdentity, repaired_from: 'database-authoritative-checkpoint', repaired_at: timestamp })}\n`)
    }
    if (databaseCheckpoint?.cursor === batches.length) await assertFixtureCoverage(pool)
    let existing = databaseCheckpoint
    let cursor = existing?.cursor ?? 0
    for (; cursor < batches.length; cursor += 1) {
      const client = await pool.connect()
      const checkpoint: SeedCheckpoint = { ...expected, cursor: cursor + 1, attempt: (existing?.attempt ?? 0) + 1, created_at: existing?.created_at ?? timestamp, updated_at: timestamp }
      try {
        await client.query('BEGIN')
        await batches[cursor](client)
        await writeDatabaseCheckpoint(client, checkpoint, existing)
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      } finally {
        client.release()
      }
      await writeCheckpoint(checkpointPath, checkpoint)
      existing = checkpoint
      if (interruptAfter !== undefined && cursor + 1 >= Number(interruptAfter)) throw new Error(`intentional fixture interruption after batch ${cursor + 1}`)
    }
    await assertFixtureCoverage(pool)
  } finally {
    await payload.destroy()
    await closePhase1PostgresPool(livePool)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await seedPhase1Fixture()
