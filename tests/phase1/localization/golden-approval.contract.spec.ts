import { describe, expect, it } from 'vitest'

import {
  compareApprovedGoldenReplacement,
  createGoldenSetManifest,
  type GoldenApprovalLookup,
} from '@/localization/golden-set'
import { GoldenReplacementApprovals, validateGoldenReplacementApproval } from '@/collections/GoldenReplacementApprovals'
import { goldenReplacementCompareEndpoint } from '@/localization/content-command'
import { makeGoldenManifestInput } from '../fixtures/localization/frozen-golden-set'

const reviewer = {
  id: 42,
  stable_id: '01J6R3W2V8W24Q10NRDBVGN3P9',
  identity_kind: 'human',
  roles: ['reviewer'],
  service_scopes: [],
}

const hashes = () => {
  const baseline = createGoldenSetManifest(makeGoldenManifestInput())
  const candidate = createGoldenSetManifest(makeGoldenManifestInput({ model_snapshot: 'candidate-model' }))
  return { baseline, candidate }
}

describe('golden replacement approval chain', () => {
  it('requires a server lookup and fails closed for a caller-supplied approval object', async () => {
    const { baseline, candidate } = hashes()

    await expect(
      compareApprovedGoldenReplacement(
        baseline,
        candidate,
        { baseline_manifest_hash: baseline.manifest_hash } as never,
      ),
    ).resolves.toMatchObject({ passed: false })
  })

  it('accepts only a persisted approval bound to both manifests and evaluator', async () => {
    const { baseline, candidate } = hashes()
    const lookup: GoldenApprovalLookup = {
      findApprovedGoldenReplacement: async () => ({
        baseline_manifest_hash: baseline.manifest_hash,
        candidate_manifest_hash: candidate.manifest_hash,
        evaluator_version: candidate.evaluator_version,
        reviewer_actor_id: reviewer.stable_id,
        reviewer_role: 'reviewer',
        correlation_id: '01J6R3W2V8W24Q10NRDBVGN3P8',
        approved_at: '2026-08-25T00:00:00.000Z',
        audit_ref: 'golden-replacement-approval:01J6R3W2V8W24Q10NRDBVGN3P8',
        audit_outcome: 'allowed',
      }),
    }

    await expect(compareApprovedGoldenReplacement(baseline, candidate, lookup)).resolves.toMatchObject({
      passed: true,
      regressions: [],
    })
  })

  it('derives reviewer authority and immutable audit facts from the authenticated user', async () => {
    const { baseline, candidate } = hashes()
    const input = {
      baseline_manifest_hash: baseline.manifest_hash,
      candidate_manifest_hash: candidate.manifest_hash,
      evaluator_version: candidate.evaluator_version,
      correlation_id: '01J6R3W2V8W24Q10NRDBVGN3P8',
    }
    const result = await validateGoldenReplacementApproval({
      operation: 'create',
      data: { ...input },
      req: { user: reviewer },
    } as never)

    expect(result).toMatchObject({
      reviewer_actor_id: reviewer.stable_id,
      reviewer_role: 'reviewer',
      reviewer_user: reviewer.id,
      audit_outcome: 'allowed',
      source_version: candidate.manifest_hash,
      audit_ref: 'golden-replacement-approval:01J6R3W2V8W24Q10NRDBVGN3P8',
      audit: {
        created_by: reviewer.id,
        updated_by: reviewer.id,
        correlation_id: '01J6R3W2V8W24Q10NRDBVGN3P8',
      },
    })
    expect(validateGoldenReplacementApproval({
      operation: 'create',
      data: { ...input, reviewer_actor_id: 'attacker' },
      req: { user: reviewer },
    } as never)).toMatchObject({ reviewer_actor_id: reviewer.stable_id })
    expect(() => validateGoldenReplacementApproval({
      operation: 'create',
      data: { ...input, reviewer_role: 'admin' },
      req: { user: reviewer },
    } as never)).toThrow(/reviewer/i)
    expect(() => validateGoldenReplacementApproval({ operation: 'update', data: {}, originalDoc: result } as never)).toThrow(/immutable/i)
    expect(() => validateGoldenReplacementApproval({ operation: 'create', data: input, req: { user: { ...reviewer, roles: ['editor'] } } } as never)).toThrow(/reviewer/i)
  })

  it('rejects a transport-provided approval timestamp', () => {
    const { baseline, candidate } = hashes()

    expect(() => validateGoldenReplacementApproval({
      operation: 'create',
      data: {
        baseline_manifest_hash: baseline.manifest_hash,
        candidate_manifest_hash: candidate.manifest_hash,
        evaluator_version: candidate.evaluator_version,
        correlation_id: '01J6R3W2V8W24Q10NRDBVGN3P8',
        approved_at: '2020-01-01T00:00:00.000Z',
      },
      req: { user: reviewer },
    } as never)).toThrow(/approved_at.*server/i)
  })

  it('declares database uniqueness for replay-safe approval facts', () => {
    expect(GoldenReplacementApprovals.indexes).toEqual(expect.arrayContaining([
      { fields: ['baseline_manifest_hash', 'candidate_manifest_hash', 'evaluator_version'], unique: true },
      { fields: ['correlation_id'], unique: true },
    ]))
  })

  it('serves comparison through the Payload-backed server endpoint for an authorized reader', async () => {
    const { baseline, candidate } = hashes()
    const persisted = {
      baseline_manifest_hash: baseline.manifest_hash,
      candidate_manifest_hash: candidate.manifest_hash,
      evaluator_version: candidate.evaluator_version,
      reviewer_actor_id: reviewer.stable_id,
      reviewer_role: 'reviewer',
      correlation_id: '01J6R3W2V8W24Q10NRDBVGN3P8',
      approved_at: '2026-08-25T00:00:00.000Z',
      audit_ref: 'golden-replacement-approval:01J6R3W2V8W24Q10NRDBVGN3P8',
      audit_outcome: 'allowed',
    }
    const response = await goldenReplacementCompareEndpoint({
      json: async () => ({ baseline, candidate }),
      user: reviewer,
      payload: { find: async () => ({ docs: [persisted] }) },
    } as never)
    await expect(response.json()).resolves.toMatchObject({ passed: true, regressions: [] })
  })

  it.each([
    ['an anonymous caller', undefined],
    ['an editor', { ...reviewer, roles: ['editor'] }],
  ])('rejects %s before the privileged approval lookup', async (_label, user) => {
    const { baseline, candidate } = hashes()
    let lookupCalled = false
    const find = async () => {
      lookupCalled = true
      return { docs: [] }
    }

    await expect(goldenReplacementCompareEndpoint({
      json: async () => ({ baseline, candidate }),
      user,
      payload: { find },
    } as never)).rejects.toMatchObject({ status: 403 })
    expect(lookupCalled).toBe(false)
  })
})
