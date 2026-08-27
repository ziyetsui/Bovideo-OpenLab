export class EndpointPolicyError extends Error {
  readonly code = 'unsafe_endpoint' as const
  constructor(reason: string) { super(`unsafe provider endpoint: ${reason}`); this.name = 'EndpointPolicyError' }
}

export class ProviderSchemaError extends Error {
  readonly code = 'provider_schema' as const
  constructor(reason: string) { super(`provider response quarantined: ${reason}`); this.name = 'ProviderSchemaError' }
}

export class CheckpointConflictError extends Error {
  readonly code = 'checkpoint_conflict' as const
  constructor() { super('checkpoint version conflict'); this.name = 'CheckpointConflictError' }
}

export type SourceFailureCode = 'auth' | 'entitlement' | 'rate_limited' | 'transient_upstream' | 'invalid_response' | 'unsafe_endpoint' | 'aborted'
/** Private durable evidence carried from the adapter to the single write-plane terminal command. */
export type QuarantineEvidence = Readonly<{ raw_ref: ObjectRef; raw_hash: string; raw_receipt_id: string; raw_receipt_actor_id: string }>
export class SourceAdapterError extends Error {
  readonly retryable: boolean
  /** Internal evidence disposition; callers only receive the safe canonical code/message. */
  constructor(readonly code: SourceFailureCode, readonly retry_after?: string, readonly attempts = 1, readonly raw_persisted = false, readonly quarantine_audited = false, readonly quarantine_evidence?: QuarantineEvidence) {
    super(code === 'auth' ? 'provider authentication rejected' : code === 'entitlement' ? 'provider entitlement rejected' : code === 'rate_limited' ? 'provider rate limited' : code === 'aborted' ? 'provider request aborted' : code === 'unsafe_endpoint' ? 'provider endpoint rejected' : code === 'invalid_response' ? 'provider response rejected' : 'provider upstream unavailable')
    this.name = 'SourceAdapterError'
    this.retryable = code === 'rate_limited' || code === 'transient_upstream'
  }
}
import type { ObjectRef } from '@/storage/object-ref'
