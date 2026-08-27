import {
  DELETION_STATES,
  LOCALE_WORKFLOW_STATES,
  PAGE_INDEX_STATES,
  PUBLICATION_STATES,
  decideDeletionTransition,
  decideLocaleTransition,
  decidePageTransition,
  decidePublicationTransition,
} from '@/contracts/index'
import { describe, expect, it } from 'vitest'

import { UUID_A, UUID_B, UUID_C } from '../fixtures/contracts'

const base = {
  expected_revision: 3,
  current_revision: 3,
  correlation_id: UUID_B,
  at: '2026-08-23T12:34:56.000Z',
  reason_code: 'state_change',
}

const localeLegal = new Set([
  'missing:machine_draft',
  'machine_draft:review',
  'machine_draft:blocked',
  'machine_draft:stale',
  'review:blocked',
  'review:stale',
  'blocked:review',
  'stale:review',
  'review:approved',
  'approved:published',
  'approved:stale',
  'published:stale',
  'published:withdrawn',
  'stale:withdrawn',
  'blocked:withdrawn',
])

const pageLegal = new Set([
  'not_generated:discoverable_noindex',
  'discoverable_noindex:index_candidate',
  'index_candidate:indexable',
  'indexable:discoverable_noindex',
  'discoverable_noindex:retired',
  'index_candidate:retired',
  'indexable:retired',
])

const publicationLegal = new Set([
  'draft:preparing',
  'preparing:validated',
  'preparing:failed',
  'validated:active',
  'validated:failed',
  'active:superseded',
  'active:rolled_back',
  'superseded:active',
])

const deletionLegal = new Set([
  'received:validated',
  'received:rejected',
  'received:cancelled',
  'validated:withdrawing',
  'validated:cancelled',
  'withdrawing:surfaces_pending',
  'withdrawing:completed',
  'surfaces_pending:completed',
])

const publicationState = (
  publishVersion: number,
  status: (typeof PUBLICATION_STATES)[number],
  revision = 3,
) => ({
  publish_version: publishVersion,
  revision,
  status,
  reason_code: null,
  activated_at: null,
  updated_at: '2026-08-23T12:34:56.000Z',
  correlation_id: UUID_B,
})

describe('canonical state decisions', () => {
  it.each(
    LOCALE_WORKFLOW_STATES.flatMap((from) =>
      LOCALE_WORKFLOW_STATES.map((to) => [from, to] as const),
    ),
  )('exhaustively decides locale pair %s → %s', (from, to) => {
    const key = `${from}:${to}`
    const guards = {
      protected_spans_valid: true,
      qa_result_id: UUID_C,
      reason_code: 'state_change',
      new_content_revision: true,
      resolved_reason: true,
      last_content_editor_id: UUID_C,
      money_page: true,
      approved_revision_unchanged: true,
      reviewer_id: UUID_C,
      source_hash_changed: true,
      withdrawal_request_id: UUID_C,
    }
    const role =
      from === 'missing'
        ? 'translator_service'
        : from === 'machine_draft' && to === 'review'
          ? 'translator'
          : from === 'review' && to === 'approved'
            ? 'reviewer'
            : from === 'approved' && to === 'published'
              ? 'publisher'
              : to === 'stale'
                ? 'system'
                : to === 'withdrawn'
                  ? 'withdraw_service'
                  : to === 'blocked'
                    ? 'qa_service'
                    : 'translator'
    expect(
      decideLocaleTransition({
        ...base,
        from,
        to,
        actor: { type: 'service', id: UUID_A },
        actor_role: role,
        guard: guards,
      }),
    ).toMatchObject({ allowed: localeLegal.has(key) })
  })

  it.each(PAGE_INDEX_STATES.flatMap((from) => PAGE_INDEX_STATES.map((to) => [from, to] as const)))(
    'exhaustively decides page pair %s → %s',
    (from, to) => {
      const key = `${from}:${to}`
      const role =
        from === 'not_generated' && to === 'discoverable_noindex'
          ? 'editor'
          : to === 'index_candidate'
            ? 'reviewer'
            : 'publisher'
      expect(
        decidePageTransition({
          ...base,
          from,
          to,
          actor: { type: 'user', id: UUID_A },
          actor_role: role,
          reason_code: 'qualified',
          metrics_input_hash:
            'sha256:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          guard: {
            five_gates_recorded: true,
            locale_and_rights_eligible: true,
            validators_passed: true,
            redirect_or_410_decided: true,
          },
        }),
      ).toMatchObject({ allowed: pageLegal.has(key) })
    },
  )

  it.each(
    PUBLICATION_STATES.flatMap((from) => PUBLICATION_STATES.map((to) => [from, to] as const)),
  )('exhaustively decides publication pair %s → %s', (from, to) => {
    const key = `${from}:${to}`
    const subjectPublishVersion = from === 'superseded' ? 2 : from === 'active' ? 4 : 5
    expect(
      decidePublicationTransition({
        ...base,
        from,
        to,
        subject_state: publicationState(subjectPublishVersion, from),
        active_pointer: { publish_version: 4, previous_verified_version: 2, revision: 3 },
        actor: { type: 'service', id: UUID_A },
        actor_role: 'publisher_service',
        reason_code: 'publish',
        guard: {
          publisher_principal_authorized: true,
          activation_plan: {
            mode: 'replacement',
            current_active_state: publicationState(4, 'active', 3),
            activating_state: publicationState(5, 'validated', 3),
            previous_verified_state: publicationState(2, 'superseded', 3),
            pointer_expected_revision: 3,
            pointer_expected_publish_version: 4,
          },
          atomic_rollback: {
            failed_current_active_state: publicationState(4, 'active', 3),
            previous_verified_state: publicationState(2, 'superseded', 3),
            pointer_expected_revision: 3,
            pointer_expected_publish_version: 4,
            pointer_expected_previous_verified_version: 2,
          },
        },
      }),
    ).toMatchObject({ allowed: publicationLegal.has(key) })
  })

  it.each(DELETION_STATES.flatMap((from) => DELETION_STATES.map((to) => [from, to] as const)))(
    'exhaustively decides deletion pair %s → %s',
    (from, to) => {
      const key = `${from}:${to}`
      const role =
        to === 'completed'
          ? 'publisher'
          : to === 'withdrawing' || to === 'surfaces_pending'
            ? 'withdraw_service'
            : 'legal'
      expect(
        decideDeletionTransition({
          ...base,
          from,
          to,
          actor: { type: 'user', id: UUID_A },
          actor_role: role,
          reason_code: 'request',
          guard: { emergency_withdraw_job_created: true },
        }),
      ).toMatchObject({ allowed: deletionLegal.has(key) })
    },
  )

  it('rejects missing command metadata, stale revisions, and guard failures without records', () => {
    expect(
      decideLocaleTransition({
        ...base,
        from: 'missing',
        to: 'machine_draft',
        actor: { type: 'service', id: UUID_A },
        actor_role: 'translator_service',
        guard: { protected_spans_valid: true },
        correlation_id: '',
      }),
    ).toMatchObject({ allowed: false })
    expect(
      decidePageTransition({
        ...base,
        current_revision: 4,
        from: 'index_candidate',
        to: 'indexable',
        actor: { type: 'user', id: UUID_A },
        actor_role: 'publisher',
        reason_code: 'qualified',
        metrics_input_hash:
          'sha256:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        guard: { validators_passed: true },
      }),
    ).toMatchObject({ allowed: false, code: 'version_conflict' })
    expect(
      decidePublicationTransition({
        ...base,
        from: 'validated',
        to: 'active',
        subject_state: publicationState(5, 'validated'),
        active_pointer: { publish_version: 4, previous_verified_version: 2, revision: 3 },
        actor: { type: 'service', id: UUID_A },
        actor_role: 'publisher_service',
        reason_code: 'activate',
        guard: {
          publisher_principal_authorized: false,
          activation_plan: {
            mode: 'replacement',
            current_active_state: publicationState(4, 'active', 2),
            activating_state: publicationState(5, 'validated', 3),
            previous_verified_state: publicationState(2, 'superseded', 3),
            pointer_expected_revision: 3,
            pointer_expected_publish_version: 4,
          },
        },
      }),
    ).toMatchObject({ allowed: false })
  })

  it.each([
    [
      'validated activation pointer version mismatch',
      {
        from: 'validated',
        to: 'active',
        subject_state: publicationState(5, 'validated'),
        active_pointer: { publish_version: 4, previous_verified_version: 2, revision: 3 },
        guard: {
          publisher_principal_authorized: true,
          activation_plan: {
            mode: 'replacement',
            current_active_state: publicationState(4, 'active', 2),
            activating_state: publicationState(5, 'validated', 3),
            previous_verified_state: publicationState(2, 'superseded', 3),
            pointer_expected_revision: 3,
            pointer_expected_publish_version: 99,
          },
        },
      },
    ],
    [
      'active rollback missing atomic plan',
      {
        from: 'active',
        to: 'rolled_back',
        subject_state: publicationState(4, 'active'),
        active_pointer: { publish_version: 4, previous_verified_version: 2, revision: 3 },
        guard: { publisher_principal_authorized: true },
      },
    ],
    [
      'superseded reactivation wrong previous verified target',
      {
        from: 'superseded',
        to: 'active',
        subject_state: publicationState(3, 'superseded'),
        active_pointer: { publish_version: 4, previous_verified_version: 2, revision: 3 },
        guard: {
          publisher_principal_authorized: true,
          atomic_rollback: {
            failed_current_active_state: publicationState(4, 'active', 2),
            previous_verified_state: publicationState(3, 'superseded', 2),
            pointer_expected_revision: 3,
            pointer_expected_publish_version: 4,
            pointer_expected_previous_verified_version: 2,
          },
        },
      },
    ],
    [
      'rollback stale active revision',
      {
        from: 'active',
        to: 'rolled_back',
        subject_state: publicationState(4, 'active', 1),
        active_pointer: { publish_version: 4, previous_verified_version: 2, revision: 3 },
        guard: {
          publisher_principal_authorized: true,
          atomic_rollback: {
            failed_current_active_state: publicationState(4, 'active', 2),
            previous_verified_state: publicationState(2, 'superseded', 2),
            pointer_expected_revision: 3,
            pointer_expected_publish_version: 4,
            pointer_expected_previous_verified_version: 2,
          },
        },
      },
    ],
  ])('rejects %s', (_name, transition) => {
    expect(
      decidePublicationTransition({
        ...base,
        ...transition,
        actor: { type: 'service', id: UUID_A },
        actor_role: 'publisher_service',
        reason_code: 'publish',
      }),
    ).toMatchObject({ allowed: false })
  })

  it('allows bootstrap activation only with an explicit absent-pointer CAS contract', () => {
    expect(
      decidePublicationTransition({
        ...base,
        from: 'validated',
        to: 'active',
        subject_state: publicationState(1, 'validated'),
        active_pointer: { publish_version: null, previous_verified_version: null, revision: 0 },
        actor: { type: 'service', id: UUID_A },
        actor_role: 'publisher_service',
        guard: {
          publisher_principal_authorized: true,
          activation_plan: {
            mode: 'bootstrap',
            current_active_state: null,
            activating_state: publicationState(1, 'validated'),
            previous_verified_state: null,
            pointer_expected_revision: 0,
          },
        },
      }),
    ).toMatchObject({ allowed: true })
  })

  it.each([
    [
      'bootstrap activation with a smuggled previous state',
      {
        from: 'validated',
        to: 'active',
        subject_state: publicationState(1, 'validated'),
        active_pointer: { publish_version: null, previous_verified_version: null, revision: 0 },
        guard: {
          publisher_principal_authorized: true,
          activation_plan: {
            mode: 'bootstrap',
            current_active_state: publicationState(4, 'active'),
            activating_state: publicationState(1, 'validated'),
            previous_verified_state: null,
            pointer_expected_revision: 0,
          },
        },
      },
    ],
    [
      'replacement activation without a previous active state',
      {
        from: 'validated',
        to: 'active',
        subject_state: publicationState(5, 'validated'),
        active_pointer: { publish_version: 4, previous_verified_version: 2, revision: 3 },
        guard: {
          publisher_principal_authorized: true,
          activation_plan: {
            mode: 'replacement',
            current_active_state: null,
            activating_state: publicationState(5, 'validated'),
            previous_verified_state: publicationState(2, 'superseded'),
            pointer_expected_revision: 3,
            pointer_expected_publish_version: 4,
          },
        },
      },
    ],
  ])('rejects %s', (_name, transition) => {
    expect(
      decidePublicationTransition({
        ...base,
        ...transition,
        actor: { type: 'service', id: UUID_A },
        actor_role: 'publisher_service',
        reason_code: 'activate',
      }),
    ).toMatchObject({ allowed: false })
  })
})
