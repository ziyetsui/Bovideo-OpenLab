import type { SliceCheckpointEvent } from './checkpoint-events'

export type SliceFixtureId = 'twitter241-synthetic-001' | 'first-party-001'

export type SliceRecord = Readonly<{
  fixtureId: SliceFixtureId
  provider: 'twitter241' | 'first_party'
  providerRecordId: string
  canonicalUrl: string
  text: string
  authorId: string
  authorHandle: string
  capturedAt: string
  rawBytes: Uint8Array
  rightsState: 'metadata_only' | 'first_party'
  rightsBasis: string | null
  partial: boolean
}>

export type SliceRunRequest = Readonly<{
  runId: string
  correlationId: string
  expectedCheckpointRevision: number
  fixtureIds: readonly [SliceFixtureId, SliceFixtureId]
}>

export type SliceRunResult = Readonly<{
  runId: string
  sourceIds: readonly [string, string]
  artifactIds: readonly [string, string]
  rawObjectRefs: readonly [string, string]
  checkpointRevision: number
  eventIds: readonly string[]
}>

export type SliceSourceAdapter = Readonly<{
  fetch: (fixtureId: SliceFixtureId, attempt: number) => Promise<SliceRecord>
}>

export type RawObjectStore = Readonly<{
  write: (input: Readonly<{ fixtureId: SliceFixtureId; bytes: Uint8Array; contentHash: string }>) => Promise<Readonly<{ ref: string; contentHash: string }>>
}>

export type SourceWriter = Readonly<{
  write: (input: Readonly<{ runId: string; correlationId: string; record: SliceRecord; rawRef: string; contentHash: string; previousSourceId?: string; sourceRevision: number }>) => Promise<Readonly<{ sourceId: string }>>
}>

export type ArtifactWriter = Readonly<{
  write: (input: Readonly<{ runId: string; correlationId: string; artifact: Readonly<Record<string, unknown>>; sourceId: string; contentHash: string }>) => Promise<Readonly<{ artifactId: string }>>
}>

export type CheckpointStore = Readonly<{
  transactPair: <T>(input: Readonly<{
    expectedRevision: number
    nextRevision: number
    work: () => Promise<T>
  }>) => Promise<Readonly<{ committed: true; value: T } | { committed: false }>>
}>

export type SliceEventSink = Readonly<{
  append: (event: SliceCheckpointEvent) => Promise<void> | void
}>

export type SliceOrchestratorOptions = Readonly<{
  sourceAdapter: SliceSourceAdapter
  rawStore: RawObjectStore
  sourceStore: SourceWriter
  artifactStore: ArtifactWriter
  checkpoint: CheckpointStore
  eventSink: SliceEventSink
  sleep?: (milliseconds: number) => Promise<void>
  maxAttempts?: number
  now?: () => string
}>
