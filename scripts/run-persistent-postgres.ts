import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { access, chmod, mkdir, open, readFile } from 'node:fs/promises'
import path from 'node:path'

import EmbeddedPostgres from 'embedded-postgres'

import { applyPersistentPayloadMigrations } from './persistent-payload-migrate'

const RUNTIME_FORMAT_VERSION = 1
const DEFAULT_POSTGRES_PORT = 54329

type PersistentRuntimeConfig = Readonly<{
  formatVersion: 1
  port: number
  databasePassword: string
  payloadSecret: string
  rawEvidenceSignerSecret: string
}>

export type PersistentRuntime = Readonly<{
  rootDir: string
  postgresDirectory: string
  rawEvidenceDirectory: string
  databaseURL: string
  payloadSecret: string
  rawEvidenceSignerSecret: string
  env: Readonly<Record<string, string | undefined>>
}>

export type PersistentRuntimeOptions = Readonly<{ rootDir?: string }>

const randomSecret = (): string => randomBytes(32).toString('hex')
const configFilename = (rootDir: string): string => path.join(rootDir, 'runtime.json')
const defaultRootDir = (): string => path.resolve(process.cwd(), '.payload-local')

const parseConfig = (value: unknown): PersistentRuntimeConfig => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('persistent Payload runtime configuration is corrupt')
  const config = value as Record<string, unknown>
  if (config.formatVersion !== RUNTIME_FORMAT_VERSION || !Number.isInteger(config.port) || (config.port as number) < 1024 || (config.port as number) > 65535) {
    throw new Error('persistent Payload runtime configuration has an unsupported format')
  }
  for (const key of ['databasePassword', 'payloadSecret', 'rawEvidenceSignerSecret'] as const) {
    if (typeof config[key] !== 'string' || config[key].length < 32) throw new Error(`persistent Payload runtime configuration has invalid ${key}`)
  }
  return Object.freeze({
    formatVersion: RUNTIME_FORMAT_VERSION,
    port: config.port as number,
    databasePassword: config.databasePassword as string,
    payloadSecret: config.payloadSecret as string,
    rawEvidenceSignerSecret: config.rawEvidenceSignerSecret as string,
  })
}

const createConfig = (): PersistentRuntimeConfig => Object.freeze({
  formatVersion: RUNTIME_FORMAT_VERSION,
  port: Number(process.env.PAYLOAD_LOCAL_POSTGRES_PORT ?? DEFAULT_POSTGRES_PORT),
  databasePassword: randomSecret(),
  payloadSecret: randomSecret(),
  rawEvidenceSignerSecret: randomSecret(),
})

const readOrCreateConfig = async (rootDir: string): Promise<PersistentRuntimeConfig> => {
  const filename = configFilename(rootDir)
  try {
    return parseConfig(JSON.parse(await readFile(filename, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const config = createConfig()
  try {
    const handle = await open(filename, 'wx', 0o600)
    try { await handle.writeFile(`${JSON.stringify(config)}\n`) } finally { await handle.close() }
    return config
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    return parseConfig(JSON.parse(await readFile(filename, 'utf8')))
  }
}

export async function ensurePersistentRuntime(options: PersistentRuntimeOptions = {}): Promise<PersistentRuntime> {
  const rootDir = path.resolve(options.rootDir ?? defaultRootDir())
  await mkdir(rootDir, { recursive: true, mode: 0o700 })
  await chmod(rootDir, 0o700)
  const config = await readOrCreateConfig(rootDir)
  await chmod(configFilename(rootDir), 0o600)
  const postgresDirectory = path.join(rootDir, 'postgres')
  const rawEvidenceDirectory = path.join(rootDir, 'raw-evidence')
  await mkdir(rawEvidenceDirectory, { recursive: true, mode: 0o700 })
  await chmod(rawEvidenceDirectory, 0o700)
  const databaseURL = `postgres://postgres:${config.databasePassword}@127.0.0.1:${config.port}/postgres`
  return Object.freeze({
    rootDir,
    postgresDirectory,
    rawEvidenceDirectory,
    databaseURL,
    payloadSecret: config.payloadSecret,
    rawEvidenceSignerSecret: config.rawEvidenceSignerSecret,
    env: Object.freeze({
      DATABASE_URL: databaseURL,
      DB_POOL_MAX: '5',
      PAYLOAD_SECRET: config.payloadSecret,
      RAW_EVIDENCE_STORE_DIR: rawEvidenceDirectory,
      RAW_EVIDENCE_SIGNER_SECRET: config.rawEvidenceSignerSecret,
    }),
  })
}

const configuredClusterExists = async (databaseDir: string): Promise<boolean> => {
  try { await access(path.join(databaseDir, 'PG_VERSION')); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export const resolvePersistentRuntimeChild = (commandArguments: readonly string[]): Readonly<{ executable: string; arguments: readonly string[] }> => {
  const entrypoint = commandArguments[0]
  if (entrypoint?.endsWith('.ts') || entrypoint?.endsWith('.tsx')) {
    return Object.freeze({ executable: path.resolve(process.cwd(), 'node_modules/.bin/tsx'), arguments: Object.freeze([...commandArguments]) })
  }
  return Object.freeze({ executable: process.execPath, arguments: Object.freeze([...commandArguments]) })
}

type StoppableEmbeddedPostgres = Readonly<{
  process?: {
    kill: (signal: NodeJS.Signals) => boolean
    once: (event: 'exit', listener: () => void) => unknown
  }
}>

/**
 * embedded-postgres 18 registers a global async-exit hook whose `stop()` can
 * wait forever after PostgreSQL already honours SIGINT. Signal the child
 * directly, but never clear its private handle until it has actually exited:
 * that would let the wrapper terminate before PostgreSQL flushes its state.
 */
const waitForExit = async (process: NonNullable<StoppableEmbeddedPostgres['process']>, timeoutMs: number): Promise<boolean> => await new Promise((resolve) => {
  let settled = false
  const timer = setTimeout(() => {
    if (!settled) { settled = true; resolve(false) }
  }, timeoutMs)
  process.once('exit', () => {
    if (!settled) {
      settled = true
      clearTimeout(timer)
      resolve(true)
    }
  })
})

export async function stopPersistentPostgres(database: StoppableEmbeddedPostgres, input: Readonly<{ graceMs?: number }> = {}): Promise<void> {
  const child = database.process
  if (!child) return
  const graceMs = input.graceMs ?? 5_000
  const gracefulExit = waitForExit(child, graceMs)
  child.kill('SIGINT')
  if (!await gracefulExit) {
    const forcedExit = waitForExit(child, 1_000)
    child.kill('SIGKILL')
    if (!await forcedExit) throw new Error('persistent PostgreSQL did not exit after SIGINT and SIGKILL')
  }
  ;(database as { process?: unknown }).process = undefined
}

const isExistingPersistentPostgresHealthy = async (database: EmbeddedPostgres): Promise<boolean> => {
  const client = database.getPgClient('postgres', '127.0.0.1')
  try {
    await client.connect()
    await client.query('SELECT 1')
    return true
  } catch {
    return false
  } finally {
    await client.end().catch(() => undefined)
  }
}

const startChild = async (commandArguments: readonly string[], runtime: PersistentRuntime): Promise<number> => {
  const environment: NodeJS.ProcessEnv = { ...process.env, ...runtime.env }
  delete environment.PAYLOAD_DB_PUSH
  const childCommand = resolvePersistentRuntimeChild(commandArguments)
  const child = spawn(childCommand.executable, childCommand.arguments, { cwd: process.cwd(), env: environment, stdio: 'inherit' })
  let forwardedSignal: NodeJS.Signals | undefined
  const forward = (signal: NodeJS.Signals): void => {
    if (forwardedSignal !== undefined) return
    forwardedSignal = signal
    child.kill(signal)
  }
  const onSigint = () => forward('SIGINT')
  const onSigterm = () => forward('SIGTERM')
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)
  try {
    return await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        if (forwardedSignal !== undefined && signal === forwardedSignal) resolve(0)
        else if (signal) reject(new Error(`Persistent PostgreSQL child terminated by ${signal}`))
        else resolve(code ?? 1)
      })
    })
  } finally {
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
  }
}

export async function runPersistentPostgres(input: Readonly<{ commandArguments: readonly string[]; rootDir?: string; migrate?: boolean }>): Promise<number> {
  if (input.commandArguments.length === 0) throw new Error('persistent PostgreSQL runtime requires a Node.js entrypoint and its arguments')
  const runtime = await ensurePersistentRuntime({ rootDir: input.rootDir })
  const database = new EmbeddedPostgres({
    databaseDir: runtime.postgresDirectory,
    user: 'postgres', password: runtime.databaseURL.match(/^postgres:\/\/postgres:([^@]+)@/)?.[1] ?? '',
    port: Number(new URL(runtime.databaseURL).port), persistent: true,
    postgresFlags: ['-h', '127.0.0.1'], onLog: () => {}, onError: () => {},
  })
  const ownsDatabase = !await isExistingPersistentPostgresHealthy(database)
  try {
    if (ownsDatabase) {
      if (!await configuredClusterExists(runtime.postgresDirectory)) await database.initialise()
      await database.start()
    }
    Object.assign(process.env, runtime.env)
    delete process.env.PAYLOAD_DB_PUSH
    if (input.migrate) await applyPersistentPayloadMigrations()
    return await startChild(input.commandArguments, runtime)
  } finally {
    if (ownsDatabase) await stopPersistentPostgres(database as unknown as StoppableEmbeddedPostgres)
  }
}

const parseArguments = (argumentsAfterCommand: readonly string[]): Readonly<{ migrate: boolean; commandArguments: readonly string[] }> => {
  const argumentsCopy = [...argumentsAfterCommand]
  const migrate = argumentsCopy.shift() === '--migrate'
  if (argumentsCopy[0] === '--') argumentsCopy.shift()
  if (argumentsCopy.length === 0) throw new Error('persistent PostgreSQL runtime requires a child command after --')
  return Object.freeze({ migrate, commandArguments: Object.freeze(argumentsCopy) })
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const parsed = parseArguments(process.argv.slice(2))
  const exitCode = await runPersistentPostgres(parsed)
  if (exitCode !== 0) throw new Error(`Persistent PostgreSQL-backed command exited with code ${exitCode}`)
  // tsx retains its esbuild service after a top-level-await script resolves.
  // The database has already received SIGINT and its third-party exit hook was
  // neutralized above, so exit explicitly rather than leaving a CLI wrapper.
  process.exit(0)
}
