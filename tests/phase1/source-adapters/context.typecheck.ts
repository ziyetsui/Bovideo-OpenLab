import type { ObjectRef } from '../../../src/storage/object-ref'
import type { RawEvidenceStore, SourceAdapterContext } from '../../../src/source-adapters/types'

declare const rawStore: RawEvidenceStore
declare const quarantine: Readonly<{ record: (input: Readonly<{ raw_ref: ObjectRef; raw_hash: string; reason: 'provider_schema' }>) => Promise<void> }>

const base = {
  correlation_id: '01J0J0J0J0J0J0J0J0J0J0J0J0',
  captured_at: '2026-08-24T00:00:00.000Z',
  signal: new AbortController().signal,
  quarantine,
} as const

const validContext: SourceAdapterContext = { ...base, raw_store: rawStore }
void validContext

// @ts-expect-error durable raw evidence is required before SourceAdapter fetchPage can be called
const missingRawStore: SourceAdapterContext = base
void missingRawStore

// @ts-expect-error compatibility context still requires an explicit quarantine observer
const contextWithoutLegacyObserver: SourceAdapterContext = {
  correlation_id: base.correlation_id,
  captured_at: base.captured_at,
  signal: base.signal,
  raw_store: rawStore,
}
void contextWithoutLegacyObserver
