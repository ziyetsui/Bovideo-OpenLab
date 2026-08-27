import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { getPayload } from 'payload'

import { createPayloadConfig } from '../../src/payload.config'
import {
  assertLocalDisposableTarget,
  assertPrivateOutputDirectory,
  assertRestoreCriticalQueryPlans,
  assertSourceRightsQueryPlan,
  closePhase1PostgresPool,
  createBackupEnvelope,
  createIntegrityManifest,
  PHASE1_SCHEMA_VERSION,
  readLogicalDump,
  requireBackupKey,
  writePrivateAtomicFile,
  type Queryable,
} from './recovery-core'

const required = (value: string | undefined, name: string): string => {
  if (!value) throw new Error(`${name} is required`)
  return value
}

export async function backupPhase1Fixture(): Promise<void> {
  const databaseURL = required(process.env.DATABASE_URL, 'DATABASE_URL')
  const runID = required(process.env.PHASE1_RUN_ID, 'PHASE1_RUN_ID')
  const databaseIdentity = required(process.env.PHASE1_DATABASE_IDENTITY, 'PHASE1_DATABASE_IDENTITY')
  const outputDirectory = required(process.env.PHASE1_OUTPUT_DIR, 'PHASE1_OUTPUT_DIR')
  assertLocalDisposableTarget(databaseURL, runID, databaseIdentity)
  const key = requireBackupKey(process.env.PHASE1_BACKUP_KEY)
  await assertPrivateOutputDirectory(outputDirectory)
  const payload = await getPayload({ config: createPayloadConfig() })
  const livePool = payload.db.pool
  try {
    const pool = payload.db.pool as unknown as Queryable
    const dump = await readLogicalDump(pool)
    const sourceRightsIndex = await assertSourceRightsQueryPlan(pool)
    const restoreCriticalIndexes = await assertRestoreCriticalQueryPlans(pool)
    const metadata = await pool.query('SELECT schema_version, compatibility FROM phase1_schema_metadata WHERE schema_version = $1', [PHASE1_SCHEMA_VERSION])
    if (metadata.rows.length !== 1) throw new Error('schema metadata is required before backup')
    const now = new Date()
    const envelope = createBackupEnvelope(dump, createIntegrityManifest(dump), {
      run_id: runID,
      source_database_identity: databaseIdentity,
      key,
      now,
      expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    })
    await writePrivateAtomicFile(path.join(outputDirectory, 'backup-envelope.json'), `${JSON.stringify(envelope)}\n`)
    await writePrivateAtomicFile(path.join(outputDirectory, 'backup-manifest.json'), `${JSON.stringify(envelope.manifest)}\n`)
    process.stdout.write(`${JSON.stringify({ run_id: runID, manifest_hash: envelope.manifest.manifest_hash, collections: envelope.manifest.collection_counts, source_rights_index: sourceRightsIndex, restore_critical_indexes: restoreCriticalIndexes })}\n`)
  } finally {
    await payload.destroy()
    await closePhase1PostgresPool(livePool)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await backupPhase1Fixture()
