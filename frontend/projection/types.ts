import { z } from 'zod'

import { projectedNodeItemSchema, projectedPromptCardSchema } from '@/contracts/projection'
import { detailPageDataSchema } from '@/detail/schema'
import { pageBreadcrumbSchema, pageLinkSchema } from '@/page/schema'

const frontendNavigationSchema = pageLinkSchema.pick({
  href: true,
  label: true,
  relation: true,
}).strict()

export const frontendNodeItemSchema = projectedNodeItemSchema.extend({
  kind: z.literal('node'),
  label: z.string().min(1),
}).strict()

export const frontendPromptCardItemSchema = projectedPromptCardSchema.extend({
  kind: z.literal('prompt_card'),
}).strict()

export const frontendRenderItemSchema = z.discriminatedUnion('kind', [
  frontendNodeItemSchema,
  frontendPromptCardItemSchema,
])

const frontendSlotSchema = z.object({
  key: z.string().min(1),
  items: z.array(frontendRenderItemSchema),
}).strict()

const frontendPageModelBaseSchema = z.object({
  title: z.string().min(1),
  h1: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  route: z.string().regex(/^\//).optional(),
  locale: z.string().min(1).optional(),
  navigation: z.array(frontendNavigationSchema),
  breadcrumbs: z.array(pageBreadcrumbSchema).optional(),
  slots: z.array(frontendSlotSchema),
}).strict()

export const frontendHubModelSchema = frontendPageModelBaseSchema.extend({
  family: z.literal('hub'),
  inventory_count: z.number().int().nonnegative().optional(),
  snapshot_date: z.string().optional(),
}).strict()

export const frontendGalleryModelSchema = frontendPageModelBaseSchema.extend({
  family: z.literal('gallery'),
  media_type: z.enum(['image', 'video']),
  page: z.number().int().positive(),
  page_size: z.number().int().positive(),
  total_items: z.number().int().nonnegative(),
  filter_state: z.record(z.string(), z.string()),
  next_page: z.string().regex(/^\//).nullable(),
  previous_page: z.string().regex(/^\//).nullable(),
}).strict()

export const frontendEntityModelSchema = frontendPageModelBaseSchema.extend({
  family: z.literal('entity'),
  entity_kind: z.enum(['model', 'use_case', 'style']),
  entity_slug: z.string().min(1),
  qualification: z.object({
    qualified: z.boolean(),
    reason_codes: z.array(z.string().min(1)),
    usable_items: z.number().int().nonnegative(),
    independent_creators: z.number().int().nonnegative(),
  }).strict(),
  item_count: z.number().int().nonnegative(),
  creator_count: z.number().int().nonnegative(),
}).strict()

export const frontendDetailModelSchema = frontendPageModelBaseSchema.extend({
  family: z.literal('detail'),
  detail: detailPageDataSchema,
}).strict()

export const frontendPageModelSchema = z.discriminatedUnion('family', [
  frontendHubModelSchema,
  frontendGalleryModelSchema,
  frontendEntityModelSchema,
  frontendDetailModelSchema,
])

type ReadonlyDeep<Value> = Value extends readonly (infer Item)[]
  ? readonly ReadonlyDeep<Item>[]
  : Value extends object
    ? { readonly [Key in keyof Value]: ReadonlyDeep<Value[Key]> }
    : Value

export type FrontendHubModel = ReadonlyDeep<z.infer<typeof frontendHubModelSchema>>
export type FrontendGalleryModel = ReadonlyDeep<z.infer<typeof frontendGalleryModelSchema>>
export type FrontendEntityModel = ReadonlyDeep<z.infer<typeof frontendEntityModelSchema>>
export type FrontendDetailModel = ReadonlyDeep<z.infer<typeof frontendDetailModelSchema>>
export type FrontendPageModel = ReadonlyDeep<z.infer<typeof frontendPageModelSchema>>
export type FrontendRenderItem = ReadonlyDeep<z.infer<typeof frontendRenderItemSchema>>
