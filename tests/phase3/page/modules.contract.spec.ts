import { describe, expect, it } from 'vitest'

import { applyRightsRevocationFanout, assertModulePublishable, assertRightsRevocationFanout, pageModuleSchema, type PageModule } from '@/page/modules'
import { executeRightsRevocationFanout } from '@/page/rights-fanout'

const BASE = { module_id: '00000000-0000-4000-8000-000000000201', page_id: '00000000-0000-4000-8000-000000000011', locale: 'en' as const, module_version: 1, source_refs: [{ type: 'source' as const, id: '00000000-0000-4000-8000-000000000001' }], rights_state: 'first_party' as const, generated_by: 'human' as const, generator_version: 'p3-test-v1', content_hash: 'sha256:v1:0000000000000000000000000000000000000000000000000000000000000000', observed_at: '2026-08-25T00:00:00.000Z', expires_at: '2026-09-25T00:00:00.000Z', review_state: 'approved' as const, schema_version: 1 }

describe('P3-T07 module contracts', () => {
  it('accepts rights-backed Prompt, Tutorial and FAQ envelopes', () => {
    const prompt = pageModuleSchema.parse({ ...BASE, module_type: 'prompt', payload: { original_text: 'Use the source prompt.', source_ref: BASE.source_refs[0], redistribution_allowed: true, token_integrity_hash: 'sha256:prompt', variation_of: null } })
    const tutorial = pageModuleSchema.parse({ ...BASE, module_id: '00000000-0000-4000-8000-000000000202', module_type: 'tutorial', payload: { application_version: '1.0.0', steps: [{ selector: '#run', action: 'click', assertion: 'result visible', result: 'passed', screenshot_ref: { type: 'artifact', id: '00000000-0000-4000-8000-000000000212' }, pii_redacted: true, third_party_ui_authorized: true }] } })
    const faq = pageModuleSchema.parse({ ...BASE, module_id: '00000000-0000-4000-8000-000000000203', module_type: 'faq', payload: { question: 'How does it work?', answer_refs: [BASE.source_refs[0]], demand_source_ref: BASE.source_refs[0], sample_count: 12 } })
    ;[prompt, tutorial, faq].forEach((module) => assertModulePublishable(module as PageModule))
  })

  it('blocks rights, freshness and unsupported factual states before publication', () => {
    const blocked = pageModuleSchema.parse({ ...BASE, rights_state: 'revoked', module_type: 'prompt', payload: { original_text: 'source', source_ref: BASE.source_refs[0], redistribution_allowed: true, token_integrity_hash: 'hash', variation_of: null } })
    expect(() => assertModulePublishable(blocked as PageModule)).toThrow(/rights/i)
    const stale = pageModuleSchema.parse({ ...BASE, expires_at: '2026-08-24T00:00:00.000Z', module_type: 'faq', payload: { question: 'Q', answer_refs: [BASE.source_refs[0]], demand_source_ref: BASE.source_refs[0], sample_count: 1 } })
    expect(() => assertModulePublishable(stale as PageModule)).toThrow(/expiry/i)
    const comparison = pageModuleSchema.parse({ ...BASE, module_type: 'comparison', payload: { factual_reviewed: false, dimensions: [{ dimension: 'price', left: { source_ref: BASE.source_refs[0], observed_at: BASE.observed_at, expires_at: BASE.expires_at, fact_type: 'price', value: '$1' }, right: { source_ref: BASE.source_refs[0], observed_at: BASE.observed_at, expires_at: BASE.expires_at, fact_type: 'price', value: '$2' }, value: 'different' }] } })
    expect(() => assertModulePublishable(comparison as PageModule)).toThrow(/review/i)
  })

  it('covers examples, provenance and action module envelopes with publish gates', () => {
    const examples = pageModuleSchema.parse({ ...BASE, module_type: 'examples', payload: { selection_rule: 'top approved examples', examples: [{ example_id: '00000000-0000-4000-8000-000000000204', input: 'input', output: 'output', media_refs: [], redistribution_allowed: true }] } })
    const provenance = pageModuleSchema.parse({ ...BASE, module_id: '00000000-0000-4000-8000-000000000205', module_type: 'provenance', payload: { claims: [{ claim: 'Observed claim', source_ref: BASE.source_refs[0], observed_at: BASE.observed_at, confidence: 'explicit' }] } })
    const action = pageModuleSchema.parse({ ...BASE, module_id: '00000000-0000-4000-8000-000000000206', module_type: 'action', payload: { label: 'Try it', action_url: 'https://preview.local/run', state: 'enabled', success_message: 'Done', failure_message: 'Failed', unavailable_reason: null } })
    ;[examples, provenance, action].forEach((module) => assertModulePublishable(module as PageModule))

    const unauthorizedUgc = pageModuleSchema.parse({ ...BASE, module_type: 'case', payload: { submission_kind: 'ugc', authorization_ref: null, input_summary: 'input', output_summary: 'output', workflow_ref: null } })
    expect(() => assertModulePublishable(unauthorizedUgc as PageModule)).toThrow(/authorization/i)
    const disabledWithoutReason = pageModuleSchema.parse({ ...BASE, module_id: '00000000-0000-4000-8000-000000000207', module_type: 'action', payload: { label: 'Try it', action_url: null, state: 'disabled', success_message: 'Done', failure_message: 'Failed', unavailable_reason: null } })
    expect(() => assertModulePublishable(disabledWithoutReason as PageModule)).toThrow(/reason/i)
  })

  it('requires screenshot privacy, bounded comparison freshness and rights fan-out', () => {
    const tutorial = pageModuleSchema.parse({ ...BASE, module_id: '00000000-0000-4000-8000-000000000208', module_type: 'tutorial', payload: { application_version: '1.0.0', steps: [{ selector: '#run', action: 'click', assertion: 'result visible', result: 'passed', screenshot_ref: null, pii_redacted: false, third_party_ui_authorized: true }] } })
    expect(() => assertModulePublishable(tutorial as PageModule)).toThrow(/PII/i)
    const stalePrice = pageModuleSchema.parse({ ...BASE, module_id: '00000000-0000-4000-8000-000000000209', module_type: 'comparison', payload: { factual_reviewed: true, dimensions: [{ dimension: 'price', left: { source_ref: BASE.source_refs[0], observed_at: BASE.observed_at, expires_at: '2026-09-25T00:00:00.000Z', fact_type: 'price', value: '$1' }, right: { source_ref: BASE.source_refs[0], observed_at: BASE.observed_at, expires_at: '2026-09-01T00:00:00.000Z', fact_type: 'price', value: '$2' }, value: 'different' }] } })
    expect(() => assertModulePublishable(stalePrice as PageModule)).toThrow(/7 day/i)
    expect(() => assertRightsRevocationFanout({ rightsState: 'revoked', derivedPageState: 'active', snapshotState: 'withdrawn', exportState: 'excluded' })).toThrow(/fan out/i)
    expect(applyRightsRevocationFanout({ rightsState: 'revoked', derivedPageState: 'active', snapshotState: 'active', exportState: 'included' })).toMatchObject({ derivedPageState: 'withdrawn', snapshotState: 'withdrawn', exportState: 'excluded' })
    const sourceModule = pageModuleSchema.parse({ ...BASE, module_type: 'prompt', payload: { original_text: 'source', source_ref: BASE.source_refs[0], redistribution_allowed: true, token_integrity_hash: 'hash', variation_of: null } }) as PageModule
    const withdrawn = executeRightsRevocationFanout({ modules: [sourceModule], pageIndexState: 'indexable', snapshotState: 'active', exportIncluded: true }, 'revoked')
    expect(withdrawn).toMatchObject({ pageIndexState: 'retired', snapshotState: 'withdrawn', exportIncluded: false })
    expect(withdrawn.modules[0]?.rights_state).toBe('revoked')
    expect(() => assertRightsRevocationFanout({ rightsState: 'revoked', derivedPageState: 'withdrawn', snapshotState: 'withdrawn', exportState: 'excluded' })).not.toThrow()
  })
})
