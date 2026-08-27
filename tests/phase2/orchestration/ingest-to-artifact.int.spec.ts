import { describe, expect, it, vi } from 'vitest';
import { createFakeTwitter241Transport, type TransportFault } from '../fixtures/fake-twitter241-transport';
import { sliceRecords, type SliceFixtureId } from '../fixtures/slice-records';
import { SliceOrchestrator } from '../../../src/pipeline/orchestrator';

const ids = ['twitter241-synthetic-001', 'first-party-001'] as const;
const request = (expectedCheckpointRevision = 0) => ({
  runId: 'run-t01-001',
  correlationId: 'corr-t01-001',
  expectedCheckpointRevision,
  fixtureIds: ids,
});

const harness = (input: Readonly<{
  transport?: ReturnType<typeof createFakeTwitter241Transport>;
  rawWrite?: (input: Readonly<{ fixtureId: SliceFixtureId; bytes: Uint8Array; contentHash: string }>) => Promise<Readonly<{ ref: string; contentHash: string }>>;
  checkpointCompareAndSet?: (expected: number, next: number) => Promise<boolean>;
  partial?: SliceFixtureId;
}> = {}) => {
  const transport = input.transport ?? createFakeTwitter241Transport({
    records: input.partial === undefined ? undefined : {
      [input.partial]: { ...sliceRecords.find((record) => record.fixtureId === input.partial)!, partial: true },
    },
  });
  const rawWrites: { fixtureId: SliceFixtureId; contentHash: string }[] = [];
  const sources: { sourceId: string; fixtureId: SliceFixtureId; contentHash: string; sourceRevision?: number; previousSourceId?: string }[] = [];
  const artifacts: { artifactId: string; sourceId: string; contentHash: string }[] = [];
  const events: { type: string; sequence: number; correlationId: string; fixtureId?: string; errorCode?: string }[] = [];
  let revision = 0;
  const sleeps: number[] = [];
  const rawStore = {
    write: input.rawWrite ?? (async ({ fixtureId, contentHash: hash }: { fixtureId: SliceFixtureId; bytes: Uint8Array; contentHash: string }) => {
      rawWrites.push({ fixtureId, contentHash: hash });
      return { ref: `raw://${hash}`, contentHash: hash };
    }),
  };
  const checkpoint = {
    transactPair: async <T>({ expectedRevision, nextRevision, work }: { expectedRevision: number; nextRevision: number; work: () => Promise<T> }) => {
      const allowed = input.checkpointCompareAndSet === undefined
        ? revision === expectedRevision
        : await input.checkpointCompareAndSet(expectedRevision, nextRevision)
      if (!allowed) return { committed: false as const }
      const value = await work()
      revision = nextRevision
      return { committed: true as const, value }
    },
  };
  const orchestrator = new SliceOrchestrator({
    sourceAdapter: transport,
    rawStore,
    sourceStore: {
      write: async ({ record, contentHash: hash, sourceRevision, previousSourceId }: { record: { fixtureId: SliceFixtureId }; contentHash: string; sourceRevision?: number; previousSourceId?: string }) => {
        const sourceId = `source://${record.fixtureId}/${hash}`;
        sources.push({ sourceId, fixtureId: record.fixtureId, contentHash: hash, sourceRevision, previousSourceId });
        return { sourceId };
      },
    },
    artifactStore: {
      write: async ({ sourceId, contentHash: hash }: { sourceId: string; contentHash: string }) => {
        const artifactId = `artifact://${sourceId}`;
        artifacts.push({ artifactId, sourceId, contentHash: hash });
        return { artifactId };
      },
    },
    checkpoint,
    eventSink: { append: async (event: typeof events[number]) => { events.push(event); } },
    sleep: async (milliseconds: number) => { sleeps.push(milliseconds); },
  });
  return { orchestrator, transport, rawWrites, sources, artifacts, events, sleeps, get revision() { return revision; } };
};

const authFault = (code: TransportFault['code'] = 'auth_denied'): TransportFault => ({
  code,
  status: code === 'entitlement_denied' ? 403 : 401,
  message: `provider ${code}: Bearer fixture-secret-do-not-leak`,
  headers: { authorization: 'Bearer fixture-secret-do-not-leak', 'x-api-key': 'fixture-secret-do-not-leak' },
});

describe('P2-T01 ingest-to-artifact orchestration', () => {
  it('writes raw evidence before immutable source/artifact records and emits ordered events', async () => {
    const h = harness();
    const result = await h.orchestrator.run(request());
    expect(result.sourceIds).toHaveLength(2);
    expect(result.artifactIds).toHaveLength(2);
    expect(result.rawObjectRefs).toEqual(h.rawWrites.map(({ contentHash }) => `raw://${contentHash}`));
    expect(h.events.map(({ type }) => type)).toEqual([
      'slice.started', 'raw.persisted', 'raw.persisted',
      'source.committed', 'artifact.built', 'source.committed', 'artifact.built',
      'checkpoint.committed', 'slice.completed',
    ]);
    expect(h.rawWrites).toHaveLength(2);
    expect(h.events.every((event) => event.correlationId === 'corr-t01-001')).toBe(true);
  });

  it('deduplicates ten concurrent replays and preserves exact hashes', async () => {
    const h = harness();
    const results = await Promise.all(Array.from({ length: 10 }, () => h.orchestrator.run(request())));
    expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(1);
    expect(h.rawWrites).toHaveLength(2);
    expect(h.sources).toHaveLength(2);
    expect(h.artifacts).toHaveLength(2);
    expect(results[0].checkpointRevision).toBe(1);
  });

  it('links changed raw bytes to a newer source revision on a subsequent run', async () => {
    let changed = false;
    const transport = { calls: [] as { fixtureId: SliceFixtureId; attempt: number }[], async fetch(fixtureId: SliceFixtureId, attempt: number) {
      this.calls.push({ fixtureId, attempt });
      const record = sliceRecords.find((candidate) => candidate.fixtureId === fixtureId)!;
      return changed && fixtureId === ids[0] ? { ...record, rawBytes: new TextEncoder().encode('changed-raw-bytes') } : record;
    } };
    const h = harness({ transport });
    await h.orchestrator.run(request());
    changed = true;
    const result = await h.orchestrator.run({ ...request(), runId: 'run-t01-changed-raw', correlationId: 'corr-t01-changed-raw', expectedCheckpointRevision: 1 });
    expect(result.sourceIds).toHaveLength(2);
    expect(h.rawWrites).toHaveLength(4);
    expect(h.sources.find((source) => source.fixtureId === ids[0] && source.sourceRevision === 2)?.previousSourceId).toContain('source://twitter241-synthetic-001/');
  });

  it('fails closed on raw-write failure before source/checkpoint/artifact state', async () => {
    const h = harness({ rawWrite: vi.fn(async () => { throw new Error('raw write failed'); }) });
    await expect(h.orchestrator.run(request())).rejects.toThrow(/raw write/i);
    expect(h.sources).toHaveLength(0);
    expect(h.artifacts).toHaveLength(0);
    expect(h.revision).toBe(0);
  });

  it('rejects a changed raw hash before source and artifact publication', async () => {
    const h = harness({ rawWrite: vi.fn(async ({ contentHash }) => ({ ref: 'raw://wrong', contentHash: `${contentHash}-changed` })) });
    await expect(h.orchestrator.run(request())).rejects.toThrow(/raw hash/i);
    expect(h.sources).toHaveLength(0);
    expect(h.artifacts).toHaveLength(0);
  });

  it('rejects partial input without creating an immutable source', async () => {
    const h = harness({ partial: ids[0] });
    await expect(h.orchestrator.run(request())).rejects.toThrow(/partial/i);
    expect(h.sources).toHaveLength(0);
    expect(h.artifacts).toHaveLength(0);
  });

  it('fails closed on checkpoint CAS conflict', async () => {
    const h = harness({ checkpointCompareAndSet: vi.fn(async () => false) });
    await expect(h.orchestrator.run(request())).rejects.toThrow(/checkpoint/i);
    expect(h.artifacts).toHaveLength(0);
    expect(h.revision).toBe(0);
  });

  it('honors Retry-After before one bounded retry for an injected 429', async () => {
    const transport = createFakeTwitter241Transport({ faults: [{ code: 'rate_limited', status: 429, retryAfterMs: 37, message: 'retry later' }] });
    const h = harness({ transport });
    await h.orchestrator.run(request());
    expect(h.sleeps).toContain(37);
    expect(transport.calls.map(({ attempt }) => attempt)).toEqual([1, 2, 1]);
  });

  it.each([authFault(), authFault('entitlement_denied')])('treats $code as terminal with max_attempts=1', async (fault) => {
    const transport = createFakeTwitter241Transport({ faults: [fault] });
    const h = harness({ transport });
    await expect(h.orchestrator.run(request())).rejects.toMatchObject({ code: fault.code });
    expect(transport.calls).toHaveLength(1);
  });

  it('redacts provider secrets and headers from checkpoint events and errors', async () => {
    const transport = createFakeTwitter241Transport({ faults: [authFault()] });
    const h = harness({ transport });
    await expect(h.orchestrator.run(request())).rejects.toThrow();
    const serialized = JSON.stringify(h.events);
    expect(serialized).not.toContain('fixture-secret-do-not-leak');
    expect(serialized).not.toContain('authorization');
  });

  it('uses no network transport beyond the injected fixture adapter', async () => {
    const h = harness();
    await h.orchestrator.run(request());
    expect(h.transport.calls).toHaveLength(2);
    expect(h.transport.calls.every(({ fixtureId }) => ids.includes(fixtureId))).toBe(true);
  });

  it('rejects duplicate fixture ids before transport side effects', async () => {
    const h = harness();
    await expect(h.orchestrator.run({ ...request(), fixtureIds: [ids[0], ids[0]] })).rejects.toThrow(/invalid/i);
    expect(h.transport.calls).toHaveLength(0);
    expect(h.rawWrites).toHaveLength(0);
    expect(h.revision).toBe(0);
  });
});
