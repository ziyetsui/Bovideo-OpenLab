import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { applyReviewedTaxonomyManifest, artifactsFromPayload, loadReviewedTaxonomyManifest, loadReviewedXMediaAllowlist, nextLocalProjectionPublishVersion, parseLocalProjectionPublishArgs, planLocalPointerActivation, promoteEligibleXPreviewMedia, publishLocalPseoProjections } from '../../../scripts/generate-local-pseo-projections'

describe('local projection publication command', () => {
  it('accepts an explicit locale and rejects arbitrary publication arguments', () => {
    expect(parseLocalProjectionPublishArgs(['--locale', 'en', '--concurrency', '4'])).toEqual({ locale: 'en', concurrency: 4, promoteXPreviewMedia: false, reviewedMediaManifest: undefined, reviewedTaxonomyManifest: undefined })
    expect(parseLocalProjectionPublishArgs(['--promote-x-preview-media', '--reviewed-media-manifest', 'reviewed.jsonl', '--reviewed-taxonomy-manifest', 'taxonomy.json'])).toEqual({ locale: 'en', concurrency: 8, promoteXPreviewMedia: true, reviewedMediaManifest: 'reviewed.jsonl', reviewedTaxonomyManifest: 'taxonomy.json' })
    expect(parseLocalProjectionPublishArgs([])).toEqual({ locale: 'en', concurrency: 8, promoteXPreviewMedia: false, reviewedMediaManifest: undefined, reviewedTaxonomyManifest: undefined })
    expect(() => parseLocalProjectionPublishArgs(['--locale', 'xx'])).toThrow(/locale/i)
    expect(() => parseLocalProjectionPublishArgs(['--locale', 'zh-CN'])).toThrow(/source projection.*en only/i)
    expect(() => parseLocalProjectionPublishArgs(['--concurrency', '17'])).toThrow(/concurrency/i)
    expect(() => parseLocalProjectionPublishArgs(['--reviewed-media-manifest', 'reviewed.jsonl'])).toThrow(/promote/i)
    expect(() => parseLocalProjectionPublishArgs(['--reviewed-taxonomy-manifest'])).toThrow(/requires/i)
    expect(() => parseLocalProjectionPublishArgs(['--publish-version', '1'])).toThrow(/unknown/i)
  })

  it('loads exact reviewed taxonomy assignments and links only their counted source-version scope', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bo-reviewed-taxonomy-'))
    const manifestPath = join(directory, 'taxonomy.json')
    const sourceVersion = `sha256:v1:${'a'.repeat(64)}`
    const writes: Record<string, unknown>[] = []
    try {
      await writeFile(manifestPath, JSON.stringify({
        schema_version: 1,
        review_id: 'fixture-review-v1',
        reviewed_at: '2026-08-27T00:00:00.000Z',
        evidence_refs: ['private/reviews/fixture-v1'],
        assignments: [{
          node_type: 'model', stable_key: 'model:higgsfield', label: 'Higgsfield',
          description: 'Reviewed fixture model.', promotion_state: 'reviewed',
          target_source_versions: [sourceVersion], expected_artifact_count: 2,
        }],
      }))
      const manifest = await loadReviewedTaxonomyManifest(manifestPath)
      let createdID = 40
      const promptDocuments = [
        { id: 10, revision: 1, updatedAt: '2026-08-27T00:00:00.000Z', source_version: sourceVersion, source: 101, model_refs: [7], taxonomy_refs: [8] },
        { id: 11, revision: 1, updatedAt: '2026-08-27T00:00:00.000Z', source_version: sourceVersion, source: 102, model_refs: [], taxonomy_refs: [] },
      ]
      let taxonomyNode: Record<string, unknown> | undefined
      const auditEvents: Record<string, unknown>[] = []
      const payload = {
        async find(input: Record<string, unknown>) {
          if (input.collection === 'taxonomy-nodes') return { docs: taxonomyNode === undefined ? [] : [taxonomyNode] }
          if (input.collection === 'prompt-artifacts') return { docs: promptDocuments }
          if (input.collection === 'audit-events') return { docs: auditEvents }
          return { docs: [] }
        },
        async create(input: Record<string, unknown>) {
          writes.push(input)
          createdID += 1
          const created = { id: createdID, ...(input.data as object) }
          if (input.collection === 'taxonomy-nodes') taxonomyNode = created
          if (input.collection === 'audit-events') auditEvents.push(created)
          return created
        },
        async update(input: Record<string, unknown>) {
          writes.push(input)
          if (input.collection === 'taxonomy-nodes') {
            taxonomyNode = { ...taxonomyNode, ...(input.data as object) }
            return taxonomyNode
          }
          const document = promptDocuments.find((candidate) => candidate.id === input.id)!
          Object.assign(document, input.data, { updatedAt: `2026-08-27T00:00:0${document.id}.000Z` })
          return document
        },
        async findByID(input: Record<string, unknown>) {
          if (input.collection === 'taxonomy-nodes') return taxonomyNode!
          return promptDocuments.find((candidate) => candidate.id === input.id)!
        },
      }

      await expect(applyReviewedTaxonomyManifest(payload as never, manifest, 2, () => ({ review: 'fixture' }))).resolves.toEqual({
        createdNodeCount: 1, updatedNodeCount: 0, linkedArtifactCount: 2,
      })
      expect(writes.find((write) => write.collection === 'taxonomy-nodes' && (write.data as Record<string, unknown>).promotion_state === 'candidate')).toMatchObject({
        data: { node_type: 'model', stable_key: 'model:higgsfield', promotion_state: 'candidate', inventory_count: 2 },
      })
      expect(writes.find((write) => write.collection === 'taxonomy-nodes' && (write.data as Record<string, unknown>).promotion_state === 'reviewed')).toMatchObject({
        data: { promotion_state: 'reviewed', inventory_count: 2 },
      })
      expect(writes.filter((write) => write.collection === 'prompt-artifacts').map((write) => write.data)).toEqual([
        expect.objectContaining({ model_refs: [7, 41], taxonomy_refs: [8], revision: 2 }),
        expect.objectContaining({ model_refs: [41], taxonomy_refs: [], revision: 2 }),
      ])
      expect(writes.find((write) => write.collection === 'audit-events')).toMatchObject({
        data: { event_type: 'taxonomy.review.accepted', new_state: expect.objectContaining({ review_id: 'fixture-review-v1', evidence_refs: ['private/reviews/fixture-v1'] }) },
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects unreviewed taxonomy manifests before any Payload write', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bo-unreviewed-taxonomy-'))
    const manifestPath = join(directory, 'taxonomy.json')
    try {
      await writeFile(manifestPath, JSON.stringify({
        schema_version: 1, review_id: 'candidate-fixture', reviewed_at: '2026-08-27T00:00:00.000Z',
        evidence_refs: ['private/reviews/candidate'], assignments: [{
          node_type: 'model', stable_key: 'model:higgsfield', label: 'Higgsfield', promotion_state: 'candidate',
          target_source_versions: [`sha256:v1:${'a'.repeat(64)}`], expected_artifact_count: 1,
        }],
      }))
      await expect(loadReviewedTaxonomyManifest(manifestPath)).rejects.toThrow(/reviewed taxonomy manifest/i)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('performs zero CMS writes when the exact reviewed taxonomy ingress is already complete', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bo-complete-taxonomy-'))
    const manifestPath = join(directory, 'taxonomy.json')
    const sourceVersion = `sha256:v1:${'b'.repeat(64)}`
    try {
      await writeFile(manifestPath, JSON.stringify({
        schema_version: 1, review_id: 'complete-fixture-v1', reviewed_at: '2026-08-27T00:00:00.000Z',
        evidence_refs: ['reviews/complete-fixture-v1'], assignments: [{
          node_type: 'model', stable_key: 'model:higgsfield', label: 'Higgsfield', description: 'Complete fixture.',
          promotion_state: 'reviewed', target_source_versions: [sourceVersion], expected_artifact_count: 1,
        }],
      }))
      const manifest = await loadReviewedTaxonomyManifest(manifestPath)
      const node = {
        id: 41, stable_id: '00000000-0000-5000-8000-000000000041', source_version: manifest.sourceHash,
        status: 'active', node_type: 'model', stable_key: 'model:higgsfield', label: 'Higgsfield',
        description: 'Complete fixture.', promotion_state: 'reviewed', inventory_count: 1, evidence_refs: [101],
      }
      const artifact = { id: 10, source_version: sourceVersion, source: 101, model_refs: [41], taxonomy_refs: [] }
      const payload = {
        async find(input: Record<string, unknown>) {
          if (input.collection === 'taxonomy-nodes') return { docs: [node] }
          if (input.collection === 'prompt-artifacts') return { docs: [artifact] }
          if (input.collection === 'audit-events') return { docs: [{ event_id: 'existing-review-event' }] }
          return { docs: [] }
        },
        async create() { throw new Error('unexpected create') },
        async update() { throw new Error('unexpected update') },
        async findByID() { throw new Error('unexpected findByID') },
      }

      await expect(applyReviewedTaxonomyManifest(payload as never, manifest, 2)).resolves.toEqual({
        createdNodeCount: 0, updatedNodeCount: 0, linkedArtifactCount: 1,
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('locks each prompt artifact row before reading and merging reviewed taxonomy relationships', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bo-locked-taxonomy-'))
    const manifestPath = join(directory, 'taxonomy.json')
    const sourceVersion = `sha256:v1:${'9'.repeat(64)}`
    const operations: string[] = []
    try {
      await writeFile(manifestPath, JSON.stringify({
        schema_version: 1, review_id: 'locked-fixture-v1', reviewed_at: '2026-08-27T00:00:00.000Z',
        evidence_refs: ['reviews/locked-fixture-v1'], assignments: [{
          node_type: 'model', stable_key: 'model:higgsfield', label: 'Higgsfield', promotion_state: 'reviewed',
          target_source_versions: [sourceVersion], expected_artifact_count: 1,
        }],
      }))
      const manifest = await loadReviewedTaxonomyManifest(manifestPath)
      const artifact = {
        id: 10, revision: 3, updatedAt: '2026-08-27T00:00:00.000Z', source_version: sourceVersion,
        source: 101, model_refs: [7], taxonomy_refs: [8],
      }
      let taxonomyNode: Record<string, unknown> | undefined
      const payload = {
        async find(input: Record<string, unknown>) {
          if (input.collection === 'taxonomy-nodes') return { docs: taxonomyNode === undefined ? [] : [taxonomyNode] }
          if (input.collection === 'prompt-artifacts') return { docs: [artifact] }
          if (input.collection === 'audit-events') return { docs: [] }
          return { docs: [] }
        },
        async create(input: Record<string, unknown>) {
          const created = { id: input.collection === 'taxonomy-nodes' ? 41 : 42, ...(input.data as object) }
          if (input.collection === 'taxonomy-nodes') taxonomyNode = created
          return created
        },
        async findByID(input: Record<string, unknown>) {
          if (input.collection === 'taxonomy-nodes') return taxonomyNode!
          operations.push('read')
          return artifact
        },
        async update(input: Record<string, unknown>) {
          if (input.collection === 'taxonomy-nodes') {
            taxonomyNode = { ...taxonomyNode, ...(input.data as object) }
            return taxonomyNode
          }
          operations.push('update')
          expect(input).toMatchObject({ collection: 'prompt-artifacts', id: 10 })
          expect(input).not.toHaveProperty('where')
          Object.assign(artifact, input.data)
          return artifact
        },
        db: {
          tableNameMap: new Map([
            ['prompt_artifacts', 'prompt_artifacts'],
            ['prompt_artifacts_rels', 'prompt_artifacts_rels'],
          ]),
          tables: {
            prompt_artifacts: { id: Symbol('prompt-artifacts.id'), table: 'parent' },
            prompt_artifacts_rels: {
              id: Symbol('prompt-artifacts-rels.id'), parent: Symbol('prompt-artifacts-rels.parent'), table: 'relationships',
            },
          },
          sessions: {
            'tx-lock': {
              db: {
                select() {
                  return { from: (table: Record<string, unknown>) => ({ where: () => ({
                    for: async (strength: string) => {
                      expect(strength).toBe('update')
                      operations.push(`lock:${String(table.table)}`)
                      return table.table === 'parent' ? [{ id: 10 }] : [{ id: 90 }]
                    },
                  }) }) }
                },
              },
            },
          },
          async beginTransaction() { return 'tx-lock' },
          async commitTransaction() {},
          async rollbackTransaction() {},
        },
      }

      await expect(applyReviewedTaxonomyManifest(payload as never, manifest, 1, (transactionID) => ({ transactionID }))).resolves.toEqual({
        createdNodeCount: 1, updatedNodeCount: 0, linkedArtifactCount: 1,
      })
      expect(operations).toEqual(['lock:parent', 'lock:relationships', 'read', 'update'])
      expect(artifact).toMatchObject({ model_refs: [7, 41], taxonomy_refs: [8], revision: 4 })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('leaves the taxonomy node non-consumable when a later relationship batch fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bo-taxonomy-fault-'))
    const manifestPath = join(directory, 'taxonomy.json')
    const sourceVersion = `sha256:v1:${'c'.repeat(64)}`
    try {
      await writeFile(manifestPath, JSON.stringify({
        schema_version: 1, review_id: 'fault-fixture-v1', reviewed_at: '2026-08-27T00:00:00.000Z',
        evidence_refs: ['reviews/fault-fixture-v1'], assignments: [{
          node_type: 'model', stable_key: 'model:higgsfield', label: 'Higgsfield', promotion_state: 'reviewed',
          target_source_versions: [sourceVersion], expected_artifact_count: 51,
        }],
      }))
      const manifest = await loadReviewedTaxonomyManifest(manifestPath)
      const promptDocuments = Array.from({ length: 51 }, (_, index) => ({
        id: index + 1, revision: 1, updatedAt: `2026-08-27T00:00:${String(index).padStart(2, '0')}.000Z`,
        source_version: sourceVersion, source: index + 100, model_refs: [] as number[], taxonomy_refs: [] as number[],
      }))
      let taxonomyNode: Record<string, unknown> | undefined
      let promptUpdates = 0
      let reviewEvents = 0
      const payload = {
        async find(input: Record<string, unknown>) {
          if (input.collection === 'taxonomy-nodes') return { docs: taxonomyNode === undefined ? [] : [taxonomyNode] }
          if (input.collection === 'prompt-artifacts') return { docs: promptDocuments }
          if (input.collection === 'audit-events') return { docs: [] }
          return { docs: [] }
        },
        async create(input: Record<string, unknown>) {
          if (input.collection === 'taxonomy-nodes') {
            taxonomyNode = { id: 80, ...(input.data as object) }
            return taxonomyNode
          }
          if (input.collection === 'audit-events') reviewEvents += 1
          return { id: 81, ...(input.data as object) }
        },
        async findByID(input: Record<string, unknown>) { return promptDocuments.find((document) => document.id === input.id)! },
        async update(input: Record<string, unknown>) {
          if (input.collection === 'taxonomy-nodes') {
            taxonomyNode = { ...taxonomyNode, ...(input.data as object) }
            return taxonomyNode
          }
          promptUpdates += 1
          if (promptUpdates === 51) throw new Error('injected taxonomy relationship failure')
          const document = promptDocuments.find((candidate) => candidate.id === input.id)!
          Object.assign(document, input.data)
          return document
        },
      }

      await expect(applyReviewedTaxonomyManifest(payload as never, manifest, 1)).rejects.toThrow(/injected taxonomy relationship failure/i)
      expect(promptUpdates).toBe(51)
      expect(taxonomyNode).toMatchObject({ promotion_state: 'candidate' })
      expect(reviewEvents).toBe(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('uses a fresh Payload request carrier for every concurrent publication mutation', async () => {
    const requestCarriers: object[] = []
    let createdID = 100
    const publisher = { id: 1, stable_id: '00000000-0000-4000-8000-000000000901', identity_kind: 'human', roles: ['publisher'], service_scopes: [] }
    const service = { id: 2, stable_id: '00000000-0000-4000-8000-000000000902', identity_kind: 'service', roles: [], service_scopes: ['publish'] }
    const payload = {
      async find(input: Record<string, unknown>) {
        if (input.collection === 'prompt-artifacts') return { docs: [{
          stable_id: '00000000-0000-4000-8000-000000000101', canonical_label: 'Source prompt',
          prompt: { original_text: 'Source prompt bytes.' }, original_language: 'en', outcome: { media_type: 'image' },
          source: { id: 10, stable_id: '00000000-0000-4000-8000-000000000201', source_version: `sha256:v1:${'a'.repeat(64)}`, captured_at: '2026-08-26T00:00:00.000Z', canonical_url: 'https://x.com/example/status/1' },
        }] }
        if (input.collection === 'media-evidence') return { docs: [] }
        if (input.collection === 'users') return { docs: [publisher, service] }
        if (input.collection === 'active-publication-pointers') return { docs: [{ id: 5, publish_version: null, previous_verified_version: null, revision: 0 }] }
        return { docs: [] }
      },
      async create(input: Record<string, unknown>) {
        if (typeof input.req === 'object' && input.req !== null) requestCarriers.push(input.req)
        createdID += 1
        if (input.collection === 'workflow-runs') return { id: createdID, stable_id: `00000000-0000-4000-8000-${String(createdID).padStart(12, '0')}`, revision: 1, status: 'queued' }
        return { id: createdID, ...(input.data as object) }
      },
      async update(input: Record<string, unknown>) { return { id: input.id, ...(input.data as object) } },
      async findByID() { return {} },
      async destroy() {},
    }

    const result = await publishLocalPseoProjections({ locale: 'en', concurrency: 3, promoteXPreviewMedia: false, reviewedMediaManifest: undefined }, payload as never)

    expect(result.routes).toHaveLength(3)
    expect(result).toMatchObject({ artifactCount: 1, projectionCount: 3, bindingCount: 3, promotedMediaCount: 0 })
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(new Set(requestCarriers).size).toBe(requestCarriers.length)
  })

  it('does not reuse a version left by an interrupted local projection run', () => {
    expect(nextLocalProjectionPublishVersion({ snapshotVersions: [], workflowKeys: ['local-projection:1:projection-a'] })).toBe(2)
    expect(nextLocalProjectionPublishVersion({ snapshotVersions: [2], workflowKeys: ['local-projection:1:projection-a', 'unrelated'] })).toBe(3)
  })

  it('invokes Payload transaction methods with their adapter receiver intact', async () => {
    const receiver = {
      marker: 'payload-adapter',
      async beginTransaction(this: { marker: string }) {
        if (this.marker !== 'payload-adapter') throw new Error('transaction receiver lost')
        return 'tx-receiver'
      },
      async commitTransaction(this: { marker: string }, _id: string) {
        if (this.marker !== 'payload-adapter') throw new Error('commit receiver lost')
      },
      async rollbackTransaction(this: { marker: string }, _id: string) {
        if (this.marker !== 'payload-adapter') throw new Error('rollback receiver lost')
      },
    }
    const requestTransactions: unknown[] = []
    const payload = {
      async find() {
        return { docs: [{
          id: 1, provider: 'x', visibility: 'private_evidence', sensitive_content_state: 'allowed', rights_state: 'metadata_only',
          remote_url: 'https://pbs.twimg.com/media/safe.jpg', source_ref: { canonical_url: 'https://x.com/example/status/1' },
        }] }
      },
      async update(input: Record<string, unknown>) {
        requestTransactions.push((input.req as Record<string, unknown>).transactionID)
        return input
      },
      db: receiver,
    }

    await expect(promoteEligibleXPreviewMedia(payload as never, 1, new Set(), (transactionID) => ({ transactionID }))).resolves.toBe(1)
    expect(requestTransactions).toEqual(['tx-receiver'])
  })

  it('bootstraps the pointer at the null triple before advancing to a release', () => {
    expect(planLocalPointerActivation(undefined, 3)).toEqual({
      bootstrap: { publish_version: null, previous_verified_version: null, revision: 0 },
      expected: { publish_version: null, previous_verified_version: null, revision: 0 },
      desired: { publish_version: 3, previous_verified_version: null, revision: 1 },
    })
  })

  it('carries only reviewed, populated taxonomy entities into the internal projection input', async () => {
    const artifacts = await artifactsFromPayload({
      async find() {
        return {
          docs: [{
            stable_id: '00000000-0000-4000-8000-000000000101',
            canonical_label: 'Source-backed prompt',
            prompt: { original_text: 'A source-backed prompt.' },
            outcome: { media_type: 'image' },
            source: {
              stable_id: '00000000-0000-4000-8000-000000000201',
              source_version: `sha256:v1:${'a'.repeat(64)}`,
              captured_at: '2026-08-26T00:00:00.000Z',
            },
            model_refs: [{
              stable_id: '00000000-0000-4000-8000-000000000301', node_type: 'model', stable_key: 'model:higgsfield', label: 'Higgsfield', promotion_state: 'reviewed',
            }],
            taxonomy_refs: [
              { stable_id: '00000000-0000-4000-8000-000000000302', node_type: 'style', stable_key: 'style:cinematic', label: 'Cinematic', promotion_state: 'candidate' },
              { stable_id: '00000000-0000-4000-8000-000000000303', node_type: 'subject', stable_key: 'subject:city', label: 'City', promotion_state: 'qualified' },
            ],
          }],
        }
      },
    } as never, 'en')

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.entityRefs).toEqual([
      { id: '00000000-0000-4000-8000-000000000301', kind: 'model', stableKey: 'model:higgsfield', label: 'Higgsfield', promotionState: 'reviewed' },
    ])
  })

  it('preserves an absent outcome type as unresolved instead of fabricating image evidence', async () => {
    const [artifact] = await artifactsFromPayload({
      async find() {
        return { docs: [{
          stable_id: '00000000-0000-4000-8000-000000000111',
          canonical_label: 'Outcome is absent',
          prompt: { original_text: 'Only source-backed prompt text.' },
          outcome: {},
          source: {
            stable_id: '00000000-0000-4000-8000-000000000211',
            source_version: `sha256:v1:${'b'.repeat(64)}`,
            captured_at: '2026-08-26T00:00:00.000Z',
          },
        }] }
      },
    } as never, 'en')

    expect(artifact?.mediaType).toBe('unresolved')
  })

  it('preserves source prompt bytes including leading and trailing whitespace', async () => {
    const original = '\n  Keep every source byte.  \t'
    const [artifact] = await artifactsFromPayload({
      async find(input: Record<string, unknown>) {
        if (input.collection === 'media-evidence') return { docs: [] }
        return { docs: [{
          stable_id: '00000000-0000-4000-8000-000000000112', canonical_label: 'Whitespace prompt',
          prompt: { original_text: original }, outcome: { media_type: 'image' },
          source: { stable_id: '00000000-0000-4000-8000-000000000212', source_version: `sha256:v1:${'d'.repeat(64)}`, captured_at: '2026-08-26T00:00:00.000Z' },
        }] }
      },
    } as never, 'en')

    expect(artifact?.text).toBe(original)
  })

  it('joins promoted media evidence to its source and derives an unresolved outcome type', async () => {
    const [artifact] = await artifactsFromPayload({
      async find(input: Record<string, unknown>) {
        if (input.collection === 'media-evidence') return { docs: [{
          media_evidence_id: '00000000-0000-4000-8000-000000000501',
          source_ref: { id: 42 }, provider: 'x', provider_media_id: 'tweet-image', media_type: 'image',
          remote_url: 'https://pbs.twimg.com/media/source-image.jpg', thumbnail_url: null,
          observed_at: '2026-08-26T00:00:00.000Z', rights_state: 'metadata_only', sensitive_content_state: 'allowed',
          content_hash: `sha256:v1:${'c'.repeat(64)}`, visibility: 'internal_preview', delivery_target: 'x_cdn',
          preview_noindex: true, attribution_url: 'https://x.com/example/status/1',
        }] }
        return { docs: [{
          stable_id: '00000000-0000-4000-8000-000000000111', canonical_label: 'Media-backed prompt',
          prompt: { original_text: 'Keep exact source prompt bytes.' }, outcome: {},
          source: { id: 42, stable_id: '00000000-0000-4000-8000-000000000211', source_version: `sha256:v1:${'b'.repeat(64)}`, captured_at: '2026-08-26T00:00:00.000Z' },
        }] }
      },
    } as never, 'en')

    expect(artifact).toMatchObject({
      mediaType: 'image',
      media: [expect.objectContaining({ remote_url: 'https://pbs.twimg.com/media/source-image.jpg', delivery_target: 'x_cdn' })],
    })
  })

  it('promotes only safe X CDN evidence with source attribution into noindex preview media', async () => {
    const updates: Record<string, unknown>[] = []
    const requestCarriers: object[] = []
    const payload = {
      async find() {
        return { docs: [
          { id: 1, provider: 'x', visibility: 'private_evidence', sensitive_content_state: 'allowed', rights_state: 'metadata_only', remote_url: 'https://pbs.twimg.com/media/safe.jpg', source_ref: { canonical_url: 'https://x.com/example/status/1' } },
          { id: 2, provider: 'x', visibility: 'private_evidence', sensitive_content_state: 'blocked', rights_state: 'metadata_only', remote_url: 'https://pbs.twimg.com/media/blocked.jpg', source_ref: { canonical_url: 'https://x.com/example/status/2' } },
          { id: 3, provider: 'x', visibility: 'private_evidence', sensitive_content_state: 'allowed', rights_state: 'metadata_only', remote_url: 'https://example.com/foreign.jpg', source_ref: { canonical_url: 'https://x.com/example/status/3' } },
          { id: 4, provider: 'x', visibility: 'private_evidence', sensitive_content_state: 'unknown', rights_state: 'metadata_only', remote_url: 'https://video.twimg.com/ext_tw_video/reviewed.mp4', thumbnail_url: 'https://pbs.twimg.com/media/reviewed.jpg', source_ref: { canonical_url: 'https://x.com/example/status/4' } },
          { id: 5, provider: 'x', visibility: 'private_evidence', sensitive_content_state: 'unknown', rights_state: 'metadata_only', remote_url: 'https://video.twimg.com/ext_tw_video/unreviewed.mp4', thumbnail_url: 'https://pbs.twimg.com/media/reviewed.jpg', source_ref: { canonical_url: 'https://x.com/example/status/5' } },
          { id: 6, provider: 'x', visibility: 'private_evidence', sensitive_content_state: 'unknown', rights_state: 'metadata_only', remote_url: 'https://video.twimg.com/ext_tw_video/reviewed.mp4', thumbnail_url: null, source_ref: { canonical_url: 'https://x.com/example/status/6' } },
        ] }
      },
      async update(input: Record<string, unknown>) { updates.push(input); return input },
    }

    await expect(promoteEligibleXPreviewMedia(
      payload as never,
      2,
      new Set([
        'https://video.twimg.com/ext_tw_video/reviewed.mp4',
        'https://pbs.twimg.com/media/reviewed.jpg',
      ]),
      () => {
        const request = { correlation: globalThis.crypto.randomUUID() }
        requestCarriers.push(request)
        return request
      },
    )).resolves.toBe(2)
    expect(updates).toEqual([expect.objectContaining({ id: 1, data: {
      visibility: 'internal_preview', delivery_target: 'x_cdn', preview_noindex: true,
      attribution_url: 'https://x.com/example/status/1',
    } }), expect.objectContaining({ id: 4, data: {
      sensitive_content_state: 'allowed', visibility: 'internal_preview', delivery_target: 'x_cdn', preview_noindex: true,
      attribution_url: 'https://x.com/example/status/4',
    } })])
    expect(updates.every((update) => typeof update.req === 'object' && update.req !== null)).toBe(true)
    expect(new Set(requestCarriers).size).toBe(2)
  })

  it.each(['page-projections', 'publication-projections'] as const)('rolls back a failed %s batch without snapshot or active-pointer advancement', async (failureCollection) => {
    const operations: string[] = []
    const rolledBack: string[] = []
    const committed: string[] = []
    let transaction = 0
    let createdID = 300
    const publisher = { id: 1, stable_id: '00000000-0000-4000-8000-000000000901', identity_kind: 'human', roles: ['publisher'], service_scopes: [] }
    const service = { id: 2, stable_id: '00000000-0000-4000-8000-000000000902', identity_kind: 'service', roles: [], service_scopes: ['publish'] }
    const payload = {
      async find(input: Record<string, unknown>) {
        if (input.collection === 'prompt-artifacts') return { docs: [{
          stable_id: '00000000-0000-4000-8000-000000000101', canonical_label: 'Source prompt',
          prompt: { original_text: 'Source prompt bytes.' }, original_language: 'en', outcome: { media_type: 'image' },
          source: { id: 10, stable_id: '00000000-0000-4000-8000-000000000201', source_version: `sha256:v1:${'a'.repeat(64)}`, captured_at: '2026-08-26T00:00:00.000Z' },
        }] }
        if (input.collection === 'media-evidence') return { docs: [] }
        if (input.collection === 'users') return { docs: [publisher, service] }
        if (input.collection === 'active-publication-pointers') return { docs: [{ id: 5, publish_version: 7, previous_verified_version: 6, revision: 3 }] }
        return { docs: [] }
      },
      async create(input: Record<string, unknown>) {
        operations.push(`create:${String(input.collection)}`)
        if (input.collection === failureCollection) throw new Error(`injected ${failureCollection} failure`)
        createdID += 1
        if (input.collection === 'workflow-runs') return { id: createdID, stable_id: `00000000-0000-4000-8000-${String(createdID).padStart(12, '0')}`, revision: 1, status: 'queued' }
        return { id: createdID, ...(input.data as object) }
      },
      async update(input: Record<string, unknown>) {
        operations.push(`update:${String(input.collection)}`)
        return { id: input.id, ...(input.data as object) }
      },
      async destroy() {},
      db: {
        async beginTransaction() { transaction += 1; return `tx-${transaction}` },
        async commitTransaction(id: string) { committed.push(id) },
        async rollbackTransaction(id: string) { rolledBack.push(id) },
      },
    }

    await expect(publishLocalPseoProjections(
      { locale: 'en', concurrency: 3, promoteXPreviewMedia: false, reviewedMediaManifest: undefined },
      payload as never,
    )).rejects.toThrow(new RegExp(`injected ${failureCollection} failure`, 'i'))
    expect(operations).not.toContain('create:publication-snapshots')
    expect(operations).not.toContain('update:active-publication-pointers')
    expect(rolledBack).toHaveLength(1)
    expect(committed).toHaveLength(failureCollection === 'page-projections' ? 0 : 1)
  })

  it('reconciles a 1,043-artifact publisher run through workflows, bindings, snapshot and active pointer', async () => {
    const sourceHash = `sha256:v1:${'e'.repeat(64)}`
    const promptDocuments = Array.from({ length: 1_043 }, (_, index) => ({
      stable_id: `00000000-0000-4000-8000-${String(index + 2_000).padStart(12, '0')}`,
      canonical_label: `Source prompt ${index}`,
      prompt: { original_text: `Exact source prompt ${index}.` },
      original_language: 'en',
      outcome: { media_type: 'image' },
      source: {
        id: index + 1,
        stable_id: `00000000-0000-4000-8000-${String(index + 4_000).padStart(12, '0')}`,
        source_version: sourceHash,
        captured_at: '2026-08-26T00:00:00.000Z',
      },
    }))
    const publisher = { id: 1, stable_id: '00000000-0000-4000-8000-000000000901', identity_kind: 'human', roles: ['publisher'], service_scopes: [] }
    const service = { id: 2, stable_id: '00000000-0000-4000-8000-000000000902', identity_kind: 'service', roles: [], service_scopes: ['publish'] }
    let createdID = 10_000
    let workflowCreated = 0
    let workflowSucceeded = 0
    let bindingCreated = 0
    let snapshotCreated = 0
    let activePointer: Record<string, unknown> = { id: 5, publish_version: 10, previous_verified_version: 9, revision: 4 }
    const payload = {
      async find(input: Record<string, unknown>) {
        if (input.collection === 'prompt-artifacts') return { docs: promptDocuments }
        if (input.collection === 'media-evidence') return { docs: [] }
        if (input.collection === 'users') return { docs: [publisher, service] }
        if (input.collection === 'active-publication-pointers') return { docs: [activePointer] }
        return { docs: [] }
      },
      async create(input: Record<string, unknown>) {
        createdID += 1
        if (input.collection === 'workflow-runs') {
          workflowCreated += 1
          return { id: createdID, stable_id: `00000000-0000-4000-8000-${String(createdID).padStart(12, '0')}`, revision: 1, status: 'queued' }
        }
        if (input.collection === 'publication-projections') bindingCreated += 1
        if (input.collection === 'publication-snapshots') snapshotCreated += 1
        return { id: createdID, ...(input.data as object) }
      },
      async update(input: Record<string, unknown>) {
        if (input.collection === 'workflow-runs') workflowSucceeded += 1
        if (input.collection === 'active-publication-pointers') activePointer = { id: input.id, ...(input.data as object) }
        return { id: input.id, ...(input.data as object) }
      },
      async destroy() {},
    }

    const result = await publishLocalPseoProjections(
      { locale: 'en', concurrency: 8, promoteXPreviewMedia: false, reviewedMediaManifest: undefined },
      payload as never,
    )

    expect(result).toMatchObject({
      artifactCount: 1_043,
      projectionCount: 1_055,
      bindingCount: 1_055,
      promotedMediaCount: 0,
    })
    expect(workflowCreated).toBe(result.projectionCount)
    expect(workflowSucceeded).toBe(result.projectionCount)
    expect(bindingCreated).toBe(result.bindingCount)
    expect(snapshotCreated).toBe(1)
    expect(activePointer).toMatchObject({
      publish_version: result.publishVersion,
      previous_verified_version: 10,
      revision: 5,
    })
    expect(new Set(result.routes).size).toBe(result.projectionCount)
  }, 30_000)

  it('builds the X CDN allowlist only from manifest rows explicitly marked non-sensitive', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bo-reviewed-media-'))
    const manifest = join(directory, 'media_refs.jsonl')
    try {
      await writeFile(manifest, [
        JSON.stringify({ possibly_sensitive: false, media: [{ thumb_url: 'https://pbs.twimg.com/media/reviewed.jpg', video: { mp4_high: 'https://video.twimg.com/ext_tw_video/reviewed-high.mp4', variants: [{ url: 'https://video.twimg.com/ext_tw_video/reviewed.mp4' }] } }] }),
        JSON.stringify({ possibly_sensitive: true, media: [{ thumb_url: 'https://pbs.twimg.com/media/rejected.jpg' }] }),
      ].join('\n'), 'utf8')

      const allowlist = await loadReviewedXMediaAllowlist(manifest)
      expect([...allowlist]).toEqual([
        'https://pbs.twimg.com/media/reviewed.jpg',
        'https://video.twimg.com/ext_tw_video/reviewed-high.mp4',
        'https://video.twimg.com/ext_tw_video/reviewed.mp4',
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
