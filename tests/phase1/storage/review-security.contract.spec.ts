import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { principals } from '@/access/principals'
import { LocalObjectStore } from '@/storage/local-object-store'
import { buildContentAddressedKey, type ObjectRef } from '@/storage/object-ref'
import { validateObjectUpload } from '@/storage/upload-validation'
import { describe, expect, it } from 'vitest'

const text = (value: string): Uint8Array => new TextEncoder().encode(value)
const hash = (body: Uint8Array): string => `sha256:v1:${createHash('sha256').update(body).digest('hex')}`
const png = (): Uint8Array => new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])
const rawRef = (body = text('trusted raw body')): ObjectRef => {
  const contentHash = hash(body)
  return {
    namespace: 'raw-evidence', bucket_class: 'private_raw', key: buildContentAddressedKey('raw-evidence', contentHash),
    content_hash: contentHash, version: 'v1', size_bytes: body.byteLength, mime_type: 'application/json',
    rights_state: 'first_party', deletion_state: 'active',
  }
}
const settlesWithin = async <T>(promise: Promise<T>, ms = 150): Promise<T | 'timed_out'> =>
  Promise.race([promise, new Promise<'timed_out'>((resolve) => setTimeout(() => resolve('timed_out'), ms))])

describe('P1-T04 review security regressions', () => {
  it('does not hold the root transaction while after-pending-delete hook reenters head', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bo-p1-reentrant-pending-delete-')); const body = text('reentrant pending delete'); const ref = rawRef(body)
    const store = new LocalObjectStore({ root_dir: root, signer_secret: 'reentrant-pending-delete', failpoint: async (phase) => { if (phase === 'after_pending_delete') await store.head({ principal: principals.ingestService, ref }).catch(() => null) } })
    try {
      await store.write({ principal: principals.ingestService, ref, bytes: body })
      await expect(settlesWithin(store.delete({ principal: principals.ingestService, ref, reason: 'withdrawal', idempotency_key: 'reentrant-pending-delete' }))).resolves.toBeUndefined()
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('does not hold the root transaction while after-object-publish hook reenters head', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bo-p1-reentrant-publish-')); const body = text('reentrant publish'); const ref = rawRef(body)
    const store = new LocalObjectStore({ root_dir: root, signer_secret: 'reentrant-publish', failpoint: async (phase) => { if (phase === 'after_object_publish') await store.head({ principal: principals.ingestService, ref }) } })
    try { await expect(settlesWithin(store.write({ principal: principals.ingestService, ref, bytes: body }))).resolves.toMatchObject({ content_hash: ref.content_hash }) }
    finally { await rm(root, { recursive: true, force: true }) }
  })

  it('samples an injected clock before the root lock and reuses that timestamp throughout the operation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bo-p1-clock-boundary-')); const body = text('clock boundary'); const ref = rawRef(body)
    let calls = 0
    const store = new LocalObjectStore({ root_dir: root, signer_secret: 'clock-boundary', now: () => {
      calls += 1
      if (calls > 1) throw new Error('clock must not execute inside root transaction')
      return Date.parse('2026-08-24T00:00:00.000Z')
    } })
    try {
      await expect(store.write({ principal: principals.ingestService, ref, bytes: body })).resolves.toMatchObject({ content_hash: ref.content_hash })
      expect(calls).toBe(1)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('rejects symlinked namespace ancestors for write, read, delete, and list', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bo-p1-symlink-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'bo-p1-symlink-outside-'))
    const body = text('trusted raw body')
    const ref = rawRef(body)
    const store = new LocalObjectStore({ root_dir: root, signer_secret: 'symlink-test-signer' })
    try {
      await store.write({ principal: principals.ingestService, ref, bytes: body })
      await rm(join(root, 'raw-evidence', 'sha256'), { recursive: true })
      await symlink(outside, join(root, 'raw-evidence', 'sha256'))
      await expect(store.write({ principal: principals.ingestService, ref, bytes: body })).rejects.toThrow(/symlink/i)
      await expect(store.get({ principal: principals.ingestService, ref })).rejects.toThrow(/symlink/i)
      await expect(store.list({ principal: principals.ingestService, ref })).rejects.toThrow(/symlink/i)
      await expect(store.delete({ principal: principals.ingestService, ref, reason: 'test' })).rejects.toThrow(/symlink/i)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('revokes all restricted reads and stale capabilities from current lifecycle metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bo-p1-lifecycle-'))
    const body = text('trusted raw body')
    const ref = rawRef(body)
    const store = new LocalObjectStore({ root_dir: root, signer_secret: 'test-signer' })
    try {
      await store.write({ principal: principals.ingestService, ref, bytes: body })
      const capability = await store.issueReadCapability({ issuer: principals.ingestService, ref, principal_id: 'reviewer-1', correlation_id: 'c1', ttl_ms: 60_000 })
      await store.setLifecycle({ principal: principals.ingestService, ref, deletion_state: 'removed' })
      await expect(store.get({ principal: principals.ingestService, ref })).rejects.toThrow(/deleted|revoked/i)
      await expect(store.head({ principal: principals.ingestService, ref })).rejects.toThrow(/deleted|revoked/i)
      await expect(store.list({ principal: principals.ingestService, ref })).rejects.toThrow(/deleted|revoked/i)
      await expect(store.get({ principal: principals.reviewer, ref, capability, correlation_id: 'c1' })).rejects.toThrow(/deleted|revoked/i)
      await expect(store.issueReadCapability({ issuer: principals.ingestService, ref, principal_id: 'reviewer-1', correlation_id: 'c2', ttl_ms: 60_000 })).rejects.toThrow(/deleted|revoked/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('never replaces a content-addressed object during concurrent conflicting writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bo-p1-race-'))
    const body = text('trusted raw body')
    const ref = rawRef(body)
    const store = new LocalObjectStore({ root_dir: root, signer_secret: 'race-test-signer' })
    try {
      const results = await Promise.allSettled([
        store.write({ principal: principals.ingestService, ref, bytes: body }),
        store.write({ principal: principals.ingestService, ref, bytes: text('different-but-same-length') }),
      ])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
      expect((await store.get({ principal: principals.ingestService, ref })).bytes).toEqual(body)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('persists pending deletion intent before removal and retries it after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bo-p1-outbox-'))
    const body = text('trusted raw body')
    const ref = rawRef(body)
    let calls = 0
    const failing = new LocalObjectStore({ root_dir: root, signer_secret: 'outbox-test-signer', on_delete: async () => { calls += 1; throw new Error('ledger down') } })
    try {
      await failing.write({ principal: principals.ingestService, ref, bytes: body })
      await expect(failing.delete({ principal: principals.ingestService, ref, reason: 'withdrawal', idempotency_key: 'delete-1' })).rejects.toThrow(/ledger down/)
      await expect(failing.get({ principal: principals.ingestService, ref })).rejects.toThrow(/deleted|revoked/i)
      const recovered: unknown[] = []
      const restarted = new LocalObjectStore({ root_dir: root, signer_secret: 'outbox-test-signer', on_delete: (entry) => { recovered.push(entry) } })
      await expect(restarted.retryPendingDeletions()).resolves.toMatchObject({ completed: 1 })
      expect(calls).toBe(1)
      expect(recovered).toHaveLength(1)
      expect(recovered[0]).toMatchObject({ namespace: 'raw-evidence', content_hash: ref.content_hash, reason: 'withdrawal' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('delivers deletion callbacks outside store locks so a callback can re-enter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bo-p1-reentrant-delete-'))
    const body = text('reentrant deletion callback body')
    const ref = rawRef(body)
    const delivered: unknown[] = []
    const store = new LocalObjectStore({
      root_dir: root, signer_secret: 'reentrant-delete-signer',
      on_delete: async (entry) => {
        const reentered = await settlesWithin(store.head({ principal: principals.ingestService, ref }).then(() => 'resolved', () => 'denied'))
        if (reentered === 'timed_out') throw new Error('callback re-entry blocked by store lock')
        delivered.push(entry)
      },
    })
    try {
      await store.write({ principal: principals.ingestService, ref, bytes: body })
      await expect(store.delete({ principal: principals.ingestService, ref, reason: 'withdrawal', idempotency_key: 'reentrant-delete' })).resolves.toBeUndefined()
      expect(delivered).toHaveLength(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not block unrelated store reads while a deletion callback is slow', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bo-p1-slow-delete-'))
    const body = text('slow deletion callback body')
    const ref = rawRef(body)
    let releaseCallback!: () => void
    const callbackBlocked = new Promise<void>((resolve) => { releaseCallback = resolve })
    let enteredCallback!: () => void
    const callbackEntered = new Promise<void>((resolve) => { enteredCallback = resolve })
    const store = new LocalObjectStore({
      root_dir: root, signer_secret: 'slow-delete-signer',
      on_delete: async () => { enteredCallback(); await callbackBlocked },
    })
    try {
      await store.write({ principal: principals.ingestService, ref, bytes: body })
      const deletion = store.delete({ principal: principals.ingestService, ref, reason: 'withdrawal', idempotency_key: 'slow-delete' })
      await callbackEntered
      const head = await settlesWithin(store.head({ principal: principals.ingestService, ref }).then(() => 'resolved', () => 'denied'))
      expect(head).toBe('denied')
      releaseCallback()
      await deletion
    } finally {
      releaseCallback?.()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('heartbeats a live slow callback and gives receivers one immutable deletion event', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bo-p1-delete-heartbeat-'))
    const body = text('heartbeat deletion callback body')
    const ref = rawRef(body)
    let releaseCallback!: () => void
    const callbackBlocked = new Promise<void>((resolve) => { releaseCallback = resolve })
    let enteredCallback!: () => void
    const callbackEntered = new Promise<void>((resolve) => { enteredCallback = resolve })
    const delivered: unknown[] = []
    const first = new LocalObjectStore({
      root_dir: root, signer_secret: 'heartbeat-delete-signer', delivery_claim_lease_ms: 30,
      on_delete: async (entry) => { delivered.push(entry); enteredCallback(); await callbackBlocked },
    })
    const second = new LocalObjectStore({ root_dir: root, signer_secret: 'heartbeat-delete-signer', delivery_claim_lease_ms: 30 })
    let deletion: Promise<void> | undefined
    try {
      await first.write({ principal: principals.ingestService, ref, bytes: body })
      deletion = first.delete({ principal: principals.ingestService, ref, reason: 'withdrawal', idempotency_key: 'heartbeat-delete', deletion_request_id: 'correlation-heartbeat' })
      await callbackEntered
      await new Promise<void>((resolve) => setTimeout(resolve, 90))
      await expect(second.retryPendingDeletions()).resolves.toMatchObject({ completed: 1 })
      expect(delivered).toHaveLength(1)
      expect(delivered[0]).toMatchObject({ idempotency_key: expect.any(String), deletion_request_id: 'correlation-heartbeat', correlation_id: 'correlation-heartbeat', reason: 'withdrawal', ref: { ...ref, deletion_state: 'removed' } })
      releaseCallback()
      await deletion
    } finally {
      releaseCallback?.()
      await deletion?.catch(() => undefined)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps a callback claim alive through a delayed durable acknowledgement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bo-p1-delete-ack-heartbeat-'))
    const body = text('delayed acknowledgement heartbeat body')
    const ref = rawRef(body)
    const callbacks: { readonly idempotency_key: string }[] = []
    let releaseAck!: () => void
    const ackBlocked = new Promise<void>((resolve) => { releaseAck = resolve })
    let ackDelayed!: () => void
    const ackDelayStarted = new Promise<void>((resolve) => { ackDelayed = resolve })
    const first = new LocalObjectStore({
      root_dir: root, signer_secret: 'ack-heartbeat-signer', delivery_claim_lease_ms: 30,
      on_delete: (entry) => { callbacks.push(entry) },
      failpoint: async (phase) => { if (phase === 'after_delivery_callback') { ackDelayed(); await ackBlocked } },
    })
    const second = new LocalObjectStore({
      root_dir: root, signer_secret: 'ack-heartbeat-signer', delivery_claim_lease_ms: 30,
      on_delete: (entry) => { callbacks.push(entry) },
    })
    let deletion: Promise<void> | undefined
    try {
      await first.write({ principal: principals.ingestService, ref, bytes: body })
      deletion = first.delete({ principal: principals.ingestService, ref, reason: 'withdrawal', idempotency_key: 'ack-heartbeat', deletion_request_id: 'ack-correlation' })
      await ackDelayStarted
      await new Promise<void>((resolve) => setTimeout(resolve, 90))
      await expect(second.retryPendingDeletions()).resolves.toMatchObject({ completed: 1 })
      expect(callbacks).toHaveLength(1)
      releaseAck()
      await deletion
      expect(callbacks).toHaveLength(1)
      expect(callbacks[0]?.idempotency_key).toContain('ack-correlation')
    } finally {
      releaseAck?.()
      await deletion?.catch(() => undefined)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('recovers expired claimed deliveries after interruption before and after a callback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bo-p1-delivery-claim-recovery-'))
    const body = text('claimed delivery recovery body')
    const ref = rawRef(body)
    let now = Date.parse('2026-08-24T00:00:00.000Z')
    const beforeCalls: unknown[] = []
    const interruptedBefore = new LocalObjectStore({
      root_dir: root, signer_secret: 'delivery-claim-signer', now: () => now,
      fault_plan: ['after_delivery_claim'],
      on_delete: (entry) => { beforeCalls.push(entry) },
    })
    try {
      await interruptedBefore.write({ principal: principals.ingestService, ref, bytes: body })
      await expect(interruptedBefore.delete({ principal: principals.ingestService, ref, reason: 'withdrawal', idempotency_key: 'claim-before' })).rejects.toThrow(/after_delivery_claim/)
      expect(beforeCalls).toEqual([])
      now += 30_001
      const recoveredBefore = new LocalObjectStore({ root_dir: root, signer_secret: 'delivery-claim-signer', now: () => now, on_delete: (entry) => { beforeCalls.push(entry) } })
      await expect(recoveredBefore.retryPendingDeletions()).resolves.toMatchObject({ completed: 1 })
      expect(beforeCalls).toHaveLength(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }

    const secondRoot = await mkdtemp(join(tmpdir(), 'bo-p1-delivery-ack-recovery-'))
    const secondBody = text('claimed delivery acknowledgement body')
    const secondRef = rawRef(secondBody)
    now = Date.parse('2026-08-24T00:00:00.000Z')
    const afterCalls: unknown[] = []
    const interruptedAfter = new LocalObjectStore({
      root_dir: secondRoot, signer_secret: 'delivery-ack-signer', now: () => now,
      fault_plan: ['after_delivery_callback'],
      on_delete: (entry) => { afterCalls.push(entry) },
    })
    try {
      await interruptedAfter.write({ principal: principals.ingestService, ref: secondRef, bytes: secondBody })
      await expect(interruptedAfter.delete({ principal: principals.ingestService, ref: secondRef, reason: 'withdrawal', idempotency_key: 'claim-after' })).rejects.toThrow(/after_delivery_callback/)
      expect(afterCalls).toHaveLength(1)
      now += 30_001
      const recoveredAfter = new LocalObjectStore({ root_dir: secondRoot, signer_secret: 'delivery-ack-signer', now: () => now, on_delete: (entry) => { afterCalls.push(entry) } })
      await expect(recoveredAfter.retryPendingDeletions()).resolves.toMatchObject({ completed: 1 })
      expect(afterCalls).toHaveLength(2)
      expect((afterCalls[1] as { idempotency_key: string }).idempotency_key).toBe((afterCalls[0] as { idempotency_key: string }).idempotency_key)
    } finally {
      await rm(secondRoot, { recursive: true, force: true })
    }
  })

  it('recovers a prepared put after link sync and never adopts an unrelated orphan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bo-p1-put-recovery-'))
    const body = text('prepared put body')
    const ref = rawRef(body)
    const interrupted = new LocalObjectStore({
      root_dir: root, signer_secret: 'put-recovery-signer',
      fault_plan: ['after_object_publish'],
    })
    try {
      await expect(interrupted.write({ principal: principals.ingestService, ref, bytes: body })).rejects.toThrow(/after_object_publish/)
      const unrelatedBody = text('unrelated orphan')
      const unrelated = rawRef(unrelatedBody)
      await mkdir(join(root, unrelated.namespace, 'sha256', unrelated.content_hash.slice(10, 12)), { recursive: true })
      await writeFile(join(root, unrelated.namespace, unrelated.key), unrelatedBody)
      const restarted = new LocalObjectStore({ root_dir: root, signer_secret: 'put-recovery-signer' })
      await expect(restarted.write({ principal: principals.ingestService, ref, bytes: body })).resolves.toMatchObject({ content_hash: ref.content_hash })
      await expect(restarted.get({ principal: principals.ingestService, ref })).resolves.toMatchObject({ bytes: body })
      await expect(restarted.get({ principal: principals.ingestService, ref: unrelated })).rejects.toThrow(/authoritative ref/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails closed when key suffix, MIME magic, or format body disagree', () => {
    const validPng = png()
    const pngHash = hash(validPng)
    expect(() => validateObjectUpload({ namespace: 'public-media', key: 'media/aa/synthetic.jpg', bytes: validPng, declared_size: validPng.byteLength, declared_hash: pngHash, declared_mime_type: 'image/png', rights_state: 'first_party', deletion_state: 'active' })).toThrow(/suffix/i)
    const pngHtml = new Uint8Array([...validPng, ...text('<html><script>x</script></html>')])
    expect(() => validateObjectUpload({ namespace: 'public-media', key: 'media/aa/synthetic.png', bytes: pngHtml, declared_size: pngHtml.byteLength, declared_hash: hash(pngHtml), declared_mime_type: 'image/png', rights_state: 'first_party', deletion_state: 'active' })).toThrow(/polyglot|format/i)
    const pngZip = new Uint8Array([...validPng, 0x50, 0x4b, 0x03, 0x04])
    expect(() => validateObjectUpload({ namespace: 'public-media', key: 'media/aa/synthetic.png', bytes: pngZip, declared_size: pngZip.byteLength, declared_hash: hash(pngZip), declared_mime_type: 'image/png', rights_state: 'first_party', deletion_state: 'active' })).toThrow(/polyglot|format/i)
    const pngPE = new Uint8Array([...validPng, 0x4d, 0x5a])
    expect(() => validateObjectUpload({ namespace: 'public-media', key: 'media/aa/synthetic.png', bytes: pngPE, declared_size: pngPE.byteLength, declared_hash: hash(pngPE), declared_mime_type: 'image/png', rights_state: 'first_party', deletion_state: 'active' })).toThrow(/polyglot|format/i)
  })

  it('fails closed for missing or corrupt initialized state instead of trusting caller refs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bo-p1-state-fail-closed-'))
    const body = text('durable state body')
    const ref = rawRef(body)
    const store = new LocalObjectStore({ root_dir: root, signer_secret: 'state-test-signer' })
    try {
      await store.write({ principal: principals.ingestService, ref, bytes: body })
      await rm(join(root, '.p1-object-store-state.json'))
      const restarted = new LocalObjectStore({ root_dir: root, signer_secret: 'state-test-signer' })
      await expect(restarted.get({ principal: principals.ingestService, ref })).rejects.toThrow(/state.*missing|missing.*state/i)
      await writeFile(join(root, '.p1-object-store-state.json'), '{not json')
      await expect(restarted.head({ principal: principals.ingestService, ref })).rejects.toThrow(/state.*corrupt|corrupt.*state/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('persists capability signer and nonce state over restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bo-p1-nonce-state-'))
    const body = text('durable nonce body')
    const ref = rawRef(body)
    let now = Date.parse('2026-08-23T00:00:00.000Z')
    try {
      expect(() => new LocalObjectStore({ root_dir: root })).toThrow(/signer/i)
      const first = new LocalObjectStore({ root_dir: root, signer_secret: 'durable-signer', now: () => now })
      await first.write({ principal: principals.ingestService, ref, bytes: body })
      const used = await first.issueReadCapability({ issuer: principals.ingestService, ref, principal_id: 'reviewer-1', correlation_id: 'used', ttl_ms: 60_000 })
      const unused = await first.issueReadCapability({ issuer: principals.ingestService, ref, principal_id: 'reviewer-1', correlation_id: 'unused', ttl_ms: 60_000 })
      await first.get({ principal: principals.reviewer, ref, capability: used, correlation_id: 'used' })
      const restarted = new LocalObjectStore({ root_dir: root, signer_secret: 'durable-signer', now: () => now })
      await expect(restarted.get({ principal: principals.reviewer, ref, capability: used, correlation_id: 'used' })).rejects.toThrow(/replay/i)
      await expect(restarted.get({ principal: principals.reviewer, ref, capability: unused, correlation_id: 'unused' })).resolves.toMatchObject({ bytes: body })
      const wrongSigner = new LocalObjectStore({ root_dir: root, signer_secret: 'wrong-signer', now: () => now })
      const third = await restarted.issueReadCapability({ issuer: principals.ingestService, ref, principal_id: 'reviewer-1', correlation_id: 'wrong', ttl_ms: 60_000 })
      await expect(wrongSigner.get({ principal: principals.reviewer, ref, capability: third, correlation_id: 'wrong' })).rejects.toThrow(/signature/i)
      now += 60_001
      await expect(restarted.get({ principal: principals.reviewer, ref, capability: third, correlation_id: 'wrong' })).rejects.toThrow(/expired/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('retries physical deletion before delivery after a durable physical-delete failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bo-p1-physical-phase-'))
    const body = text('durable physical deletion body')
    const ref = rawRef(body)
    const delivered: unknown[] = []
    const failing = new LocalObjectStore({
      root_dir: root, signer_secret: 'physical-phase-signer',
      fault_plan: ['physical_delete'],
      on_delete: (entry) => { delivered.push(entry) },
    })
    try {
      await failing.write({ principal: principals.ingestService, ref, bytes: body })
      await expect(failing.delete({ principal: principals.ingestService, ref, reason: 'withdrawal', idempotency_key: 'physical-1' })).rejects.toThrow(/physical_delete/)
      expect(delivered).toEqual([])
      await expect(failing.get({ principal: principals.ingestService, ref })).rejects.toThrow(/deleted|revoked/i)
      const restarted = new LocalObjectStore({ root_dir: root, signer_secret: 'physical-phase-signer', on_delete: (entry) => { delivered.push(entry) } })
      await expect(restarted.retryPendingDeletions()).resolves.toMatchObject({ completed: 1 })
      await expect(readFile(join(root, ref.namespace, ref.key))).rejects.toThrow(/ENOENT/)
      expect(delivered).toHaveLength(1)
      expect(delivered[0]).toMatchObject({ namespace: 'raw-evidence', content_hash: ref.content_hash, reason: 'withdrawal' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('restarts safely from every persisted deletion handoff before callback delivery', async () => {
    for (const phase of ['after_pending_delete', 'after_physical_unlink', 'after_deletion_state_save', 'after_physical_delete', 'before_delivery'] as const) {
      const root = await mkdtemp(join(tmpdir(), `bo-p1-${phase}-`))
      const body = text(`durable ${phase}`)
      const ref = rawRef(body)
      const delivered: unknown[] = []
      const interrupted = new LocalObjectStore({
        root_dir: root, signer_secret: `signer-${phase}`,
        fault_plan: [phase],
        on_delete: (entry) => { delivered.push(entry) },
      })
      try {
        await interrupted.write({ principal: principals.ingestService, ref, bytes: body })
        await expect(interrupted.delete({ principal: principals.ingestService, ref, reason: 'withdrawal', idempotency_key: phase })).rejects.toThrow(phase)
        const restarted = new LocalObjectStore({ root_dir: root, signer_secret: `signer-${phase}`, on_delete: (entry) => { delivered.push(entry) } })
        await expect(restarted.retryPendingDeletions()).resolves.toMatchObject({ completed: 1 })
        expect(delivered).toHaveLength(1)
        expect(delivered[0]).toMatchObject({ namespace: 'raw-evidence', content_hash: ref.content_hash, reason: 'withdrawal' })
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  })

  it('allows exactly one cross-instance consumer for a single persisted read capability', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bo-p1-cross-instance-nonce-'))
    const body = text('cross instance nonce body')
    const ref = rawRef(body)
    const first = new LocalObjectStore({ root_dir: root, signer_secret: 'cross-instance-signer' })
    const second = new LocalObjectStore({ root_dir: root, signer_secret: 'cross-instance-signer' })
    try {
      await first.write({ principal: principals.ingestService, ref, bytes: body })
      const capability = await first.issueReadCapability({ issuer: principals.ingestService, ref, principal_id: 'reviewer-1', correlation_id: 'once', ttl_ms: 60_000 })
      const results = await Promise.allSettled([
        first.get({ principal: principals.reviewer, ref, capability, correlation_id: 'once' }),
        second.get({ principal: principals.reviewer, ref, capability, correlation_id: 'once' }),
      ])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('serializes a pre-delete put so it cannot resurrect bytes before deletion delivery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bo-p1-put-delete-race-'))
    const body = text('put delete race body')
    const ref = rawRef(body)
    let releasePublish!: () => void
    const publishBlocked = new Promise<void>((resolve) => { releasePublish = resolve })
    let markPublishBlocked!: () => void
    const enteredPublish = new Promise<void>((resolve) => { markPublishBlocked = resolve })
    const delivered: unknown[] = []
    const writer = new LocalObjectStore({
      root_dir: root, signer_secret: 'put-delete-race-signer',
      failpoint: ((phase: string) => {
        if (phase !== 'before_object_directory_sync') return undefined
        markPublishBlocked()
        return publishBlocked
      }) as never,
    })
    const deleter = new LocalObjectStore({
      root_dir: root, signer_secret: 'put-delete-race-signer',
      on_delete: async (entry) => {
        await expect(readFile(join(root, ref.namespace, ref.key))).rejects.toThrow(/ENOENT/)
        delivered.push(entry)
      },
    })
    try {
      const bootstrap = new LocalObjectStore({ root_dir: root, signer_secret: 'put-delete-race-signer' })
      await bootstrap.write({ principal: principals.ingestService, ref, bytes: body })
      await rm(join(root, ref.namespace, ref.key))
      const put = writer.write({ principal: principals.ingestService, ref, bytes: body })
      await enteredPublish
      const deletion = deleter.delete({ principal: principals.ingestService, ref, reason: 'withdrawal', idempotency_key: 'put-delete-race' })
      let deletionSettled = false
      void deletion.finally(() => { deletionSettled = true })
      // The observer is outside the root lock, so a concurrent delete may complete while it waits.
      await new Promise<void>((resolve) => setTimeout(resolve, 90))
      expect(deletionSettled).toBe(true)
      releasePublish()
      await put
      await deletion
      await expect(readFile(join(root, ref.namespace, ref.key))).rejects.toThrow(/ENOENT/)
      await expect(deleter.get({ principal: principals.ingestService, ref })).rejects.toThrow(/deleted|revoked/i)
      expect(delivered).toHaveLength(1)
      expect(delivered[0]).toMatchObject({ namespace: 'raw-evidence', content_hash: ref.content_hash, reason: 'withdrawal' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails closed on a deletion intent that conflicts with an active authoritative ref', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bo-p1-inconsistent-intent-'))
    const body = text('inconsistent intent body')
    const ref = rawRef(body)
    const store = new LocalObjectStore({ root_dir: root, signer_secret: 'inconsistent-intent-signer' })
    try {
      await store.write({ principal: principals.ingestService, ref, bytes: body })
      const statePath = join(root, '.p1-object-store-state.json')
      const state = JSON.parse(await readFile(statePath, 'utf8')) as Record<string, unknown>
      state.deletions = {
        [`delete:${ref.namespace}:${ref.key}:${ref.content_hash}:${ref.version}:inconsistent-delete`]: {
          idempotency_key: `delete:${ref.namespace}:${ref.key}:${ref.content_hash}:${ref.version}:inconsistent-delete`, request_id: 'inconsistent-delete', ref: { ...ref, deletion_state: 'removed' }, reason: 'withdrawal', phase: 'pending_delete', attempts: 0, error: null,
        },
      }
      await writeFile(statePath, `${JSON.stringify(state)}\n`)
      const restarted = new LocalObjectStore({ root_dir: root, signer_secret: 'inconsistent-intent-signer' })
      await expect(restarted.head({ principal: principals.ingestService, ref })).rejects.toThrow(/state.*corrupt|corrupt.*deletion/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('requires object-directory durability before committing object state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bo-p1-directory-sync-'))
    const body = text('directory sync body')
    const ref = rawRef(body)
    const order: string[] = []
    const bootstrapBody = text('directory sync bootstrap')
    const bootstrapRef = rawRef(bootstrapBody)
    const bootstrap = new LocalObjectStore({ root_dir: root, signer_secret: 'directory-sync-signer' })
    const store = new LocalObjectStore({
      root_dir: root, signer_secret: 'directory-sync-signer',
      fault_plan: ['before_object_directory_sync'],
      failpoint: (phase) => { order.push(phase) },
    })
    try {
      await bootstrap.write({ principal: principals.ingestService, ref: bootstrapRef, bytes: bootstrapBody })
      await expect(store.write({ principal: principals.ingestService, ref, bytes: body })).rejects.toThrow(/before_object_directory_sync/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
