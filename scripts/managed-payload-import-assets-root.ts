import { pathToFileURL } from 'node:url'

import { runAssetsRootImportCommand } from './import-assets-root'
import { runManagedPayloadWritePlane } from './managed-payload'

export const runManagedAssetsRootImportCommand = async (
  argumentsAfterCommand = process.argv.slice(2),
  environment = process.env,
): Promise<unknown> => await runManagedPayloadWritePlane({
  environment,
  write: async () => await runAssetsRootImportCommand(argumentsAfterCommand, process.env),
})

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runManagedAssetsRootImportCommand()
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exit(0)
}
