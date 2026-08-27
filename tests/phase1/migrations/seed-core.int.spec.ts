import { describe, expect, it } from 'vitest'

import { FixtureConflictError, insertFixtureRow } from '../../../scripts/phase1/seed'

describe('P1-T03 fixture seed core', () => {
  it('rejects an existing canonical row whose stored content differs', async () => {
    const pool = {
      query: async (query: string) => {
        if (query.startsWith('SELECT row_to_json')) return { rows: [{ value: { id: 1, stable_id: 'fixture-1', status: 'removed' } }] }
        return { rows: [] }
      },
    }

    await expect(insertFixtureRow(pool, 'sources', { id: 1, stable_id: 'fixture-1', status: 'active' })).rejects.toBeInstanceOf(FixtureConflictError)
  })

  it('accepts an identical replay without issuing an insert', async () => {
    const queries: string[] = []
    const pool = {
      query: async (query: string) => {
        queries.push(query)
        return { rows: [{ value: { id: 1, stable_id: 'fixture-1', status: 'active' } }] }
      },
    }

    await expect(insertFixtureRow(pool, 'sources', { id: 1, stable_id: 'fixture-1', status: 'active' })).resolves.toBeUndefined()
    expect(queries).toHaveLength(1)
  })

  it('rejects a mismatched generated relation instead of treating it as replayable', async () => {
    const pool = {
      query: async (query: string) => {
        if (query.startsWith('SELECT row_to_json')) return { rows: [{ value: { id: 7, parent_id: 1, path: 'model_refs', taxonomy_nodes_id: 2 } }] }
        return { rows: [] }
      },
    }

    await expect(insertFixtureRow(pool, 'prompt_artifacts_rels', { id: 7, parent_id: 1, path: 'model_refs', taxonomy_nodes_id: 3 })).rejects.toBeInstanceOf(FixtureConflictError)
  })
})
