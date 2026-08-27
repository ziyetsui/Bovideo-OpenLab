import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { assertModulePublishable, pageModuleSchema } from '@/page/modules'
import { GenerationBlockedError, createModuleRegistry } from '@/modules/registry'

const SOURCE = { type: 'source' as const, id: '00000000-0000-4000-8000-000000000001' }
const SCREENSHOT = { type: 'artifact' as const, id: '00000000-0000-4000-8000-000000000003' }

const hash = (value: string): string => `sha256:v1:${createHash('sha256').update(value).digest('hex')}`

const envelope = (moduleId: string) => ({
  module_id: moduleId,
  page_id: '00000000-0000-4000-8000-000000000011',
  locale: 'en' as const,
  module_version: 1,
  source_refs: [SOURCE],
  rights_state: 'redistribution_licensed' as const,
  generated_by: 'rule' as const,
  generator_version: 'module-test-v1',
  content_hash: hash(`content:${moduleId}`),
  observed_at: '2026-08-25T00:00:00.000Z',
  expires_at: '2026-08-30T00:00:00.000Z',
  schema_version: 1,
})

const registry = createModuleRegistry()

describe('P3-T06 module generators', () => {
  it('preserves Prompt bytes and requires redistribution rights for public output', async () => {
    const originalText = 'Keep  two spaces, a newline\n, and punctuation exactly.'
    const generatedModule = await registry.generate('prompt', {
      envelope: envelope('00000000-0000-4000-8000-000000000201'),
      originalText,
      sourceRef: SOURCE,
      redistributionAllowed: true,
      variationOf: null,
    })

    expect(pageModuleSchema.safeParse(generatedModule).success).toBe(true)
    if (generatedModule.module_type !== 'prompt') throw new Error('expected prompt module')
    expect(generatedModule.payload.original_text).toBe(originalText)
    expect(generatedModule.payload.token_integrity_hash).toBe(hash(originalText))
    expect(() => assertModulePublishable({ ...generatedModule, review_state: 'approved', rights_state: 'metadata_only' })).toThrow(/redistribution/i)
  })

  it('fails closed for a UGC case without explicit authorization', async () => {
    await expect(registry.generate('case', {
      envelope: envelope('00000000-0000-4000-8000-000000000202'),
      submissionKind: 'ugc',
      authorizationRef: null,
      inputSummary: 'Submitted input',
      outputSummary: 'Submitted result',
      workflowRef: null,
    })).rejects.toMatchObject({ name: 'GenerationBlockedError', code: 'case_ugc_authorization_required' })
  })

  it('requires passed, privacy-safe, authorized RPA steps with screenshot evidence', async () => {
    await expect(registry.generate('tutorial', {
      envelope: envelope('00000000-0000-4000-8000-000000000203'),
      applicationVersion: '1.2.3',
      steps: [{ selector: '#submit', action: 'click', assertion: 'result is visible', result: 'passed', screenshotRef: null, piiRedacted: true, thirdPartyUiAuthorized: true }],
    })).rejects.toMatchObject({ name: 'GenerationBlockedError', code: 'tutorial_screenshot_evidence_required' })

    const generatedModule = await registry.generate('tutorial', {
      envelope: envelope('00000000-0000-4000-8000-000000000204'),
      applicationVersion: '1.2.3',
      steps: [{ selector: '#submit', action: 'click', assertion: 'result is visible', result: 'passed', screenshotRef: SCREENSHOT, piiRedacted: true, thirdPartyUiAuthorized: true }],
    })
    expect(pageModuleSchema.safeParse(generatedModule).success).toBe(true)

    if (generatedModule.module_type !== 'tutorial') throw new Error('expected tutorial module')
    expect(() => assertModulePublishable({
      ...generatedModule,
      review_state: 'approved',
      payload: { ...generatedModule.payload, steps: [{ ...generatedModule.payload.steps[0]!, screenshot_ref: null }] },
    })).toThrow(/screenshot/i)
  })

  it('requires cited comparison facts and leaves generated synthesis pending human factual review', async () => {
    const generatedModule = await registry.generate('comparison', {
      envelope: envelope('00000000-0000-4000-8000-000000000205'),
      dimensions: [{
        dimension: 'Price',
        left: { sourceRef: SOURCE, observedAt: '2026-08-25T00:00:00.000Z', expiresAt: '2026-08-30T00:00:00.000Z', factType: 'price', value: '$10' },
        right: { sourceRef: SOURCE, observedAt: '2026-08-25T00:00:00.000Z', expiresAt: '2026-08-30T00:00:00.000Z', factType: 'price', value: '$20' },
        value: 'The cited prices differ.',
      }],
    })

    if (generatedModule.module_type !== 'comparison') throw new Error('expected comparison module')
    expect(generatedModule.payload.factual_reviewed).toBe(false)
    expect(generatedModule.review_state).toBe('candidate')
    expect(() => assertModulePublishable({ ...generatedModule, review_state: 'approved' })).toThrow('comparison facts require factual review')
  })

  it('requires FAQ answer sources and demand evidence without generating a fallback answer', async () => {
    await expect(registry.generate('faq', {
      envelope: envelope('00000000-0000-4000-8000-000000000206'),
      question: 'How do I use it?',
      answerRefs: [],
      demandSourceRef: SOURCE,
      sampleCount: 8,
    })).rejects.toMatchObject({ name: 'GenerationBlockedError', code: 'faq_answer_sources_required' })
  })

  it('uses one stable blocked error for unsupported generators', async () => {
    await expect(registry.generate('action', {})).rejects.toBeInstanceOf(GenerationBlockedError)
    await expect(registry.generate('action', {})).rejects.toMatchObject({ code: 'unsupported_module:action' })
  })
})
