import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import EmbeddedPostgres from 'embedded-postgres'

const nodeRuntime = process.execPath
const pgModule = path.resolve('node_modules/.pnpm/pg@8.20.0/node_modules/pg')
// Embedded PostgreSQL suites may contend for local CPU while still requiring a
// bounded shutdown path; 20 seconds leaves room for a cold Payload start.
const CHILD_TIMEOUT_MS = 20_000
const CHILD_TERM_GRACE_MS = 2_000

const reportStage = (stage: string, event: 'start' | 'success' | 'teardown'): void => {
  process.stdout.write(`${JSON.stringify({ stage, event })}\n`)
}

const redactChildOutput = (output: string, environment: NodeJS.ProcessEnv): string => {
  let redacted = output
  if (environment.PHASE1_BACKUP_KEY) redacted = redacted.replaceAll(environment.PHASE1_BACKUP_KEY, '[redacted]')
  try {
    const password = environment.DATABASE_URL ? new URL(environment.DATABASE_URL).password : ''
    if (password) redacted = redacted.replaceAll(password, '[redacted]')
  } catch {
    // The child receives only generated local URLs; leave malformed values out of diagnostics.
  }
  return redacted
}

const reservePort = async (): Promise<number> => {
  const server = createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  if (!address || typeof address === 'string') throw new Error('unable to reserve local PostgreSQL port')
  return address.port
}

const runChild = async (stage: string, entry: string, args: string[], environment: NodeJS.ProcessEnv): Promise<{ code: number; output: string }> => {
  const child = spawn(nodeRuntime, [path.resolve('node_modules/tsx/dist/cli.mjs'), entry, ...args], { cwd: process.cwd(), env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (value) => { output += String(value) })
  child.stderr.on('data', (value) => { output += String(value) })
  const closed = new Promise<number>((resolve) => {
    child.once('error', () => resolve(1))
    child.once('close', (value) => resolve(value ?? 1))
  })
  const waitForClose = async (timeout: number): Promise<number | undefined> => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeout)
    void closed.then((code) => { clearTimeout(timer); resolve(code) })
  })
  const result = await waitForClose(CHILD_TIMEOUT_MS)
  if (result !== undefined) return { code: result, output }

  child.kill('SIGTERM')
  const afterTerm = await waitForClose(CHILD_TERM_GRACE_MS)
  if (afterTerm === undefined) {
    child.kill('SIGKILL')
    await closed
  }
  throw new Error(`${stage} timed out after ${CHILD_TIMEOUT_MS / 1_000} seconds; child output: ${redactChildOutput(output, environment)}`)
}

const runSQL = async (statement: string, values: readonly unknown[], environment: NodeJS.ProcessEnv): Promise<Record<string, unknown>[]> => {
  const program = `const { Client } = require(${JSON.stringify(pgModule)}); const [, statement, values] = process.argv; const client = new Client({ connectionString: process.env.DATABASE_URL }); (async () => { await client.connect(); const result = await client.query(statement, JSON.parse(values)); console.log(JSON.stringify(result.rows)); await client.end(); })().catch(async (error) => { console.error(error.stack || error); try { await client.end(); } catch {} process.exitCode = 1 })`
  const child = spawn(nodeRuntime, ['-e', program, statement, JSON.stringify(values)], { cwd: process.cwd(), env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (value) => { output += String(value) })
  child.stderr.on('data', (value) => { output += String(value) })
  const code = await new Promise<number>((resolve) => child.once('close', (value) => resolve(value ?? 1)))
  if (code !== 0) throw new Error(`post-restore SQL assertion failed: ${redactChildOutput(output, environment)}`)
  return JSON.parse(output) as Record<string, unknown>[]
}

export async function runMigrationRoundtrip(): Promise<void> {
  const clusterDirectory = await mkdtemp(path.join(tmpdir(), 'bo-p1-t03-cluster-'))
  const outputDirectory = await mkdtemp(path.join(tmpdir(), 'bo-p1-t03-run-'))
  const port = await reservePort()
  const runSuffix = globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 12)
  const runID = `p1l-${runSuffix}`
  const password = `p1t03${globalThis.crypto.randomUUID().replaceAll('-', '')}`
  const cluster = new EmbeddedPostgres({ databaseDir: clusterDirectory, user: 'postgres', password, port, persistent: false, onLog: () => {} })
  const key = randomBytes(32).toString('hex')
  const sourceIdentity = `bo_p1_t03_${runSuffix}_source`
  const restoreIdentity = `bo_p1_t03_${runSuffix}_restore`
  const makeEnvironment = (identity: string): NodeJS.ProcessEnv => ({
    ...process.env,
    DATABASE_URL: `postgres://postgres:${password}@127.0.0.1:${port}/${identity}`,
    DB_POOL_MAX: '3',
    PAYLOAD_DB_PUSH: 'false',
    PAYLOAD_SECRET: 'phase1-local-roundtrip-only',
    PHASE1_RUN_ID: runID,
    PHASE1_DATABASE_IDENTITY: identity,
    PHASE1_OUTPUT_DIR: outputDirectory,
    PHASE1_BACKUP_KEY: key,
  })
  const stage = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
    reportStage(name, 'start')
    try {
      const result = await operation()
      reportStage(name, 'success')
      return result
    } finally {
      reportStage(name, 'teardown')
    }
  }
  const mustPass = async (name: string, entry: string, args: string[], environment: NodeJS.ProcessEnv): Promise<string> => {
    return stage(name, async () => {
      const result = await runChild(name, entry, args, environment)
      if (result.code !== 0) throw new Error(`${name} failed with ${result.code}: ${redactChildOutput(result.output, environment)}`)
      return result.output
    })
  }
  try {
    await cluster.initialise()
    await cluster.start()
    await cluster.createDatabase(sourceIdentity)
    await cluster.createDatabase(restoreIdentity)
    const source = makeEnvironment(sourceIdentity)
    const restore = makeEnvironment(restoreIdentity)
    await mustPass('apply', 'scripts/phase1/apply-migration.ts', [], source)
    await mustPass('replay', 'scripts/phase1/apply-migration.ts', [], source) // Payload ledger replay: typed already-applied/no SQL replay.
    await stage('seed-interrupt', async () => {
      const interrupted = await runChild('seed-interrupt', 'scripts/phase1/seed.ts', ['--batch-size', '1000', '--interrupt-after', '1'], source)
      if (interrupted.code === 0 || !interrupted.output.includes('intentional fixture interruption'))
        throw new Error(`interrupted fixture batch did not stop at the checkpoint seam: ${redactChildOutput(interrupted.output, source)}`)
    })
    await mustPass('seed-resume', 'scripts/phase1/seed.ts', ['--batch-size', '1000'], source)
    // Roundtrip-only planner population: the canonical fixture remains small,
    // while this makes the protected rights lookup naturally selective.
    await runSQL(`INSERT INTO sources (id, stable_id, revision, schema_version, source_version, status, provider, provider_record_id, canonical_url, raw_ref, captured_at, content_hash, rights_state, deletion_state, created_at, updated_at) SELECT 10000 + value, 'plan-source-' || value, 1, 1, 'plan-v1', 'active', 'first_party', 'plan-' || value, 'https://fixture.invalid/plan/' || value, '{"namespace":"raw-evidence","content_hash":"sha256:v1:plan","version":"v1"}'::jsonb, '2026-01-02T03:04:05.000Z'::timestamptz, 'sha256:v1:plan-' || value, (CASE WHEN value = 1 OR value % 2 = 0 THEN 'first_party' ELSE 'unknown' END)::enum_sources_rights_state, (CASE WHEN value = 1 OR value % 2 = 1 THEN 'active' ELSE 'removed' END)::enum_sources_deletion_state, '2026-01-02T03:04:05.000Z'::timestamptz, '2026-01-02T03:04:05.000Z'::timestamptz FROM generate_series(1, 1000) AS value`, [], source)
    await runSQL(`INSERT INTO locale_variants (id, stable_id, revision, schema_version, source_version, status, entity_key, locale, source_locale, translation_model, translation_prompt_version, localized_fields, content_revision, workflow_state, is_money_page, created_at, updated_at) SELECT 20000 + value, 'plan-locale-' || value, 1, 1, 'plan-v1', 'active', 'plan-entity-' || value, 'en', 'en', 'plan', 'plan', '{}'::jsonb, 1, 'missing', false, now(), now() FROM generate_series(1, 400) AS value`, [], source)
    await runSQL(`INSERT INTO page_records (id, stable_id, revision, schema_version, source_version, status, page_type, locale, root_object_key, intent, inventory, qualification_score, qualification_input_hash, qualification_rule_version, index_state, created_at, updated_at) SELECT 30000 + value, 'plan-page-' || value, 1, 1, 'plan-v1', 'active', 'detail', 'en', 'plan-root-' || value, 'plan', '{}'::jsonb, '{}'::jsonb, 'plan-' || value, 'plan', 'not_generated', now(), now() FROM generate_series(1, 400) AS value`, [], source)
    await runSQL(`INSERT INTO publication_snapshots (id, stable_id, revision, schema_version, source_version, status, publish_version, route_manifest_ref, sitemap_manifest_ref, github_manifest_ref, content_tree_hash, validation_report_ref, created_at, updated_at) SELECT 40000 + value, 'plan-publication-' || value, 1, 1, 'plan-v1', 'recorded', 10000 + value, 'plan', 'plan', 'plan', 'plan-' || value, 'plan', now(), now() FROM generate_series(1, 400) AS value`, [], source)
    await runSQL(`INSERT INTO active_publication_pointers (id, stable_id, revision, singleton_key, publish_version, created_at, updated_at) SELECT 50000 + value, 'plan-pointer-' || value, 1, 'plan-pointer-' || value, 1, now(), now() FROM generate_series(1, 400) AS value`, [], source)
    for (const table of ['sources', 'locale_variants', 'page_records', 'publication_snapshots', 'active_publication_pointers']) await runSQL(`ANALYZE ${table}`, [], source)
    const backupOutput = await mustPass('backup', 'scripts/phase1/backup.ts', [], source)
    await mustPass('restore-migration', 'scripts/phase1/apply-migration.ts', [], restore)
    const restoreOutput = await mustPass('restore', 'scripts/phase1/restore.ts', [], restore)
    const manifest = (output: string) => JSON.parse(output.trim().split('\n').filter((line) => line.startsWith('{')).at(-1) ?? '{}').manifest_hash
    if (!manifest(backupOutput) || manifest(backupOutput) !== manifest(restoreOutput)) throw new Error('fresh-target restore manifest mismatch')
    const created = await runSQL('INSERT INTO users (stable_id, identity_kind, email, login_attempts, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5) RETURNING id', ['01J000000000000000000009999', 'human', 'post-restore@fixture.invalid', 0, '2026-01-02T03:04:05.000Z'], restore)
    if (Number(created[0]?.id) <= 10) throw new Error('restored serial sequence reused an explicit fixture id')
    process.stdout.write(`${JSON.stringify({ run_id: runID, source_database_identity: sourceIdentity, restore_database_identity: restoreIdentity, manifest_hash: manifest(backupOutput), remote_status: 'NOT_RUN_REQUIRED_REMOTE' })}\n`)
  } finally {
    await cluster.stop().catch(() => {})
    await rm(clusterDirectory, { recursive: true, force: true })
    await rm(outputDirectory, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runMigrationRoundtrip()
