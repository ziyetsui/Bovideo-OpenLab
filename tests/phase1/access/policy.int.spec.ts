import {
  decideAccess,
  principals,
  type AccessAction,
  type AccessResource,
} from '@/access/policy'
import { buildAuditEvent, redactAuditValue } from '@/access/audit-hook'
import { exactLocaleRead, payloadAccess, payloadMutationActions } from '@/access/payload-access'
import { isExpectedPayloadDiagnostic } from '@/platform/payload-logger'
import { enforceLocaleServerMetadata, requireCanonicalCommandFor } from '@/collections/shared'
import { describe, expect, it } from 'vitest'

const moneyPageLocale: AccessResource = {
  collection: 'locale-variants',
  moneyPage: true,
  lastContentEditorId: 'editor-1',
  reviewerId: 'reviewer-1',
}

const highRiskActions: readonly AccessAction[] = [
  'redirect_status_transition',
  'workflow_run_status_transition',
  'rights_override',
  'license_change',
  'publish',
  'deletion_complete',
]

describe('Phase 1 Payload policy', () => {
  it('publishes a single production catalog for every semantic mutation class', () => {
    expect(Object.keys(payloadMutationActions)).toEqual([
      'sources.create',
      'sources.update',
      'users.delete',
      'locale_transition',
      'page_transition',
      'redirect_status_transition',
      'workflow_run_status_transition',
      'rights_override',
      'license_change',
      'publish',
      'deletion_complete',
      'identity_escalation',
    ])
  })

  it('covers every mutating class for all 11 principals through local, REST, and GraphQL decisions', () => {
    const cases: Array<{
      action: AccessAction
      resource: AccessResource
      allowed: readonly (keyof typeof principals)[]
    }> = [
      { action: 'create', resource: { collection: 'sources' }, allowed: ['admin', 'editor', 'legal', 'ingestService'] },
      { action: 'update', resource: { collection: 'sources' }, allowed: ['admin', 'editor', 'legal'] },
      { action: 'delete', resource: { collection: 'users' }, allowed: ['admin'] },
      { action: 'locale_transition', resource: { collection: 'locale-variants' }, allowed: ['editor', 'translator', 'reviewer', 'publisher', 'legal', 'translateService', 'withdrawService'] },
      { action: 'page_transition', resource: { collection: 'page-records' }, allowed: ['editor', 'reviewer', 'publisher', 'legal'] },
      { action: 'redirect_status_transition', resource: { collection: 'redirects' }, allowed: [] },
      { action: 'workflow_run_status_transition', resource: { collection: 'workflow-runs' }, allowed: [] },
      { action: 'rights_override', resource: { collection: 'sources' }, allowed: ['legal'] },
      { action: 'license_change', resource: { collection: 'sources' }, allowed: ['legal'] },
      { action: 'publish', resource: { collection: 'publication-states' }, allowed: ['publisher', 'publishService'] },
      { action: 'deletion_complete', resource: { collection: 'deletion-requests' }, allowed: ['legal', 'withdrawService'] },
      {
        action: 'identity_escalation',
        resource: { collection: 'users', subjectId: 'other-user', requestedRoles: ['editor'] },
        allowed: ['admin'],
      },
    ]

    for (const [principalName, principal] of Object.entries(principals) as Array<[keyof typeof principals, typeof principals[keyof typeof principals]]>) {
      for (const entry of cases) {
        const decisions = (['internal', 'rest', 'graphql'] as const).map((path) =>
          decideAccess({ principal, action: entry.action, resource: entry.resource, path }),
        )
        expect(decisions[1]).toEqual(decisions[0])
        expect(decisions[2]).toEqual(decisions[0])
        expect(decisions[0]?.allowed).toBe(entry.allowed.includes(principalName))
      }
    }
  })

  it('rejects and audits client attempts to rewrite persisted Money Page facts', async () => {
    const writes: unknown[] = []
    const req = {
      user: {
        id: 1,
        stable_id: '01J6R3W2V8W24Q10NRDBVGN3P9',
        identity_kind: 'human',
        roles: ['admin'],
        service_scopes: [],
      },
      payload: { create: async (value: unknown) => { writes.push(value); return {} } },
    }

    await expect(enforceLocaleServerMetadata({
      operation: 'update',
      data: {
        reviewed_by_stable_id: '01J6R3W2V8W24Q10NRDBVGN3P1',
        reviewed_revision: 7,
      },
      originalDoc: {
        stable_id: '01J6R3W2V8W24Q10NRDBVGN3P8',
        is_money_page: true,
        reviewed_by_stable_id: '01J6R3W2V8W24Q10NRDBVGN3P6',
        reviewed_revision: 4,
      },
      req,
    } as never)).rejects.toThrow('server-managed')
    expect(writes).toContainEqual(expect.objectContaining({
      collection: 'audit-events',
      data: expect.objectContaining({
        outcome: 'denied',
        reason_code: 'locale_metadata_server_managed',
      }),
    }))
  })

  it('rejects and audits client-selected Money Page metadata on locale creation', async () => {
    const writes: unknown[] = []
    const req = {
      user: { id: 1, stable_id: '01J6R3W2V8W24Q10NRDBVGN3P9', identity_kind: 'human', roles: ['admin'], service_scopes: [] },
      payload: { create: async (value: unknown) => { writes.push(value); return {} } },
    }
    await expect(enforceLocaleServerMetadata({
      operation: 'create',
      data: { stable_id: '01J6R3W2V8W24Q10NRDBVGN3P8', is_money_page: false },
      req,
    } as never)).rejects.toThrow('server-managed')
    expect(writes).toContainEqual(expect.objectContaining({
      data: expect.objectContaining({ outcome: 'denied', reason_code: 'locale_metadata_server_managed' }),
    }))
  })

  it('rejects and audits a published locale created without a canonical command', async () => {
    const writes: unknown[] = []
    const req = {
      user: { id: 1, stable_id: '01J6R3W2V8W24Q10NRDBVGN3P9', identity_kind: 'human', roles: ['admin'], service_scopes: [] },
      payload: { create: async (value: unknown) => { writes.push(value); return {} } },
    }
    await expect(requireCanonicalCommandFor('locale')({
      operation: 'create',
      data: { stable_id: '01J6R3W2V8W24Q10NRDBVGN3P8', workflow_state: 'published' },
      req,
    } as never)).rejects.toThrow('canonical expected-revision')
    expect(writes).toContainEqual(expect.objectContaining({
      data: expect.objectContaining({ outcome: 'denied', reason_code: 'canonical_command_required' }),
    }))
  })

  it.each([
    ['publication', 'status', 'draft'],
    ['deletion', 'status', 'received'],
  ] as const)('permits the canonical default %s create state', async (kind, field, state) => {
    await expect(requireCanonicalCommandFor(kind)({
      operation: 'create',
      data: { [field]: state },
      req: { payload: { create: async () => ({}) } },
    } as never)).resolves.toMatchObject({ [field]: state })
  })

  it('suppresses only the known expected local authorization and email diagnostics', () => {
    expect(isExpectedPayloadDiagnostic('You are not allowed to perform this action.')).toBe(true)
    expect(isExpectedPayloadDiagnostic({ msg: 'You are not allowed to perform this action.' })).toBe(true)
    expect(isExpectedPayloadDiagnostic({
      err: {
        data: { field: 'is_money_page' },
        isOperational: true,
        message: 'locale Money Page metadata is server-managed',
        status: 400,
      },
    })).toBe(true)
    expect(isExpectedPayloadDiagnostic({
      err: {
        data: { field: 'is_money_page' },
        isOperational: true,
        message: 'database connection lost',
        status: 400,
      },
    })).toBe(false)
    expect(isExpectedPayloadDiagnostic('original_language is immutable')).toBe(true)
    expect(isExpectedPayloadDiagnostic('prompt.original_text is immutable')).toBe(true)
    expect(isExpectedPayloadDiagnostic({
      err: {
        data: { code: 'pointer_command_invalid', field: 'active_publication_pointer' },
        isOperational: true,
        message: 'publication pointer mutations require a private server command',
        status: 400,
      },
    })).toBe(true)
    expect(isExpectedPayloadDiagnostic({
      err: {
        data: { code: 'pointer_command_invalid', field: 'active_publication_pointer' },
        isOperational: true,
        message: 'database connection lost',
        status: 400,
      },
    })).toBe(false)
    expect(isExpectedPayloadDiagnostic('No email adapter provided. Email will be written to console.')).toBe(true)
    expect(isExpectedPayloadDiagnostic({
      err: {
        message: 'Not Found',
        path: ['updateMedia'],
      },
    })).toBe(true)
    expect(isExpectedPayloadDiagnostic({
      err: {
        message: 'Not Found',
        path: ['updateSource'],
      },
    })).toBe(false)
    expect(isExpectedPayloadDiagnostic('database connection lost')).toBe(false)
  })

  it.each(['internal', 'rest', 'graphql'] as const)(
    'uses the same default-deny decision through %s',
    (path) => {
      const decision = decideAccess({
        principal: principals.anonymous,
        action: 'update',
        resource: { collection: 'prompt-artifacts' },
        path,
      })

      expect(decision).toEqual({ allowed: false, reason: 'anonymous_denied' })
    },
  )

  it('grants only the documented workflow roles and service scopes', () => {
    expect(
      decideAccess({
        principal: principals.editor,
        action: 'update',
        resource: { collection: 'prompt-artifacts' },
        path: 'internal',
      }),
    ).toMatchObject({ allowed: true })
    expect(
      decideAccess({
        principal: principals.translator,
        action: 'publish',
        resource: { collection: 'locale-variants' },
        path: 'rest',
      }),
    ).toMatchObject({ allowed: false })
    expect(
      decideAccess({
        principal: principals.translateService,
        action: 'locale_transition',
        resource: { collection: 'locale-variants' },
        path: 'graphql',
      }),
    ).toMatchObject({ allowed: true })
    expect(
      decideAccess({
        principal: principals.ingestService,
        action: 'create',
        resource: { collection: 'sources' },
        path: 'internal',
      }),
    ).toMatchObject({ allowed: true })
  })

  it('never lets admin bypass legal rights control or Money Page separation', () => {
    expect(
      decideAccess({
        principal: principals.admin,
        action: 'rights_override',
        resource: { collection: 'sources' },
        path: 'internal',
      }),
    ).toEqual({ allowed: false, reason: 'legal_role_required' })
    expect(
      decideAccess({
        principal: principals.reviewer,
        action: 'locale_transition',
        resource: { ...moneyPageLocale, lastContentEditorId: principals.reviewer.id },
        path: 'rest',
      }),
    ).toEqual({ allowed: false, reason: 'money_page_reviewer_separation_required' })
    expect(
      decideAccess({
        principal: principals.publisher,
        action: 'publish',
        resource: { ...moneyPageLocale, reviewerId: principals.publisher.id },
        path: 'graphql',
      }),
    ).toEqual({ allowed: false, reason: 'money_page_publisher_separation_required' })
  })

  it.each(highRiskActions)('denies and audits high-risk %s attempts', (action) => {
    const decision = decideAccess({
      principal: principals.editor,
      action,
      resource: { collection: 'sources' },
      path: 'rest',
    })
    const event = buildAuditEvent({
      action,
      actor: principals.editor,
      entity: { type: 'source', id: '01J6R3W2V8W24Q10NRDBVGN3P9' },
      correlationId: '01J6R3W2V8W24Q10NRDBVGN3P9',
      outcome: decision.allowed ? 'allowed' : 'denied',
      reasonCode: decision.reason,
      before: { rights_state: 'first_party', authorization: 'Bearer secret' },
      after: { rights_state: 'blocked', original_text: 'private full prompt' },
    })

    expect(decision.allowed).toBe(false)
    expect(event.outcome).toBe('denied')
    expect(event.prior_state).toEqual({ rights_state: 'first_party' })
    expect(event.new_state).toEqual({ rights_state: 'blocked' })
  })

  it('emits only allow-listed diffs and recursively redacts sensitive values', () => {
    expect(
      redactAuditValue({
        status: { nested: { Cookie: 'session=value', kept: 'ok' }, note: 'Bearer private-token' },
        workflow_state: ['review', 'cookie=session=value', 'approved'],
        email: 'person@example.com',
        localized_fields: { title: 'full translation' },
      }),
    ).toEqual({ status: { nested: { kept: 'ok' } }, workflow_state: ['review', 'approved'] })
  })

  it.each([
    ['locale', 'workflow_state', 'machine_draft', 'review'],
    ['page', 'index_state', 'discoverable_noindex', 'index_candidate'],
    ['publication', 'status', 'draft', 'preparing'],
    ['deletion', 'status', 'received', 'validated'],
  ] as const)('audits a denied %s canonical transition before rejecting it', async (kind, field, from, to) => {
    const writes: unknown[] = []
    const hook = requireCanonicalCommandFor(kind)
    const req = {
      user: {
        id: 7,
        stable_id: '01J6R3W2V8W24Q10NRDBVGN3P9',
        identity_kind: 'human',
        roles: ['reviewer'],
        service_scopes: [],
      },
      payload: { create: async (value: unknown) => { writes.push(value); return {} } },
    }
    await expect(hook({
      operation: 'update',
      data: { [field]: to, revision: 2 },
      originalDoc: { stable_id: '01J6R3W2V8W24Q10NRDBVGN3P8', [field]: from, revision: 1 },
      req,
    } as never)).rejects.toThrow('state mutations require')
    const eventType = kind === 'locale'
      ? 'locale-variants.locale_transition'
      : kind === 'page'
        ? 'page-records.page_transition'
        : expect.stringContaining(`${kind}.transition_denied`)
    expect(writes[0]).toMatchObject({
      collection: 'audit-events',
      data: { outcome: 'denied', event_type: eventType },
    })
    expect(writes[0]).not.toHaveProperty('req')
  })

  it('rejects a Money Page approval command that omits persisted editor separation facts', async () => {
    const hook = requireCanonicalCommandFor('locale')
    const req = {
      user: {
        id: 8,
        stable_id: '01J6R3W2V8W24Q10NRDBVGN3P9',
        identity_kind: 'human',
        roles: ['reviewer'],
        service_scopes: [],
      },
      payload: { create: async () => ({}) },
      context: {
        phase1CanonicalCommand: {
          expected_revision: 1,
          current_revision: 1,
          correlation_id: '01J6R3W2V8W24Q10NRDBVGN3P7',
          at: '2026-08-23T00:00:00.000Z',
          from: 'review',
          to: 'approved',
          actor: { type: 'user', id: '01J6R3W2V8W24Q10NRDBVGN3P9' },
          actor_role: 'reviewer',
          reason_code: 'review_complete',
          guard: { money_page: true },
        },
      },
    }
    await expect(hook({
      operation: 'update',
      data: { workflow_state: 'approved', revision: 2 },
      originalDoc: {
        stable_id: '01J6R3W2V8W24Q10NRDBVGN3P8',
        workflow_state: 'review',
        revision: 1,
        is_money_page: true,
        last_content_editor_stable_id: '01J6R3W2V8W24Q10NRDBVGN3P6',
        reviewed_by_stable_id: null,
      },
      req,
    } as never)).rejects.toThrow('Money Page facts')
  })

  it('server-maintains Money Page review evidence and audits the accepted command', async () => {
    const actorID = '01J6R3W2V8W24Q10NRDBVGN3P9'
    const writes: unknown[] = []
    const hook = requireCanonicalCommandFor('locale')
    const data = {
      workflow_state: 'approved',
      revision: 2,
      reviewed_by_stable_id: '01J6R3W2V8W24Q10NRDBVGN3P1',
      reviewed_revision: 99,
    }
    const req = {
      user: { id: 8, stable_id: actorID, identity_kind: 'human', roles: ['reviewer'], service_scopes: [] },
      payload: { create: async (value: unknown) => { writes.push(value); return {} } },
      context: {
        phase1CanonicalCommand: {
          expected_revision: 1,
          current_revision: 1,
          correlation_id: '01J6R3W2V8W24Q10NRDBVGN3P7',
          at: '2026-08-23T00:00:00.000Z',
          from: 'review',
          to: 'approved',
          actor: { type: 'user', id: actorID },
          actor_role: 'reviewer',
          reason_code: 'review_complete',
          guard: { money_page: true, last_content_editor_id: '01J6R3W2V8W24Q10NRDBVGN3P6' },
        },
      },
    }

    await expect(hook({
      operation: 'update',
      data,
      originalDoc: {
        stable_id: '01J6R3W2V8W24Q10NRDBVGN3P8',
        workflow_state: 'review',
        revision: 1,
        is_money_page: true,
        content_revision: 4,
        last_content_editor_stable_id: '01J6R3W2V8W24Q10NRDBVGN3P6',
        reviewed_by_stable_id: null,
      },
      req,
    } as never)).resolves.toMatchObject({
      reviewed_by_stable_id: actorID,
      reviewed_revision: 4,
    })
    expect(writes).toContainEqual(expect.objectContaining({
      collection: 'audit-events',
      data: expect.objectContaining({
        actor_stable_id: actorID,
        event_type: 'locale-variants.locale_transition',
        outcome: 'allowed',
        reason_code: 'review_complete',
      }),
      req,
    }))
  })

  it('uses an independent transaction for fail-closed denied high-risk audit writes', async () => {
    const auditWrites: unknown[] = []
    const req = {
      user: { id: 'editor-1', roles: ['editor'] },
      payload: {
        create: async (args: unknown) => {
          auditWrites.push(args)
          return {}
        },
      },
    }
    const access = payloadAccess('sources', 'update')

    await expect(
      access({
        req: req as never,
        data: { stable_id: 'source-1', rights_state: 'first_party' },
      }),
    ).resolves.toBe(false)
    expect(auditWrites).toHaveLength(1)
    expect(auditWrites[0]).toMatchObject({ collection: 'audit-events', overrideAccess: true })
    expect(auditWrites[0]).not.toHaveProperty('req')
  })

  it('does not treat an unchanged full-document rights field as a rights override', async () => {
    const req = {
      user: {
        id: 7,
        stable_id: '01J6R3W2V8W24Q10NRDBVGN3P9',
        identity_kind: 'human',
        roles: ['editor'],
        service_scopes: [],
      },
      payload: {
        create: async () => { throw new Error('unchanged rights must not emit a denied audit') },
        findByID: async () => ({ stable_id: 'source-1', rights_state: 'first_party' }),
      },
    }

    await expect(
      payloadAccess('sources', 'update')({
        id: 7,
        req: req as never,
        data: { stable_id: 'source-1', rights_state: 'first_party' },
      }),
    ).resolves.toBe(true)
  })

  it('classifies rights-basis changes as audited license changes', async () => {
    const auditWrites: unknown[] = []
    const req = {
      user: {
        id: 7,
        stable_id: '01J6R3W2V8W24Q10NRDBVGN3P9',
        identity_kind: 'human',
        roles: ['editor'],
        service_scopes: [],
      },
      payload: {
        create: async (args: unknown) => { auditWrites.push(args); return {} },
        findByID: async () => ({ stable_id: 'source-1', rights_basis: 'licensed' }),
      },
    }

    await expect(payloadAccess('sources', 'update')({
      id: 7,
      req: req as never,
      data: { stable_id: 'source-1', rights_basis: 'first_party' },
    })).resolves.toBe(false)
    expect(auditWrites).toContainEqual(expect.objectContaining({
      data: expect.objectContaining({ event_type: 'sources.license_change', outcome: 'denied' }),
    }))
  })

  it('uses the nested audit correlation ID for a denied high-risk Payload mutation', async () => {
    const auditWrites: unknown[] = []
    const correlationID = '01J6R3W2V8W24Q10NRDBVGN3P7'
    const req = {
      user: {
        id: 7,
        stable_id: '01J6R3W2V8W24Q10NRDBVGN3P9',
        identity_kind: 'human',
        roles: ['editor'],
        service_scopes: [],
      },
      payload: {
        create: async (args: unknown) => { auditWrites.push(args); return {} },
        findByID: async () => ({ stable_id: 'source-1', rights_state: 'first_party' }),
      },
    }

    await expect(payloadAccess('sources', 'update')({
      id: 7,
      req: req as never,
      data: {
        stable_id: 'source-1',
        rights_state: 'blocked',
        audit: { correlation_id: correlationID },
      },
    })).resolves.toBe(false)
    expect(auditWrites).toContainEqual(expect.objectContaining({
      data: expect.objectContaining({ correlation_id: correlationID }),
    }))
  })

  it('denies a numeric-ID user document from escalating its own stable identity', async () => {
    const stableID = '01J6R3W2V8W24Q10NRDBVGN3P9'
    const auditWrites: unknown[] = []
    const req = {
      user: {
        id: 7,
        stable_id: stableID,
        identity_kind: 'human',
        roles: ['admin'],
        service_scopes: [],
      },
      payload: {
        create: async (args: unknown) => { auditWrites.push(args); return {} },
        findByID: async () => ({ id: 7, stable_id: stableID, identity_kind: 'human', roles: ['admin'] }),
      },
    }

    await expect(
      payloadAccess('users', 'update')({
        id: 7,
        req: req as never,
        data: { id: 7, stable_id: stableID, identity_kind: 'human', roles: ['legal'] },
      }),
    ).resolves.toBe(false)
    expect(auditWrites).toHaveLength(1)
    expect(auditWrites[0]).toMatchObject({
      data: {
        event_type: 'users.identity_escalation',
        outcome: 'denied',
        prior_state: { identity_kind: 'human', roles: ['admin'] },
        new_state: { identity_kind: 'human', roles: ['legal'] },
      },
      overrideAccess: true,
    })
  })

  it('fails closed when the independent denied-audit write fails', async () => {
    const req = {
      user: { id: 'editor-1', roles: ['editor'] },
      payload: { create: async () => Promise.reject(new Error('audit sink unavailable')) },
    }

    await expect(
      payloadAccess('sources', 'update')({
        req: req as never,
        data: { stable_id: 'source-1', rights_state: 'first_party' },
      }),
    ).rejects.toThrow('audit sink unavailable')
  })

  it('uses exact locale reads with fallback disabled', () => {
    expect(exactLocaleRead('ja-JP')).toEqual({ locale: 'ja-JP', fallbackLocale: false })
  })

  it('denies self role/service-scope escalation and mixed service identities', () => {
    expect(
      decideAccess({
        principal: principals.admin,
        action: 'identity_escalation',
        resource: { collection: 'users', subjectId: principals.admin.id },
        path: 'internal',
      }),
    ).toMatchObject({ allowed: false })
    expect(
      decideAccess({
        principal: principals.admin,
        action: 'identity_escalation',
        resource: { collection: 'users', subjectId: 'other-user', requestedRoles: ['admin', 'legal'] },
        path: 'rest',
      }),
    ).toMatchObject({ allowed: false })
    expect(
      decideAccess({
        principal: { ...principals.editor, serviceScopes: ['publish'] },
        action: 'read',
        resource: { collection: 'sources' },
        path: 'graphql',
      }),
    ).toMatchObject({ allowed: false })
  })
})
