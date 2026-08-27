import { describe, expect, it } from 'vitest'

import { completeDetailFixture } from '../../phase2/fixtures/detail/complete'
import { buildLocalPublicationManifest } from '@/publication/manifest'
import { assertReleaseEvidence, buildReleaseEvidence, hashReleaseEvidence, runLocalReleaseDrills } from '@/ops/release-evidence'

const makeManifest = (version: 2 | 3) => buildLocalPublicationManifest({
  label: version === 2 ? 'P2L-B1' : 'P2L-B2', publishVersion: version,
  routes: completeDetailFixture.pages.map((page, index) => ({ ...completeDetailFixture.route, locale: page.locale, path: `/${page.locale}/prompts/record-${String(index + 1).padStart(2, '0')}-00000000-0000-4000-8000-000000000001` })),
  routeFiles: completeDetailFixture.pages.map((page) => ({ path: `routes/${page.locale}/detail.json`, bytes: JSON.stringify(page) })),
  exportFiles: [{ path: 'export/records/record-001.json', bytes: '{"id":"record-001"}\n' }],
})

describe('P4 release evidence', () => {
  it('records local rollback and withdrawal drills and keeps remote blockers explicit', () => {
    const drills = runLocalReleaseDrills({ previousManifest: makeManifest(2), currentManifest: makeManifest(3), locale: 'en' })
    expect(drills.rollback.status).toBe('PASS')
    expect(drills.withdrawal.status).toBe('PASS')
    const evidence = buildReleaseEvidence({ releaseVersion: 3, manifestHash: makeManifest(3).payloadTreeHash, localChecks: [
      { name: 'secret_scan', status: 'PASS', detail: 'no secrets' },
      { name: 'pii_scan', status: 'PASS', detail: 'no PII' },
      { name: 'rights_scan', status: 'PASS', detail: 'allow-list enforced' },
      { name: 'route_scan', status: 'PASS', detail: 'canonical routes only' },
    ], drills })
    expect(evidence.local_status).toBe('PASS')
    expect(evidence.remote_blockers.every((blocker) => blocker.status === 'NOT_RUN_REMOTE')).toBe(true)
    expect(evidence.release_bundle_hash).toBe(hashReleaseEvidence(evidence))
    expect(() => assertReleaseEvidence(evidence)).not.toThrow()
  })

  it('fails closed when local checks or drill evidence is missing', () => {
    expect(() => buildReleaseEvidence({ releaseVersion: 4, manifestHash: 'sha256:test', localChecks: [{ name: 'secret_scan', status: 'FAIL', detail: 'fixture secret' }] })).toThrow(/missing required checks/i)
  })

  it('rejects an explicitly empty remote blocker list', () => {
    expect(() => buildReleaseEvidence({ releaseVersion: 5, manifestHash: 'sha256:test', localChecks: [
      { name: 'secret_scan', status: 'PASS', detail: 'ok' }, { name: 'pii_scan', status: 'PASS', detail: 'ok' },
      { name: 'rights_scan', status: 'PASS', detail: 'ok' }, { name: 'route_scan', status: 'PASS', detail: 'ok' },
      ], remoteBlockers: [] })).toThrow(/remote/i)
  })
})
