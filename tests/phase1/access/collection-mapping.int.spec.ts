import { CANONICAL_COLLECTION_MAPPING } from '@/collections/contract-mapping'
import { LocaleVariants } from '@/collections/LocaleVariants'
import { DeletionRequests } from '@/collections/DeletionRequests'
import { Users } from '@/collections/Users'
import { Media } from '@/collections/Media'
import { Sources } from '@/collections/Sources'
import { PromptArtifacts } from '@/collections/PromptArtifacts'
import { TaxonomyNodes } from '@/collections/TaxonomyNodes'
import { PageRecords } from '@/collections/PageRecords'
import { Edges } from '@/collections/Edges'
import { ModuleEnvelopes } from '@/collections/ModuleEnvelopes'
import { PublicationSnapshots } from '@/collections/PublicationSnapshots'
import { PublicationStates } from '@/collections/PublicationStates'
import { ActivePublicationPointers } from '@/collections/ActivePublicationPointers'
import { Redirects } from '@/collections/Redirects'
import { WorkflowRuns } from '@/collections/WorkflowRuns'
import {
  canonicalPayloadBeforeValidate,
  normalizeRedirectPayloadDocument,
  normalizeWorkflowRunPayloadDocument,
  validateCanonicalPayloadDocument,
} from '@/collections/canonical-payload-contract'
import { DEFAULT_REDIRECT_STATUS, REDIRECT_STATUSES } from '@/contracts/redirect'
import { DEFAULT_WORKFLOW_RUN_STATUS, WORKFLOW_RUN_JOB_TYPES, WORKFLOW_RUN_STATUSES } from '@/contracts/workflow-run'
import { preventLocaleIdentityMutation, requireApprovedPageEvidence } from '@/collections/shared'
import { describe, expect, it } from 'vitest'

const HASH = `sha256:v1:${'a'.repeat(64)}`
const ACTOR_ID = '018f8f41-6dc0-7b5e-8d93-22d8f7a64b6c'
const SPOOFED_ID = '018f8f41-6dc0-7b5e-8d93-22d8f7a64b6d'
const UTC = '2026-08-23T12:34:56.000Z'

describe('Payload collection to canonical contract mapping', () => {
  it('rejects changes to a locale record language identity', async () => {
    expect(() => preventLocaleIdentityMutation({
      operation: 'update',
      data: { locale: 'ja-JP' },
      originalDoc: { locale: 'en', source_locale: 'en' },
    } as never)).toThrow('locale is immutable')
    expect(() => preventLocaleIdentityMutation({
      operation: 'update',
      data: { source_locale: 'ja-JP' },
      originalDoc: { locale: 'en', source_locale: 'en' },
    } as never)).toThrow('source_locale is immutable')
  })

  it('rejects candidate or rejected graph evidence before a PageRecord becomes indexable', async () => {
    const hook = requireApprovedPageEvidence
    const base = {
      operation: 'create',
      data: { index_state: 'index_candidate', approval_edge: 1, approval_evidence: [9] },
    }

    await expect(hook({
      ...base,
      req: { payload: { findByID: async () => ({ review_state: 'candidate', evidence: [9] }) } },
    } as never)).rejects.toThrow('approved edge')
    await expect(hook({
      ...base,
      req: { payload: { findByID: async () => ({ review_state: 'approved', evidence: [] }) } },
    } as never)).rejects.toThrow('approved edge evidence')
    await expect(hook({
      ...base,
      req: { payload: { findByID: async () => ({ review_state: 'approved', evidence: [10] }) } },
    } as never)).rejects.toThrow('approved edge evidence')
    await expect(hook({
      ...base,
      req: { payload: { findByID: async () => ({ review_state: 'approved', evidence: [9] }) } },
    } as never)).resolves.toMatchObject(base.data)
  })

  it('audits every successful mutable collection change and deletion', () => {
    const mutableCollections = [
      Users,
      Media,
      Sources,
      PromptArtifacts,
      TaxonomyNodes,
      PageRecords,
      LocaleVariants,
      Edges,
      ModuleEnvelopes,
      PublicationSnapshots,
      PublicationStates,
      ActivePublicationPointers,
      Redirects,
      WorkflowRuns,
      DeletionRequests,
    ]

    for (const collection of mutableCollections) {
      expect(collection.hooks?.afterChange, `${collection.slug} afterChange`).toHaveLength(1)
      expect(collection.hooks?.afterDelete, `${collection.slug} afterDelete`).toHaveLength(1)
    }
  })

  it('declares every contract-backed collection and its unique identity shape', () => {
    expect(CANONICAL_COLLECTION_MAPPING).toMatchObject({
      sources: { unique: ['provider', 'provider_record_id', 'content_hash'] },
      'prompt-artifacts': { unique: ['source', 'kind', 'source_version'] },
      'taxonomy-nodes': { unique: ['node_type', 'stable_key'] },
      edges: { unique: ['from_key', 'relation', 'to_key', 'source_version'] },
      'locale-variants': { unique: ['entity_key', 'locale', 'source_version'] },
      'page-records': { unique: ['page_type', 'root_object_key', 'locale'] },
      'module-envelopes': { unique: ['page_id', 'locale', 'module_type', 'module_version'] },
      'publication-snapshots': { unique: ['publish_version'] },
      'publication-states': { unique: ['publish_version'] },
      'active-publication-pointers': { unique: ['singleton_key'] },
      redirects: { unique: ['locale', 'old_path'] },
      'workflow-runs': { unique: ['job_type', 'idempotency_key'] },
      'deletion-requests': { unique: ['external_request_key'] },
      'audit-events': { unique: ['event_id'] },
    })
  })

  it('declares required contract field mappings for stateful locale, page, module, and deletion records', () => {
    expect(CANONICAL_COLLECTION_MAPPING['prompt-artifacts'].fields).toEqual(expect.arrayContaining([
      'original_language', 'prompt.original_text',
    ]))
    expect(CANONICAL_COLLECTION_MAPPING['locale-variants'].fields).toContain('is_money_page')
    expect(CANONICAL_COLLECTION_MAPPING['locale-variants'].fields).toContain('reviewed_revision')
    expect(CANONICAL_COLLECTION_MAPPING['page-records'].fields).toContain('qualification_input_hash')
    expect(CANONICAL_COLLECTION_MAPPING['module-envelopes'].fields).toContain('generated_by')
    expect(CANONICAL_COLLECTION_MAPPING['deletion-requests'].fields).toContain('requested_by')
  })

  it('maps Redirects and WorkflowRuns to their canonical common fields and contract-owned enums', () => {
    expect(CANONICAL_COLLECTION_MAPPING.redirects.fields).toEqual(expect.arrayContaining([
      'id', 'schema_version', 'revision', 'source_version', 'locale', 'old_path',
      'target_path', 'status', 'reason_code', 'created_at', 'audit',
    ]))
    expect(CANONICAL_COLLECTION_MAPPING.redirects.fields).not.toContain('createdAt')
    expect(CANONICAL_COLLECTION_MAPPING['workflow-runs'].fields).toEqual(expect.arrayContaining([
      'id', 'schema_version', 'revision', 'source_version', 'job_type',
      'idempotency_key', 'attempt', 'input_ref', 'output_ref', 'status',
      'error_class', 'created_at', 'updated_at', 'audit',
    ]))

    const options = (config: { fields: unknown[] }, name: string) =>
      (config.fields as Array<{ name?: string; options?: unknown }>).find((field) => field.name === name)?.options
    const fieldByName = (fields: unknown[], name: string) =>
      (fields as Array<{ name?: string; required?: boolean; defaultValue?: unknown }>).find((field) => field.name === name)
    expect(options(Redirects, 'status')).toEqual(REDIRECT_STATUSES.map((value) => ({ label: value, value })))
    expect(options(WorkflowRuns, 'status')).toEqual(WORKFLOW_RUN_STATUSES.map((value) => ({ label: value, value })))
    expect(options(WorkflowRuns, 'job_type')).toEqual(WORKFLOW_RUN_JOB_TYPES.map((value) => ({ label: value, value })))
    expect(fieldByName(Redirects.fields, 'status')?.defaultValue).toBe(DEFAULT_REDIRECT_STATUS)
    expect(fieldByName(WorkflowRuns.fields, 'status')?.defaultValue).toBe(DEFAULT_WORKFLOW_RUN_STATUS)
    expect(Redirects.hooks?.beforeValidate).toBeDefined()
    expect(WorkflowRuns.hooks?.beforeValidate).toBeDefined()
    expect(fieldByName(Redirects.fields, 'audit')?.required).toBe(true)
    expect(fieldByName(WorkflowRuns.fields, 'audit')?.required).toBe(true)
  })

  it('normalizes only server-maintained Payload facts before strict redirect and workflow validation', async () => {
    const redirectHook = canonicalPayloadBeforeValidate('redirect')
    const workflowHook = canonicalPayloadBeforeValidate('workflowRun')
    const req = { user: { id: 42, stable_id: ACTOR_ID, identity_kind: 'service' } }
    const redirect = await redirectHook({
      data: {
        schema_version: 99,
        revision: 99,
        source_version: HASH,
        status: '301',
        locale: 'en',
        old_path: '/before',
        target_path: '/after',
        reason_code: 'slug_changed',
      },
      operation: 'create',
      req,
    } as never) as Record<string, unknown>
    const workflow = await workflowHook({
      data: {
        source_version: HASH,
        status: 'succeeded',
        job_type: 'publish',
        idempotency_key: 'publish:001',
        attempt: 1,
        input_ref: 'private/input/001',
        output_ref: 'private/output/001',
      },
      operation: 'create',
      req,
    } as never) as Record<string, unknown>

    expect(redirect).toMatchObject({ schema_version: 1, revision: 1, target_path: '/after' })
    expect(redirect.stable_id).not.toBe(SPOOFED_ID)
    expect(redirect.audit).toEqual({ created_by: 42, updated_by: 42, correlation_id: expect.any(String) })
    expect(workflow).toMatchObject({ schema_version: 1, revision: 1, output_ref: 'private/output/001', error_class: null })
    expect(normalizeRedirectPayloadDocument({ ...redirect, createdAt: UTC }, req.user)).toMatchObject({
      id: redirect.stable_id,
      created_at: UTC,
      audit: { created_by: { type: 'service', id: ACTOR_ID }, updated_by: { type: 'service', id: ACTOR_ID } },
    })
    expect(normalizeRedirectPayloadDocument({
      ...redirect,
      createdAt: UTC,
      audit: {
        ...redirect.audit as Record<string, unknown>,
        created_by: { stable_id: SPOOFED_ID, identity_kind: 'human' },
        updated_by: { stable_id: ACTOR_ID, identity_kind: 'service' },
      },
    }, req.user).audit).toMatchObject({
      created_by: { type: 'user', id: SPOOFED_ID },
      updated_by: { type: 'service', id: ACTOR_ID },
    })
    expect(normalizeWorkflowRunPayloadDocument({ ...workflow, createdAt: UTC, updatedAt: UTC }, req.user)).toMatchObject({
      id: workflow.stable_id,
      created_at: UTC,
      updated_at: UTC,
      output_ref: 'private/output/001',
      error_class: null,
    })
    expect(() => validateCanonicalPayloadDocument('redirect', { ...redirect, createdAt: UTC }, req.user)).not.toThrow()
    expect(() => validateCanonicalPayloadDocument('workflowRun', { ...workflow, createdAt: UTC, updatedAt: UTC }, req.user)).not.toThrow()

    for (const field of ['audit', 'createdAt', 'created_at', 'unexpected']) {
      await expect(redirectHook({
        data: { source_version: HASH, status: '301', locale: 'en', old_path: '/before', target_path: '/after', reason_code: 'slug_changed', [field]: field === 'stable_id' ? SPOOFED_ID : field === 'audit' ? { correlation_id: SPOOFED_ID } : UTC },
        operation: 'create',
        req,
      } as never)).rejects.toThrow()
    }
  })

  it('requires a persisted last content editor for Money Pages and typed non-empty deletion object refs', () => {
    const fields = (config: { fields: unknown[] }) => config.fields as Array<{
      name?: string
      validate?: (value: unknown, args: unknown) => true | string
    }>
    const editor = fields(LocaleVariants).find((field) => field.name === 'last_content_editor')
    const objectRefs = fields(DeletionRequests).find((field) => field.name === 'object_refs')
    expect(editor?.validate?.(undefined, { siblingData: { is_money_page: true } })).toMatch(/required/)
    expect(objectRefs?.validate?.([], {})).toMatch(/non-empty/)
    expect(objectRefs?.validate?.([{ type: 'source', id: '01J6R3W2V8W24Q10NRDBVGN3P9' }], {})).toBe(true)
  })
})
