import type { PageEnvelope } from '@/page/schema'

/** Rights states that may be rendered into a public release. */
export const PUBLIC_RIGHTS_STATES = ['first_party', 'redistribution_licensed'] as const
export type PublicRightsState = (typeof PUBLIC_RIGHTS_STATES)[number]
export type RightsState = PublicRightsState | 'display_licensed' | 'metadata_only' | 'unknown' | 'blocked' | 'revoked'

/** Stable, machine-readable reason codes. Keep order and spellings backwards compatible. */
export const QUALIFICATION_REASON_CODES = [
  'index_state_not_indexable',
  'robots_not_index_follow',
  'canonical_not_self',
  'locale_not_approved',
  'rights_not_permitted',
  'primary_media_missing',
  'hard_gate_failed',
] as const
export type QualificationReasonCode = (typeof QUALIFICATION_REASON_CODES)[number]

export type QualificationGate = Readonly<{
  code: string
  passed: boolean
}>

export type QualificationInput = Readonly<{
  page: PageEnvelope
  /** The canonical URL observed in the request. Defaults to page.canonical. */
  requestedCanonical?: string
  /** Defaults to page.detail.robots for detail pages and index,follow otherwise. */
  robots?: string
  localeApproved: boolean
  rightsState: RightsState
  primaryMediaPresent: boolean
  hardGates?: readonly QualificationGate[]
}>

export type QualificationLedgerEntry = Readonly<{
  code: QualificationReasonCode
  passed: boolean
  hard: true
}>

export type QualificationResult = Readonly<{
  qualified: boolean
  indexState: 'indexable' | 'not_generated' | 'retired'
  reasonCodes: readonly QualificationReasonCode[]
  ledger: readonly QualificationLedgerEntry[]
}>

const hasIndexFollow = (robots: string): boolean => {
  const tokens = robots.toLowerCase().split(/[\s,]+/).filter(Boolean)
  return tokens.includes('index') && tokens.includes('follow') && !tokens.includes('noindex') && !tokens.includes('nofollow')
}

const isSelfCanonical = (page: PageEnvelope, requestedCanonical: string): boolean => {
  try {
    const actual = new URL(page.canonical)
    const requested = new URL(requestedCanonical, actual.origin)
    return actual.origin === requested.origin && actual.pathname === requested.pathname && actual.search === '' && requested.search === '' && actual.hash === '' && requested.hash === ''
  } catch {
    return false
  }
}

const gateFailed = (gates: readonly QualificationGate[]): boolean => gates.some((gate) => gate.passed !== true)

/**
 * Evaluate the release qualification contract. The output is deterministic for
 * a given input and intentionally contains every hard gate, including passed
 * gates, so an audit can explain both acceptance and rejection.
 */
export const qualifyForRelease = (input: QualificationInput): QualificationResult => {
  const requestedCanonical = input.requestedCanonical ?? input.page.canonical
  const robots = input.robots ?? (input.page.page_type === 'detail' ? input.page.detail.robots : 'index,follow')
  const gates = input.hardGates ?? []
  const ledger: QualificationLedgerEntry[] = [
    { code: 'index_state_not_indexable', passed: input.page.index_state === 'indexable', hard: true },
    { code: 'robots_not_index_follow', passed: hasIndexFollow(robots), hard: true },
    { code: 'canonical_not_self', passed: isSelfCanonical(input.page, requestedCanonical), hard: true },
    { code: 'locale_not_approved', passed: input.localeApproved, hard: true },
    { code: 'rights_not_permitted', passed: PUBLIC_RIGHTS_STATES.includes(input.rightsState as PublicRightsState), hard: true },
    { code: 'primary_media_missing', passed: input.primaryMediaPresent, hard: true },
    { code: 'hard_gate_failed', passed: !gateFailed(gates), hard: true },
  ]
  const reasonCodes = ledger.filter((entry) => !entry.passed).map((entry) => entry.code)
  const qualified = reasonCodes.length === 0
  return Object.freeze({
    qualified,
    indexState: qualified ? 'indexable' : input.page.index_state === 'retired' ? 'retired' : 'not_generated',
    reasonCodes: Object.freeze(reasonCodes),
    ledger: Object.freeze(ledger),
  })
}

export const evaluateQualification = qualifyForRelease
export const qualificationReasonLedger = qualifyForRelease

