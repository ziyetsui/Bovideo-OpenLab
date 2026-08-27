import { APPLICATION_LOCALES as CONTRACT_LOCALES, type ApplicationLocale } from '@/contracts/locale'

export const APPLICATION_LOCALES = CONTRACT_LOCALES

export const LOCALE_RISK_CLASSES = ['money', 'comparison', 'price', 'legal_rights'] as const
export type LocaleRiskClass = (typeof LOCALE_RISK_CLASSES)[number]

type LocaleContentRecord = Readonly<{
  id: string
  revision: number
  content_revision: number
  workflow_state: 'missing' | 'machine_draft' | 'review' | 'approved' | 'published' | 'blocked' | 'stale' | 'withdrawn'
  localized_fields: Readonly<Record<string, string>>
  reviewed_revision: number | null
  reviewed_by_stable_id: string | null
  reviewed_at: string | null
  published_version: number | null
  is_money_page: boolean
  risk_classes: readonly LocaleRiskClass[]
}>

type ContentRevisionCommand = Readonly<{
  expected_revision: number
  expected_content_revision: number
  actor_id: string
  correlation_id: string
  reason_code: string
  localized_fields: Readonly<Record<string, string>>
  risk_classes: readonly LocaleRiskClass[]
}>

const riskSet = new Set<string>(LOCALE_RISK_CLASSES)

const sameFields = (left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean => {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key])
}

export const localeSeoCode = (locale: string): string => {
  if (!(APPLICATION_LOCALES as readonly string[]).includes(locale)) throw new Error('unsupported locale')
  return locale === 'es-419' ? 'es' : locale
}

/** Validates and canonicalizes server-derived risk facts. */
export const deriveLocaleRisk = (input: readonly string[], isMoneyPage?: boolean): readonly LocaleRiskClass[] => {
  const unique = [...new Set(input)]
  if (!unique.every((value) => riskSet.has(value))) throw new Error('unsupported locale risk class')
  const canonical = LOCALE_RISK_CLASSES.filter((value) => unique.includes(value))
  if (isMoneyPage !== undefined && isMoneyPage !== canonical.includes('money'))
    throw new Error('money membership must match is_money_page')
  return canonical
}

/** Deterministic server classifier over canonical localized field names/content. */
export const classifyLocaleRisk = (fields: Readonly<Record<string, string>>): readonly LocaleRiskClass[] => {
  const corpus = Object.entries(fields).map(([key, value]) => `${key} ${value}`.toLowerCase()).join('\n')
  // Canonical content may be in any of the supported application locales.
  // These deliberately conservative policy terms make every detected class
  // require the full human-review path; callers cannot remove the result.
  const matches = (pattern: RegExp): boolean => pattern.test(corpus)
  return deriveLocaleRisk([
    ...(matches(/money|payment|financial|货币|金钱|お金|돈|geld|argent|denaro|dinero|dinheiro|पैसा|เงิน|para|tiền/) ? ['money'] : []),
    ...(matches(/compare|comparison|versus|\bvs\b|比较|比較|비교|vergleich|comparaison|confronto|comparación|comparação|तुलना|เปรียบเทียบ|karşılaştır|so sánh/) ? ['comparison'] : []),
    ...(matches(/price|pricing|cost|usd|\$|价格|價錢|価格|가격|preis|prix|prezzo|precio|preço|कीमत|ราคา|fiyat|giá/) ? ['price'] : []),
    ...(matches(/legal|license|licence|rights|terms|许可|許可|条款|條款|利用規約|라이선스|lizenz|recht|droit|licenza|licencia|licença|कानूनी|ข้อกำหนด|lisans|pháp lý/) ? ['legal_rights'] : []),
  ])
}

export const localeVisibility = (input: Readonly<{
  workflow_state: LocaleContentRecord['workflow_state']
  risk_classes: readonly LocaleRiskClass[]
  human_reviewed?: boolean
}>): Readonly<{ indexable: boolean; sitemap: boolean; unavailable: boolean }> => {
  const risky = input.risk_classes.length > 0
  const eligible = input.workflow_state === 'approved' && (!risky || input.human_reviewed === true)
  return { indexable: eligible, sitemap: eligible, unavailable: !eligible }
}

export const decideLocaleContentRevision = (input: Readonly<{
  record: LocaleContentRecord
  command: ContentRevisionCommand
}>):
  | Readonly<{ allowed: false; reason_code: 'version_conflict' | 'no_content_change' }>
  | Readonly<{
    allowed: true
    next: LocaleContentRecord
    audit_intent: Readonly<{ action: 'locale-variants.localized_content_revised'; outcome: 'allowed'; reason_code: string; correlation_id: string }>
  }> => {
  const { record, command } = input
  if (command.expected_revision !== record.revision || command.expected_content_revision !== record.content_revision)
    return { allowed: false, reason_code: 'version_conflict' }
  if (sameFields(record.localized_fields, command.localized_fields)) return { allowed: false, reason_code: 'no_content_change' }
  // The request may only add a reviewed intent; persisted high-risk facts and
  // deterministic content classification cannot be cleared by a command.
  const risks = deriveLocaleRisk([...record.risk_classes, ...command.risk_classes, ...classifyLocaleRisk(command.localized_fields)])
  const nextState = record.workflow_state === 'approved' || record.workflow_state === 'published' ? 'stale' : record.workflow_state
  return {
    allowed: true,
    next: {
      ...record,
      revision: record.revision + 1,
      content_revision: record.content_revision + 1,
      workflow_state: nextState,
      localized_fields: Object.freeze({ ...command.localized_fields }),
      reviewed_revision: null,
      reviewed_by_stable_id: null,
      reviewed_at: null,
      published_version: null,
      risk_classes: risks,
      is_money_page: risks.includes('money'),
    },
    audit_intent: {
      action: 'locale-variants.localized_content_revised',
      outcome: 'allowed',
      reason_code: command.reason_code,
      correlation_id: command.correlation_id,
    },
  }
}

export type { ApplicationLocale }
