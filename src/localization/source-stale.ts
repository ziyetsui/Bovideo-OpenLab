import type { Payload, PayloadRequest } from 'payload'

import { principalFromPayloadUser } from '@/access/principals'
import { observationContext } from '@/observability/context'
import { LocalPhase1ObservabilityBoundary } from '@/observability/boundaries'
import { recordStructuredEvent, type InstrumentationTestDoubleSink, type StructuredLogSink } from '@/observability/events'
import { localeEntityKey, type LocaleEntityReference } from './entity-identity'

type TranslateServiceUser = Readonly<{
  id: number | string
  stable_id: string
  identity_kind: 'service'
  roles: readonly string[]
  service_scopes: readonly string[]
}>

type PromptArtifactReference = Readonly<{ id: number | string }>

const promptArtifactPageLimit = 1_000

/**
 * Source afterChange already owns the transaction that inserted the new
 * revision and its audit event. Locale writes require a translate principal
 * and canonical command, but must retain that transaction instead of opening
 * independently committing child transactions.
 */
const localeStalenessRequest = (
  outerRequest: PayloadRequest,
  service: TranslateServiceUser,
  command: Record<string, unknown>,
): PayloadRequest => {
  const request = Object.create(outerRequest) as PayloadRequest
  request.user = service as never
  request.context = {
    ...(outerRequest.context as Record<string, unknown> | undefined),
    phase1CanonicalCommand: command,
  }
  return request
}

const translateServiceUser = (service: TranslateServiceUser): TranslateServiceUser => {
  const principal = principalFromPayloadUser(service)
  if (principal.kind !== 'service' || principal.payloadUserId === undefined || !principal.serviceScopes.includes('translate'))
    throw new Error('source staleness requires a persisted translate service principal')
  return service
}

const authoritativeTranslateService = async (payload: Payload, req: PayloadRequest): Promise<TranslateServiceUser> => {
  const services: TranslateServiceUser[] = []
  const seen = new Set<string>()
  for (let page = 1; ; page += 1) {
    const candidates = await payload.find({
      collection: 'users',
      where: { identity_kind: { equals: 'service' } },
      page,
      limit: promptArtifactPageLimit,
      overrideAccess: true,
      req,
    }) as unknown as { docs?: unknown; page?: unknown; totalPages?: unknown }
    const totalPages = candidates.totalPages
    if (!Array.isArray(candidates.docs) || candidates.page !== page || typeof totalPages !== 'number' || !Number.isInteger(totalPages) || totalPages < page)
      throw new Error('source staleness service pagination is invalid')
    for (const candidate of candidates.docs) {
      const id = typeof candidate === 'object' && candidate !== null
        ? (candidate as Record<string, unknown>).id
        : undefined
      if (!((typeof id === 'number' && Number.isInteger(id) && id > 0) || (typeof id === 'string' && id.length > 0)))
        throw new Error('source staleness service pagination contains an invalid id')
      const identity = String(id)
      if (seen.has(identity)) throw new Error('source staleness service pagination contains a duplicate id')
      seen.add(identity)
      try {
        const service = translateServiceUser(candidate as TranslateServiceUser)
        if (service.service_scopes.includes('translate')) services.push(service)
      } catch {
        // Other service records cannot authorize a source-staleness fanout.
      }
    }
    if (page === totalPages) break
  }
  if (services.length !== 1) throw new Error('source staleness requires exactly one persisted translate service principal')
  return services[0]
}

/**
 * Payload's default page size is not an authority boundary. A source revision
 * must discover every linked artifact before it can invalidate any locale
 * state, otherwise a later page could retain publishable stale content.
 */
const allPromptArtifactsForSource = async (
  payload: Payload,
  req: PayloadRequest,
  sourceID: number | string,
): Promise<readonly PromptArtifactReference[]> => {
  const artifacts: PromptArtifactReference[] = []
  const seen = new Set<string>()
  for (let page = 1; ; page += 1) {
    const result = await payload.find({
      collection: 'prompt-artifacts',
      where: { source: { equals: sourceID } },
      page,
      limit: promptArtifactPageLimit,
      overrideAccess: true,
      req,
    }) as unknown as { docs?: unknown; page?: unknown; totalPages?: unknown }
    const totalPages = result.totalPages
    if (!Array.isArray(result.docs) || result.page !== page || typeof totalPages !== 'number' || !Number.isInteger(totalPages) || totalPages < page)
      throw new Error('source staleness prompt artifact pagination is invalid')
    for (const candidate of result.docs) {
      const id = typeof candidate === 'object' && candidate !== null
        ? (candidate as Record<string, unknown>).id
        : undefined
      if (!((typeof id === 'number' && Number.isInteger(id) && id > 0) || (typeof id === 'string' && id.length > 0)))
        throw new Error('source staleness prompt artifact pagination contains an invalid id')
      const identity = String(id)
      if (seen.has(identity)) throw new Error('source staleness prompt artifact pagination contains a duplicate id')
      seen.add(identity)
      artifacts.push({ id })
    }
    if (page === totalPages) return artifacts
  }
}

/**
 * Internal write-plane operation: the caller supplies the old and new
 * canonical source hashes it read from the source authority. It discovers
 * affected locale rows from the old hash itself; no client boolean or locale
 * id list can expand/shrink the mutation set.
 */
export const staleLocalesForSourceHashChange = async (input: Readonly<{
  payload: Payload
  req: PayloadRequest
  service: TranslateServiceUser
  entity: LocaleEntityReference
  old_source_hash: string
  new_source_hash: string
  correlation_id: string
  causation_id?: string | null
  observability?: StructuredLogSink
  traceparent?: string
  instrumentation?: InstrumentationTestDoubleSink
}>): Promise<readonly number[]> => {
  const service = translateServiceUser(input.service)
  if (input.old_source_hash === input.new_source_hash) return []
  const localeRequest = localeStalenessRequest(input.req, service, {})
  const entityKey = localeEntityKey(input.entity)
  const affected = await input.payload.find({
    collection: 'locale-variants',
    where: { and: [{ entity_key: { equals: entityKey } }, { source_version: { equals: input.old_source_hash } }, { workflow_state: { in: ['machine_draft', 'review', 'approved', 'published'] } }] },
    limit: 1_000,
    overrideAccess: true,
    req: localeRequest,
  })
  const ids: number[] = []
  for (const variant of affected.docs) {
    await input.payload.update({
      collection: 'locale-variants', id: variant.id,
      data: { workflow_state: 'stale', revision: variant.revision + 1 } as never,
      overrideAccess: true,
      req: localeStalenessRequest(input.req, service, {
          expected_revision: variant.revision, current_revision: variant.revision, correlation_id: input.correlation_id,
          at: new Date().toISOString(), reason_code: 'source_hash_changed', from: variant.workflow_state, to: 'stale',
          actor: { type: 'service', id: input.service.stable_id }, actor_role: 'system', guard: { source_hash_changed: true },
      }),
    })
    ids.push(variant.id)
    recordStructuredEvent(input.observability, {
      event_name: 'localization.source_stale',
      context: observationContext({ correlation_id: input.correlation_id, causation_id: input.causation_id ?? null }),
      refs: { locale_variant_id: String(variant.id), entity_key: entityKey, old_source_hash: input.old_source_hash, new_source_hash: input.new_source_hash },
      metadata: { from_state: variant.workflow_state, to_state: 'stale' },
    })
    LocalPhase1ObservabilityBoundary.recordLocalization({ sink: input.instrumentation, correlation_id: input.correlation_id, causation_id: input.causation_id, traceparent: input.traceparent })
  }
  return ids
}

/** Discover a prior provider revision and its bound artifacts from Payload. */
export const staleLocalesForNewSourceRevision = async (input: Readonly<{
  payload: Payload
  req: PayloadRequest
  source: Readonly<{ id: number; provider: string; provider_record_id: string; content_hash: string }>
  correlation_id: string
  causation_id?: string | null
  observability?: StructuredLogSink
  traceparent?: string
  instrumentation?: InstrumentationTestDoubleSink
}>): Promise<readonly number[]> => {
  const prior = await input.payload.find({ collection: 'sources', where: { and: [{ provider: { equals: input.source.provider } }, { provider_record_id: { equals: input.source.provider_record_id } }, { id: { not_equals: input.source.id } }] }, sort: '-createdAt', limit: 1, overrideAccess: true, req: input.req })
  const old = prior.docs[0]
  if (!old || old.content_hash === input.source.content_hash) return []
  const artifacts = await allPromptArtifactsForSource(input.payload, input.req, old.id)
  if (artifacts.length === 0) return []
  const service = await authoritativeTranslateService(input.payload, input.req)
  const ids: number[] = []
  for (const artifact of artifacts) ids.push(...await staleLocalesForSourceHashChange({
    payload: input.payload,
    req: input.req,
    service,
    entity: { relationTo: 'prompt-artifacts', value: artifact.id },
    old_source_hash: old.content_hash,
    new_source_hash: input.source.content_hash,
    correlation_id: input.correlation_id,
    causation_id: input.causation_id,
    observability: input.observability,
    traceparent: input.traceparent,
    instrumentation: input.instrumentation,
  }))
  return ids
}
