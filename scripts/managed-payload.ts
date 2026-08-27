export type ManagedPayloadEnvironment = Readonly<Record<string, string | undefined>>

type ManagedMigration = () => Promise<unknown>
type ManagedWrite = () => Promise<unknown>

const requiredValue = (environment: ManagedPayloadEnvironment, key: string): string => {
  const value = environment[key]?.trim()
  if (!value) throw new Error(`${key} is required for the managed Payload write plane`)
  return value
}

const requiredMigrationEnvironment = (environment: ManagedPayloadEnvironment): Readonly<Record<'DATABASE_URL' | 'PAYLOAD_SECRET', string>> => Object.freeze({
  DATABASE_URL: requiredValue(environment, 'DATABASE_URL'),
  PAYLOAD_SECRET: requiredValue(environment, 'PAYLOAD_SECRET'),
})

const localEvidenceKeys = ['RAW_EVIDENCE_STORE_DIR', 'RAW_EVIDENCE_SIGNER_SECRET'] as const
const r2EvidenceKeys = [
  'RAW_EVIDENCE_R2_ACCESS_KEY_ID',
  'RAW_EVIDENCE_R2_SECRET_ACCESS_KEY',
  'RAW_EVIDENCE_R2_ENDPOINT',
  'RAW_EVIDENCE_R2_BUCKET',
  'RAW_EVIDENCE_R2_REGION',
] as const

const configured = (environment: ManagedPayloadEnvironment, keys: readonly string[]): boolean =>
  keys.some((key) => environment[key]?.trim().length)

const requiredWriteEnvironment = (environment: ManagedPayloadEnvironment): Readonly<Record<string, string>> => {
  const localConfigured = configured(environment, localEvidenceKeys)
  const r2Configured = configured(environment, r2EvidenceKeys)
  if (localConfigured && r2Configured) throw new Error('raw evidence storage configuration is ambiguous: configure either local or R2 storage')
  const storageKeys = r2Configured ? r2EvidenceKeys : localEvidenceKeys
  return Object.freeze({
    ...requiredMigrationEnvironment(environment),
    ...Object.fromEntries(storageKeys.map((key) => [key, requiredValue(environment, key)])),
  })
}

const restore = (key: string, previous: string | undefined): void => {
  if (previous === undefined) delete process.env[key]
  else process.env[key] = previous
}

/**
 * Payload resolves its adapter config from process.env. Keep the managed write
 * boundary narrow: inject only required values, force migrations rather than
 * schema push, and restore the calling process afterwards.
 */
const withManagedPayloadEnvironment = async <T>(
  values: Readonly<Record<string, string>>,
  operation: () => Promise<T>,
): Promise<T> => {
  const keys = [...Object.keys(values), 'PAYLOAD_DB_PUSH']
  const before = new Map(keys.map((key) => [key, process.env[key]]))
  try {
    Object.assign(process.env, values)
    delete process.env.PAYLOAD_DB_PUSH
    return await operation()
  } finally {
    for (const key of keys) restore(key, before.get(key))
  }
}

/** A migration command accepts no flags so it cannot accidentally target a different database. */
export const parseManagedPayloadMigrationArgs = (argumentsAfterCommand: readonly string[]): Readonly<Record<never, never>> => {
  const argumentsCopy = [...argumentsAfterCommand]
  if (argumentsCopy[0] === '--') argumentsCopy.shift()
  if (argumentsCopy.length > 0) throw new Error(`unknown managed migration argument: ${argumentsCopy[0]}`)
  return Object.freeze({})
}

export const runManagedPayloadMigration = async (
  environment: ManagedPayloadEnvironment = process.env,
  dependencies: Readonly<{ migrate: ManagedMigration }> = { migrate: async () => await (await import('./persistent-payload-migrate')).applyPersistentPayloadMigrations() },
): Promise<unknown> => await withManagedPayloadEnvironment(requiredMigrationEnvironment(environment), dependencies.migrate)

/**
 * Applies the reviewed migration ledger before a managed import or collector.
 * A migration failure prevents the writer from ever receiving control.
 */
export const runManagedPayloadWritePlane = async (input: Readonly<{
  environment?: ManagedPayloadEnvironment
  migrate?: ManagedMigration
  write: ManagedWrite
}>): Promise<Readonly<{ migration: unknown; write: unknown }>> => {
  const environment = input.environment ?? process.env
  const migration = input.migrate ?? (async () => await (await import('./persistent-payload-migrate')).applyPersistentPayloadMigrations())
  return await withManagedPayloadEnvironment(requiredWriteEnvironment(environment), async () => {
    const migrationResult = await migration()
    const writeResult = await input.write()
    return Object.freeze({ migration: migrationResult, write: writeResult })
  })
}
