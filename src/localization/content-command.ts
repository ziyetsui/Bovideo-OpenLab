import { APIError, type PayloadRequest } from 'payload'
import { z } from 'zod'

import { principalFromPayloadUser } from '@/access/principals'
import { createPayloadGoldenApprovalLookup } from './golden-approval-payload'
import { compareApprovedGoldenReplacement, validateGoldenSetManifest } from './golden-set'

const localizedFieldsSchema = z.record(z.string().min(1), z.string()).refine(
  (value) => Object.keys(value).length > 0,
  'localized_fields must not be empty',
)

/**
 * The only transport-shaped input accepted for a localized content revision.
 * This intentionally has no field for workflow, approval, source identity, or
 * risk facts: those are derived by the server-side canonical command hook.
 */
export const localeContentCommandSchema = z.object({
  id: z.number().int().positive(),
  expected_revision: z.number().int().positive(),
  expected_content_revision: z.number().int().positive(),
  correlation_id: z.string().min(1).max(128),
  reason_code: z.string().min(1).max(128),
  localized_fields: localizedFieldsSchema,
}).strict()

export type LocaleContentCommandInput = z.infer<typeof localeContentCommandSchema>

const reject = (message: string, status = 400): never => {
  throw new APIError(message, status, { field: 'locale_content_command' })
}

/**
 * A server-only bridge from an authenticated transport request to the private
 * Payload hook context. JSON callers can never provide this context themselves.
 */
export const executeLocaleContentCommand = async (
  req: PayloadRequest,
  input: unknown,
) => {
  let commandInput!: LocaleContentCommandInput
  try { commandInput = localeContentCommandSchema.parse(input) } catch { reject('invalid localized content command') }
  const principal = principalFromPayloadUser(req.user)
  if (principal.kind !== 'user' || !principal.roles.some((role) => role === 'editor' || role === 'translator'))
    reject('localized content command requires editor or translator', 403)

  const command = Object.freeze({
    ...commandInput,
    actor_id: principal.id,
    at: new Date().toISOString(),
    // Risk membership is deliberately derived by the hook, never transported.
    risk_classes: [] as string[],
  })
  const commandReq = {
    ...req,
    context: {
      ...(req.context ?? {}),
      phase1LocaleContentCommand: command,
    },
  } as PayloadRequest
  return req.payload.update({
    collection: 'locale-variants',
    id: command.id,
    data: { localized_fields: command.localized_fields } as never,
    req: commandReq,
  })
}

export const localeContentCommandEndpoint = async (req: PayloadRequest): Promise<Response> => {
  const input = await req.json?.()
  const doc = await executeLocaleContentCommand(req, input)
  return Response.json({ doc })
}

/**
 * Server comparison path for replacing a golden manifest. The request carries
 * candidate data only; approval evidence is loaded from Payload by hash and
 * never accepted as a transport field.
 */
export const goldenReplacementCompareEndpoint = async (req: PayloadRequest): Promise<Response> => {
  const principal = principalFromPayloadUser(req.user)
  if (
    principal.kind !== 'user' ||
    !principal.roles.some((role) => role === 'reviewer' || role === 'admin' || role === 'legal')
  )
    reject('golden replacement comparison requires reviewer, admin, or legal', 403)
  const input = await req.json?.()
  if (typeof input !== 'object' || input === null) reject('invalid golden replacement comparison')
  const body = input as { baseline?: unknown; candidate?: unknown }
  const comparison = await compareApprovedGoldenReplacement(
    validateGoldenSetManifest(body.baseline),
    validateGoldenSetManifest(body.candidate),
    createPayloadGoldenApprovalLookup(req.payload),
  )
  return Response.json(comparison)
}
