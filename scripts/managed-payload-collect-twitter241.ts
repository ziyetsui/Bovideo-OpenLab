import { pathToFileURL } from 'node:url'

import { runTwitter241CollectAndImportCommand } from './collect-and-import-twitter241'
import { runManagedPayloadWritePlane } from './managed-payload'

export const runManagedTwitter241CollectAndImportCommand = async (
  argumentsAfterCommand = process.argv.slice(2),
  environment = process.env,
): Promise<unknown> => await runManagedPayloadWritePlane({
  environment,
  write: async () => await runTwitter241CollectAndImportCommand(argumentsAfterCommand, process.env),
})

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runManagedTwitter241CollectAndImportCommand()
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exit(0)
}
