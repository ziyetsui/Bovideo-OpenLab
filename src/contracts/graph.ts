import { z } from 'zod'

import {
  immutableIdSchema,
  relationRefSchema,
  schemaVersionSchema,
  utcTimestampSchema,
} from './common'

export const GRAPH_RELATIONS = [
  'generated_with',
  'used_for',
  'produces',
  'has_style',
  'uses_technique',
  'depicts',
  'targets_audience',
  'created_by',
  'sourced_from',
  'variation_of',
  'member_of',
  'compared_with',
  'requires_input',
] as const

/** Legacy values accepted only at compatibility input boundaries. */
export const LEGACY_GRAPH_RELATION_INPUTS = ['authored_by', 'belongs_to', 'supports'] as const
export const graphRelationSchema = z.enum(GRAPH_RELATIONS)
export type GraphRelation = z.infer<typeof graphRelationSchema>

export const taxonomyNodeSchema = z
  .object({
    id: immutableIdSchema,
    schema_version: schemaVersionSchema,
    node_type: z.enum(['output', 'model', 'use_case', 'style', 'technique', 'creator', 'subject']),
    stable_key: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1),
    promotion_state: z.enum(['candidate', 'reviewed', 'qualified', 'retired']),
    evidence_refs: z
      .array(z.object({ type: z.literal('source'), id: immutableIdSchema }).strict())
      .min(1),
  })
  .strict()

export const edgeSchema = z
  .object({
    id: immutableIdSchema,
    schema_version: schemaVersionSchema,
    from: relationRefSchema,
    relation: graphRelationSchema,
    to: relationRefSchema,
    evidence_refs: z
      .array(z.object({ type: z.literal('source'), id: immutableIdSchema }).strict())
      .min(1),
    evidence_revision: z.string().min(1),
    confidence: z.number().min(0).max(1),
    review_state: z.enum(['candidate', 'approved', 'rejected']),
    valid_from: utcTimestampSchema.nullable(),
    valid_to: utcTimestampSchema.nullable(),
  })
  .strict()

export type TaxonomyNode = z.infer<typeof taxonomyNodeSchema>
export type Edge = z.infer<typeof edgeSchema>
