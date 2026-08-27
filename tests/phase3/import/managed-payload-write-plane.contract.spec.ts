import { readFile } from 'node:fs/promises'

import { describe, expect, it, vi } from 'vitest'

import {
  parseManagedPayloadMigrationArgs,
  runManagedPayloadMigration,
  runManagedPayloadWritePlane,
} from '../../../scripts/managed-payload'

const managedEnvironment = Object.freeze({
  DATABASE_URL: 'postgres://operator:password@example.test:5432/pseo?sslmode=require',
  PAYLOAD_SECRET: 'managed-payload-secret-that-is-long-enough',
  RAW_EVIDENCE_STORE_DIR: '/private/pseo-evidence',
  RAW_EVIDENCE_SIGNER_SECRET: 'managed-evidence-signer-that-is-long-enough',
  PAYLOAD_DB_PUSH: 'true',
})

describe('managed Payload write-plane commands', () => {
  it('declares migration-gated managed asset and collector commands', async () => {
    const manifest = JSON.parse(await readFile('package.json', 'utf8')) as { scripts: Record<string, string> }

    expect(manifest.scripts['payload:migrate']).toContain('scripts/managed-payload-migrate.ts')
    expect(manifest.scripts['payload:managed:import:assets']).toContain('scripts/managed-payload-import-assets-root.ts')
    expect(manifest.scripts['payload:managed:collect:twitter241']).toContain('scripts/managed-payload-collect-twitter241.ts')
  })

  it('requires an argument-free migration command', () => {
    expect(parseManagedPayloadMigrationArgs([])).toEqual({})
    expect(() => parseManagedPayloadMigrationArgs(['--unsafe'])).toThrow(/unknown managed migration argument/i)
  })

  it('fails closed before migrating when managed database credentials are missing', async () => {
    const migrate = vi.fn(async () => undefined)

    await expect(runManagedPayloadMigration({}, { migrate })).rejects.toThrow(/DATABASE_URL is required/i)

    expect(migrate).not.toHaveBeenCalled()
  })

  it('runs the reviewed migration before an asset write and suppresses schema push for both steps', async () => {
    const observed: string[] = []
    const migrate = vi.fn(async () => {
      observed.push(`migrate:${process.env.PAYLOAD_DB_PUSH ?? 'unset'}`)
      return { applied: ['one'] }
    })
    const write = vi.fn(async () => {
      observed.push(`write:${process.env.PAYLOAD_DB_PUSH ?? 'unset'}`)
      return { imported: true }
    })

    const result = await runManagedPayloadWritePlane({
      environment: managedEnvironment,
      migrate,
      write,
    })

    expect(result).toEqual({ migration: { applied: ['one'] }, write: { imported: true } })
    expect(observed).toEqual(['migrate:unset', 'write:unset'])
    expect(migrate).toHaveBeenCalledBefore(write)
    expect(process.env.PAYLOAD_DB_PUSH).not.toBe('true')
  })

  it('does not run an importer if migration rejects', async () => {
    const write = vi.fn(async () => ({ imported: true }))

    await expect(runManagedPayloadWritePlane({
      environment: managedEnvironment,
      migrate: async () => { throw new Error('migration ledger rejected') },
      write,
    })).rejects.toThrow('migration ledger rejected')

    expect(write).not.toHaveBeenCalled()
  })
})
