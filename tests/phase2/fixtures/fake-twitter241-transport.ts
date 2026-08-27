import { sliceRecordById, type SliceFixtureId, type SliceFixtureRecord } from './slice-records';

export type TransportFault = Readonly<{
  code: 'raw_write' | 'auth_denied' | 'entitlement_denied' | 'rate_limited';
  status: number;
  message: string;
  retryAfterMs?: number;
  headers?: Readonly<Record<string, string>>;
}>;

export type FakeTransport = Readonly<{
  fetch: (fixtureId: SliceFixtureId, attempt: number) => Promise<SliceFixtureRecord>;
  calls: readonly { fixtureId: SliceFixtureId; attempt: number }[];
}>;

export const createFakeTwitter241Transport = (input: Readonly<{
  faults?: readonly TransportFault[];
  records?: Partial<Record<SliceFixtureId, SliceFixtureRecord>>;
}> = {}): FakeTransport => {
  const calls: { fixtureId: SliceFixtureId; attempt: number }[] = [];
  const faults = [...(input.faults ?? [])];
  const records = { ...sliceRecordById, ...(input.records ?? {}) };
  return {
    get calls() { return Object.freeze(calls.map((call) => Object.freeze({ ...call }))); },
    async fetch(fixtureId, attempt) {
      calls.push({ fixtureId, attempt });
      const fault = faults.shift();
      if (fault !== undefined) throw fault;
      const record = records[fixtureId];
      if (record === undefined) throw new Error(`unknown fixture ${fixtureId}`);
      return record;
    },
  };
};
