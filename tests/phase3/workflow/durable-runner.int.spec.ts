import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Payload } from 'payload'
import EmbeddedPostgres from 'embedded-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { principals } from '@/access/principals'
import { authorizeWorkflowWorker, claimOldestQueuedRun, succeedRun, type DurableWorkflowRun, WorkflowLeaseCapabilityError, WorkflowLeaseLostError, WorkflowWorkerAuthenticationError } from '@/workflow/payload-lease'
import { StaleWorkflowSourceError, WorkflowHandlerError, WorkflowRegistry, type WorkflowOutputRef } from '@/workflow/registry'
import { runNextWorkflow } from '@/workflow/runner'

const HASH = `sha256:v1:${'a'.repeat(64)}`
const CORRELATION_ID = '01J123456789ABCDEFGHJKMNPR'
const WORKER_RUN: DurableWorkflowRun = {
  id: 1,
  stable_id: '01J123456789ABCDEFGHJKMNPQ',
  revision: 2,
  source_version: HASH,
  status: 'running',
  job_type: 'project_page',
  idempotency_key: 'project-page:writer-contract',
  attempt: 0,
  input_ref: 'workflow://page/example',
  output_ref: null,
  error_class: null,
  lease_owner: 'worker-contract',
  lease_expires_at: '2026-08-26T00:01:00.000Z',
  audit: { correlation_id: CORRELATION_ID },
}

const WORKER_A = authorizeWorkflowWorker(principals.ingestService)
const WORKER_B = authorizeWorkflowWorker(principals.translateService)
const WORKER_C = authorizeWorkflowWorker(principals.publishService)
const WORKER_D = authorizeWorkflowWorker(principals.withdrawService)
const WORKER_B_ID = principals.translateService.id
const WORKER_C_ID = principals.publishService.id
const outputRef = (value: string): WorkflowOutputRef => value as WorkflowOutputRef

const reservePort = async (): Promise<number> => {
  const server = createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  if (address === null || typeof address === 'string') throw new Error('workflow test could not reserve a PostgreSQL port')
  return address.port
}

let payload: Payload
let database: EmbeddedPostgres
let databaseDirectory: string

beforeAll(async () => {
  databaseDirectory = await mkdtemp(join(tmpdir(), 'bo-workflow-runner-'))
  const port = await reservePort()
  const password = `workflow_${globalThis.crypto.randomUUID().replaceAll('-', '')}`
  database = new EmbeddedPostgres({ databaseDir: databaseDirectory, user: 'postgres', password, port, persistent: false, onLog: () => {} })
  await database.initialise()
  await database.start()
  process.env.DATABASE_URL = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`
  process.env.DB_POOL_MAX = '5'
  process.env.PAYLOAD_DB_PUSH = 'true'
  process.env.PAYLOAD_SECRET = 'workflow-runner-integration-test-only'
  const [{ getPayload }, { createPayloadConfig }] = await Promise.all([import('payload'), import('@/payload.config')])
  payload = await getPayload({ config: createPayloadConfig() })
}, 60_000)

afterAll(async () => {
  const pool = payload?.db.pool as unknown as { end: () => Promise<void>; _clients?: Array<{ release?: (destroy?: boolean) => void }> } | undefined
  await payload?.destroy().catch(() => {})
  for (const client of pool?._clients ?? []) {
    try {
      client.release?.(true)
    } catch (error) {
      if (!(error instanceof Error) || !/already been released/i.test(error.message)) throw error
    }
  }
  await pool?.end().catch(() => {})
  await database?.stop().catch(() => {})
  await rm(databaseDirectory, { recursive: true, force: true })
})

const queuedRun = async (key: string) => payload.create({
  collection: 'workflow-runs',
  overrideAccess: true,
  data: { source_version: HASH, job_type: 'project_page', idempotency_key: key, attempt: 0, input_ref: 'workflow://page/example', output_ref: null, error_class: null } as never,
})

describe('durable workflow runner', () => {
  it('processes one idempotent run exactly once across two PostgreSQL workers', async () => {
    const run = await queuedRun(`project-page:postgres:${globalThis.crypto.randomUUID()}`)
    let calls = 0
    const leftRegistry = new WorkflowRegistry()
    const rightRegistry = new WorkflowRegistry()
    for (const registry of [leftRegistry, rightRegistry]) registry.register('project_page', async (command) => {
      calls += 1
      command.output.write('private/workflow-output/project-page-example')
    })

    const [left, right] = await Promise.all([runNextWorkflow(payload, leftRegistry, WORKER_A), runNextWorkflow(payload, rightRegistry, WORKER_B)])
    const stored = await payload.findByID({ collection: 'workflow-runs', id: run.id, overrideAccess: true })
    const audits = await payload.find({
      collection: 'audit-events', overrideAccess: true,
      where: { and: [{ entity_type: { equals: 'workflow-runs' } }, { entity_stable_id: { equals: run.stable_id } }, { event_type: { equals: 'workflow-runs.state_transition' } }] },
      sort: 'occurred_at',
    })

    expect([left, right].filter((value) => value === 'processed')).toHaveLength(1)
    expect(calls).toBe(1)
    expect(stored).toMatchObject({ status: 'succeeded', revision: 3, output_ref: 'private/workflow-output/project-page-example', error_class: null })
    expect(audits.docs).toHaveLength(2)
    expect(audits.docs.map((audit) => [audit.reason_code, audit.prior_state, audit.new_state])).toEqual([
      ['workflow_claimed', { revision: 1, status: 'queued' }, { revision: 2, status: 'running' }],
      ['workflow_succeeded', { revision: 2, status: 'running' }, { revision: 3, status: 'succeeded' }],
    ])
  }, 60_000)

  it('reclaims an expired running lease with a fresh owner and auditable takeover', async () => {
    const run = await queuedRun(`project-page:expired:${globalThis.crypto.randomUUID()}`)
    await (payload.db as unknown as { drizzle: { execute: (query: unknown) => Promise<unknown> } }).drizzle.execute(
      `UPDATE workflow_runs SET status = 'running', revision = 2, lease_owner = 'crashed-worker', lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = ${Number(run.id)}`,
    )
    const claimed = await claimOldestQueuedRun(payload, WORKER_C)
    const stored = await payload.findByID({ collection: 'workflow-runs', id: run.id, overrideAccess: true })
    const audits = await payload.find({ collection: 'audit-events', overrideAccess: true, where: { entity_stable_id: { equals: run.stable_id } }, sort: 'occurred_at' })

    expect(claimed?.run).toMatchObject({ id: run.id, status: 'running', lease_owner: WORKER_C_ID })
    expect(stored).toMatchObject({ status: 'running', revision: 3, lease_owner: WORKER_C_ID })
    expect(audits.docs).toEqual(expect.arrayContaining([expect.objectContaining({ reason_code: 'workflow_lease_taken_over' })]))
  })

  it('rejects a stale worker terminal transition after lease expiry and takeover', async () => {
    const run = await queuedRun(`project-page:takeover-terminal:${globalThis.crypto.randomUUID()}`)
    const firstLease = await claimOldestQueuedRun(payload, WORKER_A)
    expect(firstLease?.run.id).toBe(run.id)
    await (payload.db as unknown as { drizzle: { execute: (query: unknown) => Promise<unknown> } }).drizzle.execute(
      `UPDATE workflow_runs SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = ${Number(run.id)}`,
    )
    const takeoverLease = await claimOldestQueuedRun(payload, WORKER_B)
    expect(takeoverLease?.run).toMatchObject({ id: run.id, lease_owner: WORKER_B_ID, status: 'running' })

    await expect(succeedRun(payload, firstLease!, outputRef('private/workflow-output/stale-worker'))).rejects.toBeInstanceOf(WorkflowLeaseLostError)
    await expect(payload.findByID({ collection: 'workflow-runs', id: run.id, overrideAccess: true })).resolves.toMatchObject({ status: 'running', lease_owner: WORKER_B_ID, revision: 3 })
    await succeedRun(payload, takeoverLease!, outputRef('private/workflow-output/takeover-recovered'))
  })

  it('uses private claim facts when a genuine receipt public fields are forged toward another run', async () => {
    const claimedRun = await queuedRun(`project-page:receipt-private:${globalThis.crypto.randomUUID()}`)
    const genuineReceipt = await claimOldestQueuedRun(payload, WORKER_A)
    expect(genuineReceipt?.run.id).toBe(claimedRun.id)
    const targetRun = await queuedRun(`project-page:receipt-target:${globalThis.crypto.randomUUID()}`)
    const targetReceipt = await claimOldestQueuedRun(payload, WORKER_B)
    expect(targetReceipt?.run.id).toBe(targetRun.id)
    await (payload.db as unknown as { drizzle: { execute: (query: unknown) => Promise<unknown> } }).drizzle.execute(
      `UPDATE workflow_runs SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = ${Number(claimedRun.id)}`,
    )

    const forged = genuineReceipt as unknown as { run: Record<string, unknown>; worker: Record<string, unknown> }
    forged.run.id = targetReceipt!.run.id
    forged.run.revision = targetReceipt!.run.revision
    forged.run.stable_id = targetReceipt!.run.stable_id
    forged.run.lease_owner = WORKER_B_ID
    forged.run.lease_expires_at = targetReceipt!.run.lease_expires_at
    forged.worker.id = WORKER_B_ID

    await expect(succeedRun(payload, genuineReceipt!, outputRef('private/workflow-output/forged-receipt'))).rejects.toBeInstanceOf(WorkflowLeaseLostError)
    await expect(payload.findByID({ collection: 'workflow-runs', id: targetRun.id, overrideAccess: true })).resolves.toMatchObject({ status: 'running', lease_owner: WORKER_B_ID })
    await succeedRun(payload, targetReceipt!, outputRef('private/workflow-output/target-cleanup'))
    const recoveredReceipt = await claimOldestQueuedRun(payload, WORKER_D)
    expect(recoveredReceipt?.run.id).toBe(claimedRun.id)
    await succeedRun(payload, recoveredReceipt!, outputRef('private/workflow-output/forged-receipt-recovered'))
  })

  it('allows a handler to write exactly one bounded output reference', async () => {
    const registry = new WorkflowRegistry()
    registry.register('project_page', async (command) => {
      command.output.write('private/workflow-output/one-use')
      expect(() => command.output.write('private/workflow-output/two')).toThrow(WorkflowHandlerError)
    })

    await expect(registry.execute(WORKER_RUN)).resolves.toEqual({ outputRef: 'private/workflow-output/one-use' })
  })

  it.each([['invalid', 'https://example.test/output'], ['oversize', `private/${'a'.repeat(1025)}`]])(
    'rejects %s output references before a Payload transition',
    async (_case, outputRef) => {
      const registry = new WorkflowRegistry()
      registry.register('project_page', async (command) => { command.output.write(outputRef) })

      await expect(registry.execute(WORKER_RUN)).rejects.toMatchObject({ workflowErrorClass: 'invalid_output_ref' })
    },
  )

  it('records stale source versions and rethrows handler failures through durable terminal states', async () => {
    const stale = await queuedRun(`project-page:stale:${globalThis.crypto.randomUUID()}`)
    const staleRegistry = new WorkflowRegistry()
    staleRegistry.register('project_page', async () => { throw new StaleWorkflowSourceError() })
    await expect(runNextWorkflow(payload, staleRegistry, WORKER_C)).rejects.toThrow('workflow source version is stale')
    await expect(payload.findByID({ collection: 'workflow-runs', id: stale.id, overrideAccess: true })).resolves.toMatchObject({ status: 'stale_ignored', revision: 3 })

    const failed = await queuedRun(`project-page:failed:${globalThis.crypto.randomUUID()}`)
    const failedRegistry = new WorkflowRegistry()
    failedRegistry.register('project_page', async () => { throw new Error('upstream transport failed') })
    await expect(runNextWorkflow(payload, failedRegistry, WORKER_D)).rejects.toThrow('upstream transport failed')
    await expect(payload.findByID({ collection: 'workflow-runs', id: failed.id, overrideAccess: true })).resolves.toMatchObject({ status: 'failed', revision: 3, error_class: 'handler_error' })
  })

  it('rejects a direct queued terminal transition without an acquired lease receipt', async () => {
    const run = await queuedRun(`project-page:queued-terminal:${globalThis.crypto.randomUUID()}`)
    await expect(succeedRun(payload, { run, worker: principals.ingestService } as never, outputRef('private/workflow-output/forged'))).rejects.toBeInstanceOf(WorkflowLeaseCapabilityError)
    await expect(payload.findByID({ collection: 'workflow-runs', id: run.id, overrideAccess: true })).resolves.toMatchObject({ status: 'queued', revision: 1 })
  })

  it('rejects structural service impersonation at worker authorization issuance', () => {
    expect(() => authorizeWorkflowWorker({ ...principals.ingestService })).toThrow(WorkflowWorkerAuthenticationError)
  })
})
