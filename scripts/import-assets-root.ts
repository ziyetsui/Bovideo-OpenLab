import { getPayload } from 'payload'
import { pathToFileURL } from 'node:url'

import { createUlid } from '../src/access/ulid'
import { importAssetsRoot, planAssetsRootImport, recordDerivedEvidenceWorkflow } from '../src/imports/assets-root'
import { importHiggsfieldSnapshot, type SnapshotImportPayload } from '../src/imports/higgsfield-snapshot'
import { LocalObjectStore } from '../src/storage/local-object-store'

export type AssetsRootImportCommand = Readonly<{ rootDirectory: string; dryRun: boolean }>

export const parseAssetsRootImportArgs = (
  argumentsAfterCommand: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): AssetsRootImportCommand => {
  let rootDirectory = environment.ASSET_ROOT_DIR?.trim() || undefined
  let dryRun = false
  for (let index = 0; index < argumentsAfterCommand.length; index += 1) {
    const argument = argumentsAfterCommand[index]
    if (argument === '--' && index === 0) continue
    if (argument === '--dry-run') { dryRun = true; continue }
    if (argument === '--assets-root') {
      const candidate = argumentsAfterCommand[index + 1]?.trim()
      if (!candidate) throw new Error('--assets-root requires a directory')
      rootDirectory = candidate
      index += 1
      continue
    }
    throw new Error(`unknown assets-root import argument: ${argument}`)
  }
  if (!rootDirectory) throw new Error('ASSET_ROOT_DIR or --assets-root is required')
  return Object.freeze({ rootDirectory, dryRun })
}

export async function runAssetsRootImportCommand(
  argumentsAfterCommand = process.argv.slice(2),
  environment = process.env,
): Promise<unknown> {
  const { rootDirectory, dryRun } = parseAssetsRootImportArgs(argumentsAfterCommand, environment)
  if (dryRun) return await planAssetsRootImport(rootDirectory)
  const directory = environment.RAW_EVIDENCE_STORE_DIR?.trim()
  const signerSecret = environment.RAW_EVIDENCE_SIGNER_SECRET?.trim()
  if (!directory) throw new Error('RAW_EVIDENCE_STORE_DIR is required when not using --dry-run')
  if (!signerSecret) throw new Error('RAW_EVIDENCE_SIGNER_SECRET is required when not using --dry-run')
  const payload = await getPayload({ config: (await import('../src/payload.config')).createPayloadConfig() })
  const livePool = payload.db.pool
  try {
    const store = new LocalObjectStore({ root_dir: directory, signer_secret: signerSecret })
    const result = await importAssetsRoot({
      rootDirectory,
      store,
      importSnapshot: async (snapshotDir) => await importHiggsfieldSnapshot({
        snapshotDir,
        payload: payload as SnapshotImportPayload,
        correlationId: createUlid(),
        rawEvidenceStore: store,
      }),
    })
    for (const evidence of result.derived) {
      await recordDerivedEvidenceWorkflow({ payload: payload as SnapshotImportPayload, evidence })
    }
    return result
  } finally {
    await payload.destroy()
    if (livePool) {
      const { closePhase1PostgresPool } = await import('./phase1/recovery-core')
      await closePhase1PostgresPool(livePool)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runAssetsRootImportCommand()
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exit(0)
}
