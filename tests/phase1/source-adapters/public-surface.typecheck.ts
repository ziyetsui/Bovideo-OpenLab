import { Twitter241Adapter } from '../../../src/source-adapters/twitter241'
import * as acquisition from '../../../src/source-adapters/ingest'

declare const adapter: Twitter241Adapter

// The adapter only exposes the evidence-first page boundary. Raw fetch/parse cannot be used by
// callers to bypass mandatory durable raw persistence and parse-failure quarantine.
// @ts-expect-error fetch is intentionally private
void adapter.fetch
// @ts-expect-error parse is intentionally private
void adapter.parse
void adapter.fetchPage

// @ts-expect-error public acquisition only exposes the exact twenty-unit orchestrator
void acquisition.ingestTwitter241
void acquisition.Twitter241AcquisitionOrchestrator
