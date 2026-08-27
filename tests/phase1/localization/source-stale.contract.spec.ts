import { describe, expect, it } from 'vitest'

import { staleLocalesForNewSourceRevision, staleLocalesForSourceHashChange } from '@/localization/source-stale'

const oldHash = `sha256:v1:${'a'.repeat(64)}`
const newHash = `sha256:v1:${'b'.repeat(64)}`
const translateService = {
  id: 17,
  stable_id: '01J6R3W2V8W24Q10NRDBVGN3P8',
  identity_kind: 'service' as const,
  roles: [],
  service_scopes: ['translate'],
}
const outerTransactionRequest = { transactionID: 'source-create-transaction', context: { source_create: true } }

describe('source staleness fanout', () => {
  it('derives the locale selector from the authoritative artifact identity and retains the Payload service id', async () => {
    const finds: unknown[] = []
    const updates: unknown[] = []
    const payload = {
      find: async (args: unknown) => {
        finds.push(args)
        return { docs: [{ id: 71, revision: 4, workflow_state: 'approved' }] }
      },
      update: async (args: unknown) => {
        updates.push(args)
        return { id: 71 }
      },
    }

    await expect(staleLocalesForSourceHashChange({
      payload: payload as never,
      req: outerTransactionRequest as never,
      service: translateService,
      entity: { relationTo: 'prompt-artifacts', value: 42 },
      old_source_hash: oldHash,
      new_source_hash: newHash,
      correlation_id: '01J6R3W2V8W24Q10NRDBVGN3P7',
    } as never)).resolves.toEqual([71])

    expect(finds).toEqual([expect.objectContaining({
      where: { and: expect.arrayContaining([{ entity_key: { equals: 'prompt-artifact:42' } }]) },
    })])
    expect(updates).toEqual([expect.objectContaining({
      req: expect.objectContaining({
        user: expect.objectContaining({ id: 17, stable_id: translateService.stable_id }),
        transactionID: 'source-create-transaction',
      }),
    })])
  })

  it('paginates every prompt artifact bound to the superseded source revision', async () => {
    const artifactIDs = Array.from({ length: 1_001 }, (_, index) => index + 1)
    const artifactPages: number[] = []
    const servicePages: number[] = []
    const staleUpdates: number[] = []
    const payload = {
      find: async (args: { collection: string; page?: number; limit?: number }) => {
        if (args.collection === 'sources') {
          return { docs: [{ id: 17, provider: 'first_party', provider_record_id: 'record-1', content_hash: oldHash }] }
        }
        if (args.collection === 'prompt-artifacts') {
          artifactPages.push(args.page ?? 0)
          const page = args.page ?? 1
          return {
            docs: artifactIDs.slice((page - 1) * 1_000, page * 1_000).map((id) => ({ id })),
            page,
            totalPages: 2,
          }
        }
        if (args.collection === 'users') {
          servicePages.push(args.page ?? 0)
          return args.page === 1
            ? { docs: [{ ...translateService, id: 18, stable_id: '01J6R3W2V8W24Q10NRDBVGN3P6', service_scopes: ['ingest'] }], page: 1, totalPages: 2 }
            : { docs: [translateService], page: 2, totalPages: 2 }
        }
        if (args.collection === 'locale-variants') {
          const selector = (args as unknown as { where: { and: Array<{ entity_key?: { equals?: string } }> } }).where.and
            .find((entry) => entry.entity_key !== undefined)?.entity_key?.equals
          const id = Number(selector?.replace('prompt-artifact:', ''))
          return { docs: [{ id, revision: 1, workflow_state: 'review' }] }
        }
        throw new Error(`unexpected collection: ${args.collection}`)
      },
      update: async (args: { id: number }) => {
        staleUpdates.push(args.id)
        return { id: args.id }
      },
    }

    await expect(staleLocalesForNewSourceRevision({
      payload: payload as never,
      req: outerTransactionRequest as never,
      source: { id: 18, provider: 'first_party', provider_record_id: 'record-1', content_hash: newHash },
      correlation_id: '01J6R3W2V8W24Q10NRDBVGN3P7',
    })).resolves.toEqual(artifactIDs)

    expect(artifactPages).toEqual([1, 2])
    expect(servicePages).toEqual([1, 2])
    expect(staleUpdates).toEqual(artifactIDs)
  })

  it('fails closed when prompt artifact pagination metadata is unavailable', async () => {
    const updates: unknown[] = []
    const payload = {
      find: async (args: { collection: string }) => {
        if (args.collection === 'sources') {
          return { docs: [{ id: 17, provider: 'first_party', provider_record_id: 'record-1', content_hash: oldHash }] }
        }
        if (args.collection === 'prompt-artifacts') return { docs: [{ id: 1 }] }
        throw new Error(`unexpected collection: ${args.collection}`)
      },
      update: async (args: unknown) => {
        updates.push(args)
        return { id: 1 }
      },
    }

    await expect(staleLocalesForNewSourceRevision({
      payload: payload as never,
      req: outerTransactionRequest as never,
      source: { id: 18, provider: 'first_party', provider_record_id: 'record-1', content_hash: newHash },
      correlation_id: '01J6R3W2V8W24Q10NRDBVGN3P7',
    })).rejects.toThrow(/pagination/i)

    expect(updates).toEqual([])
  })
})
