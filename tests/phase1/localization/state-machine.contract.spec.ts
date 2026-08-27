import { describe, expect, it } from 'vitest'

import {
  APPLICATION_LOCALES,
  classifyLocaleRisk,
  decideLocaleContentRevision,
  deriveLocaleRisk,
  localeSeoCode,
  localeVisibility,
} from '@/localization/state-machine'

const record = {
  id: '01J6R3W2V8W24Q10NRDBVGN3P8',
  revision: 7,
  content_revision: 3,
  workflow_state: 'approved' as const,
  localized_fields: { title: '旧标题' },
  reviewed_revision: 3,
  reviewed_by_stable_id: '01J6R3W2V8W24Q10NRDBVGN3P9',
  reviewed_at: '2026-08-23T00:00:00.000Z',
  published_version: 2,
  is_money_page: false,
  risk_classes: [],
}

describe('T07 locale state machine', () => {
  it('keeps the normative 16-locale set and maps es-419 only to es', () => {
    expect(APPLICATION_LOCALES).toHaveLength(16)
    expect(localeSeoCode('es-419')).toBe('es')
    expect(localeSeoCode('es-ES')).toBe('es-ES')
    expect(() => localeSeoCode('en-US')).toThrow('unsupported locale')
  })

  it('derives high-risk classes from canonical multilingual content', () => {
    expect(classifyLocaleRisk({ title: '价格与许可条款' })).toEqual(['price', 'legal_rights'])
    expect(classifyLocaleRisk({ title: '価格・利用規約' })).toEqual(['price', 'legal_rights'])
    expect(classifyLocaleRisk({ title: 'Preis und Lizenz' })).toEqual(['price', 'legal_rights'])
  })

  it('creates a new revision and stale state when canonical content changes', () => {
    const result = decideLocaleContentRevision({
      record,
      command: {
        expected_revision: 7,
        expected_content_revision: 3,
        actor_id: '01J6R3W2V8W24Q10NRDBVGN3P7',
        correlation_id: '01J6R3W2V8W24Q10NRDBVGN3P6',
        reason_code: 'translation_corrected',
        localized_fields: { title: '新标题' },
        risk_classes: ['price'],
      },
    })
    expect(result).toMatchObject({
      allowed: true,
      next: {
        revision: 8,
        content_revision: 4,
        workflow_state: 'stale',
        reviewed_revision: null,
        reviewed_by_stable_id: null,
        reviewed_at: null,
        published_version: null,
        is_money_page: false,
        risk_classes: ['price'],
      },
      audit_intent: { action: 'locale-variants.localized_content_revised', outcome: 'allowed' },
    })
  })

  it('rejects stale CAS and direct risk/money inconsistencies without a mutation', () => {
    expect(decideLocaleContentRevision({ record, command: { expected_revision: 6, expected_content_revision: 3, actor_id: '01J6R3W2V8W24Q10NRDBVGN3P7', correlation_id: '01J6R3W2V8W24Q10NRDBVGN3P6', reason_code: 'translation_corrected', localized_fields: { title: '新标题' }, risk_classes: [] } })).toEqual({ allowed: false, reason_code: 'version_conflict' })
    expect(() => deriveLocaleRisk(['money'], false)).toThrow('money membership')
    expect(deriveLocaleRisk(['legal_rights', 'money'], true)).toEqual(['money', 'legal_rights'])
  })

  it('excludes non-approved and every risky variant from indexable eligibility', () => {
    expect(localeVisibility({ workflow_state: 'machine_draft', risk_classes: [] })).toEqual({ indexable: false, sitemap: false, unavailable: true })
    expect(localeVisibility({ workflow_state: 'approved', risk_classes: ['comparison'], human_reviewed: false })).toEqual({ indexable: false, sitemap: false, unavailable: true })
    expect(localeVisibility({ workflow_state: 'approved', risk_classes: ['comparison'], human_reviewed: true })).toEqual({ indexable: true, sitemap: true, unavailable: false })
  })
})
