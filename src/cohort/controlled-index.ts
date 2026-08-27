import { createHash } from 'node:crypto'

import { APPLICATION_LOCALES, type ApplicationLocale } from '@/contracts/locale'
import type { PageFamily } from '@/page/schema'
import { stableJson } from '@/publication/manifest'

export const COHORT_REMOTE_STATUS = 'NOT_RUN_REMOTE' as const
export const COHORT_DECISIONS = ['expand', 'improve', 'hold', 'merge_noindex', 'withdraw'] as const
export type CohortDecision = (typeof COHORT_DECISIONS)[number]
export type CohortCandidate = Readonly<{
  url: string
  pageFamily: PageFamily
  locale: ApplicationLocale
  demandEvidence: string
  publishVersion: number
  inclusionDate: string
  qualified: boolean
  rightsState: 'first_party' | 'redistribution_licensed' | 'metadata_only' | 'blocked' | 'revoked' | 'unknown'
  canonical: boolean
}>

export type CohortManifest = Readonly<{
  schema_version: 'p5-cohort-manifest-v1'
  cohort_id: string
  publish_version: number
  inclusion_date: string
  start_date: string
  records: readonly CohortCandidate[]
  locale_counts: Readonly<Record<string, number>>
  family_counts: Readonly<Record<PageFamily, number>>
  manifest_hash: `sha256:p5-cohort-v1:${string}`
}>

const hash = (value: string): `sha256:p5-cohort-v1:${string}` => `sha256:p5-cohort-v1:${createHash('sha256').update(value, 'utf8').digest('hex')}`
const PUBLIC_RIGHTS = new Set(['first_party', 'redistribution_licensed'])
const assertDate = (value: string, name: string): void => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const parsed = match === null ? new Date(Number.NaN) : new Date(`${value}T00:00:00.000Z`)
  if (match === null || Number.isNaN(parsed.valueOf()) || parsed.getUTCFullYear() !== Number(match[1]) || parsed.getUTCMonth() + 1 !== Number(match[2]) || parsed.getUTCDate() !== Number(match[3])) throw new Error(`${name} must be an ISO calendar date`)
}
const assertCount = (value: number, name: string, allowZero = true): void => {
  if (!Number.isSafeInteger(value) || (allowZero ? value < 0 : value <= 0)) throw new Error(`${name} must be a finite non-negative integer`)
}
const manifestBody = (manifest: CohortManifest): Readonly<Record<string, unknown>> => ({ schema_version: manifest.schema_version, cohort_id: manifest.cohort_id, publish_version: manifest.publish_version, inclusion_date: manifest.inclusion_date, start_date: manifest.start_date, records: manifest.records, locale_counts: manifest.locale_counts, family_counts: manifest.family_counts })
export const hashCohortManifest = (manifest: CohortManifest): `sha256:p5-cohort-v1:${string}` => hash(stableJson(manifestBody(manifest)))
export const assertCohortManifest = (manifest: CohortManifest): void => {
  if (manifest.manifest_hash !== hashCohortManifest(manifest)) throw new Error('cohort manifest hash mismatch')
  if (manifest.records.length === 0 || manifest.records.length > 500) throw new Error('cohort manifest size is invalid')
}
const cleanPath = (url: string): string => {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.search !== '' || parsed.hash !== '' || !parsed.pathname.startsWith('/')) throw new Error(`cohort URL must be a clean HTTPS canonical: ${url}`)
  return parsed.pathname === '/' ? '/' : parsed.pathname.replace(/\/+$/, '')
}

export const buildCohortManifest = (input: Readonly<{
  phase4Passed: boolean
  cohortId: string
  publishVersion: number
  inclusionDate: string
  startDate?: string
  candidates: readonly CohortCandidate[]
  qualifiedInventoryTotal?: number
}>): CohortManifest => {
  if (!input.phase4Passed) throw new Error('Phase 4 must PASS before a Phase 5 cohort can be created')
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(input.cohortId)) throw new Error('cohort id is invalid')
  if (!Number.isSafeInteger(input.publishVersion) || input.publishVersion < 1) throw new Error('cohort publish version must be positive')
  assertDate(input.inclusionDate, 'inclusionDate')
  assertDate(input.startDate ?? input.inclusionDate, 'startDate')
  const candidates = [...input.candidates].sort((left, right) => left.url.localeCompare(right.url))
  if (candidates.length < 100 && input.qualifiedInventoryTotal === undefined) throw new Error('qualified inventory total is required for a cohort smaller than 100 URLs')
  const qualifiedInventoryTotal = input.qualifiedInventoryTotal ?? candidates.length
  assertCount(qualifiedInventoryTotal, 'qualifiedInventoryTotal')
  if (qualifiedInventoryTotal < candidates.length) throw new Error('qualified inventory total cannot be below selected cohort size')
  if (candidates.length === 0 || candidates.length > 500 || (candidates.length < 100 && qualifiedInventoryTotal !== candidates.length)) throw new Error('cohort must contain 100–500 URLs unless the qualified inventory is smaller')
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const route = cleanPath(candidate.url)
    const parsedUrl = new URL(candidate.url)
    const identity = `${parsedUrl.origin}${route}`
    if (seen.has(identity)) throw new Error(`duplicate cohort URL: ${candidate.url}`)
    seen.add(identity)
    if (!APPLICATION_LOCALES.includes(candidate.locale)) throw new Error(`cohort locale is not approved: ${candidate.locale}`)
    if (!candidate.qualified) throw new Error(`unqualified candidate cannot enter cohort: ${candidate.url}`)
    if (!PUBLIC_RIGHTS.has(candidate.rightsState) || !candidate.canonical || candidate.demandEvidence.trim().length === 0) throw new Error(`cohort candidate failed qualification: ${candidate.url}`)
    if (route.length < 2) throw new Error(`cohort route is empty: ${candidate.url}`)
    if (candidate.publishVersion !== input.publishVersion) throw new Error(`cohort publish version mismatch: ${candidate.url}`)
    if (candidate.inclusionDate !== input.inclusionDate) throw new Error(`cohort inclusion date mismatch: ${candidate.url}`)
  }
  const localeCounts = Object.fromEntries([...new Set(candidates.map((candidate) => candidate.locale))].sort().map((locale) => [locale, candidates.filter((candidate) => candidate.locale === locale).length]))
  if ((localeCounts.en ?? 0) < 20) throw new Error('cohort requires at least 20 English URLs')
  for (const [locale, count] of Object.entries(localeCounts)) if (locale !== 'en' && count < 10) throw new Error(`included locale ${locale} requires at least 10 URLs`)
  const familyCounts = Object.fromEntries((['hub', 'gallery', 'entity', 'detail'] as const).map((family) => [family, candidates.filter((candidate) => candidate.pageFamily === family).length])) as Record<PageFamily, number>
  const body = { schema_version: 'p5-cohort-manifest-v1' as const, cohort_id: input.cohortId, publish_version: input.publishVersion, inclusion_date: input.inclusionDate, start_date: input.startDate ?? input.inclusionDate, records: candidates, locale_counts: localeCounts, family_counts: familyCounts }
  return Object.freeze({ ...body, records: Object.freeze(candidates), locale_counts: Object.freeze(localeCounts), family_counts: Object.freeze(familyCounts), manifest_hash: hash(stableJson(body)) })
}

export type CohortActivation = Readonly<{
  cohort_id: string
  publish_version: number
  local_status: 'READY'
  remote_status: typeof COHORT_REMOTE_STATUS
  submission: 'NOT_SUBMITTED'
  remote_mutations: 0
  activated_at: string
}>

export const prepareCohortActivation = (input: Readonly<{ manifest: CohortManifest; activatedAt: string }>): CohortActivation => {
  assertCohortManifest(input.manifest)
  return Object.freeze({ cohort_id: input.manifest.cohort_id, publish_version: input.manifest.publish_version, local_status: 'READY', remote_status: COHORT_REMOTE_STATUS, submission: 'NOT_SUBMITTED', remote_mutations: 0, activated_at: input.activatedAt })
}

export type SurveillanceReport = Readonly<{
  cohort_id: string
  day: 7 | 14
  status: 'PASS' | 'FAIL' | 'NOT_RUN'
  severe_incidents: number
  technical_exclusion_rate: number
  orphan_urls: number
  freeze: boolean
  remote_status: typeof COHORT_REMOTE_STATUS
}>

export const buildSurveillanceReport = (input: Readonly<{ manifest: CohortManifest; day: 7 | 14; submitted: number; technicalExclusions: number; orphanUrls: number; severeIncidents: number }>): SurveillanceReport => {
  if (![7, 14].includes(input.day)) throw new Error('invalid surveillance day')
  assertCount(input.submitted, 'submitted', false)
  assertCount(input.technicalExclusions, 'technicalExclusions')
  assertCount(input.orphanUrls, 'orphanUrls')
  assertCount(input.severeIncidents, 'severeIncidents')
  if (input.technicalExclusions > input.submitted || input.orphanUrls > input.submitted || input.severeIncidents > input.submitted) throw new Error('invalid surveillance measurements')
  const technicalExclusionRate = input.technicalExclusions / input.submitted
  const freeze = input.severeIncidents > 0 || input.orphanUrls > 0 || technicalExclusionRate > 0.05
  return Object.freeze({ cohort_id: input.manifest.cohort_id, day: input.day, status: freeze ? 'FAIL' : 'PASS', severe_incidents: input.severeIncidents, technical_exclusion_rate: technicalExclusionRate, orphan_urls: input.orphanUrls, freeze, remote_status: COHORT_REMOTE_STATUS })
}

export type D28Diagnosis = Readonly<{ cohort_id: string; status: 'PASS' | 'FAIL'; freeze: boolean; discovered_rate: number; technical_exclusion_rate: number; query_owner_conflict_rate: number; severe_incidents: number; reasons: readonly string[] }>

export const diagnoseD28 = (input: Readonly<{ manifest: CohortManifest; submitted: number; discovered: number; technicalExclusions: number; orphanUrls: number; queryOwnerConflicts: number; reviewedQueryClusters: number; severeIncidents: number }>): D28Diagnosis => {
  assertCount(input.submitted, 'submitted', false)
  assertCount(input.discovered, 'discovered')
  assertCount(input.technicalExclusions, 'technicalExclusions')
  assertCount(input.orphanUrls, 'orphanUrls')
  assertCount(input.queryOwnerConflicts, 'queryOwnerConflicts')
  assertCount(input.reviewedQueryClusters, 'reviewedQueryClusters', false)
  assertCount(input.severeIncidents, 'severeIncidents')
  if (input.discovered > input.submitted || input.technicalExclusions > input.submitted || input.orphanUrls > input.submitted || input.queryOwnerConflicts > input.reviewedQueryClusters || input.severeIncidents > input.submitted) throw new Error('invalid D+28 measurements')
  const discoveredRate = input.discovered / input.submitted
  const technicalExclusionRate = input.technicalExclusions / input.submitted
  const queryOwnerConflictRate = input.queryOwnerConflicts / input.reviewedQueryClusters
  const reasons = [discoveredRate < 0.7 ? 'discovered_below_70_percent' : '', technicalExclusionRate > 0.05 ? 'technical_exclusion_above_5_percent' : '', input.orphanUrls > 0 ? 'orphan_indexable_url' : '', queryOwnerConflictRate > 0.1 ? 'query_owner_conflict_above_10_percent' : '', input.severeIncidents > 0 ? 'severe_incident' : ''].filter(Boolean)
  return Object.freeze({ cohort_id: input.manifest.cohort_id, status: reasons.length === 0 ? 'PASS' : 'FAIL', freeze: reasons.length > 0, discovered_rate: discoveredRate, technical_exclusion_rate: technicalExclusionRate, query_owner_conflict_rate: queryOwnerConflictRate, severe_incidents: input.severeIncidents, reasons: Object.freeze(reasons) })
}

export type D60Decision = Readonly<{ cohort_id: string; decision: 'expand' | 'freeze'; reasons: readonly string[] }>
export const decideD60 = (input: Readonly<{ manifest: CohortManifest; indexedValidSubmittedRate: number; impressionsRate: number; matureSegmentRates: readonly number[]; queryOwnerConflictRate: number; severeIncidents: number; validCtaRate: number }>): D60Decision => {
  const rates = [input.indexedValidSubmittedRate, input.impressionsRate, ...input.matureSegmentRates, input.queryOwnerConflictRate, input.validCtaRate]
  if (input.matureSegmentRates.length === 0 || rates.some((rate) => !Number.isFinite(rate) || rate < 0 || rate > 1)) throw new Error('invalid D+60 measurements')
  assertCount(input.severeIncidents, 'severeIncidents')
  const reasons = [input.indexedValidSubmittedRate < 0.6 ? 'indexed_valid_submitted_below_60_percent' : '', input.impressionsRate < 0.4 ? 'impressions_below_40_percent' : '', input.matureSegmentRates.some((rate) => rate < 0.4) ? 'mature_segment_below_40_percent' : '', input.queryOwnerConflictRate >= 0.1 ? 'query_owner_conflict_at_or_above_10_percent' : '', input.severeIncidents > 0 ? 'severe_incident' : '', input.validCtaRate < 0.99 ? 'cta_validity_below_99_percent' : ''].filter(Boolean)
  return Object.freeze({ cohort_id: input.manifest.cohort_id, decision: reasons.length === 0 ? 'expand' : 'freeze', reasons: Object.freeze(reasons) })
}

export type PortfolioSegment = Readonly<{ locale: ApplicationLocale; pageFamily: PageFamily; demandExists: boolean; qualityWeak: boolean; duplicateIntent: boolean; insufficientObservation: boolean; severeIncident: boolean; usefulProductAction: boolean }>
const portfolioDecision = (segment: PortfolioSegment): CohortDecision => segment.severeIncident ? 'withdraw' : segment.duplicateIntent ? 'merge_noindex' : segment.insufficientObservation ? 'hold' : !segment.demandExists ? 'improve' : segment.qualityWeak ? 'improve' : segment.usefulProductAction ? 'expand' : 'hold'
export const decideD90 = (segments: readonly PortfolioSegment[]): Readonly<{ decisions: readonly Readonly<PortfolioSegment & { decision: CohortDecision }>[] }> => {
  if (segments.length === 0 || segments.some((segment) => !APPLICATION_LOCALES.includes(segment.locale))) throw new Error('D+90 requires approved non-empty portfolio segments')
  return Object.freeze({ decisions: Object.freeze(segments.map((segment) => ({ ...segment, decision: portfolioDecision(segment) }))) })
}
