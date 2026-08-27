/**
 * Phase-0 proof that the shipped Payload configuration, its real D1 schema and
 * Payload's migration engine can preserve a production-shaped local fixture.
 *
 * This script is intentionally local-only. It creates a fresh Miniflare state
 * directory for each run and never accepts `--remote` or Cloudflare credentials.
 */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { getPayload } from 'payload'

import * as initialMigration from '../src/migrations/20250929_111647'
import * as phaseZeroMigration from '../src/migrations/20260822_083720_pseo_phase0_schema'
import * as probeMigration from './migrations/20260822_160000_p0_roundtrip_probe'

const execFileAsync = promisify(execFile)
const runtimeDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defaultEvidenceDirectory = path.resolve(runtimeDirectory, '../phase0/d1-load/payload-real-evidence')
const wrangler = path.join(runtimeDirectory, 'node_modules/.bin/wrangler')
const locales = ['en', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'it-IT', 'es-ES', 'es-419', 'pt-BR', 'pt-PT', 'hi-IN', 'th-TH', 'tr-TR', 'vi-VN']
const basePerCollection = 1_250
const baseEntities = basePerCollection * 4
const relationshipCount = 100_000
const insertBatchRows = 250
const hashPageRows = 5_000
const timestamp = '2026-08-22T00:00:00.000Z'

type D1Row = Record<string, unknown>
type CommandRecord = { command: string; stderr: string }

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function rowHash(rows: D1Row[]): string {
  return hash(rows.map((row) => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))))).sort().join('\n'))
}

function sqlString(value: string | number | null): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number') return String(value)
  return `'${value.replaceAll("'", "''")}'`
}

function sqlIdentifier(value: string): string {
  return `\`${value.replaceAll('`', '``')}\``
}

function boundedInsert(table: string, columns: string[], rows: Array<Array<string | number | null>>): string[] {
  const statements: string[] = []
  for (let offset = 0; offset < rows.length; offset += insertBatchRows) {
    const batch = rows.slice(offset, offset + insertBatchRows)
    invariant(batch.length <= 1_000, `D1 batch is too large for ${table}`)
    statements.push(`INSERT INTO ${sqlIdentifier(table)} (${columns.map(sqlIdentifier).join(', ')}) VALUES\n${batch.map((row) => `(${row.map(sqlString).join(', ')})`).join(',\n')};`)
  }
  return statements
}

function fileChunks(statements: string[], statementsPerFile = 20): string[] {
  const files: string[] = []
  for (let offset = 0; offset < statements.length; offset += statementsPerFile) files.push(statements.slice(offset, offset + statementsPerFile).join('\n'))
  return files
}

/** Actual physical Payload tables, not the earlier synthetic harness tables. */
function buildPhysicalSeedStatements(): string[] {
  const sources = Array.from({ length: basePerCollection }, (_, index) => {
    const id = index + 1
    return [id, `source-${id}`, 1, `seed-source-${id}`, 'active', 'first_party', 'first_party', `p0-source-${id}`, `https://example.invalid/sources/${id}`, `synthetic://p0/source/${id}`, timestamp, hash(`source-${id}`), 'active']
  })
  const taxonomy = Array.from({ length: basePerCollection }, (_, index) => {
    const id = index + 1
    return [id, `taxonomy-${id}`, 1, `seed-taxonomy-${id}`, 'active', 'model', `model-${id}`, `Synthetic model ${id}`, 'qualified', id]
  })
  const prompts = Array.from({ length: basePerCollection }, (_, index) => {
    const id = index + 1
    return [id, `prompt-${id}`, 1, `seed-prompt-${id}`, 'approved', 'prompt', `Synthetic prompt ${id}`, `Synthetic prompt body ${id}`, 'image', `Synthetic outcome ${id}`, 'generation', '[]', '[]', '[]', '[]', '[]', '[]', id, 'first_party', 'approved', 'verified']
  })
  const pages = Array.from({ length: basePerCollection }, (_, index) => {
    const id = index + 1
    return [id, `page-${id}`, 1, `seed-page-${id}`, 'active', 'detail', `Synthetic page intent ${id}`, '[]', '{}', '{}', '{}', 'discoverable_noindex', '[]']
  })

  const localeVariants: Array<Array<string | number | null>> = []
  const localeRels: Array<Array<string | number | null>> = []
  for (let entity = 1; entity <= baseEntities; entity++) {
    for (let localeIndex = 0; localeIndex < locales.length; localeIndex++) {
      const id = (entity - 1) * locales.length + localeIndex + 1
      const locale = locales[localeIndex]
      localeVariants.push([id, `locale-${entity}-${locale}`, 1, `seed-locale-${entity}-${locale}`, 'active', locale, 'en', 'synthetic-model', 'p0', '{}', 1, 'pass', 'pass', 'pass', 5, 'approved', `v1-${locale}`])
      const relationID = ((entity - 1) % basePerCollection) + 1
      const type = entity <= basePerCollection ? 'prompt_artifacts_id' : entity <= basePerCollection * 2 ? 'taxonomy_nodes_id' : 'page_records_id'
      localeRels.push([id, 0, id, 'entity', type === 'prompt_artifacts_id' ? relationID : null, type === 'taxonomy_nodes_id' ? relationID : null, type === 'page_records_id' ? relationID : null])
    }
  }

  const pageRels = Array.from({ length: basePerCollection }, (_, index) => {
    const id = index + 1
    return [id, 0, id, 'root_object', id, null]
  })
  const promptRels = Array.from({ length: basePerCollection * 2 }, (_, index) => {
    const parent = (index % basePerCollection) + 1
    return [index + 1, 0, parent, index < basePerCollection ? 'model_refs' : 'taxonomy_refs', parent, null]
  })

  const edges: Array<Array<string | number | null>> = []
  const edgeRels: Array<Array<string | number | null>> = []
  for (let id = 1; id <= relationshipCount; id++) {
    const relationID = ((id - 1) % basePerCollection) + 1
    edges.push([id, `edge-${id}`, 1, `seed-edge-${id}`, 'active', id % 2 ? 'supports' : 'belongs_to', 0.9, 'approved', timestamp])
    edgeRels.push([id * 3 - 2, 0, id, 'from', relationID, null, null])
    edgeRels.push([id * 3 - 1, 0, id, 'to', null, relationID, null])
    edgeRels.push([id * 3, 0, id, 'evidence', relationID, null, null])
  }

  const audits: Array<Array<string | number | null>> = []
  const auditRels: Array<Array<string | number | null>> = []
  for (let id = 1; id <= baseEntities; id++) {
    const relationID = ((id - 1) % basePerCollection) + 1
    audits.push([id, `audit-${id}`, 1, `seed-audit-${id}`, 'recorded', 'seed-service', `p0-${id}`, 'seeded', '{}', '{}', timestamp])
    const type = id <= basePerCollection ? 'sources_id' : id <= basePerCollection * 2 ? 'prompt_artifacts_id' : id <= basePerCollection * 3 ? 'taxonomy_nodes_id' : 'page_records_id'
    auditRels.push([id, 0, id, 'entity', type === 'sources_id' ? relationID : null, type === 'prompt_artifacts_id' ? relationID : null, type === 'taxonomy_nodes_id' ? relationID : null, type === 'page_records_id' ? relationID : null, null, null])
  }

  return [
    ...boundedInsert('sources', ['id', 'stable_id', 'schema_version', 'source_version', 'status', 'rights_state', 'provider', 'provider_record_id', 'canonical_url', 'raw_ref', 'captured_at', 'content_hash', 'deletion_state'], sources),
    ...boundedInsert('taxonomy_nodes', ['id', 'stable_id', 'schema_version', 'source_version', 'status', 'node_type', 'stable_key', 'label', 'promotion_state', 'inventory_count'], taxonomy),
    ...boundedInsert('prompt_artifacts', ['id', 'stable_id', 'schema_version', 'source_version', 'status', 'kind', 'canonical_label', 'prompt_original_text', 'outcome_media_type', 'outcome_summary', 'outcome_capability', 'inputs_required', 'inputs_optional', 'parameters', 'examples', 'workflow_steps', 'signals', 'source_id', 'rights_state', 'safety_state', 'evidence_state'], prompts),
    ...boundedInsert('page_records', ['id', 'stable_id', 'schema_version', 'source_version', 'status', 'page_type', 'intent', 'inventory', 'demand_evidence', 'information_gain', 'qualification_score', 'index_state', 'reason_codes'], pages),
    ...boundedInsert('page_records_rels', ['id', 'order', 'parent_id', 'path', 'prompt_artifacts_id', 'taxonomy_nodes_id'], pageRels),
    ...boundedInsert('prompt_artifacts_rels', ['id', 'order', 'parent_id', 'path', 'taxonomy_nodes_id', 'prompt_artifacts_id'], promptRels),
    ...boundedInsert('locale_variants', ['id', 'stable_id', 'schema_version', 'source_version', 'status', 'locale', 'source_locale', 'translation_model', 'translation_prompt_version', 'localized_fields', 'quality_terminology_score', 'quality_placeholder_integrity', 'quality_factual_consistency', 'quality_language_detection', 'quality_human_score', 'workflow_state', 'published_version'], localeVariants),
    ...boundedInsert('locale_variants_rels', ['id', 'order', 'parent_id', 'path', 'prompt_artifacts_id', 'taxonomy_nodes_id', 'page_records_id'], localeRels),
    ...boundedInsert('edges', ['id', 'stable_id', 'schema_version', 'source_version', 'status', 'relation', 'confidence', 'review_state', 'valid_from'], edges),
    ...boundedInsert('edges_rels', ['id', 'order', 'parent_id', 'path', 'sources_id', 'prompt_artifacts_id', 'taxonomy_nodes_id'], edgeRels),
    ...boundedInsert('audit_events', ['id', 'stable_id', 'schema_version', 'source_version', 'status', 'actor_service', 'correlation_id', 'event_type', 'prior_state', 'new_state', 'occurred_at'], audits),
    ...boundedInsert('audit_events_rels', ['id', 'order', 'parent_id', 'path', 'sources_id', 'prompt_artifacts_id', 'taxonomy_nodes_id', 'page_records_id', 'locale_variants_id', 'edges_id'], auditRels),
  ]
}

function safeEnvironment(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, NO_COLOR: '1', FORCE_COLOR: '0' } as unknown as NodeJS.ProcessEnv
}

async function executeD1(persistDirectory: string, args: string[]): Promise<{ rows: D1Row[]; record: CommandRecord }> {
  invariant(!args.includes('--remote'), 'Remote D1 is forbidden in this harness')
  const command = [wrangler, 'd1', 'execute', 'D1', '--local', '--persist-to', persistDirectory, '--json', ...args]
  const { stdout, stderr } = await execFileAsync(command[0], command.slice(1), { cwd: runtimeDirectory, env: safeEnvironment(), maxBuffer: 64 * 1024 * 1024 })
  const parsed = JSON.parse(stdout) as Array<{ results?: D1Row[] }> | { results?: D1Row[] }
  const result = Array.isArray(parsed) ? parsed[0] : parsed
  return { rows: result?.results ?? [], record: { command: command.map((part) => JSON.stringify(part)).join(' '), stderr: stderr.trim() } }
}

async function directoryBytes(directory: string): Promise<number> {
  let bytes = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    bytes += entry.isDirectory() ? await directoryBytes(target) : entry.isFile() ? (await stat(target)).size : 0
  }
  return bytes
}

const countTables = ['sources', 'prompt_artifacts', 'taxonomy_nodes', 'page_records', 'locale_variants', 'edges', 'audit_events', 'page_records_rels', 'prompt_artifacts_rels', 'locale_variants_rels', 'edges_rels', 'audit_events_rels'] as const
const expectedCounts = { sources: 1_250, prompt_artifacts: 1_250, taxonomy_nodes: 1_250, page_records: 1_250, locale_variants: 80_000, edges: 100_000, audit_events: 5_000, page_records_rels: 1_250, prompt_artifacts_rels: 2_500, locale_variants_rels: 80_000, edges_rels: 300_000, audit_events_rels: 5_000 }

async function fullTableHash(persistDirectory: string, table: string): Promise<{ hash: string; rows: number; commands: CommandRecord[] }> {
  const commands: CommandRecord[] = []
  const columnsResult = await executeD1(persistDirectory, ['--command', `PRAGMA table_info(${sqlIdentifier(table)});`])
  commands.push(columnsResult.record)
  const columns = columnsResult.rows
    .map((row) => String(row.name))
    .filter((column) => column !== 'migration_probe_revision')
  invariant(columns.length > 0, `No columns returned for ${table}`)

  const digest = createHash('sha256')
  let rows = 0
  for (let offset = 0; ; offset += hashPageRows) {
    const page = await executeD1(persistDirectory, [
      '--command',
      `SELECT ${columns.map(sqlIdentifier).join(', ')} FROM ${sqlIdentifier(table)} ORDER BY id LIMIT ${hashPageRows} OFFSET ${offset};`,
    ])
    commands.push(page.record)
    for (const row of page.rows) {
      digest.update(JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))))
      digest.update('\n')
    }
    rows += page.rows.length
    if (page.rows.length < hashPageRows) break
  }
  return { hash: digest.digest('hex'), rows, commands }
}

async function observedState(persistDirectory: string): Promise<{ counts: Record<string, number>; fullHashes: Record<string, string>; sqliteMasterHash: string; commands: CommandRecord[] }> {
  const commands: CommandRecord[] = []
  const counts: Record<string, number> = {}
  const fullHashes: Record<string, string> = {}
  for (const table of countTables) {
    const count = await executeD1(persistDirectory, ['--command', `SELECT COUNT(*) AS count FROM ${table};`])
    commands.push(count.record)
    invariant(count.rows.length === 1, `No count returned for ${table}`)
    counts[table] = Number(count.rows[0].count)
    const full = await fullTableHash(persistDirectory, table)
    commands.push(...full.commands)
    invariant(full.rows === counts[table], `Full-hash row count differs from count for ${table}`)
    fullHashes[table] = full.hash
  }
  const schema = await executeD1(persistDirectory, ['--command', "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY type, name;"])
  commands.push(schema.record)
  return { counts, fullHashes, sqliteMasterHash: rowHash(schema.rows), commands }
}

function sameRecord(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function clearRemoteCredentials(): void {
  const mutableEnvironment = process.env as Record<string, string | undefined>
  for (const key of Object.keys(process.env)) {
    if (/^(CLOUDFLARE_|RAPIDAPI_|TWITTER241_|OPENAI_|ANTHROPIC_)/.test(key)) delete mutableEnvironment[key]
  }
  mutableEnvironment.PAYLOAD_SECRET = 'p0-local-only-not-a-deployment-secret'
  mutableEnvironment.PAYLOAD_REMOTE_BINDINGS = 'false'
  mutableEnvironment.PAYLOAD_MIGRATING = 'true'
  mutableEnvironment.NODE_ENV = 'test'
}

async function main(): Promise<void> {
  clearRemoteCredentials()
  const outputIndex = process.argv.indexOf('--output-directory')
  const evidenceDirectory = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1] ?? '') : defaultEvidenceDirectory
  invariant(outputIndex < 0 || Boolean(process.argv[outputIndex + 1]), '--output-directory requires a path')
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'bo-payload-real-d1-'))
  const persistDirectory = path.join(temporaryDirectory, 'persist')
  const seedDirectory = path.join(temporaryDirectory, 'seed')
  const commands: CommandRecord[] = []
  await mkdir(persistDirectory, { recursive: true })

  // The first generated Payload migration owns the migration-ledger table. Bootstrap it
  // through the same generated migration, then record it as batch 0 so the real adapter
  // can execute the requested [initial, pSEO] baseline as batch 1 without re-creating it.
  ;(process.env as Record<string, string | undefined>).PAYLOAD_LOCAL_BINDINGS_PATH = persistDirectory
  const { default: moduleDefaultConfig, createPayloadConfig, disposePayloadConfigContext } = await import('../src/payload.config.d1-legacy')
  await disposePayloadConfigContext(await moduleDefaultConfig)
  const config = await createPayloadConfig()
  const payload = await getPayload({ config, key: 'p0-real-d1-baseline' })
  const migrationArgs = { db: payload.db.drizzle, payload, req: undefined } as never
  await initialMigration.up(migrationArgs)
  const d1Client = (payload.db as unknown as { client: D1Database }).client
  await d1Client.prepare('INSERT INTO payload_migrations (id, name, batch) VALUES (?, ?, ?)').bind(1, '20250929_111647', 0).run()

  const baselineMigrations = [
    { name: '20250929_111647', up: initialMigration.up, down: initialMigration.down },
    { name: '20260822_083720_pseo_phase0_schema', up: phaseZeroMigration.up, down: phaseZeroMigration.down },
  ] as never
  await payload.db.migrate({ migrations: baselineMigrations })
  await disposePayloadConfigContext(config)

  await mkdir(seedDirectory, { recursive: true })
  const seedFiles: string[] = []
  for (const [index, content] of fileChunks(buildPhysicalSeedStatements()).entries()) {
    const file = path.join(seedDirectory, `physical-seed-${String(index + 1).padStart(3, '0')}.sql`)
    await writeFile(file, `${content}\n`)
    seedFiles.push(file)
  }
  for (const file of seedFiles) commands.push((await executeD1(persistDirectory, ['--file', file])).record)
  const beforeProbe = await observedState(persistDirectory)
  commands.push(...beforeProbe.commands)
  invariant(sameRecord(expectedCounts, beforeProbe.counts), 'Real Payload physical table counts do not match the Phase-0 contract')

  const probeMigrations = [...baselineMigrations, { name: '20260822_160000_p0_roundtrip_probe', up: probeMigration.up, down: probeMigration.down }] as never
  const probeConfig = await createPayloadConfig()
  const probePayload = await getPayload({ config: probeConfig, key: 'p0-real-d1-probe' })
  await probePayload.db.migrate({ migrations: probeMigrations })
  await disposePayloadConfigContext(probeConfig)
  const afterProbe = await observedState(persistDirectory)
  commands.push(...afterProbe.commands)
  const probePresent = await executeD1(persistDirectory, ['--command', "SELECT name FROM pragma_table_info('locale_variants') WHERE name = 'migration_probe_revision';"])
  commands.push(probePresent.record)
  invariant(probePresent.rows.length === 1, 'The second migration did not alter locale_variants')

  ;(process.env as Record<string, string | undefined>).PAYLOAD_LOCAL_MIGRATION_DIR = path.join(runtimeDirectory, 'scripts/migrations')
  const rollbackConfig = await createPayloadConfig()
  const rollbackPayload = await getPayload({ config: rollbackConfig, key: 'p0-real-d1-rollback' })
  await rollbackPayload.db.migrateDown()
  await disposePayloadConfigContext(rollbackConfig)
  const afterRollback = await observedState(persistDirectory)
  commands.push(...afterRollback.commands)
  const probeAbsent = await executeD1(persistDirectory, ['--command', "SELECT name FROM pragma_table_info('locale_variants') WHERE name = 'migration_probe_revision';"])
  commands.push(probeAbsent.record)
  invariant(probeAbsent.rows.length === 0, 'Rollback did not remove only the latest migration probe')

  const preservedCounts = sameRecord(beforeProbe.counts, afterProbe.counts) && sameRecord(beforeProbe.counts, afterRollback.counts)
  const preservedFullHashes = sameRecord(beforeProbe.fullHashes, afterProbe.fullHashes) && sameRecord(beforeProbe.fullHashes, afterRollback.fullHashes)
  const bytes = await directoryBytes(persistDirectory)
  const physicalRows = Object.values(expectedCounts).reduce((sum, count) => sum + count, 0)
  const d1LimitBytes = 10 * 1024 ** 3
  const forecastMonths = 12
  const monthlyGrowthMultiplier = 1
  const projectedPhysicalRows = physicalRows * (1 + forecastMonths * monthlyGrowthMultiplier)
  const projectedBytes = Math.ceil((bytes / physicalRows) * projectedPhysicalRows)
  const thresholdPercent = 70
  const thresholdBytes = Math.floor(d1LimitBytes * (thresholdPercent / 100))
  const capacity = {
    persisted_bytes: bytes,
    physical_rows: physicalRows,
    bytes_per_physical_row: bytes / physicalRows,
    current_d1_10_gib_utilization_percent: Number(((bytes / d1LimitBytes) * 100).toFixed(6)),
    forecast_months: forecastMonths,
    monthly_growth_multiplier: monthlyGrowthMultiplier,
    projected_physical_rows: projectedPhysicalRows,
    projected_bytes: projectedBytes,
    projected_utilization_percent: Number(((projectedBytes / d1LimitBytes) * 100).toFixed(6)),
    threshold_percent: thresholdPercent,
    threshold_bytes: thresholdBytes,
    gate: projectedBytes < thresholdBytes ? 'PASS' : 'FAIL',
  }
  const evidence = {
    schema_version: 1,
    historical_synthetic_harness_is_final_evidence: false,
    execution: { environment: 'local', remote: false, fresh_persist_directory: true, payload_adapter: '@payloadcms/db-d1-sqlite', payload_migration_engine: true },
    bootstrap: { method: 'generated initial migration up + batch-0 ledger row', reason: 'Payload migration ledger is itself created by the first generated migration' },
    expected_counts: expectedCounts,
    stages: { before_probe: beforeProbe, after_probe: afterProbe, after_rollback: afterRollback },
    migration: { baseline_batch: 1, second_batch: 2, probe_altered_locale_variants: probePresent.rows.length === 1, latest_batch_only_rolled_back: probeAbsent.rows.length === 0, counts_preserved: preservedCounts, full_table_hashes_preserved: preservedFullHashes },
    capacity,
    commands,
    verdict: preservedCounts && preservedFullHashes && probePresent.rows.length === 1 && probeAbsent.rows.length === 0 && capacity.gate === 'PASS' ? 'PASS' : 'FAIL',
  }
  await mkdir(evidenceDirectory, { recursive: true })
  await writeFile(path.join(evidenceDirectory, 'manifest.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  await writeFile(path.join(evidenceDirectory, 'report.md'), [
    '# P0 real Payload + D1 roundtrip', '', `Verdict: **${evidence.verdict}**`, '',
    `- local-only: ${evidence.execution.remote === false}`, `- Payload migration batches: baseline ${evidence.migration.baseline_batch}, probe ${evidence.migration.second_batch}`, `- core records: ${baseEntities.toLocaleString()} / locale variants: 80,000 / edges: 100,000 / audit events: 5,000`, `- physical relation rows: ${(physicalRows - 190_000).toLocaleString()}`, `- persisted bytes: ${bytes.toLocaleString()} (${capacity.bytes_per_physical_row.toFixed(2)} bytes/physical row)`, `- counts preserved through probe and rollback: ${preservedCounts}`, `- full-table hashes preserved through probe and rollback: ${preservedFullHashes}`, `- sqlite_master hash changed for probe then restored: ${beforeProbe.sqliteMasterHash === afterRollback.sqliteMasterHash && beforeProbe.sqliteMasterHash !== afterProbe.sqliteMasterHash}`, `- 12-month projected bytes: ${projectedBytes.toLocaleString()} (${capacity.projected_utilization_percent}% of 10 GiB)`, `- D1 70% capacity gate: ${capacity.gate}`, '', 'Machine-readable manifest: `manifest.json`. The older synthetic harness evidence is historical only and is not used as final Payload validation.', '',
  ].join('\n'))
  process.stdout.write(`Payload real D1 roundtrip ${evidence.verdict}: ${path.join(evidenceDirectory, 'manifest.json')}\n`)
  await rm(temporaryDirectory, { recursive: true, force: true })
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    process.exit(1)
  },
)
