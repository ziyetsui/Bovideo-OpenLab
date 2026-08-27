import { createHash } from 'node:crypto'

export const SLICE_EVENT_TYPES = [
  'slice.started',
  'raw.persisted',
  'checkpoint.committed',
  'source.committed',
  'artifact.built',
  'slice.completed',
  'slice.failed',
] as const

export type SliceEventType = (typeof SLICE_EVENT_TYPES)[number]
export type SliceCheckpointEvent = Readonly<{
  id: string
  type: SliceEventType
  sequence: number
  runId: string
  correlationId: string
  fixtureId?: string
  sourceId?: string
  artifactId?: string
  rawRef?: string
  errorCode?: string
}>

const stableId = (value: string): string => {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split('')
  hex[12] = '5'
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16]!, 16) % 4]!
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`
}

export const createCheckpointEvent = (input: Readonly<{
  type: SliceEventType
  sequence: number
  runId: string
  correlationId: string
  fixtureId?: string
  sourceId?: string
  artifactId?: string
  rawRef?: string
  errorCode?: string
}>): SliceCheckpointEvent => Object.freeze({
  id: stableId(`${input.runId}:${input.sequence}:${input.type}:${input.fixtureId ?? ''}`),
  type: input.type,
  sequence: input.sequence,
  runId: input.runId,
  correlationId: input.correlationId,
  ...(input.fixtureId === undefined ? {} : { fixtureId: input.fixtureId }),
  ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
  ...(input.artifactId === undefined ? {} : { artifactId: input.artifactId }),
  ...(input.rawRef === undefined ? {} : { rawRef: input.rawRef }),
  ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
})

export const redactedFailureCode = (error: unknown): string => {
  if (typeof error !== 'object' || error === null) return 'pipeline_failure'
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && /^[a-z][a-z0-9_]{1,63}$/.test(code) ? code : 'pipeline_failure'
}
