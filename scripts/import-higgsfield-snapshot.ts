import { getPayload } from 'payload'
import { pathToFileURL } from 'node:url'

import { createUlid } from '../src/access/ulid'
import { importHiggsfieldSnapshot, type SnapshotImportPayload } from '../src/imports/higgsfield-snapshot'
import { resolveRawEvidenceStoreFromEnvironment } from '../src/storage/raw-evidence-store'

export type SnapshotImportCommand = Readonly<{ snapshotDir: string; dryRun: boolean }>

export const parseSnapshotImportArgs = (argumentsAfterCommand: readonly string[], environment: Readonly<Record<string, string | undefined>>): SnapshotImportCommand => {
  let snapshotDir = environment.ASSET_SNAPSHOT_DIR?.trim() || undefined
  let dryRun = false
  for (let index = 0; index < argumentsAfterCommand.length; index += 1) {
    const argument = argumentsAfterCommand[index]
    if (argument === '--' && index === 0) continue
    if (argument === '--dry-run') { dryRun = true; continue }
    if (argument === '--snapshot') {
      const candidate = argumentsAfterCommand[index + 1]?.trim()
      if (!candidate) throw new Error('--snapshot requires a directory')
      snapshotDir = candidate
      index += 1
      continue
    }
    throw new Error(`unknown snapshot import argument: ${argument}`)
  }
  if (!snapshotDir) throw new Error('ASSET_SNAPSHOT_DIR or --snapshot is required')
  return Object.freeze({ snapshotDir, dryRun })
}

export async function runSnapshotImportCommand(argumentsAfterCommand = process.argv.slice(2), environment = process.env): Promise<unknown> {
  const { snapshotDir, dryRun } = parseSnapshotImportArgs(argumentsAfterCommand, environment)
  const rawEvidenceStore = (() => {
    if (dryRun) return undefined
    return resolveRawEvidenceStoreFromEnvironment(environment)
  })()
  const payload = dryRun ? undefined : await getPayload({ config: (await import('../src/payload.config')).createPayloadConfig() })
  const livePool = payload?.db.pool
  try {
    return await importHiggsfieldSnapshot({
      snapshotDir,
      payload: payload as SnapshotImportPayload | undefined,
      correlationId: createUlid(),
      dryRun,
      rawEvidenceStore,
    })
  } finally {
    await payload?.destroy()
    if (livePool) {
      const { closePhase1PostgresPool } = await import('./phase1/recovery-core')
      await closePhase1PostgresPool(livePool)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runSnapshotImportCommand()
  process.stdout.write(`${JSON.stringify(result)}\n`)
  // Payload/tsx can retain internal handles after all DB pools are closed.
  // This is a CLI boundary only; library callers keep normal async control.
  process.exit(0)
}
