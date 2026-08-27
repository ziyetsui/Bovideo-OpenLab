import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { getPayload } from 'payload'

import { createPayloadConfig } from '../../src/payload.config'
import {
  assertLocalDisposableTarget,
  assertPrivateOutputDirectory,
  closePhase1PostgresPool,
  createIntegrityManifest,
  decryptBackupEnvelope,
  PHASE1_SCHEMA_VERSION,
  restoreLogicalDump,
  type BackupEnvelope,
  requireBackupKey,
  readLogicalDump, readPrivateOutputFile,
  type Queryable,
} from './recovery-core'

const required = (value: string | undefined, name: string): string => {
  if (!value) throw new Error(`${name} is required`)
  return value
}

export async function restorePhase1Fixture(): Promise<void> {
  const databaseURL = required(process.env.DATABASE_URL, 'DATABASE_URL')
  const runID = required(process.env.PHASE1_RUN_ID, 'PHASE1_RUN_ID')
  const databaseIdentity = required(process.env.PHASE1_DATABASE_IDENTITY, 'PHASE1_DATABASE_IDENTITY')
  const outputDirectory = required(process.env.PHASE1_OUTPUT_DIR, 'PHASE1_OUTPUT_DIR')
  assertLocalDisposableTarget(databaseURL, runID, databaseIdentity)
  await assertPrivateOutputDirectory(outputDirectory)
  const key = requireBackupKey(process.env.PHASE1_BACKUP_KEY)
  const envelope = JSON.parse(await readPrivateOutputFile(path.join(outputDirectory, 'backup-envelope.json'))) as BackupEnvelope
  if (envelope.metadata.run_id !== runID || envelope.metadata.schema_version !== PHASE1_SCHEMA_VERSION) throw new Error('backup envelope does not belong to this local recovery run')
  const payload = await getPayload({ config: createPayloadConfig() })
  const livePool = payload.db.pool
  try {
    const pool = payload.db.pool as unknown as Queryable & { connect: () => Promise<Queryable & { release: () => void }> }
    const metadata = await pool.query('SELECT schema_version FROM phase1_schema_metadata WHERE schema_version = $1', [PHASE1_SCHEMA_VERSION])
    if (metadata.rows.length !== 1) throw new Error('restore target must be migrated before restore')
    const dump = decryptBackupEnvelope(envelope, key)
    await restoreLogicalDump(pool, dump)
    const restored = await readLogicalDump(pool)
    const manifest = createIntegrityManifest(restored)
    if (manifest.manifest_hash !== envelope.manifest.manifest_hash) throw new Error('post-restore manifest mismatch')
    process.stdout.write(`${JSON.stringify({ run_id: runID, manifest_hash: manifest.manifest_hash, restored_database_identity: databaseIdentity })}\n`)
  } finally {
    await payload.destroy()
    await closePhase1PostgresPool(livePool)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await restorePhase1Fixture()
