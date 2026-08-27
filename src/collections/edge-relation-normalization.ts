import type { CollectionBeforeValidateHook } from 'payload'

import {
  graphRelationSchema,
  LEGACY_GRAPH_RELATION_INPUTS,
} from '@/contracts/graph'

type RecordValue = Record<string, unknown>

export class EdgeRelationCompatibilityError extends Error {
  constructor(relation: string) {
    super(`legacy relation ${relation} requires an explicit contextual migration before persistence`)
    this.name = 'EdgeRelationCompatibilityError'
  }
}

/**
 * Compatibility boundary for legacy edge input. Legacy aliases have no global,
 * unambiguous canonical mapping, so only a later contextual migration may
 * normalize them. This boundary rejects them before a document can persist.
 */
export const normalizeEdgeRelationCompatibilityInput = <T extends RecordValue>(data: T): T => {
  const relation = data.relation
  if (relation === undefined) return data
  if (typeof relation !== 'string') {
    graphRelationSchema.parse(relation)
    return data
  }
  if ((LEGACY_GRAPH_RELATION_INPUTS as readonly string[]).includes(relation))
    throw new EdgeRelationCompatibilityError(relation)
  graphRelationSchema.parse(relation)
  return data
}

export const normalizeEdgeRelationBeforeValidate: CollectionBeforeValidateHook = ({ data }) =>
  data === undefined ? data : normalizeEdgeRelationCompatibilityInput(data as RecordValue)
