export type SliceFixtureId = 'twitter241-synthetic-001' | 'first-party-001';

export type SliceFixtureRecord = Readonly<{
  fixtureId: SliceFixtureId;
  provider: 'twitter241' | 'first_party';
  providerRecordId: string;
  canonicalUrl: string;
  text: string;
  authorId: string;
  authorHandle: string;
  capturedAt: string;
  rawBytes: Uint8Array;
  rightsState: 'metadata_only' | 'first_party';
  rightsBasis: string | null;
  partial: boolean;
}>;

export const sliceRecords = Object.freeze([
  Object.freeze({
    fixtureId: 'twitter241-synthetic-001' as const,
    provider: 'twitter241' as const,
    providerRecordId: 'tweet-241-001',
    canonicalUrl: 'https://x.example/status/241-001',
    text: 'Synthetic fixture for the local slice.',
    authorId: 'author-241',
    authorHandle: 'fixture_author',
    capturedAt: '2026-01-01T00:00:00.000Z',
    rawBytes: new TextEncoder().encode('{"id":"tweet-241-001","text":"Synthetic fixture for the local slice."}'),
    rightsState: 'metadata_only' as const,
    rightsBasis: null,
    partial: false,
  }),
  Object.freeze({
    fixtureId: 'first-party-001' as const,
    provider: 'first_party' as const,
    providerRecordId: 'first-party-001',
    canonicalUrl: 'https://first-party.example/items/001',
    text: 'First-party fixture for the local slice.',
    authorId: 'first-party-author',
    authorHandle: 'first-party',
    capturedAt: '2026-01-01T00:00:01.000Z',
    rawBytes: new TextEncoder().encode('{"id":"first-party-001","text":"First-party fixture for the local slice."}'),
    rightsState: 'first_party' as const,
    rightsBasis: 'fixture-license-v1',
    partial: false,
  }),
] satisfies readonly SliceFixtureRecord[]);

export const sliceRecordById = Object.freeze(Object.fromEntries(sliceRecords.map((record) => [record.fixtureId, record])) as Record<SliceFixtureId, SliceFixtureRecord>);
