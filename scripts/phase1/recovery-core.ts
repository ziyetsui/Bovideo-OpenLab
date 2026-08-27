import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { lstat, open, readFile, rename } from 'node:fs/promises'
import path from 'node:path'

export const PHASE1_SCHEMA_VERSION = 1
export const PHASE1_MIGRATION_NAME = '20260824_022230_phase1_payload_schema'
export const PHASE1_COLLECTIONS = [
  'users', 'media', 'sources', 'prompt_artifacts', 'taxonomy_nodes', 'page_records',
  'locale_variants', 'edges', 'audit_events', 'module_envelopes', 'publication_snapshots',
  'publication_states', 'active_publication_pointers', 'redirects', 'workflow_runs',
  'deletion_requests',
] as const

export const PHASE1_DUMP_TABLES = [
  'users', 'users_roles', 'users_service_scopes', 'users_sessions', 'media', 'sources',
  'prompt_artifacts', 'prompt_artifacts_prompt_variables', 'prompt_artifacts_rels',
  'taxonomy_nodes', 'taxonomy_nodes_rels', 'page_records', 'page_records_primary_keyword_by_locale',
  'page_records_rels', 'locale_variants', 'locale_variants_rels', 'edges', 'edges_rels',
  'audit_events', 'module_envelopes', 'module_envelopes_rels', 'publication_snapshots',
  'publication_states', 'active_publication_pointers', 'redirects', 'workflow_runs',
  'deletion_requests', 'payload_kv', 'payload_locked_documents', 'payload_locked_documents_rels',
  'payload_preferences', 'payload_preferences_rels',
] as const

export type Queryable = { query: (query: string, values?: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }
type TransactionClient = Queryable & { release: () => void }
type TransactionalPool = { connect: () => Promise<TransactionClient> }
export type LogicalDump = Readonly<{ schema_version: number; tables: Record<string, Record<string, unknown>[]> }>
export type IntegrityManifest = Readonly<{
  format_version: 2
  schema_version: number
  collection_counts: Record<string, number>
  stable_id_hashes: Record<string, string>
  canonical_projection_hash: string
  relation_hash: string
  content_hash: string
  audit_chain_hash: string
  object_ref_hash: string
  manifest_hash: string
}>
export type BackupEnvelope = Readonly<{
  envelope_version: 1
  algorithm: 'aes-256-gcm'
  metadata: Readonly<{
    run_id: string
    source_database_identity: string
    schema_version: number
    created_at: string
    expires_at: string
    retention_class: 'local-disposable'
    plaintext_sha256: string
  }>
  manifest: IntegrityManifest
  iv: string
  auth_tag: string
  ciphertext: string
}>
export type SeedCheckpoint = Readonly<{
  run_id: string
  database_identity: string
  schema_version: number
  query_hash: string
  input_hash: string
  cursor: number
  attempt: number
  created_at: string
  updated_at: string
}>

export class LocalTargetGuardError extends Error {}
export class CheckpointMismatchError extends Error {}
export class BackupIntegrityError extends Error {}

/**
 * Payload 3.88's Postgres adapter retains its initial health-check client.
 * Snapshot and force-release every client before ending the local CLI pool so
 * that a one-shot process can terminate. This deliberately uses pg's internal
 * pool client list only in these disposable, local-only scripts.
 */
export async function closePhase1PostgresPool(pool: { end: () => Promise<void>; _clients?: Array<{ release?: (destroy?: boolean) => void; _queryable?: boolean }> }): Promise<void> {
  const held = [...(pool._clients ?? [])]
  for (const client of held) {
    try {
      client.release?.(true)
    } catch (error) {
      if (!(error instanceof Error) || !/already been released/i.test(error.message)) throw error
    }
  }
  await pool.end()
}

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

/** Canonical JSON for deterministic local evidence; input is synthetic and finite. */
export const canonicalJson = (value: unknown): string => {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`
const localHostnames = new Set(['127.0.0.1', '::1', 'localhost'])

/** Rejects shared, world-readable, symlinked, or foreign-owned recovery roots. */
export async function assertPrivateOutputDirectory(directory: string): Promise<void> {
  const stats = await lstat(directory)
  if (!stats.isDirectory() || stats.isSymbolicLink() || stats.uid !== process.getuid?.() || (stats.mode & 0o777) !== 0o700)
    throw new BackupIntegrityError('output directory must be a current-user 0700 non-symlink root')
}

/** Rejects ambiguous or non-local destructive targets before any mutation. */
export function assertLocalDisposableTarget(databaseURL: string, runID: string, databaseIdentity: string): URL {
  if (!/^p1l-[a-z0-9][a-z0-9-]{7,63}$/.test(runID)) throw new LocalTargetGuardError('run_id must be an explicit generated p1l identifier')
  const parsed = new URL(databaseURL)
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !localHostnames.has(parsed.hostname))
    throw new LocalTargetGuardError('only explicit loopback PostgreSQL URLs are allowed')
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (!/^bo_p1_t03_[a-z0-9_]{8,63}_(source|restore)$/.test(databaseName) || databaseName !== databaseIdentity)
    throw new LocalTargetGuardError('database identity must name the explicit local disposable bo_p1_t03 source or restore database')
  if (/prod|production|render|neon|remote/i.test(databaseURL)) throw new LocalTargetGuardError('ambiguous or remote-looking database URL rejected')
  return parsed
}

export function requireBackupKey(value: string | undefined): Buffer {
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) throw new BackupIntegrityError('PHASE1_BACKUP_KEY must be an injected 32-byte hexadecimal key')
  return Buffer.from(value, 'hex')
}

const discoverObjectRefs = (value: unknown, facts: unknown[]): void => {
  if (Array.isArray(value)) return value.forEach((item) => discoverObjectRefs(item, facts))
  if (!value || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if (typeof record.namespace === 'string' && typeof record.content_hash === 'string' && typeof record.version === 'string') {
    facts.push({ namespace: record.namespace, content_hash: record.content_hash, version: record.version, rights_state: record.rights_state, deletion_state: record.deletion_state })
  }
  Object.values(record).forEach((item) => discoverObjectRefs(item, facts))
}

/** Reads a stable logical dump; it intentionally excludes migration/control metadata. */
export async function readLogicalDump(pool: Queryable): Promise<LogicalDump> {
  const tables: Record<string, Record<string, unknown>[]> = {}
  for (const table of PHASE1_DUMP_TABLES) {
    const result = await pool.query(`SELECT row_to_json(row) AS value FROM (SELECT * FROM ${quoteIdentifier(table)} ORDER BY id) AS row`)
    tables[table] = result.rows.map((row) => row.value as Record<string, unknown>)
  }
  return { schema_version: PHASE1_SCHEMA_VERSION, tables }
}

const findExecutedIndex = (value: unknown, expected: string): boolean => {
  if (Array.isArray(value)) {
    return value.some((item) => findExecutedIndex(item, expected))
  }
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const node = record['Node Type']
  if ((node === 'Index Scan' || node === 'Index Only Scan' || node === 'Bitmap Index Scan') && record['Index Name'] === expected && Number(record['Actual Rows']) > 0 && Number(record['Actual Loops']) > 0) return true
  return Object.values(record).some((item) => findExecutedIndex(item, expected))
}

/** Proves the migrated composite rights/deletion index supports the guarded source lookup. */
export async function assertSourceRightsQueryPlan(pool: Queryable): Promise<string> {
  const result = await pool.query('EXPLAIN (ANALYZE, FORMAT JSON) SELECT id FROM "sources" WHERE "rights_state" = $1 AND "deletion_state" = $2', ['first_party', 'active'])
  if (!findExecutedIndex(result.rows[0]?.['QUERY PLAN'], 'rights_state_deletion_state_idx')) throw new BackupIntegrityError('source rights/deletion query did not execute its required composite index')
  return 'rights_state_deletion_state_idx'
}

/** Executes each restore-critical lookup without planner GUCs and proves its declared index ran. */
export async function assertRestoreCriticalQueryPlans(pool: Queryable): Promise<readonly string[]> {
  const plans = [
    ['provider_provider_record_id_content_hash_idx', 'SELECT id FROM "sources" WHERE "provider" = $1 AND "provider_record_id" = $2 AND "content_hash" = $3', ['first_party', 'plan-1', 'sha256:v1:plan-1']],
    ['entity_key_locale_source_version_idx', 'SELECT id FROM "locale_variants" WHERE "entity_key" = $1 AND "locale" = $2 AND "source_version" = $3', ['plan-entity-1', 'en', 'plan-v1']],
    ['page_type_root_object_key_locale_idx', 'SELECT id FROM "page_records" WHERE "page_type" = $1 AND "root_object_key" = $2 AND "locale" = $3', ['detail', 'plan-root-1', 'en']],
    ['publish_version_idx', 'SELECT id FROM "publication_snapshots" WHERE "publish_version" = $1', [10001]],
    ['singleton_key_idx', 'SELECT id FROM "active_publication_pointers" WHERE "singleton_key" = $1', ['plan-pointer-1']],
  ] as const
  const found: string[] = []
  for (const [index, query, values] of plans) {
    const result = await pool.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${query}`, values)
    if (!findExecutedIndex(result.rows[0]?.['QUERY PLAN'], index)) throw new BackupIntegrityError(`restore-critical query did not execute ${index}`)
    found.push(index)
  }
  return found
}

/**
 * No dumped Phase 1 field is excluded: the synthetic local dump contains no
 * server-maintained volatile field that cannot round-trip exactly. Keeping the
 * list explicit makes future exclusions a reviewed manifest-format change.
 */
export const PHASE1_MANIFEST_EXCLUDED_FIELDS: Readonly<Record<string, readonly string[]>> = {}

/** Creates a deterministic manifest over every canonical collection and relation row. */
export function createIntegrityManifest(dump: LogicalDump): IntegrityManifest {
  // PostgreSQL JSON rows never preserve JavaScript `undefined`; normalize before
  // hashing so a manifest made before encryption equals one after decryption.
  const normalized = JSON.parse(canonicalJson(dump)) as LogicalDump
  const canonicalProjection = Object.fromEntries(Object.entries(normalized.tables)
    .map(([table, rows]) => [table, rows.map((row) => Object.fromEntries(Object.entries(row)
      .filter(([field]) => !(PHASE1_MANIFEST_EXCLUDED_FIELDS[table] ?? []).includes(field))))
      .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)))]))
  const collection_counts = Object.fromEntries(PHASE1_COLLECTIONS.map((collection) => [collection, normalized.tables[collection]?.length ?? 0]))
  const stable_id_hashes = Object.fromEntries(PHASE1_COLLECTIONS.map((collection) => {
    const ids = (normalized.tables[collection] ?? []).map((row) => String(row.stable_id ?? row.event_id ?? row.id)).sort()
    return [collection, sha256(canonicalJson(ids))]
  }))
  const relationRows = Object.entries(normalized.tables).filter(([table]) => table.endsWith('_rels') || table === 'edges').flatMap(([, rows]) => rows)
  const contentRows = Object.values(normalized.tables).flatMap((rows) => rows.map((row) => ({ content_hash: row.content_hash, content_tree_hash: row.content_tree_hash, raw_ref: row.raw_ref, object_ref: row.object_ref })))
  const audits = [...(normalized.tables.audit_events ?? [])].sort((left, right) => String(left.occurred_at).localeCompare(String(right.occurred_at)) || Number(left.id) - Number(right.id))
  let auditChain = 'phase1-audit-v1'
  for (const audit of audits) auditChain = sha256(`${auditChain}:${canonicalJson(audit)}`)
  const objectRefs: unknown[] = []
  Object.values(normalized.tables).forEach((rows) => rows.forEach((row) => discoverObjectRefs(row, objectRefs)))
  const bare = {
    format_version: 2 as const,
    schema_version: normalized.schema_version,
    collection_counts,
    stable_id_hashes,
    canonical_projection_hash: sha256(canonicalJson(canonicalProjection)),
    relation_hash: sha256(canonicalJson(relationRows)),
    content_hash: sha256(canonicalJson(contentRows)),
    audit_chain_hash: auditChain,
    object_ref_hash: sha256(canonicalJson(objectRefs.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))))),
  }
  return { ...bare, manifest_hash: sha256(canonicalJson(bare)) }
}

export function createBackupEnvelope(dump: LogicalDump, manifest: IntegrityManifest, input: Readonly<{ run_id: string; source_database_identity: string; key: Buffer; now: Date; expires_at: Date }>): BackupEnvelope {
  const plaintext = Buffer.from(canonicalJson(dump))
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', input.key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    envelope_version: 1,
    algorithm: 'aes-256-gcm',
    metadata: {
      run_id: input.run_id,
      source_database_identity: input.source_database_identity,
      schema_version: dump.schema_version,
      created_at: input.now.toISOString(),
      expires_at: input.expires_at.toISOString(),
      retention_class: 'local-disposable',
      plaintext_sha256: sha256(plaintext),
    },
    manifest,
    iv: iv.toString('base64'),
    auth_tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

export function decryptBackupEnvelope(envelope: BackupEnvelope, key: Buffer): LogicalDump {
  if (envelope.envelope_version !== 1 || envelope.algorithm !== 'aes-256-gcm') throw new BackupIntegrityError('unsupported backup envelope')
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(envelope.auth_tag, 'base64'))
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()])
    if (sha256(plaintext) !== envelope.metadata.plaintext_sha256) throw new BackupIntegrityError('logical dump checksum mismatch')
    const dump = JSON.parse(plaintext.toString('utf8')) as LogicalDump
    const actual = createIntegrityManifest(dump)
    if (actual.manifest_hash !== envelope.manifest.manifest_hash || canonicalJson(actual) !== canonicalJson(envelope.manifest))
      throw new BackupIntegrityError('backup manifest mismatch')
    return dump
  } catch (error) {
    if (error instanceof BackupIntegrityError) throw error
    throw new BackupIntegrityError('backup envelope authentication failed')
  }
}

const deferredRestoreReferences: Readonly<Record<string, string>> = {
  // The generated Payload 3.88 constraints are non-deferrable. These two
  // references form the only cycles in the state-complete fixture graph.
  sources: 'author_ref_id',
  page_records: 'approval_edge_id',
}

// Payload emits relation tables alongside their owning tables, but several
// polymorphic relations point at collections emitted later. Restore base rows
// first, then every relation/array table once all referenced parents exist.
const PHASE1_RESTORE_TABLES = [
  'users', 'users_roles', 'users_service_scopes', 'users_sessions', 'media', 'sources', 'prompt_artifacts',
  'taxonomy_nodes', 'taxonomy_nodes_rels', 'page_records', 'page_records_primary_keyword_by_locale',
  'locale_variants', 'edges', 'audit_events', 'module_envelopes', 'publication_snapshots',
  'publication_states', 'active_publication_pointers', 'redirects', 'workflow_runs', 'deletion_requests',
  'payload_kv', 'payload_locked_documents', 'payload_preferences', 'prompt_artifacts_prompt_variables',
  'prompt_artifacts_rels', 'page_records_rels', 'locale_variants_rels', 'edges_rels', 'module_envelopes_rels',
  'payload_locked_documents_rels', 'payload_preferences_rels',
] as const satisfies readonly (typeof PHASE1_DUMP_TABLES)[number][]

// node-postgres encodes JavaScript arrays as PostgreSQL arrays. This dump has
// no native SQL array columns, so JSONB arrays must remain JSON text on insert.
const restoreValue = (value: unknown): unknown => Array.isArray(value) ? JSON.stringify(value) : value

const assertRestoreTargetEmpty = async (client: Queryable): Promise<void> => {
  for (const table of PHASE1_DUMP_TABLES) {
    const result = await client.query(`SELECT 1 FROM ${quoteIdentifier(table)} LIMIT 1`)
    if (result.rows.length > 0) throw new BackupIntegrityError(`restore target is not empty: ${table}`)
  }
}

const synchronizeExplicitIDSequences = async (client: Queryable, dump: LogicalDump): Promise<void> => {
  for (const table of PHASE1_RESTORE_TABLES) {
    if ((dump.tables[table] ?? []).length === 0) continue
    const sequence = await client.query('SELECT pg_get_serial_sequence($1, $2) AS sequence', [table, 'id'])
    const name = sequence.rows[0]?.sequence
    if (typeof name !== 'string') continue
    await client.query(`SELECT setval($1, COALESCE((SELECT MAX("id") FROM ${quoteIdentifier(table)}), 1), true)`, [name])
  }
}

/** Restores only into an already-migrated empty local target in one transaction. */
export async function restoreLogicalDump(pool: TransactionalPool, dump: LogicalDump): Promise<void> {
  if (dump.schema_version !== PHASE1_SCHEMA_VERSION) throw new BackupIntegrityError('unsupported logical dump schema version')
  const client = await pool.connect()
  const deferred: Array<Readonly<{ table: string; column: string; id: unknown; value: unknown }>> = []
  try {
    await client.query('BEGIN')
    await assertRestoreTargetEmpty(client)
    for (const table of PHASE1_RESTORE_TABLES) {
      const rows = dump.tables[table] ?? []
      for (const row of rows) {
        const column = deferredRestoreReferences[table]
        const value = column ? row[column] : undefined
        const restoring = column && value !== undefined && value !== null ? { ...row, [column]: null } : row
        if (column && value !== undefined && value !== null) deferred.push({ table, column, id: row.id, value })
        const columns = Object.keys(restoring)
        if (columns.length === 0) continue
        const values = columns.map((name) => restoreValue(restoring[name]))
        await client.query(`INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})`, values)
      }
    }
    for (const reference of deferred) {
      await client.query(`UPDATE ${quoteIdentifier(reference.table)} SET ${quoteIdentifier(reference.column)} = $1 WHERE "id" = $2`, [reference.value, reference.id])
    }
    await synchronizeExplicitIDSequences(client, dump)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

export async function writeCheckpoint(filePath: string, checkpoint: SeedCheckpoint): Promise<void> {
  await writePrivateAtomicFile(filePath, `${canonicalJson(checkpoint)}\n`)
}

/** Writes a local recovery artifact without following an existing symlink. */
export async function writePrivateAtomicFile(filePath: string, content: string): Promise<void> {
  const directory = path.dirname(filePath)
  await assertPrivateOutputDirectory(directory)
  try {
    if ((await lstat(filePath)).isSymbolicLink()) throw new BackupIntegrityError('refusing symlink output target')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const temporary = path.join(directory, `.${path.basename(filePath)}.${randomBytes(12).toString('hex')}.tmp`)
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, filePath)
}

/** Reads a recovery artifact only when both its parent and target are non-links. */
export async function readPrivateOutputFile(filePath: string): Promise<string> {
  await assertPrivateOutputDirectory(path.dirname(filePath))
  const fileStats = await lstat(filePath)
  if (!fileStats.isFile() || fileStats.isSymbolicLink())
    throw new BackupIntegrityError('recovery artifact path must not traverse a symlink')
  return readFile(filePath, 'utf8')
}

export async function readCheckpoint(filePath: string, expected: Pick<SeedCheckpoint, 'run_id' | 'database_identity' | 'schema_version' | 'query_hash' | 'input_hash'>): Promise<SeedCheckpoint | undefined> {
  try {
    const parsed = JSON.parse(await readPrivateOutputFile(filePath)) as SeedCheckpoint
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) if (parsed[key] !== expected[key]) throw new CheckpointMismatchError(`checkpoint ${key} does not match this run`)
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
