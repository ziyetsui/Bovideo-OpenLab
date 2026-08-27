import { describe, expect, it } from 'vitest'

import { P3_GOLDEN_FIXTURES } from '@/page/fixtures'
import { buildPhase4ReleaseCandidate } from '@/seo/release-candidate'
import { buildReleaseEvidence } from '@/ops/release-evidence'
import type { ReleaseEvidence } from '@/ops/release-evidence'
import type { SitemapRouteCandidate } from '@/seo/sitemap'

const page = { ...P3_GOLDEN_FIXTURES.hub.complete, index_state: 'indexable' as const }
const route: SitemapRouteCandidate = {
  route: page.route, canonicalPath: page.route, locale: page.locale, family: page.page_type, status: 200, indexable: true,
  contentHash: page.content_hash, linkHash: 'sha256:v1:links', schemaHash: 'sha256:v1:schema', lastModified: '2026-08-25T00:00:00.000Z',
}

describe('Phase 4 local release candidate bundle', () => {
  const passingDrills = {
    rollback: { name: 'rollback' as const, status: 'PASS' as const, detail: 'ok', before: {}, after: {}, convergence_targets: [] },
    withdrawal: { name: 'withdrawal' as const, status: 'PASS' as const, detail: 'ok', before: {}, after: {}, convergence_targets: [] },
  }

  it('passes the full local chain while preserving remote NOT_RUN_REMOTE blockers', () => {
    const evidence = buildReleaseEvidence({ releaseVersion: 1, manifestHash: 'sha256:test', localChecks: [
      { name: 'secret_scan', status: 'PASS', detail: 'ok' }, { name: 'pii_scan', status: 'PASS', detail: 'ok' },
      { name: 'rights_scan', status: 'PASS', detail: 'ok' }, { name: 'route_scan', status: 'PASS', detail: 'ok' },
    ], drills: passingDrills })
    const candidate = buildPhase4ReleaseCandidate({ releaseVersion: 1, pages: [page], routeCandidates: [route], exportRecords: [], evidence })
    expect(candidate.status).toBe('PASS')
    expect(candidate.evidence.remote_blockers.every((blocker) => blocker.status === 'NOT_RUN_REMOTE')).toBe(true)
  })

  it('fails closed when a local audit or evidence gate is not passing', () => {
    const evidence = buildReleaseEvidence({ releaseVersion: 1, manifestHash: 'sha256:test', localChecks: [
      { name: 'secret_scan', status: 'PASS', detail: 'ok' }, { name: 'pii_scan', status: 'PASS', detail: 'ok' },
      { name: 'rights_scan', status: 'PASS', detail: 'ok' }, { name: 'route_scan', status: 'FAIL', detail: 'fixture' },
    ], drills: passingDrills })
    expect(() => buildPhase4ReleaseCandidate({ releaseVersion: 1, pages: [page], routeCandidates: [route], exportRecords: [], evidence })).toThrow(/not passing/i)
  })

  it('fails closed when no canonical Sitemap route is available', () => {
    const evidence = buildReleaseEvidence({ releaseVersion: 1, manifestHash: 'sha256:test', localChecks: [
      { name: 'secret_scan', status: 'PASS', detail: 'ok' }, { name: 'pii_scan', status: 'PASS', detail: 'ok' },
      { name: 'rights_scan', status: 'PASS', detail: 'ok' }, { name: 'route_scan', status: 'PASS', detail: 'ok' },
    ], drills: passingDrills })
    const candidate = buildPhase4ReleaseCandidate({ releaseVersion: 1, pages: [page], routeCandidates: [], exportRecords: [], evidence })
    expect(candidate.status).toBe('FAIL')
    expect(candidate.blockers).toContain('sitemap_empty')
  })

  it('requires bidirectional page-to-route-manifest parity', () => {
    const evidence = buildReleaseEvidence({ releaseVersion: 1, manifestHash: 'sha256:test', localChecks: [
      { name: 'secret_scan', status: 'PASS', detail: 'ok' }, { name: 'pii_scan', status: 'PASS', detail: 'ok' },
      { name: 'rights_scan', status: 'PASS', detail: 'ok' }, { name: 'route_scan', status: 'PASS', detail: 'ok' },
    ], drills: passingDrills })
    const orphanRoute = { ...route, route: '/en/prompts/orphan', canonicalPath: '/en/prompts/orphan' }
    const candidate = buildPhase4ReleaseCandidate({ releaseVersion: 1, pages: [page], routeCandidates: [orphanRoute], exportRecords: [], evidence })
    expect(candidate.status).toBe('FAIL')
    expect(candidate.blockers).toEqual(expect.arrayContaining(['manifest_missing_page:/en/prompts', 'manifest_route_not_audited:/en/prompts/orphan']))
  })

  it('rejects forged release evidence before assembling a candidate', () => {
    const forged = { release_version: 1, local_status: 'PASS', release_bundle_hash: 'bad', local_checks: [], drills: {}, remote_blockers: [] } as unknown as ReleaseEvidence
    expect(() => buildPhase4ReleaseCandidate({ releaseVersion: 1, pages: [page], routeCandidates: [route], exportRecords: [], evidence: forged })).toThrow(/hash|passing|remote/i)
  })
})
