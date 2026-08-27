import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  assertLocalDisposableTarget,
  assertSourceRightsQueryPlan,
  BackupIntegrityError,
  createBackupEnvelope,
  createIntegrityManifest,
  canonicalJson,
  closePhase1PostgresPool,
  decryptBackupEnvelope,
  PHASE1_SCHEMA_VERSION,
  readCheckpoint,
  restoreLogicalDump,
  writePrivateAtomicFile,
  writeCheckpoint,
} from '../../../scripts/phase1/recovery-core'

const key = Buffer.from('11'.repeat(32), 'hex')
const dump = {
  schema_version: PHASE1_SCHEMA_VERSION,
  tables: {
    sources: [{ id: 1, stable_id: '01J00000000000000000000001', content_hash: 'sha256:v1:abc', raw_ref: { namespace: 'raw-evidence', content_hash: 'sha256:v1:abc', version: 'v1', rights_state: 'first_party', deletion_state: 'active' } }],
    edges: [{ id: 1, stable_id: '01J00000000000000000000002', relation: 'supports' }],
    audit_events: [{ id: 1, stable_id: '01J00000000000000000000003', event_id: '01J00000000000000000000004', occurred_at: '2026-01-01T00:00:00.000Z', outcome: 'allowed' }],
  },
}

describe('P1-T03 recovery core', () => {
  it('force-releases every retained adapter client before awaiting pool shutdown', async () => {
    const releases: boolean[] = []
    let ended = false
    const pool = {
      _clients: [
        { _queryable: true, release: (destroy?: boolean) => { releases.push(Boolean(destroy)) } },
        { _queryable: false, release: (destroy?: boolean) => { releases.push(Boolean(destroy)) } },
      ],
      end: async () => { ended = true },
    }

    await closePhase1PostgresPool(pool)

    expect(releases).toEqual([true, true])
    expect(ended).toBe(true)
  })

  it('requires the source rights/deletion query to use its composite index', async () => {
    const queries: string[] = []
    await expect(assertSourceRightsQueryPlan({
      query: async (query) => {
        queries.push(query)
        return { rows: query.startsWith('EXPLAIN') ? [{ 'QUERY PLAN': [{ Plan: { Plans: [{ 'Node Type': 'Index Scan', 'Index Name': 'rights_state_deletion_state_idx', 'Actual Rows': 1, 'Actual Loops': 1 }] } }] }] : [] }
      },
    })).resolves.toBe('rights_state_deletion_state_idx')
    expect(queries).toEqual(['EXPLAIN (ANALYZE, FORMAT JSON) SELECT id FROM "sources" WHERE "rights_state" = $1 AND "deletion_state" = $2'])
  })

  it('forbids planner-GUC shortcuts and requires executed JSON plans in recovery code', async () => {
    const source = await readFile(path.resolve('scripts/phase1/recovery-core.ts'), 'utf8')
    expect(source).not.toMatch(/enable_seqscan/i)
    expect(source).toContain('EXPLAIN (ANALYZE, FORMAT JSON)')
    expect(source).toContain("'Actual Rows'")
    expect(source).toContain("'Actual Loops'")
  })

  it('accepts only an exact generated loopback source or restore identity', () => {
    expect(() => assertLocalDisposableTarget('postgres://user:password@127.0.0.1:5432/bo_p1_t03_01abcdef_source', 'p1l-01abcdef', 'bo_p1_t03_01abcdef_source')).not.toThrow()
    expect(() => assertLocalDisposableTarget('postgres://user:password@localhost:5432/postgres', 'p1l-01abcdef', 'postgres')).toThrow('database identity')
    expect(() => assertLocalDisposableTarget('postgres://user:password@host.neon.tech:5432/bo_p1_t03_01abcdef_source', 'p1l-01abcdef', 'bo_p1_t03_01abcdef_source')).toThrow('loopback')
  })

  it('rejects encrypted backups whose authenticated content or manifest changes', () => {
    const manifest = createIntegrityManifest(dump)
    expect(createIntegrityManifest(JSON.parse(canonicalJson(dump)))).toEqual(manifest)
    const envelope = createBackupEnvelope(dump, manifest, {
      run_id: 'p1l-01abcdef', source_database_identity: 'bo_p1_t03_01abcdef_source', key,
      now: new Date('2026-01-01T00:00:00.000Z'), expires_at: new Date('2026-01-02T00:00:00.000Z'),
    })
    expect(decryptBackupEnvelope(envelope, key)).toEqual(dump)
    expect(() => decryptBackupEnvelope({ ...envelope, auth_tag: Buffer.alloc(16).toString('base64') }, key)).toThrow(BackupIntegrityError)
    expect(() => decryptBackupEnvelope({ ...envelope, manifest: { ...manifest, relation_hash: 'f'.repeat(64) } }, key)).toThrow(BackupIntegrityError)
  })

  it('rejects canonical prompt, relation, and audit-content tampering even when the envelope is re-encrypted', () => {
    const complete = {
      schema_version: PHASE1_SCHEMA_VERSION,
      tables: {
        prompt_artifacts: [{ id: 1, stable_id: 'artifact-1', prompt_original_text: 'canonical prompt' }],
        prompt_artifacts_rels: [{ id: 1, parent_id: 1, path: 'model_refs', taxonomy_nodes_id: 1 }],
        audit_events: [{ id: 1, stable_id: 'audit-1', event_id: 'event-1', occurred_at: '2026-01-01T00:00:00.000Z', outcome: 'allowed', reason_code: 'canonical' }],
      },
    }
    const manifest = createIntegrityManifest(complete)
    const envelope = (tampered: typeof complete) => createBackupEnvelope(tampered, manifest, {
      run_id: 'p1l-01abcdef', source_database_identity: 'bo_p1_t03_01abcdef_source', key,
      now: new Date('2026-01-01T00:00:00.000Z'), expires_at: new Date('2026-01-02T00:00:00.000Z'),
    })

    expect(() => decryptBackupEnvelope(envelope({ ...complete, tables: { ...complete.tables, prompt_artifacts: [{ ...complete.tables.prompt_artifacts[0], prompt_original_text: 'tampered prompt' }] } }), key)).toThrow(BackupIntegrityError)
    expect(() => decryptBackupEnvelope(envelope({ ...complete, tables: { ...complete.tables, prompt_artifacts_rels: [{ ...complete.tables.prompt_artifacts_rels[0], taxonomy_nodes_id: 2 }] } }), key)).toThrow(BackupIntegrityError)
    expect(() => decryptBackupEnvelope(envelope({ ...complete, tables: { ...complete.tables, audit_events: [{ ...complete.tables.audit_events[0], reason_code: 'tampered' }] } }), key)).toThrow(BackupIntegrityError)
  })

  it('persists a checkpoint atomically and rejects a stale input hash', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'bo-p1-t03-checkpoint-'))
    const filePath = path.join(directory, 'checkpoint.json')
    const checkpoint = {
      run_id: 'p1l-01abcdef', database_identity: 'bo_p1_t03_01abcdef_source', schema_version: 1,
      query_hash: 'a'.repeat(64), input_hash: 'b'.repeat(64), cursor: 1000, attempt: 2,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:01:00.000Z',
    } as const
    await writeCheckpoint(filePath, checkpoint)
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(checkpoint)
    await expect(readCheckpoint(filePath, { ...checkpoint, input_hash: 'c'.repeat(64) })).rejects.toThrow('input_hash')
  })

  it('refuses a symlink checkpoint target without changing its referent', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'bo-p1-t03-checkpoint-link-'))
    const outside = path.join(directory, 'outside.json')
    const checkpointPath = path.join(directory, 'checkpoint.json')
    await writeFile(outside, 'preserve', 'utf8')
    await symlink(outside, checkpointPath)
    const checkpoint = {
      run_id: 'p1l-01abcdef', database_identity: 'bo_p1_t03_01abcdef_source', schema_version: 1,
      query_hash: 'a'.repeat(64), input_hash: 'b'.repeat(64), cursor: 1, attempt: 1,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:01:00.000Z',
    } as const
    await expect(writeCheckpoint(checkpointPath, checkpoint)).rejects.toThrow('symlink')
    await expect(readFile(outside, 'utf8')).resolves.toBe('preserve')
  })

  it('refuses a symlink checkpoint read without reading its referent', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'bo-p1-t03-checkpoint-read-link-'))
    const outside = path.join(directory, 'outside.json')
    const checkpointPath = path.join(directory, 'checkpoint.json')
    await writeFile(outside, '{"secret":"must-not-read"}', 'utf8')
    await symlink(outside, checkpointPath)
    await expect(readCheckpoint(checkpointPath, { run_id: 'p1l-01abcdef', database_identity: 'bo_p1_t03_01abcdef_source', schema_version: 1, query_hash: 'a'.repeat(64), input_hash: 'b'.repeat(64) })).rejects.toThrow('symlink')
  })

  it('refuses a symlink repair marker target without changing its referent', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'bo-p1-t03-repair-link-'))
    const outside = path.join(directory, 'outside.json')
    const marker = path.join(directory, 'seed-checkpoint-repair.json')
    await writeFile(outside, 'preserve', 'utf8')
    await symlink(outside, marker)
    await expect(writePrivateAtomicFile(marker, '{"repair":true}\n')).rejects.toThrow('symlink')
    await expect(readFile(outside, 'utf8')).resolves.toBe('preserve')
  })

  it('restores cyclic source-author and page-approval references after their target rows', async () => {
    const calls: Array<{ query: string; values: readonly unknown[] | undefined }> = []
    const client = {
      query: async (query: string, values?: readonly unknown[]) => {
        calls.push({ query, values })
        if (query.startsWith('SELECT pg_get_serial_sequence')) return { rows: [{ sequence: 'sources_id_seq' }] }
        return { rows: [] }
      },
      release: () => {},
    }
    await restoreLogicalDump({ connect: async () => client }, {
      schema_version: PHASE1_SCHEMA_VERSION,
      tables: {
        sources: [{ id: 1, stable_id: 'source-1', author_ref_id: 2 }],
        taxonomy_nodes: [{ id: 2, stable_id: 'author-2' }],
        page_records: [{ id: 3, stable_id: 'page-3', approval_edge_id: 4, reason_codes: ['fixture_not_generated'] }],
        edges: [{ id: 4, stable_id: 'edge-4' }],
      },
    })

    expect(calls[0]?.query).toBe('BEGIN')
    expect(calls.some((call) => call.query.startsWith('SELECT 1 FROM "users"'))).toBe(true)
    expect(calls.find((call) => call.query.startsWith('INSERT INTO "sources"'))?.values).toContain(null)
    const pageInsert = calls.find((call) => call.query.startsWith('INSERT INTO "page_records"'))?.values
    expect(pageInsert).toContain(null)
    expect(pageInsert).toContain('["fixture_not_generated"]')
    expect(calls.find((call) => call.query.startsWith('UPDATE "sources" SET "author_ref_id"'))?.values).toEqual([2, 1])
    expect(calls.find((call) => call.query.startsWith('UPDATE "page_records" SET "approval_edge_id"'))?.values).toEqual([4, 3])
    expect(calls.some((call) => call.query.startsWith('SELECT setval('))).toBe(true)
    expect(calls.at(-1)?.query).toBe('COMMIT')
  })
})
