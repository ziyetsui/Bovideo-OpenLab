import { describe, expect, it } from 'vitest'

import {
  compareGraphBytes,
  HIGGSFIELD_GRAPH_RULE_VERSION,
  persistGraphCandidateBatch,
  toReviewableGraphCandidates,
  extractGraphCandidates,
  type ImportedPromptArtifact,
} from '@/graph/higgsfield-extractor'
import { CandidateEdgeReviewService, CandidateNodeReviewService } from '@/graph/review'
import type { CandidateEdge, CandidateNode } from '@/graph/elevation'

const SOURCE_VERSION = `sha256:v1:${'a'.repeat(64)}`

const seedanceCinematicRecord: ImportedPromptArtifact = {
  id: 'prompt-seedance-cinematic',
  status: 'approved',
  source: {
    id: 'source-higgsfield-101',
    source_version_hash: SOURCE_VERSION,
    creator: '@higgsfield_creator',
    rights_state: 'metadata_only',
    safety_state: 'approved',
  },
  canonical_label: 'Seedance cinematic city prompt',
  prompt: {
    original_text: 'Seedance cinematic dolly zoom of a neon city. Use case: music video.',
  },
  outcome: { media_type: 'video', capability: 'music video' },
  variation_refs: [{
    id: 'prompt-seedance-cinematic-v2', label: 'Seedance cinematic city prompt v2',
    source_evidence: { id: 'source-higgsfield-102', source_version_hash: SOURCE_VERSION },
  }],
}

describe('Higgsfield graph candidate extraction', () => {
  it('keeps lexical model × style as a candidate edge and does not create a route', () => {
    const batch = extractGraphCandidates(seedanceCinematicRecord)

    expect(batch.edges).toContainEqual(expect.objectContaining({ relation: 'has_style', review_state: 'candidate' }))
    expect(batch.navigationCandidates).not.toContainEqual(expect.objectContaining({ link_policy: 'link' }))
    expect(batch.navigationCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ link_policy: 'dead_text', href: null, target_indexability: 'none' }),
    ]))
  })

  it('emits only immutable, source-version-bound candidates from supported evidence', () => {
    const batch = extractGraphCandidates(seedanceCinematicRecord)

    expect(batch.ruleVersion).toBe(HIGGSFIELD_GRAPH_RULE_VERSION)
    expect(batch.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ node_type: 'output', stable_key: 'output:video', promotion_state: 'candidate' }),
      expect.objectContaining({ node_type: 'model', stable_key: 'model:seedance', promotion_state: 'candidate' }),
      expect.objectContaining({ node_type: 'style', stable_key: 'style:cinematic', promotion_state: 'candidate' }),
      expect.objectContaining({ node_type: 'technique', stable_key: 'technique:dolly-zoom', promotion_state: 'candidate' }),
      expect.objectContaining({ node_type: 'use_case', stable_key: 'use_case:music-video', promotion_state: 'candidate' }),
      expect.objectContaining({ node_type: 'creator', stable_key: 'creator:higgsfield-creator', promotion_state: 'candidate' }),
    ]))
    for (const candidate of [...batch.nodes, ...batch.edges]) {
      expect(candidate.source_version_hash).toBe(SOURCE_VERSION)
      expect(candidate.evidence_refs).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'source', id: 'source-higgsfield-101', source_version_hash: SOURCE_VERSION }),
      ]))
    }
    expect(batch.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: 'produces', review_state: 'candidate' }),
      expect.objectContaining({ relation: 'generated_with', review_state: 'candidate' }),
      expect.objectContaining({ relation: 'used_for', review_state: 'candidate' }),
      expect.objectContaining({ relation: 'uses_technique', review_state: 'candidate' }),
      expect.objectContaining({ relation: 'created_by', review_state: 'candidate' }),
      expect.objectContaining({ relation: 'variation_of', review_state: 'candidate' }),
    ]))
    expect(batch.edges.find((edge) => edge.relation === 'variation_of')?.evidence_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'source-higgsfield-102', source_version_hash: SOURCE_VERSION }),
    ]))
    expect(Object.isFrozen(batch)).toBe(true)
    expect(Object.isFrozen(batch.nodes)).toBe(true)
    expect(Object.isFrozen(batch.edges)).toBe(true)
  })

  it('does not invent nodes from unsupported prompt text or unapproved artifacts', () => {
    const unsupported = extractGraphCandidates({
      ...seedanceCinematicRecord,
      canonical_label: 'Unclassified prompt',
      prompt: { original_text: 'Make it hyperflorpian and then glimmermax it.' },
      outcome: { media_type: 'unresolved' },
      source: { id: 'source-higgsfield-102', source_version_hash: SOURCE_VERSION, rights_state: 'metadata_only', safety_state: 'approved' },
      variation_refs: [],
    })
    const unapproved = extractGraphCandidates({ ...seedanceCinematicRecord, status: 'review' })

    expect(unsupported.nodes).toEqual([])
    expect(unsupported.edges).toEqual([])
    expect(unapproved).toMatchObject({ nodes: [], edges: [], navigationCandidates: [] })
  })

  it('persists extractor candidates into the graph review paths without auto-approval', async () => {
    const batch = extractGraphCandidates(seedanceCinematicRecord)
    const persistedNodes: CandidateNode[] = []
    const persistedEdges: CandidateEdge[] = []

    await persistGraphCandidateBatch(batch, {
      appendNode: (node) => { persistedNodes.push(node) },
      appendEdge: (edge) => { persistedEdges.push(edge) },
    })

    expect(persistedNodes).not.toHaveLength(0)
    expect(persistedEdges).not.toHaveLength(0)
    expect(persistedNodes[0]).toMatchObject({ revision: 1, reviewState: 'candidate', promotionState: 'candidate', proposerId: 'higgsfield-extractor' })
    expect(persistedEdges[0]).toMatchObject({ revision: 1, reviewState: 'candidate', proposerId: 'higgsfield-extractor' })

    let node = persistedNodes[0]!
    let edge = persistedEdges.find((candidate) => candidate.evidenceRefs.every((ref) => ref.sourceId === 'source-higgsfield-101'))!
    const sources = () => [{ sourceId: 'source-higgsfield-101', revision: SOURCE_VERSION, rightsState: 'metadata_only' as const, available: true }]
    const edgeReview = new CandidateEdgeReviewService({
      edgeStore: {
        read: async () => edge,
        transact: async <T>(revision: number, operation: (current: CandidateEdge) => Promise<T>) => {
          if (revision !== edge.revision) return { committed: false as const }
          edge = await operation(edge) as typeof edge
          return { committed: true as const, value: edge as T }
        },
      },
      auditSink: { append: async () => undefined }, now: () => '2026-08-26T00:00:00.000Z', sources,
    })
    const nodeReview = new CandidateNodeReviewService({
      nodeStore: {
        read: async () => node,
        transact: async <T>(revision: number, operation: (current: CandidateNode) => Promise<T>) => {
          if (revision !== node.revision) return { committed: false as const }
          node = await operation(node) as typeof node
          return { committed: true as const, value: node as T }
        },
      },
      auditSink: { append: async () => undefined }, now: () => '2026-08-26T00:00:00.000Z', sources,
    })

    await expect(edgeReview.review({ edgeId: edge.id, expectedRevision: 1, reviewer: { id: 'reviewer', role: 'reviewer' }, decision: 'approve' }))
      .resolves.toMatchObject({ reviewState: 'approved' })
    await expect(nodeReview.review({ nodeId: node.id, expectedRevision: 1, reviewer: { id: 'reviewer', role: 'reviewer' }, decision: 'approve' }))
      .resolves.toMatchObject({ reviewState: 'approved', promotionState: 'reviewed' })
  })

  it('fails closed and emits an audit event on a same-type normalized stable-key collision', () => {
    const audits: unknown[] = []

    expect(() => extractGraphCandidates({
      ...seedanceCinematicRecord,
      canonical_label: 'Unclassified prompt', prompt: { original_text: 'No lexical candidates.' }, outcome: { media_type: 'unresolved' },
      variation_refs: [],
      taxonomy_refs: [
        { id: 'style-1', node_type: 'style', label: 'Foo & Bar' },
        { id: 'style-2', node_type: 'style', label: 'Foo Bar' },
      ],
    }, { auditSink: { append: (event) => { audits.push(event) } } })).toThrow(/stable_key_collision/)
    expect(audits).toEqual([expect.objectContaining({ code: 'stable_key_collision', stable_key: 'style:foo-bar' })])
  })

  it('keeps same labels in different taxonomy types distinct through type-prefixed stable keys', () => {
    const batch = extractGraphCandidates({
      ...seedanceCinematicRecord,
      canonical_label: 'Unclassified prompt', prompt: { original_text: 'No lexical candidates.' }, outcome: { media_type: 'unresolved' }, variation_refs: [],
      source: { ...seedanceCinematicRecord.source, creator: undefined },
      taxonomy_refs: [
        { id: 'model-1', node_type: 'model', label: 'Foo' },
        { id: 'style-1', node_type: 'style', label: 'Foo' },
      ],
    })

    expect(batch.nodes.map((node) => node.stable_key)).toEqual(['model:foo', 'style:foo'])
  })

  it('orders candidate output with fixed bytewise comparison', () => {
    const batch = extractGraphCandidates({
      ...seedanceCinematicRecord,
      canonical_label: 'Unclassified prompt', prompt: { original_text: 'No lexical candidates.' }, outcome: { media_type: 'unresolved' }, variation_refs: [],
      source: { ...seedanceCinematicRecord.source, creator: undefined },
      taxonomy_refs: [
        { id: 'style-z', node_type: 'style', label: 'Zulu', stable_key: 'style:zulu' },
        { id: 'style-a', node_type: 'style', label: 'alpha', stable_key: 'style:alpha' },
      ],
    })

    expect(compareGraphBytes('Z', 'a')).toBeLessThan(0)
    expect(batch.nodes.map((node) => node.stable_key)).toEqual(['style:alpha', 'style:zulu'])
  })

  it.each(['style:Foo & Bar', 'style:Foo', ' style:foo ', 'style:foo '] as const)('fails closed and audits a noncanonical supplied stable key %s before dedupe', (stableKey) => {
    const audits: unknown[] = []

    expect(() => extractGraphCandidates({
      ...seedanceCinematicRecord,
      canonical_label: 'Unclassified prompt', prompt: { original_text: 'No lexical candidates.' }, outcome: { media_type: 'unresolved' }, variation_refs: [],
      taxonomy_refs: [
        { id: 'style-noncanonical', node_type: 'style', label: 'Foo & Bar', stable_key: stableKey },
        { id: 'style-canonical', node_type: 'style', label: 'Foo Bar', stable_key: stableKey === 'style:Foo' ? 'style:foo' : 'style:foo-bar' },
      ],
    }, { auditSink: { append: (event) => { audits.push(event) } } })).toThrow(/invalid_stable_key/)
    expect(audits).toEqual([expect.objectContaining({ code: 'invalid_stable_key', stable_key: stableKey })])
  })

  it('skips a variation whose target source evidence is absent', () => {
    const batch = extractGraphCandidates({
      ...seedanceCinematicRecord,
      variation_refs: [{ id: 'prompt-without-evidence', label: 'Unsafe variation' }],
    })

    expect(batch.edges).not.toContainEqual(expect.objectContaining({ relation: 'variation_of', to: expect.objectContaining({ id: 'prompt-without-evidence' }) }))
  })
})
