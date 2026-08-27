import { getPayload } from 'payload'
import { pathToFileURL } from 'node:url'

import { createPayloadConfig } from '../../src/payload.config'
import { assertLocalDisposableTarget, closePhase1PostgresPool } from './recovery-core'
import { PHASE1_MIGRATION_PLAN } from './migration-plan'

export async function applyPhase1Migration(): Promise<void> {
  const databaseURL = process.env.DATABASE_URL
  const runID = process.env.PHASE1_RUN_ID
  const identity = process.env.PHASE1_DATABASE_IDENTITY
  if (!databaseURL || !runID || !identity) throw new Error('DATABASE_URL, PHASE1_RUN_ID and PHASE1_DATABASE_IDENTITY are required')
  assertLocalDisposableTarget(databaseURL, runID, identity)
  const payload = await getPayload({ config: createPayloadConfig() })
  const livePool = payload.db.pool
  try {
    const pool = payload.db.pool as unknown as { query: (query: string, values?: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }
    const applied: string[] = []
    const alreadyApplied: string[] = []
    for (const migration of PHASE1_MIGRATION_PLAN) {
      const present = await pool.query('SELECT name FROM payload_migrations WHERE name = $1', [migration.name]).catch(() => ({ rows: [] }))
      if (present.rows.length === 0) {
        await migration.up({ db: payload.db.drizzle, payload, req: undefined } as never)
        await pool.query('INSERT INTO payload_migrations (name, batch) VALUES ($1, 1)', [migration.name])
        applied.push(migration.name)
      } else {
        alreadyApplied.push(migration.name)
      }
    }
    process.stdout.write(`${JSON.stringify({ applied, already_applied: alreadyApplied })}\n`)
  } finally {
    await payload.destroy()
    await closePhase1PostgresPool(livePool)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await applyPhase1Migration()
