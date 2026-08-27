import { z } from 'zod'

import { detailPageDataSchema, type DetailPageData } from '@/detail/schema'
import { applicationLocaleSchema } from '@/contracts/locale'
import { immutableIdSchema, relationRefSchema, schemaVersionSchema, utcTimestampSchema, versionedHashSchema } from '@/contracts/common'

export const PAGE_SCHEMA_VERSION = 1
export const pageFamilySchema = z.enum(['hub', 'gallery', 'entity', 'detail'])
export type PageFamily = z.infer<typeof pageFamilySchema>
export const pageModuleStateSchema = z.enum(['available', 'unavailable', 'stale', 'candidate'])

export const pageProvenanceSchema = z.object({
  state: z.enum(['explicit', 'inferred', 'unavailable', 'candidate']),
  source_refs: z.array(relationRefSchema).min(1),
  observed_at: utcTimestampSchema.nullable(),
}).strict()

export const pageBreadcrumbSchema = z.object({
  label: z.string().min(1),
  href: z.string().regex(/^\/[a-zA-Z0-9/-]+$/),
}).strict()

export const pageLinkSchema = z.object({
  relation: z.enum(['canonical', 'related', 'facet', 'item', 'next', 'previous']),
  href: z.string().regex(/^\/[a-zA-Z0-9/?=&_-]+$/),
  label: z.string().min(1),
  target_page_id: immutableIdSchema.nullable(),
  indexable: z.boolean(),
  // Defaults preserve legacy envelope bytes while the parsed projection always
  // carries explicit link provenance and policy facts.
  evidence_state: z.enum(['reviewed', 'qualified']).default('reviewed'),
  link_policy: z.literal('link').default('link'),
  render_target: z.literal('page').default('page'),
}).strict()

export const pageModuleRefSchema = z.object({
  module_id: immutableIdSchema,
  module_type: z.enum(['case', 'tutorial', 'prompt', 'comparison', 'faq', 'examples', 'provenance', 'action']),
  state: pageModuleStateSchema,
  title: z.string().min(1),
  source_refs: z.array(relationRefSchema).min(1),
  content_hash: versionedHashSchema,
}).strict()

const basePageSchema = z.object({
  schema_version: schemaVersionSchema,
  page_id: immutableIdSchema,
  route: z.string().regex(/^\/[a-zA-Z0-9/-]+$/),
  locale: applicationLocaleSchema,
  translation_state: z.enum(['source', 'translated', 'source_fallback']).optional(),
  index_state: z.enum(['not_generated', 'discoverable_noindex', 'index_candidate', 'indexable', 'retired']),
  title: z.string().min(1),
  description: z.string().min(1),
  h1: z.string().min(1),
  canonical: z.string().url(),
  breadcrumbs: z.array(pageBreadcrumbSchema).min(1),
  provenance: pageProvenanceSchema,
  modules: z.array(pageModuleRefSchema),
  links: z.array(pageLinkSchema),
  snapshot_version: z.number().int().positive(),
  content_hash: versionedHashSchema,
  generated_filler_count: z.literal(0),
}).strict()

const hubPageSchema = basePageSchema.extend({
  page_type: z.literal('hub'),
  inventory_count: z.number().int().nonnegative(),
  snapshot_date: utcTimestampSchema,
  featured_module_ids: z.array(immutableIdSchema),
  diversity_rule_version: z.string().min(1),
}).strict()

const galleryPageSchema = basePageSchema.extend({
  page_type: z.literal('gallery'),
  media_type: z.enum(['image', 'video']),
  page: z.number().int().positive(),
  page_size: z.number().int().positive().max(100),
  total_items: z.number().int().nonnegative(),
  filter_state: z.record(z.string(), z.string()),
  next_page: z.string().regex(/^\//).nullable(),
  previous_page: z.string().regex(/^\//).nullable(),
}).strict()

const entityPageSchema = basePageSchema.extend({
  page_type: z.literal('entity'),
  entity_kind: z.enum(['model', 'use_case', 'style']),
  entity_slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  qualification: z.object({
    qualified: z.boolean(),
    reason_codes: z.array(z.string().min(1)),
    usable_items: z.number().int().nonnegative(),
    independent_creators: z.number().int().nonnegative(),
    sibling_overlap_ratio: z.number().min(0).max(1),
    demand_evidence_ref: relationRefSchema.nullable(),
    keyword_owner: z.string().min(1).nullable(),
  }).strict(),
  item_count: z.number().int().nonnegative(),
  creator_count: z.number().int().nonnegative(),
}).strict()

const detailPageSchema = basePageSchema.extend({
  page_type: z.literal('detail'),
  detail: detailPageDataSchema,
}).strict()

export const pageEnvelopeSchema = z.discriminatedUnion('page_type', [hubPageSchema, galleryPageSchema, entityPageSchema, detailPageSchema])
export type PageEnvelope = z.infer<typeof pageEnvelopeSchema>
export type HubPage = z.infer<typeof hubPageSchema>
export type GalleryPage = z.infer<typeof galleryPageSchema>
export type EntityPage = z.infer<typeof entityPageSchema>
export type DetailPage = z.infer<typeof detailPageSchema>
export type PageDetailData = DetailPageData

export const pageFamilySchemas = Object.freeze({
  hub: hubPageSchema,
  gallery: galleryPageSchema,
  entity: entityPageSchema,
  detail: detailPageSchema,
})
