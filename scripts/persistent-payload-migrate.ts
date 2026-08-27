import { getPayload } from 'payload'

type MigrationClient = Readonly<{
  query: (query: string, values?: readonly unknown[]) => Promise<unknown>
  release: () => void
}>

type MigrationPool = Readonly<{
  connect: () => Promise<MigrationClient>
}>

const MIGRATION_ADVISORY_LOCK = 8_184_127_010

/** Applies only reviewed, additive migrations. Persistent profiles must never schema-push. */
export async function applyPersistentPayloadMigrations(): Promise<Readonly<{ applied: readonly string[]; alreadyApplied: readonly string[] }>> {
  const [{ createPayloadConfig }, { closePhase1PostgresPool }, { PHASE1_MIGRATION_PLAN }] = await Promise.all([
    import('../src/payload.config'),
    import('./phase1/recovery-core'),
    import('./phase1/migration-plan'),
  ])
  const payload = await getPayload({ config: createPayloadConfig() })
  const livePool = payload.db.pool
  try {
    const pool = livePool as unknown as MigrationPool
    const client = await pool.connect()
    try {
      // A session-scoped lock serializes separate `dev:persistent` and import
      // wrappers. Payload itself applies each migration and its ledger row in
      // one transaction, so a crash cannot replay a partially recorded DDL.
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK])
      // Payload's DatabaseAdapter exposes migration arguments with `unknown`
      // callback inputs, while our generated migration index retains its
      // stricter Postgres arguments. Runtime ownership is Payload's migrate().
      await payload.db.migrate({ migrations: PHASE1_MIGRATION_PLAN as never })
      return Object.freeze({ applied: Object.freeze([]), alreadyApplied: Object.freeze([]) })
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK]).catch(() => undefined)
      client.release()
    }
  } finally {
    await payload.destroy()
    await closePhase1PostgresPool(livePool)
  }
}
