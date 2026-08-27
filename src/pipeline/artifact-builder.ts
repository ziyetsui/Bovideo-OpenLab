import { createHash } from 'node:crypto'
import type { SliceRecord } from './types'

const hash = (value: Uint8Array | string): string => `sha256:v1:${createHash('sha256').update(value).digest('hex')}`

export const contentHash = (bytes: Uint8Array): string => hash(bytes)

export const stableArtifactId = (value: string): string => {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split('')
  hex[12] = '5'
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16]!, 16) % 4]!
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`
}

export const buildArtifact = (input: Readonly<{
  record: SliceRecord
  sourceId: string
  rawRef: string
  contentHash: string
  now: string
}>): Readonly<Record<string, unknown>> => {
  const id = stableArtifactId(`artifact:${input.sourceId}:${input.contentHash}`)
  return Object.freeze({
    id,
    artifact_id: id,
    schema_version: 1,
    created_at: input.now,
    updated_at: input.now,
    kind: 'prompt',
    canonical_label: input.record.providerRecordId,
    source: { type: 'source', id: input.sourceId },
    source_version: input.contentHash,
    original_language: 'en',
    original_text: input.record.text,
    rights_state: input.record.rightsState,
    safety_state: 'pending',
    evidence_state: 'verified',
    raw_ref: input.rawRef,
  })
}
