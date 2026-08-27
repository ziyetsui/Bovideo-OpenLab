import type { CollectionConfig } from 'payload'

import { USER_ROLES, SERVICE_SCOPES } from '@/access/principals'
import { auditAfterChange, auditAfterDelete, collectionAccess } from '@/access/payload-access'
import { createUlid } from '@/access/ulid'
import { preventStableIdMutation } from './shared'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  auth: true,
  access: collectionAccess('users'),
  hooks: {
    beforeChange: [preventStableIdMutation, ({ data, operation, originalDoc, req }) => {
      if (operation === 'update' && data.stable_id !== undefined && data.stable_id !== originalDoc?.stable_id)
        throw new Error('stable_id is immutable')
      if (operation === 'update' && req.user?.id === originalDoc?.id &&
        (data.roles !== undefined || data.service_scopes !== undefined || data.identity_kind !== undefined))
        throw new Error('users cannot change their own identity authority')
      const incoming = data as { identity_kind?: unknown; roles?: unknown; service_scopes?: unknown }
      const original = (originalDoc ?? {}) as { identity_kind?: unknown; roles?: unknown; service_scopes?: unknown }
      const kind = incoming.identity_kind ?? original.identity_kind ?? 'human'
      const roles = incoming.roles ?? original.roles ?? []
      const scopes = incoming.service_scopes ?? original.service_scopes ?? []
      if (kind === 'human' && (!Array.isArray(roles) || roles.length !== 1 || !Array.isArray(scopes) || scopes.length !== 0))
        throw new Error('human identities require exactly one role and no service scope')
      if (kind === 'service' && (!Array.isArray(roles) || roles.length !== 0 || !Array.isArray(scopes) || scopes.length !== 1))
        throw new Error('service identities require exactly one service scope and no user role')
      return data
    }],
    afterChange: [auditAfterChange('users')],
    afterDelete: [auditAfterDelete('users')],
  },
  fields: [
    { name: 'stable_id', type: 'text', required: true, unique: true, index: true, defaultValue: createUlid, admin: { readOnly: true } },
    { name: 'identity_kind', type: 'select', required: true, defaultValue: 'human', options: ['human', 'service'] },
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      validate: (value, { siblingData }) => {
        const kind = (siblingData as { identity_kind?: string }).identity_kind
        if (kind === 'service') return !Array.isArray(value) || value.length === 0 || 'service identities cannot have user roles'
        return (Array.isArray(value) && value.length === 1) || 'human identities require exactly one role'
      },
      defaultValue: ['editor'],
      options: USER_ROLES.map((value) => ({ label: value, value })),
    },
    {
      name: 'service_scopes',
      type: 'select',
      hasMany: true,
      validate: (value, { siblingData }) => {
        const kind = (siblingData as { identity_kind?: string }).identity_kind
        if (kind === 'human') return !Array.isArray(value) || value.length === 0 || 'human identities cannot have service scopes'
        return (Array.isArray(value) && value.length === 1) || 'service identities require exactly one scope'
      },
      options: SERVICE_SCOPES.map((value) => ({ label: value, value })),
      admin: { description: 'Only dedicated service identities may receive a service scope.' },
    },
  ],
}
