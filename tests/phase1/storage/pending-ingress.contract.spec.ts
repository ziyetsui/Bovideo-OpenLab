import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { principals } from '@/access/principals'
import { LocalObjectStore } from '@/storage/local-object-store'
import { buildContentAddressedKey } from '@/storage/object-ref'
import { describe, expect, it } from 'vitest'

const bytes = new TextEncoder().encode('{"raw":"pending"}')
const hash = `sha256:v1:${createHash('sha256').update(bytes).digest('hex')}`
const ref = { namespace: 'raw-evidence' as const, bucket_class: 'private_raw' as const, key: buildContentAddressedKey('raw-evidence', hash), content_hash: hash, version: 'v1', size_bytes: bytes.byteLength, mime_type: 'application/json', rights_state: 'metadata_only' as const, deletion_state: 'active' as const }

describe('T04 pending raw ingress disposition', () => {
  it('persists an ingest-only pending raw receipt across a store restart until dispositioned', async () => {
    const root = await mkdtemp(join(tmpdir(), 'p1-pending-ingress-'))
    try {
      const first = new LocalObjectStore({ root_dir: root, signer_secret: 'pending-test-secret' })
      const receipt = await first.putForIngress({ principal: principals.ingestService, ref, bytes, field: 'raw_ref', actor_id: principals.ingestService.id, correlation_id: 'corr-pending' })
      await expect(first.listPendingRawIngressReceipts({ principal: principals.publisher })).rejects.toThrow(/ingest/)
      expect(await first.listPendingRawIngressReceipts({ principal: principals.ingestService })).toMatchObject([{ receipt_id: receipt.receipt_id, ref, actor_id: principals.ingestService.id, correlation_id: 'corr-pending' }])
      const restarted = new LocalObjectStore({ root_dir: root, signer_secret: 'pending-test-secret' })
      expect(await restarted.listPendingRawIngressReceipts({ principal: principals.ingestService })).toHaveLength(1)
      await expect(restarted.resolveIngressReceipt({ receipt_id: receipt.receipt_id, field: 'raw_ref', actor_id: principals.ingestService.id, correlation_id: 'corr-pending' })).resolves.toMatchObject(ref)
      await expect(restarted.resolveIngressReceipt({ receipt_id: receipt.receipt_id, field: 'raw_ref', actor_id: principals.ingestService.id, correlation_id: 'corr-pending' })).resolves.toBeNull()
      await restarted.markRawIngressReceiptDisposition({ principal: principals.ingestService, receipt_id: receipt.receipt_id, disposition: 'committed' })
      expect(await restarted.listPendingRawIngressReceipts({ principal: principals.ingestService })).toEqual([])
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
