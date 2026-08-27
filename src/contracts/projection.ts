import { z } from 'zod'

import {
  immutableIdSchema,
  relationRefSchema,
  utcTimestampSchema,
  versionedHashSchema,
} from './common'
import { applicationLocaleSchema } from './locale'
import { rightsStateSchema } from './rights'
import { pageEnvelopeSchema, pageFamilySchema } from '../page/schema'

export const linkPolicySchema = z.enum(['link', 'filter_state', 'dead_text'])
export const projectedRenderTargetSchema = z.enum(['page', 'filter', 'tag'])
export const targetIndexabilitySchema = z.enum(['indexable', 'noindex', 'none'])

const projectedLinkSchema = z
  .object({
    evidence_state: z.enum(['candidate', 'reviewed', 'qualified']),
    link_policy: linkPolicySchema,
    href: z.string().regex(/^\//).nullable(),
    render_target: projectedRenderTargetSchema,
    target_indexability: targetIndexabilitySchema,
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.evidence_state === 'candidate' && item.link_policy === 'link')
      ctx.addIssue({ code: 'custom', message: 'candidate nodes cannot link' })
    if (item.link_policy === 'link' && item.href === null)
      ctx.addIssue({ code: 'custom', message: 'linked item requires href' })
    if (item.link_policy === 'link' && (item.render_target !== 'page' || item.target_indexability === 'none'))
      ctx.addIssue({ code: 'custom', message: 'page links require an indexable or noindex page target' })
    if (item.link_policy === 'filter_state' && (item.href === null || item.render_target !== 'filter' || item.target_indexability !== 'noindex'))
      ctx.addIssue({ code: 'custom', message: 'filter state requires a noindex filter target and href' })
    if (item.link_policy === 'dead_text' && (item.href !== null || item.render_target !== 'tag' || item.target_indexability !== 'none'))
      ctx.addIssue({ code: 'custom', message: 'dead text requires a non-link tag target' })
  })

export const projectedNodeItemSchema = projectedLinkSchema.extend({
  label: z.string().min(1).optional(),
  node_ref: z.string().min(1),
  edge_ref: z.string().nullable(),
})

export const projectedPromptCardSchema = projectedLinkSchema.extend({
  prompt_ref: relationRefSchema,
  title: z.string().min(1),
  summary: z.string().min(1).nullable(),
  /** New projectors supply these; optional fields keep prior immutable releases readable. */
  prompt_text: z.string().min(1).optional(),
  prompt_language: z.string().min(1).optional(),
  media: z.array(z.lazy(() => mediaEvidenceSchema)).max(4).optional(),
  tags: z.array(projectedNodeItemSchema),
})

export const projectedSlotSchema = z
  .object({
    slot_key: z.string().min(1),
    renderer: z.string().min(1),
    source_mode: z.enum(['content_envelope', 'graph_query', 'page_metadata']),
    items: z.array(z.union([projectedNodeItemSchema, projectedPromptCardSchema])),
  })
  .strict()

export const navigationProjectionItemSchema = projectedNodeItemSchema.safeExtend({
  label: z.string().min(1),
  promotion_state: z.enum(['candidate', 'reviewed', 'qualified', 'retired']),
  target_page_id: immutableIdSchema.nullable(),
})

export const navigationProjectionSchema = z
  .object({
    version: z.string().min(1),
    items: z.array(navigationProjectionItemSchema),
  })
  .strict()
  .superRefine((navigation, ctx) => {
    navigation.items.forEach((item, index) => {
      if (item.evidence_state === 'candidate' &&
        (item.target_page_id !== null || item.target_indexability === 'indexable'))
        ctx.addIssue({
          code: 'custom',
          path: ['items', index],
          message: 'candidate navigation cannot carry a page or sitemap target',
        })
    })
  })

const payloadRelationshipIDSchema = z.union([z.number().int().positive(), immutableIdSchema])

export const mediaEvidenceSchema = z
  .object({
    media_evidence_id: immutableIdSchema,
    /** The Payload relationship stores a resolved `sources.id`, never a polymorphic semantic object. */
    source_ref: payloadRelationshipIDSchema,
    provider: z.enum(['x', 'approved_cdn', 'first_party']),
    provider_media_id: z.string().min(1),
    media_type: z.enum(['image', 'video']),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    duration_ms: z.number().int().nonnegative().nullable(),
    remote_url: z.string().url(),
    thumbnail_url: z.string().url().nullable(),
    observed_at: utcTimestampSchema,
    rights_state: rightsStateSchema,
    sensitive_content_state: z.enum(['unknown', 'allowed', 'restricted', 'blocked']),
    content_hash: versionedHashSchema,
    visibility: z.enum(['private_evidence', 'internal_preview', 'public']),
    delivery_target: z.enum(['private_reference', 'x_cdn', 'approved_public_cdn']),
    preview_noindex: z.boolean(),
    attribution_url: z.string().url().nullable(),
  })
  .strict()
  .superRefine((media, ctx) => {
    const remoteHost = new URL(media.remote_url).hostname.toLowerCase()
    const isXCDN = remoteHost === 'twimg.com' || remoteHost.endsWith('.twimg.com')
    const thumbnailHost = media.thumbnail_url === null ? null : new URL(media.thumbnail_url).hostname.toLowerCase()
    const thumbnailIsXCDN = thumbnailHost === 'twimg.com' || thumbnailHost?.endsWith('.twimg.com') === true
    if (media.delivery_target === 'x_cdn') {
      if (!isXCDN)
        ctx.addIssue({ code: 'custom', path: ['remote_url'], message: 'x_cdn delivery requires a twimg.com URL' })
      if (media.thumbnail_url !== null && !thumbnailIsXCDN)
        ctx.addIssue({ code: 'custom', path: ['thumbnail_url'], message: 'x_cdn thumbnails require a twimg.com URL' })
    }
    if (media.visibility === 'private_evidence' &&
      (media.delivery_target !== 'private_reference' || media.preview_noindex !== true))
      ctx.addIssue({ code: 'custom', message: 'private evidence must remain a noindex private reference' })
    if (media.visibility === 'internal_preview' &&
      (media.provider !== 'x' || media.delivery_target !== 'x_cdn' || media.preview_noindex !== true || media.attribution_url === null))
      ctx.addIssue({ code: 'custom', message: 'X preview media requires attributed noindex x_cdn delivery' })
    if (media.visibility === 'public') {
      if (media.provider === 'x' || media.delivery_target !== 'approved_public_cdn' || media.preview_noindex !== false || isXCDN || thumbnailIsXCDN)
        ctx.addIssue({ code: 'custom', message: 'public media requires approved public CDN delivery' })
      if (!['first_party', 'redistribution_licensed'].includes(media.rights_state))
        ctx.addIssue({ code: 'custom', path: ['rights_state'], message: 'public media requires redistribution_licensed or first_party rights' })
    }
  })

export const pageProjectionSchema = z
  .object({
    projection_id: immutableIdSchema,
    page_id: immutableIdSchema,
    locale: applicationLocaleSchema,
    family: pageFamilySchema,
    state: z.enum(['draft', 'validated', 'released', 'superseded', 'withdrawn']),
    dependency_hash: versionedHashSchema,
    page: pageEnvelopeSchema,
    navigation: navigationProjectionSchema,
    slots: z.array(projectedSlotSchema),
    content_hash: versionedHashSchema,
    link_hash: versionedHashSchema,
    schema_hash: versionedHashSchema,
    renderer_version: z.string().min(1).max(256),
    validation_report_ref: z.string().regex(/^private\/[a-z0-9][a-z0-9/_-]*$/i),
  })
  .strict()
  .superRefine((projection, ctx) => {
    if (projection.page_id !== projection.page.page_id)
      ctx.addIssue({ code: 'custom', path: ['page_id'], message: 'projection page_id must match page.page_id' })
    if (projection.locale !== projection.page.locale)
      ctx.addIssue({ code: 'custom', path: ['locale'], message: 'projection locale must match page.locale' })
    if (projection.family !== projection.page.page_type)
      ctx.addIssue({ code: 'custom', path: ['family'], message: 'projection family must match page.page_type' })
  })

export type ProjectedNodeItem = z.infer<typeof projectedNodeItemSchema>
export type ProjectedPromptCard = z.infer<typeof projectedPromptCardSchema>
export type ProjectedSlot = z.infer<typeof projectedSlotSchema>
export type NavigationProjection = z.infer<typeof navigationProjectionSchema>
export type MediaEvidence = z.infer<typeof mediaEvidenceSchema>
export type PageProjection = z.infer<typeof pageProjectionSchema>
