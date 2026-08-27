import { createHash } from 'node:crypto'

import { z } from 'zod'

import { APPLICATION_LOCALES, applicationLocaleSchema, type ApplicationLocale } from '@/contracts/locale'
import { utcTimestampSchema, versionedHashSchema } from '@/contracts/common'

const GOLDEN_SCHEMA_VERSION = 1
const MAX_MANIFEST_BYTES = 128_000
const MAX_LOCALES = APPLICATION_LOCALES.length
const MAX_TEXT_LENGTH = 256
const MAX_DEFECTS_PER_LOCALE = 32
const VERSIONED_HASH = /^sha256:v1:[a-f0-9]{64}$/

const textSchema = z.string().trim().min(1).max(MAX_TEXT_LENGTH)
const goldenLocaleSchema = z
  .object({
    locale: applicationLocaleSchema,
    source_hash: versionedHashSchema,
    score: z.number().finite().min(0).max(1),
    passed: z.boolean(),
    severe_defects: z.array(textSchema).max(MAX_DEFECTS_PER_LOCALE),
  })
  .strict()

const goldenInputSchema = z
  .object({
    schema_version: z.literal(GOLDEN_SCHEMA_VERSION),
    version: textSchema,
    model_snapshot: textSchema,
    prompt_version: textSchema,
    source_hash: versionedHashSchema,
    cost_usd: z.number().finite().min(0).max(1_000),
    evaluator_version: textSchema,
    evaluated_at: utcTimestampSchema,
    locales: z.array(goldenLocaleSchema).length(MAX_LOCALES),
  })
  .strict()

const goldenManifestSchema = goldenInputSchema
  .extend({ manifest_hash: z.string().regex(VERSIONED_HASH) })
  .strict()

export type GoldenLocaleResult = Readonly<z.infer<typeof goldenLocaleSchema>>
export type GoldenSetManifestInput = Readonly<z.input<typeof goldenInputSchema>>
export type GoldenSetManifest = Readonly<z.infer<typeof goldenManifestSchema>>

export type GoldenComparison = Readonly<{
  passed: boolean
  regressions: readonly Readonly<{
    locale: ApplicationLocale
    baseline_score: number
    candidate_score: number
    reason: 'score_regression' | 'evaluation_regression' | 'new_severe_defect'
  }>[]
}>

const goldenApprovalSchema = z.object({
  baseline_manifest_hash: z.string().regex(VERSIONED_HASH),
  candidate_manifest_hash: z.string().regex(VERSIONED_HASH),
  evaluator_version: textSchema,
  reviewer_actor_id: z.string().min(1),
  reviewer_role: z.literal('reviewer'),
  correlation_id: z.string().min(1),
  approved_at: utcTimestampSchema,
  audit_ref: z.string().min(1),
  audit_outcome: z.literal('allowed'),
}).strict()
export type GoldenApproval = Readonly<z.infer<typeof goldenApprovalSchema>>

export type GoldenApprovalLookup = Readonly<{
  findApprovedGoldenReplacement: (input: Readonly<{
    baseline_manifest_hash: string
    candidate_manifest_hash: string
    evaluator_version: string
  }>) => Promise<unknown>
}>

const stableSerialize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(',')}}`
}

const manifestPayload = (manifest: GoldenSetManifestInput | GoldenSetManifest): GoldenSetManifestInput => {
  const { manifest_hash: _manifestHash, ...payload } = manifest as GoldenSetManifest & GoldenSetManifestInput
  return payload
}

const hashPayload = (payload: GoldenSetManifestInput): `sha256:v1:${string}` =>
  `sha256:v1:${createHash('sha256').update(stableSerialize(payload), 'utf8').digest('hex')}`

const assertLocaleOrder = (locales: readonly GoldenLocaleResult[]): void => {
  const actual = locales.map((entry) => entry.locale)
  const expected = [...APPLICATION_LOCALES]
  if (new Set(actual).size !== MAX_LOCALES) throw new Error('golden set locales must be unique')
  if (actual.some((locale, index) => locale !== expected[index]))
    throw new Error('golden set locales must use the frozen normative order')
}

const assertNotFuture = (evaluatedAt: string, now: Date): void => {
  if (Number.isNaN(now.getTime())) throw new RangeError('now must be a valid date')
  if (Date.parse(evaluatedAt) > now.getTime()) throw new Error('golden evaluation timestamp cannot be in the future')
}

const assertResourceBound = (manifest: GoldenSetManifestInput | GoldenSetManifest): void => {
  if (Buffer.byteLength(stableSerialize(manifest), 'utf8') > MAX_MANIFEST_BYTES)
    throw new RangeError('golden manifest exceeds resource bound')
}

/** Validates and freezes a synthetic 16-locale evaluation, calculating its content hash. */
export const createGoldenSetManifest = (input: GoldenSetManifestInput): GoldenSetManifest => {
  const parsed = goldenInputSchema.parse(input)
  assertLocaleOrder(parsed.locales)
  assertNotFuture(parsed.evaluated_at, new Date())
  assertResourceBound(parsed)
  const manifest = { ...parsed, manifest_hash: hashPayload(parsed) }
  return deepFreeze(manifest)
}

/** Validates a persisted manifest, including its deterministic self-hash and temporal bounds. */
export const validateGoldenSetManifest = (
  input: unknown,
  options: Readonly<{ now?: Date }> = {},
): GoldenSetManifest => {
  const parsed = goldenManifestSchema.parse(input)
  assertLocaleOrder(parsed.locales)
  assertNotFuture(parsed.evaluated_at, options.now ?? new Date())
  assertResourceBound(parsed)
  const expectedHash = hashPayload(manifestPayload(parsed))
  if (parsed.manifest_hash !== expectedHash) throw new Error('golden manifest hash mismatch')
  return parsed
}

export const hashGoldenSetManifest = (manifest: GoldenSetManifest): string => hashPayload(manifestPayload(manifest))

/** Compares every frozen locale; candidate quality must be no worse than baseline. */
export const compareGoldenSetManifests = (
  baselineInput: GoldenSetManifest,
  candidateInput: GoldenSetManifest,
): GoldenComparison => {
  const baseline = validateGoldenSetManifest(baselineInput)
  const candidate = validateGoldenSetManifest(candidateInput)
  const regressions: Array<{
    locale: ApplicationLocale
    baseline_score: number
    candidate_score: number
    reason: 'score_regression' | 'evaluation_regression' | 'new_severe_defect'
  }> = []
  if (baseline.version !== candidate.version || baseline.prompt_version !== candidate.prompt_version ||
    baseline.evaluator_version !== candidate.evaluator_version || baseline.model_snapshot !== candidate.model_snapshot ||
    baseline.cost_usd !== candidate.cost_usd)
    regressions.push({ locale: 'en', baseline_score: 0, candidate_score: 0, reason: 'evaluation_regression' })
  if (baseline.source_hash !== candidate.source_hash)
    regressions.push({ locale: 'en', baseline_score: 0, candidate_score: 0, reason: 'evaluation_regression' })

  for (const [index, baselineLocale] of baseline.locales.entries()) {
    const candidateLocale = candidate.locales[index]
    if (candidateLocale.score < baselineLocale.score)
      regressions.push({
        locale: baselineLocale.locale,
        baseline_score: baselineLocale.score,
        candidate_score: candidateLocale.score,
        reason: 'score_regression',
      })
    if (baselineLocale.passed && !candidateLocale.passed)
      regressions.push({
        locale: baselineLocale.locale,
        baseline_score: baselineLocale.score,
        candidate_score: candidateLocale.score,
        reason: 'evaluation_regression',
      })
    if (candidateLocale.severe_defects.length > baselineLocale.severe_defects.length)
      regressions.push({
        locale: baselineLocale.locale,
        baseline_score: baselineLocale.score,
        candidate_score: candidateLocale.score,
        reason: 'new_severe_defect',
      })
    if (baselineLocale.source_hash !== candidateLocale.source_hash)
      regressions.push({
        locale: baselineLocale.locale,
        baseline_score: baselineLocale.score,
        candidate_score: candidateLocale.score,
        reason: 'evaluation_regression',
      })
  }
  return { passed: regressions.length === 0, regressions }
}

/**
 * Metadata replacements require an explicit, server-owned review record bound
 * to both manifest hashes.  The lookup is deliberately an interface rather
 * than a caller-supplied approval object, so a REST/GraphQL body cannot forge
 * reviewer identity or approval evidence.
 */
export const compareApprovedGoldenReplacement = async (
  baseline: GoldenSetManifest,
  candidate: GoldenSetManifest,
  approvals: GoldenApprovalLookup,
): Promise<GoldenComparison> => {
  // This boundary is intentionally fail-closed. A REST/GraphQL caller may
  // not pass an approval object (or a forged lookup) as evidence.
  if (
    approvals === null ||
    typeof approvals !== 'object' ||
    typeof approvals.findApprovedGoldenReplacement !== 'function'
  )
    return { passed: false, regressions: [approvalRegression()] }

  let approval: unknown
  try {
    approval = await approvals.findApprovedGoldenReplacement({
      baseline_manifest_hash: baseline.manifest_hash,
      candidate_manifest_hash: candidate.manifest_hash,
      evaluator_version: candidate.evaluator_version,
    })
  } catch {
    return { passed: false, regressions: [approvalRegression()] }
  }
  const parsed = goldenApprovalSchema.safeParse(approval)
  if (!parsed.success || parsed.data.baseline_manifest_hash !== baseline.manifest_hash || parsed.data.candidate_manifest_hash !== candidate.manifest_hash || parsed.data.evaluator_version !== candidate.evaluator_version)
    return { passed: false, regressions: [approvalRegression()] }
  const raw = compareGoldenSetManifests(baseline, candidate)
  const metadataChanged = baseline.model_snapshot !== candidate.model_snapshot || baseline.prompt_version !== candidate.prompt_version || baseline.source_hash !== candidate.source_hash || baseline.cost_usd !== candidate.cost_usd || baseline.evaluator_version !== candidate.evaluator_version
  return metadataChanged ? { passed: raw.regressions.every((item) => item.reason !== 'score_regression' && item.reason !== 'new_severe_defect'), regressions: raw.regressions.filter((item) => item.reason !== 'evaluation_regression') } : raw
}

const approvalRegression = (): GoldenComparison['regressions'][number] => ({
  locale: 'en',
  baseline_score: 0,
  candidate_score: 0,
  reason: 'evaluation_regression',
})

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}

const frozenInput = (): GoldenSetManifestInput => ({
  schema_version: GOLDEN_SCHEMA_VERSION,
  version: 'golden-2026-08-20-v1',
  model_snapshot: 'synthetic-model-2026-08-20',
  prompt_version: 'prompt-v7',
  source_hash: 'sha256:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  cost_usd: 0,
  evaluator_version: 'local-evaluator-v1',
  evaluated_at: '2026-08-20T12:00:00.000Z',
  locales: APPLICATION_LOCALES.map((locale, index) => ({
    locale,
    source_hash: `sha256:v1:${String(index + 1).repeat(64).slice(0, 64)}`,
    score: 0.95,
    passed: true,
    severe_defects: [],
  })),
})

const FROZEN_MANIFEST = createGoldenSetManifest(frozenInput())

/** Returns the immutable local synthetic golden set; it never calls a remote provider. */
export const getFrozenGoldenSetManifest = (): GoldenSetManifest => FROZEN_MANIFEST

export const compareGoldenSets = compareGoldenSetManifests
export const goldenSetManifestSchema = goldenManifestSchema
