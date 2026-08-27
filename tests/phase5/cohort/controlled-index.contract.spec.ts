import { describe, expect, it } from 'vitest'

import { buildCohortManifest, buildSurveillanceReport, decideD60, decideD90, diagnoseD28, prepareCohortActivation, type CohortCandidate } from '@/cohort/controlled-index'

const candidate = (index: number, locale: 'en' | 'zh-CN' = 'en'): CohortCandidate => ({
  url: `https://preview.example.test/${locale}/prompts/cohort-${index}`,
  pageFamily: 'detail', locale, demandEvidence: `demand-${index}`, publishVersion: 9, inclusionDate: '2026-08-26', qualified: true, rightsState: 'first_party', canonical: true,
})
const manifest = () => buildCohortManifest({ phase4Passed: true, cohortId: 'p5-cohort-01', publishVersion: 9, inclusionDate: '2026-08-26', qualifiedInventoryTotal: 20, candidates: Array.from({ length: 20 }, (_, index) => candidate(index)) })

describe('Phase 5 controlled indexing and growth loop', () => {
  it('builds a bounded deterministic cohort only after Phase 4 PASS', () => {
    const first = manifest()
    const second = manifest()
    expect(first.manifest_hash).toBe(second.manifest_hash)
    expect(first.locale_counts).toEqual({ en: 20 })
    expect(() => buildCohortManifest({ phase4Passed: false, cohortId: 'p5-cohort-01', publishVersion: 9, inclusionDate: '2026-08-26', qualifiedInventoryTotal: 20, candidates: Array.from({ length: 20 }, (_, index) => candidate(index)) })).toThrow(/Phase 4/i)
    expect(() => buildCohortManifest({ phase4Passed: true, cohortId: 'p5-cohort-01', publishVersion: 9, inclusionDate: 'not-a-date', qualifiedInventoryTotal: 20, candidates: Array.from({ length: 20 }, (_, index) => candidate(index)) })).toThrow(/date/i)
  })

  it('requires minimum English coverage and blocks unqualified/rights-unsafe records', () => {
    expect(() => buildCohortManifest({ phase4Passed: true, cohortId: 'p5-cohort-01', publishVersion: 9, inclusionDate: '2026-08-26', candidates: Array.from({ length: 20 }, (_, index) => candidate(index)) })).toThrow(/qualified inventory total/i)
    expect(() => buildCohortManifest({ phase4Passed: true, cohortId: 'p5-cohort-01', publishVersion: 9, inclusionDate: '2026-08-26', qualifiedInventoryTotal: 19, candidates: Array.from({ length: 19 }, (_, index) => candidate(index)) })).toThrow(/20 English/i)
    expect(() => buildCohortManifest({ phase4Passed: true, cohortId: 'p5-cohort-01', publishVersion: 9, inclusionDate: '2026-08-26', qualifiedInventoryTotal: 20, candidates: [...Array.from({ length: 19 }, (_, index) => candidate(index)), { ...candidate(19), qualified: false }] })).toThrow(/qualified|qualification/i)
    expect(() => buildCohortManifest({ phase4Passed: true, cohortId: 'p5-cohort-01', publishVersion: 9, inclusionDate: '2026-08-26', qualifiedInventoryTotal: 20, candidates: [...Array.from({ length: 19 }, (_, index) => candidate(index)), { ...candidate(19), rightsState: 'blocked' }] })).toThrow(/qualification/i)
  })

  it('prepares local activation without remote submission or mutation', () => {
    const activation = prepareCohortActivation({ manifest: manifest(), activatedAt: '2026-08-26T00:00:00.000Z' })
    expect(activation).toMatchObject({ local_status: 'READY', remote_status: 'NOT_RUN_REMOTE', submission: 'NOT_SUBMITTED', remote_mutations: 0 })
    expect(() => prepareCohortActivation({ manifest: { ...manifest(), manifest_hash: 'sha256:p5-cohort-v1:forged' as `sha256:p5-cohort-v1:${string}` }, activatedAt: '2026-08-26T00:00:00.000Z' })).toThrow(/hash/i)
  })

  it('freezes surveillance and D+28 when technical, orphan, discovery, conflict or severe gates fail', () => {
    const cohort = manifest()
    expect(buildSurveillanceReport({ manifest: cohort, day: 7, submitted: 20, technicalExclusions: 0, orphanUrls: 0, severeIncidents: 0 }).freeze).toBe(false)
    expect(buildSurveillanceReport({ manifest: cohort, day: 14, submitted: 20, technicalExclusions: 2, orphanUrls: 1, severeIncidents: 0 })).toMatchObject({ status: 'FAIL', freeze: true })
    expect(diagnoseD28({ manifest: cohort, submitted: 20, discovered: 10, technicalExclusions: 0, orphanUrls: 0, queryOwnerConflicts: 3, reviewedQueryClusters: 20, severeIncidents: 0 })).toMatchObject({ status: 'FAIL', freeze: true })
    expect(() => buildSurveillanceReport({ manifest: cohort, day: 7, submitted: Number.NaN, technicalExclusions: 0, orphanUrls: 0, severeIncidents: 0 })).toThrow(/submitted/i)
    expect(() => diagnoseD28({ manifest: cohort, submitted: 20, discovered: Number.NaN, technicalExclusions: 0, orphanUrls: 0, queryOwnerConflicts: 0, reviewedQueryClusters: 20, severeIncidents: 0 })).toThrow(/discovered/i)
  })

  it('evaluates D+60 expansion and D+90 portfolio decisions deterministically', () => {
    const cohort = manifest()
    expect(decideD60({ manifest: cohort, indexedValidSubmittedRate: 0.7, impressionsRate: 0.5, matureSegmentRates: [0.5], queryOwnerConflictRate: 0.05, severeIncidents: 0, validCtaRate: 0.995 })).toMatchObject({ decision: 'expand' })
    expect(decideD60({ manifest: cohort, indexedValidSubmittedRate: 0.7, impressionsRate: 0.5, matureSegmentRates: [0.3], queryOwnerConflictRate: 0.05, severeIncidents: 0, validCtaRate: 0.995 }).decision).toBe('freeze')
    const portfolio = decideD90([
      { locale: 'en', pageFamily: 'detail', demandExists: true, qualityWeak: false, duplicateIntent: false, insufficientObservation: false, severeIncident: false, usefulProductAction: true },
      { locale: 'zh-CN', pageFamily: 'detail', demandExists: true, qualityWeak: false, duplicateIntent: true, insufficientObservation: false, severeIncident: false, usefulProductAction: false },
      { locale: 'en', pageFamily: 'gallery', demandExists: true, qualityWeak: false, duplicateIntent: false, insufficientObservation: false, severeIncident: true, usefulProductAction: false },
    ])
    expect(portfolio.decisions.map((decision) => decision.decision)).toEqual(['expand', 'merge_noindex', 'withdraw'])
    expect(() => decideD60({ manifest: cohort, indexedValidSubmittedRate: Number.NaN, impressionsRate: 0.5, matureSegmentRates: [0.5], queryOwnerConflictRate: 0.05, severeIncidents: 0, validCtaRate: 0.995 })).toThrow(/D\+60/i)
  })
})
