import { describe, expect, it } from 'vitest'

import { InMemorySourceWritePlane } from '../../../src/source-adapters/checkpoint'
import { InMemoryCheckpointRepository } from '../../../src/source-adapters/checkpoint'
import { reconcilePendingRawEvidence } from '../../../src/source-adapters/reconcile-pending'
import type { RawEvidenceStore } from '../../../src/source-adapters/types'
import { LocalRawEvidenceStore } from '../../../src/source-adapters/twitter241'
import { LocalObjectStore } from '../../../src/storage/local-object-store'
import { principals } from '../../../src/access/principals'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const at = '2026-08-24T00:10:00.000Z'
const id = '01J0J0J0J0J0J0J0J0J0J0J0J0'
const raw = { namespace: 'raw-evidence' as const, bucket_class: 'private_raw' as const, key: `sha256/aa/${'a'.repeat(64)}`, content_hash: `sha256:v1:${'a'.repeat(64)}`, version: 'v1', size_bytes: 2, mime_type: 'application/json', rights_state: 'metadata_only' as const, deletion_state: 'active' as const }

describe('T06 durable pending raw reconciliation', () => {
  it('retains young or unverified evidence, then quarantines exactly once after an aged verified retry', async () => {
    let pending = true; let verifies = false; let failMark = true
    const store: RawEvidenceStore = {
      write: async () => { throw new Error('not used') },
      pendingRecoveryCandidates: async () => pending ? [{ receipt_id: 'receipt', ref: raw, actor_id: 'ingest', correlation_id: id, issued_at: '2026-08-24T00:00:00.000Z', disposition: 'claimed' }] : [],
      markDisposition: async () => { if (failMark) throw new Error('marker unavailable'); pending = false },
    }
    const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => id })
    await expect(reconcilePendingRawEvidence({ raw_store: store, write_plane: plane, now: at, min_age_ms: 60_000, verify_raw: async () => verifies })).resolves.toEqual({ committed: 0, quarantined: 0, retained: 1 })
    expect(plane.orphans()).toEqual([])
    verifies = true
    await expect(reconcilePendingRawEvidence({ raw_store: store, write_plane: plane, now: at, min_age_ms: 60_000, verify_raw: async () => verifies })).resolves.toEqual({ committed: 0, quarantined: 0, retained: 1 })
    expect(plane.orphans()).toHaveLength(1)
    failMark = false
    await expect(reconcilePendingRawEvidence({ raw_store: store, write_plane: plane, now: at, min_age_ms: 60_000, verify_raw: async () => verifies })).resolves.toEqual({ committed: 0, quarantined: 1, retained: 0 })
    expect(plane.orphans()).toHaveLength(1)
    expect(await store.pendingRecoveryCandidates()).toEqual([])
  })

  it('marks an existing retained orphan quarantined without creating a second orphan', async () => {
    let pending = true
    const store: RawEvidenceStore = { write: async () => { throw new Error('not used') }, pendingRecoveryCandidates: async () => pending ? [{ receipt_id: 'receipt', ref: raw, actor_id: 'ingest', correlation_id: id, issued_at: '2026-08-24T00:00:00.000Z', disposition: 'pending' }] : [], markDisposition: async () => { pending = false } }
    const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => id }); await plane.recordOrphan({ raw_ref: raw, raw_hash: raw.content_hash, reason: 'write_plane_failure' })
    await expect(reconcilePendingRawEvidence({ raw_store: store, write_plane: plane, now: at, min_age_ms: 60_000, verify_raw: async () => true })).resolves.toEqual({ committed: 0, quarantined: 1, retained: 0 })
    expect(plane.orphans()).toHaveLength(1)
  })

  it('blocks a late commit for the same receipt and correlation after recovery terminally quarantines it', async () => {
    let pending = true
    const store: RawEvidenceStore = { write: async () => { throw new Error('not used') }, pendingRecoveryCandidates: async () => pending ? [{ receipt_id: 'late-receipt', ref: raw, actor_id: 'ingest', correlation_id: id, issued_at: '2026-08-24T00:00:00.000Z', disposition: 'claimed' }] : [], markDisposition: async () => { pending = false } }
    const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => id }); const checkpoint = new InMemoryCheckpointRepository({ now: () => at })
    await expect(reconcilePendingRawEvidence({ raw_store: store, write_plane: plane, now: at, min_age_ms: 60_000, verify_raw: async () => true })).resolves.toEqual({ committed: 0, quarantined: 1, retained: 0 })
    await expect(plane.commit({ checkpoint, checkpoint_identity: 'reconcile:late', expected_checkpoint_revision: 0, checkpoint_next: { query_identity: 'Q01:Latest', adapter: 'twitter241', schema_version: 1, normalization_version: 1, query_hash: `sha256:v1:${'a'.repeat(64)}`, cursor: null, seen_cursors: [], seen_provider_record_ids: [], request_ledger: [], last_source_revision: raw.content_hash, consecutive_no_new_pages: 0, run_status: 'running', unit_status: 'open', stop_reason: null, attempt: 0 }, normalized: { provider: 'twitter241', provider_record_id: 'late', canonical_url: 'https://x.com/a/status/late', captured_at: at, title: null, text: 'x', author_id: 'a', author_handle: 'a', rights_state: 'metadata_only', rights_basis: null }, raw_ref: raw, raw_receipt_id: 'late-receipt', raw_receipt_actor_id: 'ingest', raw_receipt_authority: { resolve: async () => raw }, raw_hash: raw.content_hash, correlation_id: id, partial: false })).rejects.toThrow('terminally quarantined')
    expect(checkpoint.read('reconcile:late')).toBeUndefined(); expect(plane.sources()).toEqual([]); expect(plane.audits()).toEqual([]); expect(plane.orphans()).toHaveLength(1)
  })

  it('restarts a claimed real raw receipt and commits it when its source and immutable audit exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'p1-pending-claimed-'))
    try {
      const objectStore = new LocalObjectStore({ root_dir: root, signer_secret: 'reconcile-test' }); const local = new LocalRawEvidenceStore({ object_store: objectStore, principal: principals.ingestService, correlation_id: id })
      const bytes = new TextEncoder().encode('{"v":1}'); const contentHash = `sha256:v1:${(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex')}`
      const persisted = await local.write({ bytes, content_hash: contentHash }); const checkpoint = new InMemoryCheckpointRepository({ now: () => at }); const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => id })
      await plane.commit({ checkpoint, checkpoint_identity: 'reconcile:checkpoint', expected_checkpoint_revision: 0, checkpoint_next: { query_identity: 'Q01:Latest', adapter: 'twitter241', schema_version: 1, normalization_version: 1, query_hash: `sha256:v1:${'a'.repeat(64)}`, cursor: null, seen_cursors: [], seen_provider_record_ids: [], request_ledger: [], last_source_revision: contentHash, consecutive_no_new_pages: 0, run_status: 'running', unit_status: 'open', stop_reason: null, attempt: 0 }, normalized: { provider: 'twitter241', provider_record_id: 'reconcile', canonical_url: 'https://x.com/a/status/reconcile', captured_at: at, title: null, text: 'x', author_id: 'a', author_handle: 'a', rights_state: 'metadata_only', rights_basis: null }, raw_ref: persisted.ref, raw_receipt_id: persisted.receipt.receipt_id, raw_receipt_actor_id: persisted.actor_id, raw_receipt_authority: local.receiptAuthority(), raw_hash: contentHash, correlation_id: id, partial: false })
      const restarted = new LocalRawEvidenceStore({ object_store: new LocalObjectStore({ root_dir: root, signer_secret: 'reconcile-test' }), principal: principals.ingestService, correlation_id: id })
      expect((await restarted.pendingRecoveryCandidates())[0]).toMatchObject({ disposition: 'claimed' })
      await expect(reconcilePendingRawEvidence({ raw_store: restarted, write_plane: plane, now: at, min_age_ms: 0, verify_raw: async () => true })).resolves.toEqual({ committed: 1, quarantined: 0, retained: 0 })
      expect(await restarted.pendingRecoveryCandidates()).toEqual([]); expect(plane.orphans()).toEqual([])
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('rechecks source and immutable audit inside the write-plane serial boundary after recovery has listed the receipt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'p1-pending-race-'))
    try {
      const objectStore = new LocalObjectStore({ root_dir: root, signer_secret: 'reconcile-race', now: () => Date.parse('2026-08-24T00:00:00.000Z') }); const local = new LocalRawEvidenceStore({ object_store: objectStore, principal: principals.ingestService, correlation_id: id })
      const bytes = new TextEncoder().encode('{"v":3}'); const contentHash = `sha256:v1:${(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex')}`; const persisted = await local.write({ bytes, content_hash: contentHash })
      const checkpoint = new InMemoryCheckpointRepository({ now: () => at }); const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => id })
      let committed = false
      const commit = async () => {
        if (committed) return; committed = true
        await plane.commit({ checkpoint, checkpoint_identity: 'reconcile:race', expected_checkpoint_revision: 0, checkpoint_next: { query_identity: 'Q01:Latest', adapter: 'twitter241', schema_version: 1, normalization_version: 1, query_hash: `sha256:v1:${'a'.repeat(64)}`, cursor: null, seen_cursors: [], seen_provider_record_ids: [], request_ledger: [], last_source_revision: contentHash, consecutive_no_new_pages: 0, run_status: 'running', unit_status: 'open', stop_reason: null, attempt: 0 }, normalized: { provider: 'twitter241', provider_record_id: 'race', canonical_url: 'https://x.com/a/status/race', captured_at: at, title: null, text: 'x', author_id: 'a', author_handle: 'a', rights_state: 'metadata_only', rights_basis: null }, raw_ref: persisted.ref, raw_receipt_id: persisted.receipt.receipt_id, raw_receipt_actor_id: persisted.actor_id, raw_receipt_authority: local.receiptAuthority(), raw_hash: contentHash, correlation_id: id, partial: false })
      }
      await expect(reconcilePendingRawEvidence({ raw_store: local, write_plane: plane, now: '2026-08-24T00:12:00.000Z', min_age_ms: 60_000, verify_raw: async () => { await commit(); return true } })).resolves.toEqual({ committed: 1, quarantined: 0, retained: 0 })
      expect(plane.sources()).toHaveLength(1); expect(plane.audits().filter((entry) => entry.action === 'source.ingest.commit')).toHaveLength(1); expect(plane.orphans()).toEqual([])
      expect(await local.pendingRecoveryCandidates()).toEqual([])
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('quarantines an aged claimed real receipt after a prepublish write-plane failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'p1-pending-failed-'))
    try {
      const objectStore = new LocalObjectStore({ root_dir: root, signer_secret: 'reconcile-fail-test', now: () => Date.parse(at) }); const local = new LocalRawEvidenceStore({ object_store: objectStore, principal: principals.ingestService, correlation_id: id })
      const bytes = new TextEncoder().encode('{"v":2}'); const contentHash = `sha256:v1:${(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex')}`; const persisted = await local.write({ bytes, content_hash: contentHash })
      const checkpoint = new InMemoryCheckpointRepository({ now: () => at }); const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => id, fail_source: () => { throw new Error('prepublish source failure') } })
      await expect(plane.commit({ checkpoint, checkpoint_identity: 'reconcile:failed', expected_checkpoint_revision: 0, checkpoint_next: { query_identity: 'Q01:Latest', adapter: 'twitter241', schema_version: 1, normalization_version: 1, query_hash: `sha256:v1:${'a'.repeat(64)}`, cursor: null, seen_cursors: [], seen_provider_record_ids: [], request_ledger: [], last_source_revision: contentHash, consecutive_no_new_pages: 0, run_status: 'running', unit_status: 'open', stop_reason: null, attempt: 0 }, normalized: { provider: 'twitter241', provider_record_id: 'failed', canonical_url: 'https://x.com/a/status/failed', captured_at: at, title: null, text: 'x', author_id: 'a', author_handle: 'a', rights_state: 'metadata_only', rights_basis: null }, raw_ref: persisted.ref, raw_receipt_id: persisted.receipt.receipt_id, raw_receipt_actor_id: persisted.actor_id, raw_receipt_authority: local.receiptAuthority(), raw_hash: contentHash, correlation_id: id, partial: false })).rejects.toThrow('prepublish source failure')
      expect(checkpoint.read('reconcile:failed')).toBeUndefined(); expect(plane.sources()).toEqual([]); expect(plane.audits()).toEqual([])
      const restarted = new LocalRawEvidenceStore({ object_store: new LocalObjectStore({ root_dir: root, signer_secret: 'reconcile-fail-test', now: () => Date.parse(at) }), principal: principals.ingestService, correlation_id: id })
      await expect(reconcilePendingRawEvidence({ raw_store: restarted, write_plane: plane, now: '2026-08-24T00:12:00.000Z', min_age_ms: 60_000, verify_raw: async () => true })).resolves.toEqual({ committed: 0, quarantined: 1, retained: 0 })
      expect(plane.orphans()).toHaveLength(1); expect(await restarted.pendingRecoveryCandidates()).toEqual([])
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
