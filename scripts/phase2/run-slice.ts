import { SliceOrchestrator } from '../../src/pipeline/orchestrator'
import type { SliceOrchestratorOptions, SliceRunRequest, SliceRunResult } from '../../src/pipeline/types'

/** The local slice runner is dependency-injected; it never creates a network transport. */
export const runSlice = (options: SliceOrchestratorOptions, request: SliceRunRequest): Promise<SliceRunResult> =>
  new SliceOrchestrator(options).run(request)

if (process.argv[1]?.endsWith('run-slice.ts')) {
  throw new Error('run-slice requires an injected local fixture transport and repositories')
}
