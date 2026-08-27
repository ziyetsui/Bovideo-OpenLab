import { describe, expect, it } from 'vitest';
import { GraphElevationService, type GraphArtifactInput, type GraphSourceEvidence } from '../../../src/graph/elevation';

const artifact = (artifactId: string, sourceId: string): GraphArtifactInput => ({
  artifactId,
  sourceId,
  sourceVersion: 'sha256:v1:' + 'b'.repeat(64),
  rightsState: 'first_party',
  safetyState: 'approved',
});

const source = (sourceId: string, rightsState: GraphSourceEvidence['rightsState'] = 'first_party'): GraphSourceEvidence => ({
  sourceId,
  revision: 'sha256:v1:' + 'b'.repeat(64),
  rightsState,
  available: true,
});

const service = (artifacts: readonly GraphArtifactInput[], sources: readonly GraphSourceEvidence[]) => new GraphElevationService({
  artifacts: () => artifacts,
  sources: () => sources,
});

describe('P2-T02 graph elevation contracts', () => {
  it('creates deterministic candidate edges bound to immutable source evidence', async () => {
    const edge = await service([artifact('artifact-a', 'source-a'), artifact('artifact-b', 'source-b')], [source('source-a'), source('source-b')]).elevate({
      fromArtifactId: 'artifact-a',
      toArtifactId: 'artifact-b',
      relation: 'used_for',
      confidence: 0.8,
    });
    expect(edge.reviewState).toBe('candidate');
    expect(edge.evidenceRefs).toEqual([{ sourceId: 'source-a', revision: 'sha256:v1:' + 'b'.repeat(64) }, { sourceId: 'source-b', revision: 'sha256:v1:' + 'b'.repeat(64) }]);
    expect(edge.id).toBe((await service([artifact('artifact-a', 'source-a'), artifact('artifact-b', 'source-b')], [source('source-a'), source('source-b')]).elevate({ fromArtifactId: 'artifact-a', toArtifactId: 'artifact-b', relation: 'used_for', confidence: 0.8 })).id);
  });

  it('rejects missing source evidence and emits no candidate edge', async () => {
    await expect(service([artifact('artifact-a', 'source-a'), artifact('artifact-b', 'source-b')], [source('source-a')]).elevate({
      fromArtifactId: 'artifact-a', toArtifactId: 'artifact-b', relation: 'used_for', confidence: 0.8,
    })).rejects.toMatchObject({ code: 'missing_evidence' });
  });

  it('rejects a client artifact hash that does not match server source evidence', async () => {
    await expect(service([{ ...artifact('artifact-a', 'source-a'), sourceVersion: 'sha256:v1:' + 'a'.repeat(64) }, artifact('artifact-b', 'source-b')], [source('source-a'), source('source-b')]).elevate({
      fromArtifactId: 'artifact-a', toArtifactId: 'artifact-b', relation: 'used_for', confidence: 0.8,
    })).rejects.toMatchObject({ code: 'evidence_revision_mismatch' });
  });

  it.each(['blocked', 'revoked', 'unknown'] as const)('rejects %s rights from candidate elevation', async (rightsState) => {
    await expect(service([artifact('artifact-a', 'source-a'), artifact('artifact-b', 'source-b')], [source('source-a', rightsState), source('source-b')]).elevate({
      fromArtifactId: 'artifact-a', toArtifactId: 'artifact-b', relation: 'used_for', confidence: 0.8,
    })).rejects.toMatchObject({ code: 'rights_blocked' });
  });
});
