import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { ensurePersistentRuntime, resolvePersistentRuntimeChild, stopPersistentPostgres } from '../../../scripts/run-persistent-postgres'

describe('persistent local Payload runtime', () => {
  it('creates stable owner-private credentials without permitting schema push', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'bo-persistent-runtime-'))

    const first = await ensurePersistentRuntime({ rootDir })
    const second = await ensurePersistentRuntime({ rootDir })

    expect(second).toEqual(first)
    expect(first.databaseURL).toMatch(/^postgres:\/\/postgres:[^@]+@127\.0\.0\.1:\d+\/postgres$/)
    expect(first.payloadSecret.length).toBeGreaterThan(30)
    expect(first.rawEvidenceSignerSecret.length).toBeGreaterThan(30)
    expect(first.env.PAYLOAD_DB_PUSH).toBeUndefined()
    expect((await stat(path.join(rootDir, 'runtime.json'))).mode & 0o777).toBe(0o600)
    expect((await stat(rootDir)).mode & 0o777).toBe(0o700)
  })

  it('runs TypeScript child entrypoints through tsx rather than raw Node', () => {
    expect(resolvePersistentRuntimeChild(['scripts/import-higgsfield-snapshot.ts', '--dry-run'])).toEqual({
      executable: path.resolve(process.cwd(), 'node_modules/.bin/tsx'),
      arguments: ['scripts/import-higgsfield-snapshot.ts', '--dry-run'],
    })
  })

  it('waits for embedded-postgres to exit before clearing its exit-hook handle', async () => {
    const kill = vi.fn()
    let onExit: (() => void) | undefined
    const database = {
      process: {
        kill: (signal: NodeJS.Signals) => { kill(signal); queueMicrotask(() => onExit?.()); return true },
        once: (_event: 'exit', listener: () => void) => { onExit = listener },
      },
    }

    await stopPersistentPostgres(database)

    expect(kill).toHaveBeenCalledWith('SIGINT')
    expect(onExit).toBeDefined()
    expect(database.process).toBeUndefined()
  })

  it('escalates to SIGKILL but refuses to clear a PostgreSQL handle that stays alive', async () => {
    const kill = vi.fn(() => true)
    const database = {
      process: {
        kill,
        once: vi.fn(),
      },
    }

    await expect(stopPersistentPostgres(database, { graceMs: 0 })).rejects.toThrow('did not exit')
    expect(kill).toHaveBeenNthCalledWith(1, 'SIGINT')
    expect(kill).toHaveBeenNthCalledWith(2, 'SIGKILL')
    expect(database.process).toBeDefined()
  })
})
