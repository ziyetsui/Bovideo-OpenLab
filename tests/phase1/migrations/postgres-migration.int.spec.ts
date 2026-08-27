import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const migrationDirectory = path.resolve(process.cwd(), 'src/migrations-postgres')

describe('P1-T03 PostgreSQL migration', () => {
  it('ships a versioned additive schema migration for every Payload collection', async () => {
    const migrations = await readdir(migrationDirectory)
    const migrationName = migrations.find((name) => name.endsWith('_phase1_payload_schema.ts'))

    expect(migrationName).toBeDefined()

    const migration = await readFile(path.join(migrationDirectory, migrationName!), 'utf8')
    expect(migration).toContain('schema_version')
    expect(migration).toContain('payload_migrations')
    expect(migration).toContain('object_ref')
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX|SCHEMA)\b/i)
  })
})
