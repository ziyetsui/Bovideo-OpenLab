import { pathToFileURL } from 'node:url'

import { parseManagedPayloadMigrationArgs, runManagedPayloadMigration } from './managed-payload'

export const runManagedPayloadMigrationCommand = async (
  argumentsAfterCommand = process.argv.slice(2),
  environment = process.env,
): Promise<unknown> => {
  parseManagedPayloadMigrationArgs(argumentsAfterCommand)
  return await runManagedPayloadMigration(environment)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runManagedPayloadMigrationCommand()
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exit(0)
}
