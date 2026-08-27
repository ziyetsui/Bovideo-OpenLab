import { describe, expect, it } from 'vitest';
import { CandidateEdgeReviewService, type CandidateEdgeReviewCommand, type ReviewEdge } from '../../../src/graph/review';

const edge = (overrides: Partial<ReviewEdge> = {}): ReviewEdge => ({
  id: 'edge-001',
  revision: 1,
  proposerId: 'elevation-service',
  reviewState: 'candidate',
  evidenceRefs: [{ sourceId: 'source-a', revision: 'sha256:v1:' + 'b'.repeat(64) }],
  evidenceRevision: 'sha256:v1:' + 'c'.repeat(64),
  rightsState: 'first_party',
  safetyState: 'approved',
  ...overrides,
});

const command = (overrides: Partial<CandidateEdgeReviewCommand> = {}): CandidateEdgeReviewCommand => ({
  edgeId: 'edge-001',
  expectedRevision: 1,
  reviewer: { id: 'reviewer-001', role: 'reviewer' },
  decision: 'approve',
  ...overrides,
});

const harness = (initial = edge()) => {
  let current = initial;
  const audits: Record<string, unknown>[] = [];
  const service = new CandidateEdgeReviewService({
    edgeStore: {
      read: async () => current,
      transact: async <T>(expectedRevision: number, operation: (current: ReviewEdge) => Promise<T>) => {
        if (current.revision !== expectedRevision) return { committed: false as const };
        const value = await operation(current);
        current = value as ReviewEdge;
        return { committed: true as const, value };
      },
    },
    auditSink: { append: async (audit: Record<string, unknown>) => { audits.push(audit); } },
    now: () => '2026-01-01T00:00:00.000Z',
  });
  return { service, audits, get current() { return current; } };
};

describe('P2-T02 candidate edge review', () => {
  it('approves a candidate only through expected-revision mutation and immutable audit', async () => {
    const h = harness();
    const result = await h.service.review(command());
    expect(result.reviewState).toBe('approved');
    expect(result.revision).toBe(2);
    expect(h.audits).toHaveLength(1);
  });

  it('keeps stale revision candidate queryable but rejects the mutation', async () => {
    const h = harness(edge({ revision: 2 }));
    await expect(h.service.review(command())).rejects.toMatchObject({ code: 'stale_revision' });
    expect(h.current.reviewState).toBe('candidate');
    expect(h.audits).toHaveLength(0);
  });

  it('rejects unauthorized reviewers without changing candidate state', async () => {
    const h = harness();
    await expect(h.service.review(command({ reviewer: { id: 'operator-001', role: 'operator' as never } }))).rejects.toMatchObject({ code: 'unauthorized' });
    expect(h.current.reviewState).toBe('candidate');
  });

  it('rejects self-review even for an otherwise authorized reviewer', async () => {
    const h = harness(edge({ proposerId: 'reviewer-001' }));
    await expect(h.service.review(command())).rejects.toMatchObject({ code: 'self_review' });
    expect(h.current.reviewState).toBe('candidate');
  });

  it.each(['blocked', 'revoked', 'unknown'] as const)('cannot approve %s-rights evidence', async (rightsState) => {
    const h = harness(edge({ rightsState }));
    await expect(h.service.review(command())).rejects.toMatchObject({ code: 'rights_blocked' });
    expect(h.current.reviewState).toBe('candidate');
  });

  it('does not approve pending safety evidence', async () => {
    const h = harness(edge({ safetyState: 'pending' }));
    await expect(h.service.review(command())).rejects.toMatchObject({ code: 'safety_blocked' });
    expect(h.current.reviewState).toBe('candidate');
  });

  it('does not re-approve an already rejected edge', async () => {
    const h = harness(edge({ reviewState: 'rejected' }));
    await expect(h.service.review(command())).rejects.toMatchObject({ code: 'already_reviewed' });
  });

  it('does not commit the edge when immutable audit publication fails', async () => {
    const initial = edge();
    const current = initial;
    const service = new CandidateEdgeReviewService({
      edgeStore: {
        read: async () => current,
        transact: async <T>(_expectedRevision: number, operation: (value: ReviewEdge) => Promise<T>) => ({ committed: true as const, value: await operation(current) }),
      },
      auditSink: { append: async () => { throw new Error('audit unavailable'); } },
      now: () => '2026-01-01T00:00:00.000Z',
    });
    await expect(service.review(command())).rejects.toMatchObject({ code: 'audit_failed' });
    expect(current).toEqual(initial);
  });

  it('rejects missing evidence without creating projection input', async () => {
    const h = harness(edge({ evidenceRefs: [] }));
    await expect(h.service.review(command())).rejects.toMatchObject({ code: 'missing_evidence' });
    expect(h.current.reviewState).toBe('candidate');
  });
});
