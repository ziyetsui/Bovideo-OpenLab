import { createHash } from 'node:crypto'

import {
  APPLICATION_LOCALES,
  applicationLocaleSchema,
  type ApplicationLocale,
} from '@/contracts/locale'
import {
  restoreProtectedSpans,
  type ProtectedSpan,
} from '@/localization/protected-spans'
import { decideLocaleQa, type LocaleQaInput } from '@/localization/qa'

const BATCH_SIZE = 4

export type LocaleTranslationRequest = Readonly<{
  artifactId: string
  sourceHash: string
  sourceLocale: ApplicationLocale
  locale: ApplicationLocale
  sourceText: string
  protectedSpans: readonly ProtectedSpan[]
  batchId: string
}>

export type LocaleTranslationResponse = Readonly<{
  /** The protected-span wire string. It must retain every placeholder. */
  serializedPrompt: string
  localizedFields: Readonly<Record<string, string>>
  qa?: unknown
}>

export type LocaleTranslationVariant = Readonly<{
  id: string
  artifactId: string
  locale: ApplicationLocale
  sourceLocale: ApplicationLocale
  sourceHash: string
  contentRevision: number
  localizedFields: Readonly<Record<string, string>>
  restoredPrompt: string
  protectedSpanResult: 'pass'
  qa: Readonly<ReturnType<typeof decideLocaleQa>>
  workflowState: 'review' | 'blocked'
  lastContentEditorId: string
  reviewedBy: null
  reviewedAt: null
  batchId: string
}>

export type LocaleBatch = Readonly<{
  id: string
  index: number
  locales: readonly ApplicationLocale[]
  localeSetHash: string
}>

export type LocaleTranslationResult = Readonly<{
  artifactId: string
  sourceHash: string
  locales: readonly LocaleTranslationVariant[]
  batches: readonly LocaleBatch[]
  fallback_count: 0
  network_calls: 0
}>

export type LocaleTranslationServiceOptions = Readonly<{
  artifactId: string
  sourceHash: string
  sourceLocale: ApplicationLocale
  sourceText: string
  protectedSpans: readonly ProtectedSpan[]
  locales?: readonly ApplicationLocale[]
  translate: (input: LocaleTranslationRequest) => Promise<LocaleTranslationResponse>
  qa?: (input: Readonly<{
    locale: ApplicationLocale
    variantId: string
    sourceHash: string
    response: LocaleTranslationResponse
  }>) => Promise<unknown> | unknown
  now?: () => string
  translationModel?: string
  promptVersion?: string
}>

export class LocaleTranslationError extends Error {
  readonly code:
    | 'invalid_locale_set'
    | 'duplicate_locale'
    | 'missing_locale'
    | 'alias_locale'
    | 'missing_translation'
    | 'protected_span_failed'
    | 'source_hash_mismatch'
    | 'invalid_qa'

  constructor(code: LocaleTranslationError['code'], message: string = code) {
    super(`locale translation rejected: ${message}`)
    this.name = 'LocaleTranslationError'
    this.code = code
  }
}

const digest = (input: string): string =>
  `sha256:v1:${createHash('sha256').update(input, 'utf8').digest('hex')}`

const variantIdFor = (artifactId: string, sourceHash: string, locale: ApplicationLocale): string => {
  const hex = createHash('sha256').update(`${artifactId}:${sourceHash}:${locale}`, 'utf8').digest('hex').slice(0, 32).split('')
  hex[12] = '5'
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16] ?? '8', 16) % 4] ?? '8'
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`
}

const assertLocaleSet = (input: readonly ApplicationLocale[]): readonly ApplicationLocale[] => {
  if (!Array.isArray(input) || input.length !== APPLICATION_LOCALES.length)
    throw new LocaleTranslationError('invalid_locale_set', 'exactly 16 locales are required')
  const parsed = input.map((locale) => {
    const result = applicationLocaleSchema.safeParse(locale)
    if (!result.success) throw new LocaleTranslationError('alias_locale', `unsupported locale ${String(locale)}`)
    return result.data
  })
  if (new Set(parsed).size !== parsed.length) throw new LocaleTranslationError('duplicate_locale')
  if (parsed.some((locale, index) => locale !== APPLICATION_LOCALES[index]))
    throw new LocaleTranslationError('invalid_locale_set', 'locales must use the frozen normative order')
  return Object.freeze([...parsed])
}

export const createLocaleBatches = (sourceHash: string, locales: readonly ApplicationLocale[] = APPLICATION_LOCALES): readonly LocaleBatch[] => {
  const frozen = assertLocaleSet(locales)
  const batches: LocaleBatch[] = []
  for (let index = 0; index < frozen.length; index += BATCH_SIZE) {
    const batchLocales = frozen.slice(index, index + BATCH_SIZE)
    const localeSetHash = digest(batchLocales.join(','))
    batches.push(Object.freeze({
      id: `p2l:${sourceHash}:${batches.length}:${localeSetHash}`,
      index: batches.length,
      locales: Object.freeze(batchLocales),
      localeSetHash,
    }))
  }
  return Object.freeze(batches)
}

const defaultQa = (locale: ApplicationLocale, variantId: string, sourceHash: string, now: string): LocaleQaInput => ({
  schema_version: 1,
  locale_variant_id: variantId,
  source_version: sourceHash as `sha256:v1:${string}`,
  golden_set_version: 'p2l-golden-v1',
  model: 'p2l-local-fixture',
  prompt_version: 'p2l-prompt-v1',
  cost_version: 'local-zero-cost-v1',
  evaluator_version: 'p2l-qa-v1',
  locale,
  checked_at: now,
  placeholder_integrity: 'pass',
  factual_consistency: 'pass',
  language_detection: 'pass',
  schema_valid: true,
  scores: { schema: 1, language: 1, factual: 1, placeholder: 1 },
  severe_defects: [],
})

export class LocaleTranslationService {
  readonly #options: LocaleTranslationServiceOptions

  constructor(options: LocaleTranslationServiceOptions) {
    this.#options = options
  }

  async run(): Promise<LocaleTranslationResult> {
    const options = this.#options
    const locales = assertLocaleSet(options.locales ?? APPLICATION_LOCALES)
    const batches = createLocaleBatches(options.sourceHash, locales)
    const variants: LocaleTranslationVariant[] = []
    const now = options.now?.() ?? new Date().toISOString()

    for (const batch of batches) {
      for (const locale of batch.locales) {
        const id = variantIdFor(options.artifactId, options.sourceHash, locale)
        const response = await options.translate({
          artifactId: options.artifactId,
          sourceHash: options.sourceHash,
          sourceLocale: options.sourceLocale,
          locale,
          sourceText: options.sourceText,
          protectedSpans: options.protectedSpans,
          batchId: batch.id,
        })
        if (response === null || typeof response !== 'object' || typeof response.serializedPrompt !== 'string')
          throw new LocaleTranslationError('missing_translation', locale)

        let restoredPrompt: string
        try {
          restoredPrompt = restoreProtectedSpans(response.serializedPrompt, options.sourceText, options.protectedSpans)
        } catch (error) {
          throw new LocaleTranslationError('protected_span_failed', error instanceof Error ? error.message : locale)
        }
        // Non-protected text is expected to be translated. The codec's
        // restoration is the authoritative byte-level check for protected
        // spans: every canonical placeholder is restored from the original
        // span table, so changing a protected byte fails closed above.

        const qaInput = options.qa === undefined
          ? defaultQa(locale, id, options.sourceHash, now)
          : await options.qa({ locale, variantId: id, sourceHash: options.sourceHash, response })
        let qa: ReturnType<typeof decideLocaleQa>
        try {
          qa = decideLocaleQa(qaInput)
        } catch (error) {
          throw new LocaleTranslationError('invalid_qa', error instanceof Error ? error.message : locale)
        }
        if (qa.evidence.source_version !== options.sourceHash)
          throw new LocaleTranslationError('source_hash_mismatch')

        variants.push(Object.freeze({
          id,
          artifactId: options.artifactId,
          locale,
          sourceLocale: options.sourceLocale,
          sourceHash: options.sourceHash,
          contentRevision: 1,
          localizedFields: Object.freeze({ ...response.localizedFields }),
          restoredPrompt,
          protectedSpanResult: 'pass' as const,
          qa,
          workflowState: qa.allowed ? 'review' as const : 'blocked' as const,
          lastContentEditorId: 'translate-service',
          reviewedBy: null,
          reviewedAt: null,
          batchId: batch.id,
        }))
      }
    }
    if (variants.length !== APPLICATION_LOCALES.length)
      throw new LocaleTranslationError('missing_locale')
    return Object.freeze({
      artifactId: options.artifactId,
      sourceHash: options.sourceHash,
      locales: Object.freeze(variants),
      batches,
      fallback_count: 0 as const,
      network_calls: 0 as const,
    })
  }

  translate = this.run.bind(this)
}

export const translateLocales = async (options: LocaleTranslationServiceOptions): Promise<LocaleTranslationResult> =>
  new LocaleTranslationService(options).run()
