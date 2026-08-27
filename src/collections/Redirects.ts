import type { CollectionConfig } from 'payload'

import { auditAfterChange, auditAfterDelete, collectionAccess } from '@/access/payload-access'
import { DEFAULT_REDIRECT_STATUS, REDIRECT_STATUSES } from '@/contracts/redirect'

import {
  canonicalPayloadAfterChange,
  canonicalPayloadBeforeChange,
  canonicalPayloadBeforeValidate,
  auditCanonicalPayloadStateChange,
  serverManagedProductionFields,
} from './canonical-payload-contract'
import { localeOptions } from './shared'

export const Redirects: CollectionConfig = {
  slug: 'redirects',
  admin: { useAsTitle: 'old_path' },
  access: collectionAccess('redirects'),
  hooks: {
    beforeValidate: [canonicalPayloadBeforeValidate('redirect')],
    beforeChange: [canonicalPayloadBeforeChange('redirect')],
    afterChange: [async (args) => {
      await canonicalPayloadAfterChange('redirect')(args)
      if (await auditCanonicalPayloadStateChange('redirect', 'redirects', args)) return args.doc
      return auditAfterChange('redirects')(args)
    }],
    afterDelete: [auditAfterDelete('redirects')],
  },
  indexes: [{ fields: ['locale', 'old_path'], unique: true }],
  fields: [
    ...serverManagedProductionFields(REDIRECT_STATUSES, DEFAULT_REDIRECT_STATUS),
    { name: 'locale', type: 'select', required: true, options: localeOptions, index: true },
    { name: 'old_path', type: 'text', required: true, index: true },
    {
      name: 'target_path', type: 'text',
      validate: (value: unknown, { siblingData }: { siblingData?: unknown }) => {
        const status = (siblingData as { status?: string } | undefined)?.status
        if (status === '410') return value === undefined || value === null || '410 redirects must not have a target path'
        return typeof value === 'string' && value.startsWith('/') || '301 and 308 redirects require a target path'
      },
    },
    { name: 'reason_code', type: 'text', required: true },
  ],
}
