import { buildArtifact, contentHash } from './artifact-builder'
import { createCheckpointEvent, redactedFailureCode } from './checkpoint-events'
import type {
  SliceFixtureId,
  SliceOrchestratorOptions,
  SliceRecord,
  SliceRunRequest,
  SliceRunResult,
} from './types'

export type { SliceOrchestratorOptions, SliceRunRequest, SliceRunResult } from './types'
export type { SliceSourceAdapter } from './types'

type PipelineErrorShape = Readonly<{ code?: unknown; status?: unknown; retryAfterMs?: unknown }>

const isRecord = (error: unknown): error is PipelineErrorShape => typeof error === 'object' && error !== null
const statusOf = (error: unknown): number | undefined => isRecord(error) && typeof error.status === 'number' ? error.status : undefined
const codeOf = (error: unknown): string | undefined => isRecord(error) && typeof error.code === 'string' ? error.code : undefined
const retryAfterOf = (error: unknown): number | undefined => isRecord(error) && typeof error.retryAfterMs === 'number' && Number.isFinite(error.retryAfterMs) && error.retryAfterMs >= 0 ? error.retryAfterMs : undefined

export class RawWriteError extends Error {
  readonly code = 'raw_write_failed'
  constructor(cause: unknown) {
    super('raw write failed')
    this.name = 'RawWriteError'
    this.cause = cause
  }
  readonly cause: unknown
}

export class RawHashMismatchError extends Error {
  readonly code = 'raw_hash_mismatch'
  constructor() {
    super('raw hash does not match durable write')
    this.name = 'RawHashMismatchError'
  }
}

export class CheckpointConflictError extends Error {
  readonly code = 'checkpoint_conflict'
  constructor() {
    super('checkpoint CAS conflict')
    this.name = 'CheckpointConflictError'
  }
}

export class PartialInputError extends Error {
  readonly code = 'partial_input'
  constructor() {
    super('partial input cannot produce an immutable artifact')
    this.name = 'PartialInputError'
  }
}

export class ProviderTerminalError extends Error {
  readonly code: string
  readonly status: number | undefined
  constructor(code: string, status: number | undefined) {
    super(`provider terminal failure: ${code}`)
    this.name = 'ProviderTerminalError'
    this.code = code
    this.status = status
  }
}

const freezeResult = (result: SliceRunResult): SliceRunResult => Object.freeze({
  ...result,
  sourceIds: Object.freeze([...result.sourceIds]) as SliceRunResult['sourceIds'],
  artifactIds: Object.freeze([...result.artifactIds]) as SliceRunResult['artifactIds'],
  rawObjectRefs: Object.freeze([...result.rawObjectRefs]) as SliceRunResult['rawObjectRefs'],
  eventIds: Object.freeze([...result.eventIds]),
})

export class SliceOrchestrator {
  readonly options: SliceOrchestratorOptions
  readonly #runs = new Map<string, Promise<SliceRunResult>>()
  readonly #sourceHeads = new Map<SliceFixtureId, Readonly<{ sourceId: string; contentHash: string; revision: number }>>()

  constructor(options: SliceOrchestratorOptions) {
    this.options = Object.freeze({ ...options, maxAttempts: options.maxAttempts ?? 3 })
  }

  async run(input: SliceRunRequest): Promise<SliceRunResult> {
    const existing = this.#runs.get(input.runId)
    if (existing !== undefined) return existing
    const operation = this.runOnce(input)
    this.#runs.set(input.runId, operation)
    try {
      return await operation
    } catch (error) {
      this.#runs.delete(input.runId)
      throw error
    }
  }

  private async runOnce(input: SliceRunRequest): Promise<SliceRunResult> {
    this.assertRequest(input)
    const eventIds: string[] = []
    let sequence = 0
    const emit = async (event: Parameters<typeof createCheckpointEvent>[0]): Promise<void> => {
      const created = createCheckpointEvent(event)
      eventIds.push(created.id)
      await this.options.eventSink.append(created)
    }
    await emit({ type: 'slice.started', sequence: sequence++, runId: input.runId, correlationId: input.correlationId })
    try {
      const fetched: SliceRecord[] = []
      for (const fixtureId of input.fixtureIds) fetched.push(await this.fetchWithRetry(fixtureId))
      const persisted: { record: SliceRecord; rawRef: string; contentHash: string }[] = []
      for (const record of fetched) {
        const expectedHash = contentHash(record.rawBytes)
        let durable: Readonly<{ ref: string; contentHash: string }>
        try {
          durable = await this.options.rawStore.write({ fixtureId: record.fixtureId, bytes: new Uint8Array(record.rawBytes), contentHash: expectedHash })
        } catch (error) {
          throw new RawWriteError(error)
        }
        if (durable.contentHash !== expectedHash || typeof durable.ref !== 'string' || durable.ref.length === 0) throw new RawHashMismatchError()
        persisted.push({ record, rawRef: durable.ref, contentHash: expectedHash })
        await emit({ type: 'raw.persisted', sequence: sequence++, runId: input.runId, correlationId: input.correlationId, fixtureId: record.fixtureId, rawRef: durable.ref })
        if (record.partial) throw new PartialInputError()
      }
      const nextRevision = input.expectedCheckpointRevision + 1
      const committed = await this.options.checkpoint.transactPair({
        expectedRevision: input.expectedCheckpointRevision,
        nextRevision,
        work: async () => {
          const sources: string[] = []
          const artifacts: string[] = []
          const rawRefs: string[] = []
          const headUpdates: Array<Readonly<{ fixtureId: SliceFixtureId; sourceId: string; contentHash: string; revision: number }>> = []
          for (const item of persisted) {
            const previous = this.#sourceHeads.get(item.record.fixtureId)
            const sourceRevision = previous === undefined || previous.contentHash !== item.contentHash ? (previous?.revision ?? 0) + 1 : previous.revision
            const source = await this.options.sourceStore.write({ runId: input.runId, correlationId: input.correlationId, record: item.record, rawRef: item.rawRef, contentHash: item.contentHash, previousSourceId: previous?.sourceId, sourceRevision })
            sources.push(source.sourceId)
            headUpdates.push({ fixtureId: item.record.fixtureId, sourceId: source.sourceId, contentHash: item.contentHash, revision: sourceRevision })
            rawRefs.push(item.rawRef)
            await emit({ type: 'source.committed', sequence: sequence++, runId: input.runId, correlationId: input.correlationId, fixtureId: item.record.fixtureId, sourceId: source.sourceId, rawRef: item.rawRef })
            const artifact = buildArtifact({ record: item.record, sourceId: source.sourceId, rawRef: item.rawRef, contentHash: item.contentHash, now: this.options.now?.() ?? new Date().toISOString() })
            const stored = await this.options.artifactStore.write({ runId: input.runId, correlationId: input.correlationId, artifact, sourceId: source.sourceId, contentHash: item.contentHash })
            artifacts.push(stored.artifactId)
            await emit({ type: 'artifact.built', sequence: sequence++, runId: input.runId, correlationId: input.correlationId, fixtureId: item.record.fixtureId, artifactId: stored.artifactId, sourceId: source.sourceId })
          }
          return { sources, artifacts, rawRefs, headUpdates }
        },
      })
      if (!committed.committed) throw new CheckpointConflictError()
      for (const head of committed.value.headUpdates) this.#sourceHeads.set(head.fixtureId, head)
      await emit({ type: 'checkpoint.committed', sequence: sequence++, runId: input.runId, correlationId: input.correlationId })
      await emit({ type: 'slice.completed', sequence: sequence++, runId: input.runId, correlationId: input.correlationId })
      return freezeResult({ runId: input.runId, sourceIds: committed.value.sources as [string, string], artifactIds: committed.value.artifacts as [string, string], rawObjectRefs: committed.value.rawRefs as [string, string], checkpointRevision: nextRevision, eventIds })
    } catch (error) {
      await emit({ type: 'slice.failed', sequence: sequence++, runId: input.runId, correlationId: input.correlationId, errorCode: redactedFailureCode(error) })
      throw error
    }
  }

  private async fetchWithRetry(fixtureId: SliceFixtureId): Promise<SliceRecord> {
    const maxAttempts = this.options.maxAttempts ?? 3
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const record = await this.options.sourceAdapter.fetch(fixtureId, attempt)
        if (record.fixtureId !== fixtureId) throw new Error('fixture identity mismatch')
        return record
      } catch (error) {
        const status = statusOf(error)
        const code = codeOf(error)
        if (status === 401 || status === 403 || code === 'auth_denied' || code === 'entitlement_denied') throw new ProviderTerminalError(code ?? (status === 401 ? 'auth_denied' : 'entitlement_denied'), status)
        if (status === 429 || code === 'rate_limited') {
          if (attempt >= maxAttempts) throw new ProviderTerminalError('rate_limited', status)
          await (this.options.sleep ?? (async () => undefined))(retryAfterOf(error) ?? 0)
          continue
        }
        throw error
      }
    }
    throw new Error('unreachable')
  }

  private assertRequest(input: SliceRunRequest): void {
    if (!input || typeof input.runId !== 'string' || input.runId.length === 0 || typeof input.correlationId !== 'string' || input.correlationId.length === 0 || !Number.isInteger(input.expectedCheckpointRevision) || input.expectedCheckpointRevision < 0 || !Array.isArray(input.fixtureIds) || input.fixtureIds.length !== 2 || new Set(input.fixtureIds).size !== 2) throw new Error('slice run request is invalid')
  }
}
