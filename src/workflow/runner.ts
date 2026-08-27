import type { Payload } from 'payload'

import {
  claimOldestQueuedRun,
  failRun,
  staleIgnoreRun,
  succeedRun,
  type WorkflowLeaseReceipt,
  type WorkflowWorkerAuthorization,
} from './payload-lease'
import { StaleWorkflowSourceError, WorkflowHandlerError, type WorkflowRegistry } from './registry'

export const classifyWorkflowError = (error: unknown): string => {
  if (error instanceof WorkflowHandlerError) return error.workflowErrorClass
  return 'handler_error'
}

/** Executes one durable, revision-leased workflow run without a Payload request transaction. */
export const runNextWorkflow = async (
  payload: Payload,
  registry: WorkflowRegistry,
  worker: WorkflowWorkerAuthorization,
): Promise<'processed' | 'idle'> => {
  const receipt = await claimOldestQueuedRun(payload, worker)
  if (receipt === null) return 'idle'
  try {
    const output = await registry.execute(receipt.run)
    await succeedRun(payload, receipt, output.outputRef)
    return 'processed'
  } catch (error) {
    await recordTerminalFailure(payload, receipt, error)
    throw error
  }
}

const recordTerminalFailure = async (
  payload: Payload,
  receipt: WorkflowLeaseReceipt,
  error: unknown,
): Promise<void> => {
  if (error instanceof StaleWorkflowSourceError) {
    await staleIgnoreRun(payload, receipt)
    return
  }
  await failRun(payload, receipt, classifyWorkflowError(error))
}
