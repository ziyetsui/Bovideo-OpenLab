import { and, eq } from 'drizzle-orm'
import { APIError, type CollectionBeforeChangeHook, type CollectionConfig } from 'payload'

import { auditAfterChange, auditAfterDelete, collectionAccess } from '@/access/payload-access'

import { preventPromptOriginalTextMutation, preventStableIdMutation, productionFields } from './shared'

/**
 * Payload's PostgreSQL adapter can replace relationship rows without an atomic
 * expected-revision predicate. Claiming revision in the request transaction forces
 * every supported relationship mutation through the parent row and rejects an old
 * request after it waits behind taxonomy ingress instead of writing stale arrays.
 */
type PromptRelationshipCasDatabase = Readonly<{
  update: (table: never) => Readonly<{
    set: (values: never) => Readonly<{
      where: (predicate: never) => Readonly<{
        returning: (selection: never) => Promise<readonly unknown[]>
      }>
    }>
  }>
}>
type PromptRelationshipCasAdapter = Readonly<{
  sessions?: Readonly<Record<string, Readonly<{ db: PromptRelationshipCasDatabase }>>>
  tables?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}>

export const serializePromptRelationshipUpdate: CollectionBeforeChangeHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (operation !== 'update' || originalDoc === undefined) return data
  const changed = data as Record<string, unknown>
  const hasRelationshipChange = ['model_refs', 'taxonomy_refs', 'variation_refs']
    .some((field) => Object.prototype.hasOwnProperty.call(changed, field))
  if (!hasRelationshipChange) return data
  const id = (originalDoc as Record<string, unknown>).id
  const revision = Number((originalDoc as Record<string, unknown>).revision)
  if ((typeof id !== 'number' && typeof id !== 'string') || !Number.isSafeInteger(revision) || revision < 1)
    throw new APIError('PromptArtifact relationship update requires a persisted revision', 409, { field: 'revision' })
  const transactionID = req.transactionID === undefined ? undefined : await req.transactionID
  const adapter = req.payload.db as unknown as PromptRelationshipCasAdapter
  const database = transactionID === undefined ? undefined : adapter.sessions?.[String(transactionID)]?.db
  const table = adapter.tables?.prompt_artifacts
  const idColumn = table?.id
  const revisionColumn = table?.revision
  if (database === undefined || table === undefined || idColumn === undefined || revisionColumn === undefined)
    throw new Error('PromptArtifact relationship CAS requires the PostgreSQL transaction')
  const nextRevision = revision + 1
  const rows = await database.update(table as never)
    .set({ revision: nextRevision } as never)
    .where(and(
      eq(idColumn as never, id as never),
      eq(revisionColumn as never, revision as never),
    ) as never)
    .returning({ id: idColumn } as never)
  if (rows.length !== 1)
    throw new APIError('PromptArtifact relationship revision conflict', 409, { field: 'revision' })
  changed.revision = nextRevision
  return data
}

export const PromptArtifacts: CollectionConfig = {
  slug: 'prompt-artifacts',
  admin: { useAsTitle: 'canonical_label' },
  access: collectionAccess('prompt-artifacts'),
  hooks: {
    beforeChange: [preventStableIdMutation, preventPromptOriginalTextMutation, serializePromptRelationshipUpdate],
    afterChange: [auditAfterChange('prompt-artifacts')],
    afterDelete: [auditAfterDelete('prompt-artifacts')],
  },
  indexes: [{ fields: ['source', 'kind', 'source_version'], unique: true }],
  fields: [
    ...productionFields(['draft', 'review', 'approved', 'published', 'blocked', 'withdrawn'], 'draft'),
    { name: 'kind', type: 'select', required: true, options: ['prompt', 'workflow', 'comparison'] },
    { name: 'canonical_label', type: 'text', required: true, index: true },
    {
      name: 'prompt',
      type: 'group',
      fields: [
        { name: 'original_text', type: 'textarea', required: true },
        {
          name: 'variables',
          type: 'array',
          fields: [
            { name: 'token', type: 'text', required: true },
            { name: 'description', type: 'text' },
            { name: 'allowed_values', type: 'json' },
            { name: 'occurrences', type: 'number', min: 0 },
          ],
        },
      ],
    },
    { name: 'original_language', type: 'text', required: true, defaultValue: 'en' },
    {
      name: 'outcome',
      type: 'group',
      fields: [
        { name: 'media_type', type: 'select', options: ['image', 'video', 'unresolved'] },
        { name: 'summary', type: 'textarea' },
        { name: 'capability', type: 'text' },
      ],
    },
    {
      name: 'inputs',
      type: 'group',
      fields: [
        { name: 'required', type: 'json' },
        { name: 'optional', type: 'json' },
      ],
    },
    { name: 'parameters', type: 'json' },
    { name: 'examples', type: 'json' },
    { name: 'workflow_steps', type: 'json' },
    { name: 'signals', type: 'json' },
    { name: 'source', type: 'relationship', required: true, relationTo: 'sources', index: true },
    { name: 'model_refs', type: 'relationship', relationTo: 'taxonomy-nodes', hasMany: true },
    { name: 'taxonomy_refs', type: 'relationship', relationTo: 'taxonomy-nodes', hasMany: true },
    { name: 'variation_refs', type: 'relationship', relationTo: 'prompt-artifacts', hasMany: true },
    {
      name: 'rights_state',
      type: 'select',
      required: true,
      index: true,
      options: [
        'unknown',
        'metadata_only',
        'display_licensed',
        'redistribution_licensed',
        'first_party',
        'blocked',
        'revoked',
      ],
    },
    {
      name: 'safety_state',
      type: 'select',
      required: true,
      options: ['pending', 'approved', 'blocked'],
    },
    {
      name: 'evidence_state',
      type: 'select',
      required: true,
      options: ['pending', 'verified', 'insufficient'],
    },
  ],
}
