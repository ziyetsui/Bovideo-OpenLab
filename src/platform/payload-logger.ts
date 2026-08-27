import type { PayloadLogger } from 'payload'

const expectedDiagnostics = new Set([
  'You are not allowed to perform this action.',
  'stable_id is immutable',
  'original_language is immutable',
  'prompt.original_text is immutable',
  'locale Money Page metadata is server-managed',
  'state mutations require a canonical expected-revision command',
  'canonical command revision conflict',
  'canonical command Money Page facts do not match persisted record',
  'canonical command transition denied',
  'publication pointer mutations require a private server command',
])
const expectedEmailDiagnostic = 'No email adapter provided. Email will be written to console.'

const messageFrom = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  return messageFrom(record.err) ?? messageFrom(record.message) ?? messageFrom(record.msg)
}

/** Limits local test noise to known, independently asserted denial outcomes. */
export const isExpectedPayloadDiagnostic = (...values: unknown[]): boolean =>
  values.some((value) => {
    const message = messageFrom(value)
    const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
    const error = record?.err
    const errorRecord = typeof error === 'object' && error !== null ? error as Record<string, unknown> : undefined
    const errorMessage = messageFrom(error)
    const knownMatrixMediaNotFound =
      errorMessage === 'Not Found' &&
      Array.isArray(errorRecord?.path) &&
      errorRecord.path.length === 1 &&
      errorRecord.path[0] === 'updateMedia'
    const knownServerManagedMetadataError =
      errorRecord?.isOperational === true &&
      errorRecord.status === 400 &&
      typeof errorRecord.data === 'object' &&
      errorRecord.data !== null &&
      ['is_money_page', 'canonical_command', 'active_publication_pointer'].includes(String((errorRecord.data as Record<string, unknown>).field)) &&
      errorMessage !== undefined &&
      expectedDiagnostics.has(errorMessage)
    return knownMatrixMediaNotFound || knownServerManagedMetadataError || (message !== undefined &&
      (expectedDiagnostics.has(message) || message.startsWith(expectedEmailDiagnostic))
    )
  })

const createLog =
  (level: string, write: typeof console.log) => (objOrMsg: object | string, msg?: string) => {
    if (isExpectedPayloadDiagnostic(objOrMsg, msg)) return
    if (typeof objOrMsg === 'string') {
      write(JSON.stringify({ level, msg: objOrMsg }))
    } else {
      write(JSON.stringify({ level, ...objOrMsg, msg: msg ?? (objOrMsg as { msg?: string }).msg }))
    }
  }

/** Payload logger that keeps expected authorization denials auditable without stack-trace noise. */
export const payloadLogger = {
  level: process.env.PAYLOAD_LOG_LEVEL || 'info',
  trace: createLog('trace', console.debug),
  debug: createLog('debug', console.debug),
  info: createLog('info', console.log),
  warn: createLog('warn', console.warn),
  error: createLog('error', console.error),
  fatal: createLog('fatal', console.error),
  silent: () => {},
} as unknown as PayloadLogger
