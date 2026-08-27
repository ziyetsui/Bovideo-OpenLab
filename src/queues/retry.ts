import type { QueueEnvelope } from '@/contracts/queue'

import type { QueueClock } from './idempotency-store'

export type QueueFailure = Readonly<{
  code: 'auth' | 'entitlement' | 'schema' | 'rights' | 'unsafe_endpoint' | 'rate_limited' | 'transient'
  retryAfterMilliseconds?: number
  retryAfter?: string
}>
export type RetryDecision =
  | Readonly<{ kind: 'retry'; delayMilliseconds: number }>
  | Readonly<{ kind: 'dlq'; reason: 'permanent_failure' | 'retry_budget_exhausted' | 'retry_window_exhausted' }>

export const classifyQueueFailure = (failure: QueueFailure): Readonly<{ kind: 'permanent' | 'retryable'; retryAfterMilliseconds?: number }> =>
  failure.code === 'rate_limited' || failure.code === 'transient'
    ? { kind: 'retryable', retryAfterMilliseconds: failure.retryAfterMilliseconds }
    : { kind: 'permanent' }

/** Eight total attempts (attempt 0..7) inside one 24-hour window, with full jitter and a valid Retry-After floor. */
export const nextRetry = (
  envelope: QueueEnvelope,
  failure: QueueFailure,
  dependencies: Readonly<{ clock: QueueClock; random: () => number }>,
): RetryDecision => {
  if (classifyQueueFailure(failure).kind === 'permanent') return { kind: 'dlq', reason: 'permanent_failure' }
  if (envelope.attempt >= 7) return { kind: 'dlq', reason: 'retry_budget_exhausted' }
  const now = Date.parse(dependencies.clock.now())
  const deadline = Date.parse(envelope.enqueued_at) + 24 * 60 * 60_000
  if (now >= deadline) return { kind: 'dlq', reason: 'retry_window_exhausted' }
  const jitter = Math.floor(Math.max(0, Math.min(1, dependencies.random())) * Math.min(60_000, 1_000 * 2 ** envelope.attempt))
  const retryAfter = failure.retryAfterMilliseconds ?? parseRetryAfter(failure.retryAfter, now)
  const delayMilliseconds = Number.isFinite(retryAfter) && retryAfter !== undefined && retryAfter > 0
    ? Math.max(jitter, retryAfter)
    : jitter
  return now + delayMilliseconds > deadline
    ? { kind: 'dlq', reason: 'retry_window_exhausted' }
    : { kind: 'retry', delayMilliseconds }
}

/** Parses HTTP Retry-After delta seconds or HTTP-date against the injected clock. */
export const parseRetryAfter = (value: string | undefined, now: number): number | undefined => {
  if (!value) return undefined
  if (/^(0|[1-9][0-9]{0,4})$/.test(value)) { const seconds = Number(value); return seconds <= 86_400 ? seconds * 1_000 : undefined }
  if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$/.test(value)) return undefined
  const at = Date.parse(value)
  return Number.isFinite(at) && new Date(at).toUTCString() === value && at > now && at - now <= 86_400_000 ? at - now : undefined
}

/** Never retain an untrusted header: only a strict canonical retry value crosses provider boundary. */
export const sanitizeRetryAfter = (value: string | undefined, now: number): string | undefined => {
  if (value === undefined) return undefined
  if (/^(0|[1-9][0-9]{0,4})$/.test(value) && Number(value) <= 86_400) return value
  if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$/.test(value)) { const at = Date.parse(value); return Number.isFinite(at) && new Date(at).toUTCString() === value && at > now && at - now <= 86_400_000 ? value : undefined }
  return undefined
}
