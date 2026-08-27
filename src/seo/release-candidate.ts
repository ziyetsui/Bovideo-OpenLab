import type { PageEnvelope } from '@/page/schema'
import { buildPublicReleaseManifest, type PublicReleaseManifest, type PublicReleaseRecord } from '@/exporter/public-release'
import { assertReleaseEvidence, type ReleaseEvidence } from '@/ops/release-evidence'
import { auditReleasePages, type ReleasePageAudit } from './release-audit'
import { buildVersionedSitemap, type SitemapRouteCandidate, type VersionedSitemap } from './sitemap'

export type Phase4ReleaseCandidate = Readonly<{
  schema_version: 'p4-release-candidate-v1'
  release_version: number
  status: 'PASS' | 'FAIL'
  audit: ReleasePageAudit
  sitemap: VersionedSitemap
  publicRelease: PublicReleaseManifest
  evidence: ReleaseEvidence
  blockers: readonly string[]
}>

/** Assemble the local release candidate from the same page, route, export and
 * evidence artifacts that are reviewed at the Phase 4 boundary. */
export const buildPhase4ReleaseCandidate = (input: Readonly<{
  releaseVersion: number
  pages: readonly PageEnvelope[]
  routeCandidates: readonly SitemapRouteCandidate[]
  exportRecords: readonly PublicReleaseRecord[]
  evidence: ReleaseEvidence
}>): Phase4ReleaseCandidate => {
  assertReleaseEvidence(input.evidence)
  if (input.evidence.release_version !== input.releaseVersion) throw new Error('release evidence version must match release candidate')
  const audit = auditReleasePages(input.pages)
  const sitemap = buildVersionedSitemap({ publishVersion: input.releaseVersion, origin: 'https://preview.example.test', routes: input.routeCandidates })
  const publicRelease = buildPublicReleaseManifest({ releaseVersion: input.releaseVersion, records: input.exportRecords })
  const normalizeRoute = (route: string): string => route === '/' ? route : route.replace(/\/+$/, '')
  const auditedPageRoutes = new Set(input.pages.filter((page) => page.index_state === 'indexable').map((page) => normalizeRoute(page.route)))
  const manifestRoutes = new Set(input.routeCandidates.filter((candidate) => candidate.status === 200 && candidate.indexable && candidate.sitemapEligible !== false).map((candidate) => normalizeRoute(candidate.route)))
  const missingFromManifest = [...auditedPageRoutes].filter((route) => !manifestRoutes.has(route)).sort()
  const notAuditedByPages = [...manifestRoutes].filter((route) => !auditedPageRoutes.has(route)).sort()
  const blockers = [
    ...(audit.status === 'PASS' ? [] : audit.errors.map((error) => `audit:${error}`)),
    ...missingFromManifest.map((route) => `manifest_missing_page:${route}`),
    ...notAuditedByPages.map((route) => `manifest_route_not_audited:${route}`),
    ...(sitemap.urlCount > 0 ? [] : ['sitemap_empty']),
    ...(sitemap.excludedRoutes.length === 0 ? [] : sitemap.excludedRoutes.map((route) => `sitemap_excluded:${route.route}:${route.reason}`)),
    ...(input.evidence.local_status === 'PASS' ? [] : ['local_evidence_not_passing']),
    // Remote blockers are intentionally informational in this local phase;
    // they remain explicit in `evidence.remote_blockers` and must not turn a
    // passing deterministic local bundle into a false local failure.
  ]
  return Object.freeze({
    schema_version: 'p4-release-candidate-v1', release_version: input.releaseVersion,
    status: blockers.length === 0 ? 'PASS' : 'FAIL', audit, sitemap, publicRelease, evidence: input.evidence,
    blockers: Object.freeze(blockers),
  })
}

export const createPhase4ReleaseCandidate = buildPhase4ReleaseCandidate
