import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

import EmbeddedPostgres from 'embedded-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const nodeRuntime = process.execPath
const pgModule = path.resolve('node_modules/.pnpm/pg@8.20.0/node_modules/pg')
const tsx = path.resolve('node_modules/tsx/dist/cli.mjs')
const sqlProgram = `const { Client } = require(${JSON.stringify(pgModule)}); const [, statement, values] = process.argv; const client = new Client({ connectionString: process.env.DATABASE_URL }); (async () => { await client.connect(); const result = await client.query(statement, JSON.parse(values)); console.log(JSON.stringify(result.rows)); await client.end(); })().catch(async (error) => { console.error(error.stack || error); try { await client.end(); } catch {} process.exitCode = 1 })`

const reservePort = async (): Promise<number> => {
  const server = createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  if (!address || typeof address === 'string') throw new Error('unable to reserve local PostgreSQL port')
  return address.port
}

const execute = async (args: string[], environment: NodeJS.ProcessEnv): Promise<{ code: number; output: string }> => new Promise((resolve, reject) => {
  const child = spawn(nodeRuntime, args, { cwd: process.cwd(), env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (value) => { output += String(value) })
  child.stderr.on('data', (value) => { output += String(value) })
  child.once('error', reject)
  child.once('close', (code) => resolve({ code: code ?? 1, output }))
})

let cluster: EmbeddedPostgres
let clusterDirectory: string
let port: number
let password: string
const caseDirectories: string[] = []

const createCase = async () => {
  const suffix = globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 12)
  const databaseIdentity = `bo_p1_t03_${suffix}_source`
  const outputDirectory = await mkdtemp(path.join(tmpdir(), 'bo-p1-t03-seed-test-'))
  caseDirectories.push(outputDirectory)
  await cluster.createDatabase(databaseIdentity)
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: `postgres://postgres:${password}@127.0.0.1:${port}/${databaseIdentity}`,
    DB_POOL_MAX: '3',
    PAYLOAD_DB_PUSH: 'false',
    PAYLOAD_SECRET: 'phase1-local-seed-test-only',
    PHASE1_RUN_ID: `p1l-${suffix}`,
    PHASE1_DATABASE_IDENTITY: databaseIdentity,
    PHASE1_OUTPUT_DIR: outputDirectory,
  }
  const apply = await execute([tsx, 'scripts/phase1/apply-migration.ts'], environment)
  expect(apply.code, apply.output).toBe(0)
  const seed = async (...args: string[]) => execute([tsx, 'scripts/phase1/seed.ts', '--batch-size', '1000', ...args], environment)
  const sql = async (statement: string, values: readonly unknown[] = []): Promise<Record<string, unknown>[]> => {
    const result = await execute(['-e', sqlProgram, statement, JSON.stringify(values)], environment)
    if (result.code !== 0) throw new Error(result.output)
    return JSON.parse(result.output) as Record<string, unknown>[]
  }
  const baseline = await seed()
  expect(baseline.code, baseline.output).toBe(0)
  const checkpointPath = path.join(outputDirectory, 'seed-checkpoint.json')
  const checkpoint = async () => (await sql('SELECT run_id, database_identity, schema_version, query_hash, input_hash, cursor, attempt, created_at::text, updated_at::text FROM phase1_fixture_checkpoints WHERE run_id = $1', [environment.PHASE1_RUN_ID]))[0]
  const resetTo = async (cursor: number) => {
    const current = await checkpoint()
    await sql('UPDATE phase1_fixture_checkpoints SET cursor = $1, attempt = $1 WHERE run_id = $2', [cursor, environment.PHASE1_RUN_ID])
    const mirror = JSON.parse(await readFile(checkpointPath, 'utf8')) as Record<string, unknown>
    mirror.cursor = cursor
    mirror.attempt = cursor
    await writeFile(checkpointPath, `${JSON.stringify(mirror)}\n`, 'utf8')
    return current
  }
  return { environment, outputDirectory, checkpointPath, seed, sql, checkpoint, resetTo }
}

describe('P1-T03 production seed checkpoint integration', () => {
  beforeAll(async () => {
    clusterDirectory = await mkdtemp(path.join(tmpdir(), 'bo-p1-t03-seed-cluster-'))
    port = await reservePort()
    password = `p1t03${globalThis.crypto.randomUUID().replaceAll('-', '')}`
    cluster = new EmbeddedPostgres({ databaseDir: clusterDirectory, user: 'postgres', password, port, persistent: false, onLog: () => {} })
    await cluster.initialise()
    await cluster.start()
  }, 60_000)

  afterAll(async () => {
    await cluster.stop().catch(() => {})
    await rm(clusterDirectory, { recursive: true, force: true })
    await Promise.all(caseDirectories.map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('rejects a corrupt canonical scalar row and leaves the batch checkpoint unchanged', async () => {
    const fixture = await createCase()
    await fixture.resetTo(1)
    await fixture.sql('UPDATE sources SET status = $1 WHERE id = 1', ['removed'])
    const before = await fixture.checkpoint()
    const result = await fixture.seed()
    expect(result.code).not.toBe(0)
    expect(result.output).toContain('FixtureConflictError')
    expect(await fixture.checkpoint()).toEqual(before)
    expect((await fixture.sql('SELECT status FROM sources WHERE id = 1'))[0]?.status).toBe('removed')
  }, 60_000)

  it('rolls back a partially inserted relation when a later canonical row conflicts', async () => {
    const fixture = await createCase()
    await fixture.resetTo(1)
    await fixture.sql('DELETE FROM prompt_artifacts_rels WHERE id = 10')
    await fixture.sql('UPDATE prompt_artifacts_rels SET prompt_artifacts_id = $1 WHERE id = 11', [2])
    const before = await fixture.checkpoint()
    const result = await fixture.seed()
    expect(result.code).not.toBe(0)
    expect((await fixture.sql('SELECT count(*)::int AS count FROM prompt_artifacts_rels WHERE id = 10'))[0]?.count).toBe(0)
    expect(await fixture.checkpoint()).toEqual(before)
  }, 60_000)

  it('rejects added or missing fixture relations before a completed replay writes', async () => {
    const fixture = await createCase()
    const before = await fixture.checkpoint()
    await fixture.sql('INSERT INTO prompt_artifacts_rels (id, "order", parent_id, path, taxonomy_nodes_id) VALUES (999, 1, 1, $1, 1)', ['model_refs'])
    const added = await fixture.seed()
    expect(added.code).not.toBe(0)
    expect(added.output).toContain('prompt_artifacts_rels fixture coverage expected')
    expect(await fixture.checkpoint()).toEqual(before)
    await fixture.sql('DELETE FROM prompt_artifacts_rels WHERE id = 999')
    await fixture.sql('DELETE FROM prompt_artifacts_rels WHERE id = 10')
    const missing = await fixture.seed()
    expect(missing.code).not.toBe(0)
    expect(missing.output).toContain('prompt_artifacts_rels fixture coverage expected')
    expect(await fixture.checkpoint()).toEqual(before)
  }, 60_000)

  it('replays an identical full fixture without adding rows and preserves its checkpoint', async () => {
    const fixture = await createCase()
    const before = await fixture.sql('SELECT (SELECT count(*) FROM sources)::int AS sources, (SELECT count(*) FROM prompt_artifacts_rels)::int AS relations, (SELECT count(*) FROM audit_events)::int AS audit_events')
    const checkpointBefore = await fixture.checkpoint()
    await fixture.resetTo(0)
    const result = await fixture.seed()
    expect(result.code, result.output).toBe(0)
    expect(await fixture.sql('SELECT (SELECT count(*) FROM sources)::int AS sources, (SELECT count(*) FROM prompt_artifacts_rels)::int AS relations, (SELECT count(*) FROM audit_events)::int AS audit_events')).toEqual(before)
    expect(await fixture.checkpoint()).toEqual(checkpointBefore)
  }, 60_000)

  it('rejects divergent or torn mirrors before writes and repairs only database-to-file', async () => {
    const fixture = await createCase()
    const canonicalMirror = JSON.parse(await readFile(fixture.checkpointPath, 'utf8')) as Record<string, unknown>
    const before = await fixture.sql('SELECT count(*)::int AS sources FROM sources')
    const writeMirror = async (changes: Record<string, unknown>) => {
      await writeFile(fixture.checkpointPath, `${JSON.stringify({ ...canonicalMirror, ...changes })}\n`, 'utf8')
    }
    await writeMirror({ cursor: 0, attempt: 0 })
    expect((await fixture.seed()).code).not.toBe(0)
    await writeMirror({ cursor: 7, attempt: 7 })
    expect((await fixture.seed()).code).not.toBe(0)
    await writeMirror({ database_identity: 'bo_p1_t03_other_source' })
    expect((await fixture.seed()).code).not.toBe(0)
    await writeFile(fixture.checkpointPath, '{torn\n', 'utf8')
    expect((await fixture.seed()).code).not.toBe(0)
    expect(await fixture.sql('SELECT count(*)::int AS sources FROM sources')).toEqual(before)
    await unlink(fixture.checkpointPath)
    const repaired = await fixture.seed('--repair-checkpoint')
    expect(repaired.code, repaired.output).toBe(0)
    expect(JSON.parse(await readFile(fixture.checkpointPath, 'utf8')).cursor).toBe((await fixture.checkpoint()).cursor)
    await expect(readFile(path.join(fixture.outputDirectory, 'seed-checkpoint-repair.json'), 'utf8')).resolves.toContain('database-authoritative-checkpoint')
  }, 90_000)
})
