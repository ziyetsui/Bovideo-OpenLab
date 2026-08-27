import { describe, expect, it } from 'vitest'

import { InMemoryCheckpointRepository, InMemorySourceWritePlane, type CheckpointNext } from '../../../src/source-adapters/checkpoint'
import type { NormalizedSourceRecord } from '../../../src/source-adapters/types'

const initial = Date.parse('2026-08-24T00:00:00.000Z')
const correlation = '01J0J0J0J0J0J0J0J0J0J0J0J0'
const sourceId = '01J0J0J0J0J0J0J0J0J0J0J0J1'
const auditId = '01J0J0J0J0J0J0J0J0J0J0J0J2'
const rawHash = `sha256:v1:${'a'.repeat(64)}`
const otherHash = `sha256:v1:${'b'.repeat(64)}`
const raw = (content_hash = rawHash) => ({ namespace: 'raw-evidence' as const, bucket_class: 'private_raw' as const, key: `sha256/aa/${content_hash.slice(-64)}`, content_hash, version: 'v1', size_bytes: 2, mime_type: 'application/json', rights_state: 'metadata_only' as const, deletion_state: 'active' as const })
const next: CheckpointNext = { query_identity: 'Q01:Latest', adapter: 'twitter241', schema_version: 1, normalization_version: 1, query_hash: rawHash, cursor: null, seen_cursors: [], seen_provider_record_ids: [], request_ledger: [], last_source_revision: rawHash, consecutive_no_new_pages: 0, run_status: 'running', unit_status: 'open', stop_reason: null, attempt: 0 }
const record: NormalizedSourceRecord = { provider: 'twitter241', provider_record_id: 'tweet', canonical_url: 'https://x.com/a/status/tweet', captured_at: new Date(initial).toISOString(), title: null, text: 'x', author_id: 'a', author_handle: 'a', rights_state: 'metadata_only', rights_basis: null }

const fixture = () => {
  let now = initial
  const checkpoint = new InMemoryCheckpointRepository({ now: () => new Date(now).toISOString() })
  let ids = 0
  const plane = new InMemorySourceWritePlane({ now: () => new Date(now).toISOString(), idFactory: () => [sourceId, auditId][ids++] ?? auditId })
  const commit = () => plane.commit({ checkpoint, checkpoint_identity: 'run:orphan:Q01:Latest', expected_checkpoint_revision: 0, checkpoint_next: next, normalized: record, raw_ref: raw(), raw_receipt_id: 'receipt', raw_receipt_actor_id: 'ingest', raw_receipt_authority: { resolve: async () => raw() }, raw_hash: rawHash, correlation_id: correlation, partial: false })
  return { checkpoint, plane, commit, advance: (milliseconds: number) => { now += milliseconds }, now: () => new Date(now).toISOString() }
}

describe('T06 orphan reconciliation serialization', () => {
  it('retains recent, referenced, hash-mismatched, unverified and delete-failed raw evidence', async () => {
    const recent = fixture()
    await recent.plane.recordOrphan({ raw_ref: raw(), raw_hash: rawHash, reason: 'provider_schema' })
    await expect(recent.plane.reconcileOrphans({ strategy: 'delete', now: recent.now(), verify_raw: async () => true, delete_raw: async () => undefined })).resolves.toEqual({ retained: 1, deleted: 0 })

    const referenced = fixture()
    await referenced.commit(); await referenced.plane.recordOrphan({ raw_ref: raw(), raw_hash: rawHash, reason: 'write_plane_failure' }); referenced.advance(60_001)
    await expect(referenced.plane.reconcileOrphans({ strategy: 'delete', now: referenced.now(), verify_raw: async () => true, delete_raw: async () => undefined })).resolves.toEqual({ retained: 1, deleted: 0 })

    const mismatch = fixture(); let mismatchVerified = false
    await mismatch.plane.recordOrphan({ raw_ref: raw(), raw_hash: otherHash, reason: 'provider_schema' }); mismatch.advance(60_001)
    await expect(mismatch.plane.reconcileOrphans({ strategy: 'delete', now: mismatch.now(), verify_raw: async () => { mismatchVerified = true; return true }, delete_raw: async () => undefined })).resolves.toEqual({ retained: 1, deleted: 0 })
    expect(mismatchVerified).toBe(false)

    const unverified = fixture()
    await unverified.plane.recordOrphan({ raw_ref: raw(), raw_hash: rawHash, reason: 'provider_schema' }); unverified.advance(60_001)
    await expect(unverified.plane.reconcileOrphans({ strategy: 'delete', now: unverified.now(), verify_raw: async () => false, delete_raw: async () => undefined })).resolves.toEqual({ retained: 1, deleted: 0 })

    const deleteFailed = fixture()
    await deleteFailed.plane.recordOrphan({ raw_ref: raw(), raw_hash: rawHash, reason: 'provider_schema' }); deleteFailed.advance(60_001)
    await expect(deleteFailed.plane.reconcileOrphans({ strategy: 'delete', now: deleteFailed.now(), verify_raw: async () => true, delete_raw: async () => { throw new Error('delete unavailable') } })).resolves.toEqual({ retained: 1, deleted: 0 })
    expect(deleteFailed.plane.orphans()).toHaveLength(1)
  })

  it('deletes exactly one eligible old, unreferenced, verified orphan only after successful deletion', async () => {
    const subject = fixture(); let deletes = 0
    await subject.plane.recordOrphan({ raw_ref: raw(), raw_hash: rawHash, reason: 'checkpoint_conflict' }); subject.advance(60_001)
    await expect(subject.plane.reconcileOrphans({ strategy: 'delete', now: subject.now(), verify_raw: async () => true, delete_raw: async (ref) => { deletes += 1; expect(ref).toEqual(raw()) } })).resolves.toEqual({ retained: 0, deleted: 1 })
    expect(deletes).toBe(1); expect(subject.plane.orphans()).toEqual([])
  })

  it('rechecks a source reference that arrives after verification and before delete', async () => {
    const subject = fixture(); let deletes = 0; let lateCommit: Promise<unknown> | undefined
    await subject.plane.recordOrphan({ raw_ref: raw(), raw_hash: rawHash, reason: 'provider_schema' }); subject.advance(60_001)
    const result = await subject.plane.reconcileOrphans({ strategy: 'delete', now: subject.now(), verify_raw: async () => {
      lateCommit = subject.commit()
      await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
      return true
    }, delete_raw: async () => { deletes += 1 } })
    await lateCommit
    expect(result).toEqual({ retained: 1, deleted: 0 })
    expect(deletes).toBe(0); expect(subject.plane.orphans()).toHaveLength(1); expect(subject.plane.sources()).toHaveLength(1)
  })

  it('rechecks an orphan record that arrives after verification and before delete', async () => {
    const subject = fixture(); let deletes = 0; let lateOrphan: Promise<void> | undefined
    await subject.plane.recordOrphan({ raw_ref: raw(), raw_hash: rawHash, reason: 'provider_schema' }); subject.advance(60_001)
    const result = await subject.plane.reconcileOrphans({ strategy: 'delete', now: subject.now(), verify_raw: async () => {
      lateOrphan = subject.plane.recordOrphan({ raw_ref: raw(), raw_hash: rawHash, reason: 'write_plane_failure' })
      await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
      return true
    }, delete_raw: async () => { deletes += 1 } })
    await lateOrphan
    expect(result).toEqual({ retained: 2, deleted: 0 })
    expect(deletes).toBe(0); expect(subject.plane.orphans()).toHaveLength(2)
  })

  it('does not deadlock when a delete callback reenters the write plane, and finalizes exactly once', async () => {
    const subject = fixture(); let deletes = 0
    await subject.plane.recordOrphan({ raw_ref: raw(), raw_hash: rawHash, reason: 'provider_schema' }); subject.advance(60_001)
    await expect(subject.plane.reconcileOrphans({ strategy: 'delete', now: subject.now(), verify_raw: async () => true, delete_raw: async () => {
      deletes += 1
      await subject.plane.recordOrphan({ raw_ref: raw(), raw_hash: rawHash, reason: 'write_plane_failure' })
    } })).resolves.toEqual({ retained: 0, deleted: 1 })
    expect(deletes).toBe(1); expect(subject.plane.orphans()).toEqual([])
  })
})
