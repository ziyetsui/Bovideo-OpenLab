import type { PageEnvelope, PageFamily } from './schema'
import { pageEnvelopeSchema } from './schema'

/**
 * Explicit projection authority between a Payload document and the rendered
 * page envelope.  New Payload fields must be added here deliberately; a
 * generic object spread would otherwise make schema drift invisible.
 */
export const PAYLOAD_PAGE_FIELD_MAP: Readonly<Record<PageFamily, Readonly<Record<string, string>>>> = Object.freeze({
  hub: Object.freeze({
    id: 'page_id', stable_id: 'page_id', page_id: 'page_id', schema_version: 'schema_version', page_type: 'page_type', route: 'route', locale: 'locale', index_state: 'index_state', title: 'title', description: 'description', h1: 'h1', canonical: 'canonical', breadcrumbs: 'breadcrumbs', provenance: 'provenance', modules: 'modules', links: 'links', snapshot_version: 'snapshot_version', source_version: 'snapshot_version', content_hash: 'content_hash', qualification_input_hash: 'content_hash', generated_filler_count: 'generated_filler_count', inventory_count: 'inventory_count', snapshot_date: 'snapshot_date', featured_module_ids: 'featured_module_ids', diversity_rule_version: 'diversity_rule_version',
  }),
  gallery: Object.freeze({
    id: 'page_id', stable_id: 'page_id', page_id: 'page_id', schema_version: 'schema_version', page_type: 'page_type', route: 'route', locale: 'locale', index_state: 'index_state', title: 'title', description: 'description', h1: 'h1', canonical: 'canonical', breadcrumbs: 'breadcrumbs', provenance: 'provenance', modules: 'modules', links: 'links', snapshot_version: 'snapshot_version', source_version: 'snapshot_version', content_hash: 'content_hash', qualification_input_hash: 'content_hash', generated_filler_count: 'generated_filler_count', media_type: 'media_type', page: 'page', page_size: 'page_size', total_items: 'total_items', filter_state: 'filter_state', next_page: 'next_page', previous_page: 'previous_page',
  }),
  entity: Object.freeze({
    id: 'page_id', stable_id: 'page_id', page_id: 'page_id', schema_version: 'schema_version', page_type: 'page_type', route: 'route', locale: 'locale', index_state: 'index_state', title: 'title', description: 'description', h1: 'h1', canonical: 'canonical', breadcrumbs: 'breadcrumbs', provenance: 'provenance', modules: 'modules', links: 'links', snapshot_version: 'snapshot_version', source_version: 'snapshot_version', content_hash: 'content_hash', qualification_input_hash: 'content_hash', generated_filler_count: 'generated_filler_count', entity_kind: 'entity_kind', entity_slug: 'entity_slug', qualification: 'qualification', item_count: 'item_count', creator_count: 'creator_count',
  }),
  detail: Object.freeze({
    id: 'page_id', stable_id: 'page_id', page_id: 'page_id', schema_version: 'schema_version', page_type: 'page_type', route: 'route', locale: 'locale', index_state: 'index_state', title: 'title', description: 'description', h1: 'h1', canonical: 'canonical', breadcrumbs: 'breadcrumbs', provenance: 'provenance', modules: 'modules', links: 'links', snapshot_version: 'snapshot_version', source_version: 'snapshot_version', content_hash: 'content_hash', qualification_input_hash: 'content_hash', generated_filler_count: 'generated_filler_count', detail: 'detail',
  }),
})

// Payload audit/storage columns are intentionally ignored by the projection
// diff. They are persisted metadata, not page content and cannot be silently
// rendered by the server shell.
const PAYLOAD_METADATA_FIELDS = new Set([
  'createdAt', 'updatedAt', 'created_at', 'updated_at', 'revision', 'status',
  'audit_created_by_id', 'audit_updated_by_id', 'audit_correlation_id',
])

export type PayloadPageDiff = Readonly<{
  pageType: PageFamily
  missing: string[]
  unmapped: string[]
  schemaErrors: string[]
  ok: boolean
}>

const familyFrom = (value: PageFamily | PageEnvelope): PageFamily => typeof value === 'string' ? value : value.page_type

/** Compare a Payload projection with its strict rendered page envelope. */
export const diffPayloadToPageSchema = (
  payload: Readonly<Record<string, unknown>>,
  familyOrPage: PageFamily | PageEnvelope,
  expectedPage?: PageEnvelope,
): PayloadPageDiff => {
  const pageType = familyFrom(familyOrPage)
  const page = typeof familyOrPage === 'string' ? expectedPage : familyOrPage
  const fieldMap = PAYLOAD_PAGE_FIELD_MAP[pageType]
  const payloadFields = Object.keys(payload).filter((field) => !PAYLOAD_METADATA_FIELDS.has(field)).sort()
  const unmapped = payloadFields.filter((field) => fieldMap[field] === undefined)
  const mappedTargets = new Set(payloadFields.map((field) => fieldMap[field]).filter((field): field is string => field !== undefined))
  const requiredTargets = new Set(Object.values(fieldMap))
  const missing = [...requiredTargets].filter((target) => !mappedTargets.has(target)).sort()
  const schemaErrors: string[] = []

  if (page !== undefined) {
    const parsed = pageEnvelopeSchema.safeParse(page)
    if (!parsed.success) schemaErrors.push(...parsed.error.issues.map((issue) => issue.path.join('.') || issue.message))
    if (page.page_type !== pageType) schemaErrors.push(`page_type expected ${pageType} but received ${page.page_type}`)
  }

  return { pageType, missing, unmapped, schemaErrors, ok: missing.length === 0 && unmapped.length === 0 && schemaErrors.length === 0 }
}

