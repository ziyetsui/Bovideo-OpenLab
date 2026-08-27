import { z } from 'zod'

import { moduleEnvelopeSchema } from '@/contracts/module'
import { immutableIdSchema, relationRefSchema, utcTimestampSchema } from '@/contracts/common'

const moduleBase = moduleEnvelopeSchema.extend({})
const sourceFactSchema = z.object({
  source_ref: relationRefSchema,
  observed_at: utcTimestampSchema,
  expires_at: utcTimestampSchema.nullable(),
  fact_type: z.enum(['price', 'feature', 'other']),
  value: z.string().min(1),
}).strict()

const caseModuleSchema = moduleBase.extend({
  module_type: z.literal('case'),
  payload: z.object({ submission_kind: z.enum(['ugc', 'synthetic', 'first_party']), authorization_ref: relationRefSchema.nullable(), input_summary: z.string().min(1), output_summary: z.string().min(1), workflow_ref: relationRefSchema.nullable() }).strict(),
}).strict()

const tutorialModuleSchema = moduleBase.extend({
  module_type: z.literal('tutorial'),
  payload: z.object({
    steps: z.array(z.object({ selector: z.string().min(1), action: z.string().min(1), assertion: z.string().min(1), result: z.enum(['passed', 'failed', 'unavailable']), screenshot_ref: relationRefSchema.nullable(), pii_redacted: z.boolean(), third_party_ui_authorized: z.boolean() }).strict()).min(1),
    application_version: z.string().min(1),
  }).strict(),
}).strict()

const promptModuleSchema = moduleBase.extend({
  module_type: z.literal('prompt'),
  payload: z.object({ original_text: z.string().min(1), source_ref: relationRefSchema, redistribution_allowed: z.boolean(), token_integrity_hash: z.string().min(1), variation_of: immutableIdSchema.nullable() }).strict(),
}).strict()

const comparisonModuleSchema = moduleBase.extend({
  module_type: z.literal('comparison'),
  payload: z.object({ dimensions: z.array(z.object({ dimension: z.string().min(1), left: sourceFactSchema, right: sourceFactSchema, value: z.string().min(1) }).strict()).min(1), factual_reviewed: z.boolean() }).strict(),
}).strict()

const faqModuleSchema = moduleBase.extend({
  module_type: z.literal('faq'),
  payload: z.object({ question: z.string().min(1), answer_refs: z.array(relationRefSchema).min(1), demand_source_ref: relationRefSchema, sample_count: z.number().int().positive() }).strict(),
}).strict()

const exampleSchema = z.object({
  example_id: immutableIdSchema,
  input: z.string().min(1),
  output: z.string().min(1),
  media_refs: z.array(relationRefSchema),
  redistribution_allowed: z.boolean(),
}).strict()

const examplesModuleSchema = moduleBase.extend({
  module_type: z.literal('examples'),
  payload: z.object({ examples: z.array(exampleSchema).min(1), selection_rule: z.string().min(1) }).strict(),
}).strict()

const provenanceClaimSchema = z.object({
  claim: z.string().min(1),
  source_ref: relationRefSchema,
  observed_at: utcTimestampSchema,
  confidence: z.enum(['explicit', 'inferred']),
}).strict()

const provenanceModuleSchema = moduleBase.extend({
  module_type: z.literal('provenance'),
  payload: z.object({ claims: z.array(provenanceClaimSchema).min(1) }).strict(),
}).strict()

const actionModuleSchema = moduleBase.extend({
  module_type: z.literal('action'),
  payload: z.object({
    label: z.string().min(1),
    action_url: z.string().url().nullable(),
    state: z.enum(['enabled', 'disabled', 'unavailable']),
    success_message: z.string().min(1),
    failure_message: z.string().min(1),
    unavailable_reason: z.string().min(1).nullable(),
  }).strict(),
}).strict()

export const pageModuleSchema = z.discriminatedUnion('module_type', [caseModuleSchema, tutorialModuleSchema, promptModuleSchema, comparisonModuleSchema, faqModuleSchema, examplesModuleSchema, provenanceModuleSchema, actionModuleSchema])
export type PageModule = z.infer<typeof pageModuleSchema>

const daysBetween = (later: string, earlier: string): number => (Date.parse(later) - Date.parse(earlier)) / 86_400_000

export type RightsFanoutState = Readonly<{
  rightsState: 'revoked' | 'blocked' | 'unknown' | 'metadata_only' | 'display_licensed' | 'redistribution_licensed' | 'first_party'
  derivedPageState: 'active' | 'withdrawn'
  snapshotState: 'active' | 'withdrawn'
  exportState: 'included' | 'excluded'
}>

/** Apply the same withdrawal decision to page, snapshot and export projections. */
export const applyRightsRevocationFanout = (state: RightsFanoutState): RightsFanoutState => ['revoked', 'blocked', 'unknown'].includes(state.rightsState)
  ? { ...state, derivedPageState: 'withdrawn', snapshotState: 'withdrawn', exportState: 'excluded' }
  : state

/** A revoked/blocked source must be withdrawn from every derived surface. */
export const assertRightsRevocationFanout = (state: RightsFanoutState): void => {
  const reconciled = applyRightsRevocationFanout(state)
  if (reconciled.derivedPageState !== state.derivedPageState || reconciled.snapshotState !== state.snapshotState || reconciled.exportState !== state.exportState)
    throw new Error('rights revocation must fan out to page, snapshot and export')
}

export const assertModulePublishable = (module: PageModule): void => {
  if (module.review_state !== 'approved') throw new Error('module must be approved before publication')
  if (module.rights_state === 'blocked' || module.rights_state === 'revoked' || module.rights_state === 'unknown') throw new Error('module rights state is not publishable')
  if (module.expires_at !== null && module.expires_at <= module.observed_at) throw new Error('module freshness expiry must be after observation')
  if (module.module_type === 'comparison') {
    if (!module.payload.factual_reviewed) throw new Error('comparison facts require factual review')
    for (const dimension of module.payload.dimensions) {
      for (const fact of [dimension.left, dimension.right]) {
        const maxDays = fact.fact_type === 'price' ? 7 : fact.fact_type === 'feature' ? 30 : 90
        if (fact.expires_at === null || daysBetween(fact.expires_at, fact.observed_at) <= 0 || daysBetween(fact.expires_at, fact.observed_at) > maxDays)
          throw new Error(`comparison ${fact.fact_type} fact expiry exceeds ${maxDays} day policy`)
      }
    }
  }
  if (module.module_type === 'prompt' && (!module.payload.redistribution_allowed || !['first_party', 'redistribution_licensed'].includes(module.rights_state))) throw new Error('prompt without redistribution rights cannot enter public export')
  if (module.module_type === 'case' && module.payload.submission_kind === 'ugc' && module.payload.authorization_ref === null) throw new Error('UGC case requires authorization evidence')
  if (module.module_type === 'tutorial' && module.payload.steps.some((step) => step.result !== 'passed' || !step.pii_redacted || !step.third_party_ui_authorized || step.screenshot_ref === null)) throw new Error('tutorial selector/assertion, PII, third-party UI and screenshot checks must pass before publication')
  if (module.module_type === 'examples' && module.payload.examples.some((example) => !example.redistribution_allowed)) throw new Error('example without redistribution rights cannot enter public export')
  if (module.module_type === 'provenance' && module.payload.claims.some((claim) => !module.source_refs.some((source) => source.type === claim.source_ref.type && source.id === claim.source_ref.id))) throw new Error('provenance claim source must be declared by the module')
  if (module.module_type === 'action') {
    if (module.payload.state === 'enabled' && module.payload.action_url === null) throw new Error('enabled action requires a URL')
    if (module.payload.state !== 'enabled' && module.payload.unavailable_reason === null) throw new Error('unavailable action requires a visible reason')
  }
}
