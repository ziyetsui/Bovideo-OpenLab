import { z } from 'zod'

import { applicationLocaleSchema, type ApplicationLocale } from '@/contracts/locale'
import { immutableIdSchema, utcTimestampSchema, versionedHashSchema } from '@/contracts/common'

const webUrlSchema = z.string().url().refine((value) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}, 'source URL must use http or https')

export const DETAIL_ROBOTS = 'noindex,nofollow,noarchive,nosnippet' as const
export const DETAIL_QUESTION_ORDER = [
  'identity', 'outcome', 'prompt', 'inputs', 'parameters',
  'examples', 'workflow', 'variations', 'source_signals', 'actions',
] as const
export type DetailQuestionId = typeof DETAIL_QUESTION_ORDER[number]

export const detailProvenanceSchema = z.enum(['explicit', 'inferred', 'unavailable', 'candidate'])
export type DetailProvenance = z.infer<typeof detailProvenanceSchema>
export const detailQuestionStateSchema = z.enum(['present', 'unavailable', 'stale'])
export type DetailQuestionState = z.infer<typeof detailQuestionStateSchema>

const questionMeta = {
  state: detailQuestionStateSchema,
  provenance: detailProvenanceSchema,
  sourceRefs: z.array(z.string().min(1)).min(1),
} as const

const identityQuestionSchema = z.object({
  id: z.literal('identity'), ...questionMeta,
  content: z.object({ label: z.string().min(1), artifactKind: z.string().min(1) }).strict(),
}).strict()
const outcomeQuestionSchema = z.object({
  id: z.literal('outcome'), ...questionMeta,
  content: z.object({ summary: z.string().min(1), medium: z.string().min(1) }).strict(),
}).strict()
const promptQuestionSchema = z.object({
  id: z.literal('prompt'), ...questionMeta,
  content: z.object({ originalText: z.string().min(1), originalLanguage: z.string().min(1), copyDefault: z.literal('original') }).strict(),
}).strict()
const inputsQuestionSchema = z.object({
  id: z.literal('inputs'), ...questionMeta,
  content: z.object({ required: z.array(z.string().min(1)), optional: z.array(z.string().min(1)) }).strict(),
}).strict()
const parametersQuestionSchema = z.object({
  id: z.literal('parameters'), ...questionMeta,
  content: z.object({ items: z.array(z.object({ name: z.string().min(1), value: z.string().min(1), sourceRef: z.string().min(1) }).strict()) }).strict(),
}).strict()
const examplesQuestionSchema = z.object({
  id: z.literal('examples'), ...questionMeta,
  content: z.object({ mediaRefs: z.array(z.string().min(1)) }).strict(),
}).strict()
const workflowQuestionSchema = z.object({
  id: z.literal('workflow'), ...questionMeta,
  content: z.object({ steps: z.array(z.object({ text: z.string().min(1), action: z.string().min(1), assertion: z.string().min(1), status: z.enum(['verified', 'unavailable', 'stale']) }).strict()) }).strict(),
}).strict()
const variationsQuestionSchema = z.object({
  id: z.literal('variations'), ...questionMeta,
  content: z.object({ artifactRefs: z.array(z.string().min(1)) }).strict(),
}).strict()
const sourceSignalsQuestionSchema = z.object({
  id: z.literal('source_signals'), ...questionMeta,
  content: z.object({ sourceUrl: webUrlSchema, observedAt: utcTimestampSchema, likes: z.number().int().nonnegative().nullable(), bookmarks: z.number().int().nonnegative().nullable(), views: z.number().int().nonnegative().nullable() }).strict(),
}).strict()
const actionsQuestionSchema = z.object({
  id: z.literal('actions'), ...questionMeta,
  content: z.object({ copyPrompt: z.boolean(), productActionId: z.string().min(1).nullable() }).strict(),
}).strict()

const questionUnion = z.discriminatedUnion('id', [
  identityQuestionSchema, outcomeQuestionSchema, promptQuestionSchema, inputsQuestionSchema,
  parametersQuestionSchema, examplesQuestionSchema, workflowQuestionSchema,
  variationsQuestionSchema, sourceSignalsQuestionSchema, actionsQuestionSchema,
]).superRefine((question, context) => {
  if (question.state === 'unavailable' && question.provenance !== 'unavailable')
    context.addIssue({ code: 'custom', message: 'unavailable question must use unavailable provenance' })
  if (question.state === 'present' && question.provenance === 'unavailable')
    context.addIssue({ code: 'custom', message: 'present question cannot use unavailable provenance' })
  if (question.state === 'stale' && question.provenance === 'explicit')
    context.addIssue({ code: 'custom', message: 'stale question cannot claim explicit provenance' })
})

export type DetailQuestion = z.infer<typeof questionUnion>
export type DetailQuestions = readonly [
  Extract<DetailQuestion, { id: 'identity' }>, Extract<DetailQuestion, { id: 'outcome' }>,
  Extract<DetailQuestion, { id: 'prompt' }>, Extract<DetailQuestion, { id: 'inputs' }>,
  Extract<DetailQuestion, { id: 'parameters' }>, Extract<DetailQuestion, { id: 'examples' }>,
  Extract<DetailQuestion, { id: 'workflow' }>, Extract<DetailQuestion, { id: 'variations' }>,
  Extract<DetailQuestion, { id: 'source_signals' }>, Extract<DetailQuestion, { id: 'actions' }>,
]

const detailQuestionsSchema = z.tuple([
  identityQuestionSchema, outcomeQuestionSchema, promptQuestionSchema, inputsQuestionSchema,
  parametersQuestionSchema, examplesQuestionSchema, workflowQuestionSchema,
  variationsQuestionSchema, sourceSignalsQuestionSchema, actionsQuestionSchema,
]).superRefine((questions, context) => {
  questions.forEach((question, index) => {
    if (question.id !== DETAIL_QUESTION_ORDER[index]) context.addIssue({ code: 'custom', path: [index, 'id'], message: 'questions must use the fixed ten-question order' })
  })
  questions.forEach((question, index) => {
    const result = questionUnion.safeParse(question)
    if (!result.success) for (const issue of result.error.issues) context.addIssue({ ...issue, path: [index, ...issue.path] })
  })
})

export const detailPageDataSchema = z.object({
  pageId: immutableIdSchema,
  routeId: immutableIdSchema,
  artifactId: z.string().min(1),
  locale: applicationLocaleSchema,
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1),
  description: z.string().min(1),
  robots: z.literal(DETAIL_ROBOTS),
  sourceHash: versionedHashSchema,
  originalTextBytesHash: versionedHashSchema,
  generatedFillerCount: z.literal(0),
  questions: detailQuestionsSchema,
}).strict()
export type DetailPageData = z.infer<typeof detailPageDataSchema>

export const detailRouteSchema = z.object({
  routeId: immutableIdSchema,
  locale: applicationLocaleSchema,
  path: z.string().regex(/^\/(?:en|zh-CN|zh-TW|ja-JP|ko-KR|de-DE|fr-FR|it-IT|es-ES|es-419|pt-BR|pt-PT|hi-IN|th-TH|tr-TR|vi-VN)\/prompts\/[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{8}-[0-9a-f-]{27,}$/),
  pageDataHash: versionedHashSchema,
  htmlHash: versionedHashSchema,
  robots: z.literal(DETAIL_ROBOTS),
}).strict()
export type DetailRoute = z.infer<typeof detailRouteSchema>

export const assertApplicationLocale = (value: string): ApplicationLocale => applicationLocaleSchema.parse(value)
