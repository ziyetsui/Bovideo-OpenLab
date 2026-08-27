import type { QueueEnvelope } from '@/contracts/queue'

export type QueueClock = Readonly<{ now: () => string }>
export type ClaimToken = string
export type DurableEffectReceipt = Readonly<{ side_effect_version: string }>
export type SuccessfulQueueResult = Readonly<{
  side_effect_version: string
  committed_at: string
  retain_until: string
}>
export type ClaimResult =
  | Readonly<{ kind: 'acquired'; token: ClaimToken; takeover: boolean }>
  | Readonly<{ kind: 'duplicate'; result: SuccessfulQueueResult }>
  | Readonly<{ kind: 'busy' }>
  | Readonly<{ kind: 'conflict' }>

type StoredClaim = {
  jobId: string
  attempt: number
  fingerprint: string
  state: 'processing' | 'success'
  token: ClaimToken
  leaseExpiresAt: number
  successExpiresAt: number | null
  successResult: SuccessfulQueueResult | null
}

type Options = Readonly<{ clock: QueueClock; leaseMilliseconds?: number; successRetentionMilliseconds?: number }>

/** Local deterministic idempotency emulator. Its promise mutex makes concurrent callers observe one atomic transition. */
export class InMemoryIdempotencyStore {
  readonly #claims = new Map<string, StoredClaim>()
  readonly #clock: QueueClock
  readonly #leaseMilliseconds: number
  readonly #successRetentionMilliseconds: number
  #serial: Promise<void> = Promise.resolve()
  #sequence = 0

  constructor({ clock, leaseMilliseconds = 15 * 60_000, successRetentionMilliseconds = 90 * 24 * 60 * 60_000 }: Options) {
    this.#clock = clock
    this.#leaseMilliseconds = leaseMilliseconds
    this.#successRetentionMilliseconds = successRetentionMilliseconds
  }

  async claim(envelope: QueueEnvelope): Promise<ClaimResult> {
    return this.#atomic(() => {
      const now = Date.parse(this.#clock.now())
      const { job_id: _jobId, attempt: _attempt, enqueued_at: _enqueuedAt, ...request } = envelope
      const fingerprint = canonicalJson(request)
      const prior = this.#claims.get(envelope.idempotency_key)
      if (prior && prior.fingerprint !== fingerprint) return { kind: 'conflict' }
      if (prior?.state === 'success' && prior.successExpiresAt !== null && now < prior.successExpiresAt && prior.successResult !== null)
        return { kind: 'duplicate', result: prior.successResult }
      if (prior?.state === 'success') this.#claims.delete(envelope.idempotency_key)
      const present = this.#claims.get(envelope.idempotency_key)
      if (present?.state === 'processing') {
        if (now < present.leaseExpiresAt) return { kind: 'busy' }
        if (envelope.job_id !== present.jobId || envelope.attempt !== present.attempt + 1) return { kind: 'busy' }
      }
      const token = `${envelope.job_id}:${envelope.attempt}:${++this.#sequence}`
      this.#claims.set(envelope.idempotency_key, {
        jobId: envelope.job_id,
        attempt: envelope.attempt,
        fingerprint,
        state: 'processing',
        token,
        leaseExpiresAt: now + this.#leaseMilliseconds,
        successExpiresAt: null,
        successResult: null,
      })
      return { kind: 'acquired', token, takeover: present !== undefined }
    })
  }

  /** Commits the durable synchronous local effect, source CAS and success receipt in one serial write-plane transition. */
  async commit(
    envelope: QueueEnvelope,
    token: ClaimToken,
    currentSourceVersion: () => string | null,
    effect: () => DurableEffectReceipt,
  ): Promise<'processed' | 'stale_ignored' | 'lost_claim'> {
    return this.#atomic(() => {
      const current = this.#claims.get(envelope.idempotency_key)
      if (current?.state !== 'processing' || current.token !== token) return 'lost_claim'
      if (envelope.expected_source_version !== null && envelope.expected_source_version !== currentSourceVersion()) {
        this.#claims.delete(envelope.idempotency_key)
        return 'stale_ignored'
      }
      let receipt!: DurableEffectReceipt
      try {
        // A declared async callback can be rejected before it performs any effect.
        // Synchronous callbacks that forge a thenable are rejected below as well.
        if (effect.constructor.name === 'AsyncFunction') throw new Error('local queue effect must be synchronous')
        receipt = effect()
        if (receipt === null || typeof receipt !== 'object' || typeof receipt.side_effect_version !== 'string' || receipt.side_effect_version.length === 0 || 'then' in receipt)
          throw new Error('local queue effect must return a synchronous durable receipt')
      } catch (error) {
        this.#claims.delete(envelope.idempotency_key)
        throw error
      }
      current.state = 'success'
      const committedAt = this.#clock.now()
      current.successExpiresAt = Date.parse(committedAt) + this.#successRetentionMilliseconds
      current.successResult = Object.freeze({
        side_effect_version: receipt.side_effect_version,
        committed_at: committedAt,
        retain_until: new Date(current.successExpiresAt).toISOString(),
      })
      return 'processed'
    })
  }

  async abandon(envelope: QueueEnvelope, token: ClaimToken): Promise<boolean> {
    return this.#atomic(() => {
      const current = this.#claims.get(envelope.idempotency_key)
      if (current?.state !== 'processing' || current.token !== token) return false
      this.#claims.delete(envelope.idempotency_key)
      return true
    })
  }

  /** Read-only P2-facing success metadata; expiry is enforced at the exact retention boundary. */
  successResult(idempotencyKey: string): SuccessfulQueueResult | undefined {
    const claim = this.#claims.get(idempotencyKey)
    if (!claim?.successResult || claim.successExpiresAt === null || Date.parse(this.#clock.now()) >= claim.successExpiresAt) return undefined
    return claim.successResult
  }

  async #atomic<T>(operation: () => T): Promise<T> {
    const previous = this.#serial
    let release!: () => void
    this.#serial = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return operation() } finally { release() }
  }
}

export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}
