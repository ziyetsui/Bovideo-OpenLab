import { createHash } from 'node:crypto'

import type { LocalPublicationManifest } from '@/publication/manifest'
import { hashPublicationTree, stableJson } from '@/publication/manifest'
import { LocalCacheEmulator } from '@/publication/cache-emulator'
import { activatePublication } from '@/publication/activation'
import { emergencyWithdraw } from '@/publication/withdrawal'
import { rollbackPublication } from '@/publication/rollback'
import { LocalPublicationStore } from '@/publication/snapshot'

export type EvidenceStatus = 'PASS' | 'FAIL' | 'NOT_RUN_REMOTE'
export type ReleaseCheck = Readonly<{ name: string; status: 'PASS' | 'FAIL'; detail: string }>
export type RemoteReleaseBlocker = Readonly<{ name: string; status: 'NOT_RUN_REMOTE'; reason: string }>

export type DrillEvidence = Readonly<{
  name: 'rollback' | 'withdrawal'
  status: 'PASS' | 'FAIL'
  detail: string
  before: Readonly<Record<string, unknown>>
  after: Readonly<Record<string, unknown>>
  convergence_targets: readonly string[]
}>

export type LocalReleaseDrills = Readonly<{
  rollback: DrillEvidence
  withdrawal: DrillEvidence
}>

export type ReleaseEvidence = Readonly<{
  schema_version: 'p4-release-evidence-v1'
  release_version: number
  manifest_hash: string
  local_status: EvidenceStatus
  local_checks: readonly ReleaseCheck[]
  drills: LocalReleaseDrills
  remote_blockers: readonly RemoteReleaseBlocker[]
  release_bundle_hash: `sha256:p4-release-v1:${string}`
}>

const hash = (value: string): `sha256:p4-release-v1:${string}` => `sha256:p4-release-v1:${createHash('sha256').update(value, 'utf8').digest('hex')}`
const failedDrill = (name: DrillEvidence['name'], detail: string): DrillEvidence => Object.freeze({ name, status: 'FAIL', detail, before: Object.freeze({}), after: Object.freeze({}), convergence_targets: Object.freeze([]) })

const defaultRemoteBlockers: readonly RemoteReleaseBlocker[] = Object.freeze([
  { name: 'github_organization_publication', status: 'NOT_RUN_REMOTE', reason: 'requires production GitHub credentials and an explicit repository target' },
  { name: 'google_search_console', status: 'NOT_RUN_REMOTE', reason: 'requires a verified production property and owner approval' },
  { name: 'production_indexing', status: 'NOT_RUN_REMOTE', reason: 'Phase 5 cohort activation is the production indexing gate' },
  { name: 'multi_region_convergence', status: 'NOT_RUN_REMOTE', reason: 'local logical contexts are not a multi-region deployment proof' },
])

function assertManifestPair(previousManifest: LocalPublicationManifest, currentManifest: LocalPublicationManifest): void {
  if (previousManifest.snapshot.publish_version >= currentManifest.snapshot.publish_version) throw new Error('rollback drill requires an older verified manifest')
  if (previousManifest.routes.length === 0 || currentManifest.routes.length === 0) throw new Error('withdrawal drill requires at least one route locale')
}

/**
 * Runs the rollback and rights-withdrawal drills against the same local
 * transaction-shaped store used by the P2 write plane.  No network client is
 * created by this helper; the result is evidence, not production proof.
 */
export function runLocalReleaseDrills(input: Readonly<{ previousManifest: LocalPublicationManifest; currentManifest: LocalPublicationManifest; locale?: string; correlationId?: string; at?: string }>): LocalReleaseDrills {
  assertManifestPair(input.previousManifest, input.currentManifest)
  const locale = input.locale ?? input.previousManifest.routes[0]!.locale
  const correlationId = input.correlationId ?? `p4-drill-${input.currentManifest.snapshot.publish_version}`
  const at = input.at ?? '2026-08-25T00:00:00.000Z'
  const store = new LocalPublicationStore()
  const cache = new LocalCacheEmulator()
  try {
    store.seedValidated(input.previousManifest)
    activatePublication({ store, cache, manifest: input.previousManifest, expectedRevision: 0, correlationId: `${correlationId}-previous`, at })
    store.seedValidated(input.currentManifest)
    activatePublication({ store, cache, manifest: input.currentManifest, expectedRevision: 1, correlationId: `${correlationId}-current`, at })
    const beforeRollback = store.pointer()
    const rollback = rollbackPublication({ store, cache, expectedRevision: beforeRollback.revision, correlationId: `${correlationId}-rollback`, at })
    const rollbackEvidence: DrillEvidence = Object.freeze({
      name: 'rollback', status: rollback.pointer.publish_version === input.previousManifest.snapshot.publish_version && rollback.rolledBack.status === 'rolled_back' ? 'PASS' : 'FAIL',
      detail: 'previous verified publication was reactivated atomically',
      before: Object.freeze({ active_version: input.currentManifest.snapshot.publish_version, previous_verified_version: input.previousManifest.snapshot.publish_version }),
      after: Object.freeze({ active_version: rollback.pointer.publish_version, rolled_back_version: rollback.rolledBack.publish_version, rolled_back_status: rollback.rolledBack.status }),
      convergence_targets: Object.freeze(['publication_pointer', 'publication_snapshot', 'route_cache', 'sitemap_pointer']),
    })
    const withdrawal = emergencyWithdraw({ store, cache, publishVersion: input.previousManifest.snapshot.publish_version, locales: [locale], correlationId: `${correlationId}-withdrawal`, at })
    const withdrawalEvidence: DrillEvidence = Object.freeze({
      name: 'withdrawal', status: withdrawal.tombstone.status === 'withdrawn' && withdrawal.record.withdrawn_locales.includes(locale) ? 'PASS' : 'FAIL',
      detail: 'rights withdrawal emitted a tombstone and converged the local cache',
      before: Object.freeze({ active_version: input.previousManifest.snapshot.publish_version, locale }),
      after: Object.freeze({ status: withdrawal.record.status, withdrawn_locales: withdrawal.record.withdrawn_locales, tombstone_id: withdrawal.tombstone.id }),
      convergence_targets: Object.freeze(['derived_page', 'publication_snapshot', 'sitemap', 'public_export', 'route_cache', 'tombstone']),
    })
    return Object.freeze({ rollback: rollbackEvidence, withdrawal: withdrawalEvidence })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return Object.freeze({ rollback: failedDrill('rollback', detail), withdrawal: failedDrill('withdrawal', `drill did not reach withdrawal: ${detail}`) })
  }
}

const baseEvidence = (input: Readonly<{
  releaseVersion: number
  manifestHash: string
  localChecks?: readonly ReleaseCheck[]
  drills?: LocalReleaseDrills
  remoteBlockers?: readonly RemoteReleaseBlocker[]
}>): Omit<ReleaseEvidence, 'release_bundle_hash'> => {
  if (!Number.isSafeInteger(input.releaseVersion) || input.releaseVersion < 1) throw new Error('release version must be a positive integer')
  if (input.manifestHash.length === 0) throw new Error('release evidence requires a manifest hash')
  const checks = Object.freeze([...(input.localChecks ?? [])])
  const requiredChecks = ['secret_scan', 'pii_scan', 'rights_scan', 'route_scan'] as const
  const checkNames = new Set(checks.map((check) => check.name))
  const missingChecks = requiredChecks.filter((name) => !checkNames.has(name))
  if (missingChecks.length > 0) throw new Error(`release evidence is missing required checks: ${missingChecks.join(',')}`)
  if (input.remoteBlockers !== undefined && input.remoteBlockers.length === 0) throw new Error('release evidence requires explicit remote NOT_RUN_REMOTE blockers')
  const remoteBlockers = input.remoteBlockers ?? defaultRemoteBlockers
  const requiredRemoteNames = defaultRemoteBlockers.map((blocker) => blocker.name)
  const missingRemote = requiredRemoteNames.filter((name) => !remoteBlockers.some((blocker) => blocker.name === name && blocker.status === 'NOT_RUN_REMOTE'))
  if (missingRemote.length > 0) throw new Error(`release evidence is missing remote blockers: ${missingRemote.join(',')}`)
  const drills = input.drills ?? Object.freeze({ rollback: failedDrill('rollback', 'rollback drill evidence was not supplied'), withdrawal: failedDrill('withdrawal', 'withdrawal drill evidence was not supplied') })
  const localStatus: EvidenceStatus = checks.every((check) => check.status === 'PASS') && drills.rollback.status === 'PASS' && drills.withdrawal.status === 'PASS' ? 'PASS' : 'FAIL'
  return {
    schema_version: 'p4-release-evidence-v1', release_version: input.releaseVersion, manifest_hash: input.manifestHash,
    local_status: localStatus, local_checks: checks, drills,
    remote_blockers: Object.freeze([...remoteBlockers]),
  }
}

export function buildReleaseEvidence(input: Readonly<Parameters<typeof baseEvidence>[0]>): ReleaseEvidence {
  const evidence = baseEvidence(input)
  const releaseBundleHash = hash(stableJson(evidence))
  return Object.freeze({ ...evidence, release_bundle_hash: releaseBundleHash })
}

export const createReleaseEvidence = buildReleaseEvidence

export function hashReleaseEvidence(evidence: ReleaseEvidence): `sha256:p4-release-v1:${string}` {
  const { release_bundle_hash: _ignored, ...withoutHash } = evidence
  return hash(stableJson(withoutHash))
}

export function assertReleaseEvidence(evidence: ReleaseEvidence): void {
  if (evidence.release_bundle_hash !== hashReleaseEvidence(evidence)) throw new Error('release evidence bundle hash mismatch')
  if (evidence.local_status !== 'PASS') throw new Error('local release evidence is not passing')
  if (evidence.remote_blockers.some((blocker) => blocker.status !== 'NOT_RUN_REMOTE')) throw new Error('remote release status must remain explicit NOT_RUN_REMOTE')
}

export const releaseEvidenceTreeHash = (evidence: ReleaseEvidence): string => hashPublicationTree([{ path: 'release-evidence.json', bytes: stableJson(evidence) }])
