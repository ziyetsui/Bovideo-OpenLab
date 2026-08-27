import type { RelationRef } from '@/contracts/common'
import { decideRights } from '@/contracts/rights'

import type { QueueClock } from './idempotency-store'
import type { QueueEnvelope } from '@/contracts/queue'

export type WithdrawalQueue = Readonly<{ enqueue: (input: unknown) => void; dequeue: (lane: 'normal' | 'withdraw') => QueueEnvelope | undefined }>

export type WithdrawalTombstone = Readonly<{
  entityRef: RelationRef
  requestVersion: number
  correlationId: string
  withdrawnAt: string
}>

/** Permanent deletion/withdrawal state. No expiry is intentionally represented. */
export class WithdrawalTombstones {
  readonly #entries = new Map<string, WithdrawalTombstone>()
  readonly #clock: QueueClock
  constructor({ clock }: Readonly<{ clock: QueueClock }>) { this.#clock = clock }
  record(input: Readonly<{ entityRef: RelationRef; requestVersion: number; correlationId: string }>): WithdrawalTombstone {
    const key = `${input.entityRef.type}:${input.entityRef.id}`
    const existing = this.#entries.get(key)
    if (existing && existing.requestVersion >= input.requestVersion) return existing
    const tombstone = Object.freeze({ ...input, withdrawnAt: this.#clock.now() })
    this.#entries.set(key, tombstone)
    return tombstone
  }
  recordRightsRevocation(input: Readonly<{ entityRef: RelationRef; requestVersion: number; correlationId: string; job: QueueEnvelope; queue: WithdrawalQueue }>): WithdrawalTombstone {
    if (decideRights('revoked').withdrawal_intent?.priority !== 'emergency') throw new Error('revoked rights must withdraw')
    if (input.job.kind !== 'withdraw' || input.job.priority !== 'emergency') throw new Error('revocation requires emergency withdrawal job')
    input.queue.enqueue(input.job)
    return this.record(input)
  }
  get(entityRef: RelationRef): WithdrawalTombstone | undefined { return this.#entries.get(`${entityRef.type}:${entityRef.id}`) }
}

/** Independent local emergency executor; normal work cannot consume its semaphore. */
export class WithdrawalExecutor {
  #active = 0
  readonly #concurrency: number
  constructor(concurrency = 1) { this.#concurrency = concurrency }
  async runNext(queue: WithdrawalQueue, effect: (job: QueueEnvelope) => Promise<void>): Promise<boolean> {
    if (this.#active >= this.#concurrency) return false
    const job = queue.dequeue('withdraw')
    if (!job) return false
    this.#active += 1
    try { await effect(job); return true } finally { this.#active -= 1 }
  }
}

/** A distinct normal-work semaphore makes the emergency executor independently schedulable. */
export class NormalExecutor {
  #active = 0
  readonly #concurrency: number
  constructor(concurrency = 1) { this.#concurrency = concurrency }
  async runNext(queue: WithdrawalQueue, effect: (job: QueueEnvelope) => Promise<void>): Promise<boolean> {
    if (this.#active >= this.#concurrency) return false
    const job = queue.dequeue('normal')
    if (!job) return false
    this.#active += 1
    try { await effect(job); return true } finally { this.#active -= 1 }
  }
}
