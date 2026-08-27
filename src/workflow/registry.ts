import { workflowRunJobTypeSchema } from '@/contracts/workflow-run'

import type { DurableWorkflowRun } from './payload-lease'

export type WorkflowRunCommand = Readonly<{
  jobType: ReturnType<typeof workflowRunJobTypeSchema.parse>
  inputRef: URL
  correlationId: string
  expectedSourceVersion: string
  output: WorkflowOutputWriter
}>

declare const validatedWorkflowOutputRef: unique symbol
export type WorkflowOutputRef = string & Readonly<{ [validatedWorkflowOutputRef]: true }>
export type WorkflowOutputWriter = Readonly<{ write: (outputRef: string) => void }>
export type WorkflowHandler = (run: WorkflowRunCommand) => Promise<void>

export class StaleWorkflowSourceError extends Error {
  readonly code = 'stale_source_version' as const

  constructor(message = 'workflow source version is stale') {
    super(message)
    this.name = 'StaleWorkflowSourceError'
  }
}

export class WorkflowHandlerError extends Error {
  readonly workflowErrorClass: string

  constructor(errorClass: string, message = errorClass) {
    super(message)
    this.name = 'WorkflowHandlerError'
    this.workflowErrorClass = errorClass
  }
}

const OUTPUT_REF_MAX_LENGTH = 512
const outputRefPattern = /^private\/[a-z0-9][a-z0-9/_-]*$/i

const outputWriter = (): Readonly<{ writer: WorkflowOutputWriter; read: () => WorkflowOutputRef }> => {
  let output: WorkflowOutputRef | undefined
  const write = (candidate: string): void => {
    if (output !== undefined) throw new WorkflowHandlerError('output_already_written')
    if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > OUTPUT_REF_MAX_LENGTH || !outputRefPattern.test(candidate))
      throw new WorkflowHandlerError('invalid_output_ref')
    output = candidate as WorkflowOutputRef
  }
  return Object.freeze({
    writer: Object.freeze({ write }),
    read: () => {
      if (output === undefined) throw new WorkflowHandlerError('missing_output_ref')
      return output
    },
  })
}

const commandFrom = (run: DurableWorkflowRun, output: WorkflowOutputWriter): WorkflowRunCommand => {
  let inputRef: URL
  try {
    inputRef = new URL(run.input_ref)
  } catch {
    throw new WorkflowHandlerError('invalid_input_ref')
  }
  const correlationId = run.audit.correlation_id
  if (correlationId === null || correlationId.length === 0) throw new WorkflowHandlerError('missing_correlation_id')
  return Object.freeze({
    jobType: workflowRunJobTypeSchema.parse(run.job_type),
    inputRef,
    correlationId,
    expectedSourceVersion: run.source_version,
    output,
  })
}

/** Native worker handler lookup; handlers are intentionally process-local, never Payload hooks. */
export class WorkflowRegistry {
  readonly #handlers = new Map<ReturnType<typeof workflowRunJobTypeSchema.parse>, WorkflowHandler>()

  register(jobType: ReturnType<typeof workflowRunJobTypeSchema.parse>, handler: WorkflowHandler): void {
    if (this.#handlers.has(jobType)) throw new Error(`workflow handler already registered for ${jobType}`)
    this.#handlers.set(jobType, handler)
  }

  async execute(run: DurableWorkflowRun): Promise<{ outputRef: WorkflowOutputRef }> {
    const output = outputWriter()
    const command = commandFrom(run, output.writer)
    const handler = this.#handlers.get(command.jobType)
    if (handler === undefined) throw new WorkflowHandlerError('unregistered_job_type')
    await handler(command)
    return Object.freeze({ outputRef: output.read() })
  }
}
