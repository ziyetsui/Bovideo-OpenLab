import { createHash } from 'node:crypto'

import { APPLICATION_LOCALES, applicationLocaleSchema, type ApplicationLocale } from '@/contracts/locale'
import type { ApprovedLocaleBatch } from '@/review/locale-review'
import { assertDetailProvenance } from './provenance'
import {
  DETAIL_ROBOTS,
  detailPageDataSchema,
  detailRouteSchema,
  type DetailPageData,
  type DetailQuestion,
  type DetailRoute,
} from './schema'

export type DetailProjectionInput = Readonly<{
  artifactId: string
  routeId: string
  slug: string
  sourceHash: `sha256:v1:${string}`
  originalText: string
  originalLanguage: string
  canonicalLabel: string
  medium: string
  sourceUrl: string
  observedAt: string
  requiredInputs: readonly string[]
  optionalInputs: readonly string[]
  parameters: readonly Readonly<{ name: string; value: string; sourceRef: string }>[]
  mediaRefs: readonly string[]
  workflow: readonly Readonly<{ text: string; action: string; assertion: string; status: 'verified' | 'unavailable' | 'stale' }>[]
  variationRefs: readonly string[]
  likes: number | null
  bookmarks: number | null
  views: number | null
  productActionId: string | null
  localizedTitles: Readonly<Partial<Record<ApplicationLocale, string>>>
  sourceRef: string
}>

export type DetailProjectionOptions = Readonly<{
  locale: ApplicationLocale
  originalTextOverride?: string
  staleQuestions?: readonly DetailQuestionId[]
  unavailableQuestions?: readonly DetailQuestionId[]
}>

export type DetailQuestionId = DetailQuestion['id']

const hashBytes = (value: Uint8Array): `sha256:v1:${string}` => `sha256:v1:${createHash('sha256').update(value).digest('hex')}`
const hashJson = (value: unknown): `sha256:v1:${string}` => hashBytes(Buffer.from(JSON.stringify(value), 'utf8'))
const freezeDeep = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child)
  }
  return value
}

const uuidFor = (value: string): string => {
  const hex = createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32).split('')
  hex[12] = '5'
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16] ?? '8', 16) % 4] ?? '8'
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`
}

const source = (input: DetailProjectionInput) => [input.sourceRef]
const evidence = (input: DetailProjectionInput, provenance: DetailQuestion['provenance']): void => assertDetailProvenance({ sourceRefs: source(input), provenance, available: provenance !== 'unavailable' })

const question = (input: DetailProjectionInput, id: DetailQuestionId, provenance: DetailQuestion['provenance'], content: DetailQuestion['content'], options: DetailProjectionOptions): DetailQuestion => {
  const state = options.unavailableQuestions?.includes(id) ? 'unavailable' : options.staleQuestions?.includes(id) ? 'stale' : 'present'
  const actualProvenance = state === 'unavailable' ? 'unavailable' : state === 'stale' ? 'candidate' : provenance
  evidence(input, actualProvenance)
  return { id, state, provenance: actualProvenance, sourceRefs: source(input), content } as DetailQuestion
}

const assertApproved = (batch: ApprovedLocaleBatch, locale: ApplicationLocale, input: DetailProjectionInput): void => {
  if (batch.artifactId !== input.artifactId || batch.sourceHash !== input.sourceHash) throw new Error('approved locale batch does not match detail artifact')
  if (batch.locales.length !== APPLICATION_LOCALES.length || batch.locales.map((item) => item.locale).some((item, index) => item !== APPLICATION_LOCALES[index])) throw new Error('detail requires the exact 16 approved locales')
  const approved = batch.locales.find((item) => item.locale === locale)
  if (approved === undefined || approved.workflowState !== 'approved') throw new Error(`locale ${locale} is not approved`) 
}

export const projectDetailRoute = (input: DetailProjectionInput, batch: ApprovedLocaleBatch, options: DetailProjectionOptions): DetailPageData => {
  const locale = applicationLocaleSchema.parse(options.locale)
  assertApproved(batch, locale, input)
  const originalText = options.originalTextOverride ?? input.originalText
  const expectedBytes = Buffer.from(input.originalText, 'utf8')
  const actualBytes = Buffer.from(originalText, 'utf8')
  if (!expectedBytes.equals(actualBytes)) throw new Error('original prompt byte equality failed')
  const title = input.localizedTitles[locale]
  if (title === undefined || title.trim().length === 0) throw new Error(`missing approved localized detail for ${locale}`)
  const pageId = uuidFor(`${input.routeId}:${locale}:page`)
  const questions = [
    question(input, 'identity', 'explicit', { label: title, artifactKind: 'prompt' }, options),
    question(input, 'outcome', 'inferred', { summary: `Create ${input.canonicalLabel}`, medium: input.medium }, options),
    question(input, 'prompt', 'explicit', { originalText, originalLanguage: input.originalLanguage, copyDefault: 'original' }, options),
    question(input, 'inputs', 'explicit', { required: [...input.requiredInputs], optional: [...input.optionalInputs] }, options),
    question(input, 'parameters', 'inferred', { items: input.parameters.map((item) => ({ ...item })) }, options),
    question(input, 'examples', 'explicit', { mediaRefs: [...input.mediaRefs] }, options),
    question(input, 'workflow', 'inferred', { steps: input.workflow.map((item) => ({ ...item })) }, options),
    question(input, 'variations', 'candidate', { artifactRefs: [...input.variationRefs] }, options),
    question(input, 'source_signals', 'explicit', { sourceUrl: input.sourceUrl, observedAt: input.observedAt, likes: input.likes, bookmarks: input.bookmarks, views: input.views }, options),
    question(input, 'actions', 'inferred', { copyPrompt: true, productActionId: input.productActionId }, options),
  ] as DetailPageData['questions']
  const page = detailPageDataSchema.parse({
    pageId, routeId: input.routeId, artifactId: input.artifactId, locale, slug: input.slug,
    title, description: `Evidence-backed prompt detail for ${input.canonicalLabel}.`, robots: DETAIL_ROBOTS,
    sourceHash: input.sourceHash, originalTextBytesHash: hashBytes(expectedBytes), generatedFillerCount: 0, questions,
  })
  return freezeDeep(page)
}

export const buildDetailPageFromApproved = (input: DetailProjectionInput, batch: ApprovedLocaleBatch, options: DetailProjectionOptions): DetailPageData => projectDetailRoute(input, batch, options)

export const buildDetailPage = (input: DetailProjectionInput, batch: ApprovedLocaleBatch, options: DetailProjectionOptions): DetailPageData => projectDetailRoute(input, batch, options)

export const routeForPage = (page: DetailPageData, htmlHash: `sha256:v1:${string}`): DetailRoute => detailRouteSchema.parse({
  routeId: page.routeId, locale: page.locale,
  path: `/${page.locale}/prompts/${page.slug}-${page.routeId}`,
  pageDataHash: hashJson(page), htmlHash, robots: DETAIL_ROBOTS,
})
