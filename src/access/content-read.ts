import type { Payload, PayloadRequest } from 'payload'

import type { ApplicationLocale } from '@/contracts/locale'

import { exactLocaleRead } from './payload-access'

/** Server-side copy-default read: original content is never taken from a locale variant. */
export const readOriginalArtifact = async (
  payload: Payload,
  req: PayloadRequest,
  id: number,
): Promise<{ original_language: string; original_text: string }> => {
  const artifact = await payload.findByID({
    collection: 'prompt-artifacts',
    id,
    req,
    overrideAccess: false,
  })
  const originalText = artifact.prompt?.original_text
  if (typeof artifact.original_language !== 'string' || typeof originalText !== 'string')
    throw new Error('prompt artifact original content is incomplete')
  return { original_language: artifact.original_language, original_text: originalText }
}

/** Reads only an approved variant for the requested locale; Payload fallback is disabled. */
export const readExactApprovedLocale = async (
  payload: Payload,
  req: PayloadRequest,
  entityKey: string,
  locale: ApplicationLocale,
) => {
  const result = await payload.find({
    collection: 'locale-variants',
    ...exactLocaleRead(locale),
    limit: 1,
    req,
    overrideAccess: false,
    where: {
      and: [
        { entity_key: { equals: entityKey } },
        { locale: { equals: locale } },
        { workflow_state: { equals: 'approved' } },
      ],
    },
  })
  return result.docs[0] ?? null
}
