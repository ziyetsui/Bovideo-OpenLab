import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { drizzle } from 'drizzle-orm/node-postgres'
import EmbeddedPostgres from 'embedded-postgres'
import { describe, expect, it } from 'vitest'

import { PHASE1_MIGRATION_PLAN } from '../../../scripts/phase1/migration-plan'
import { up as upPayloadSchema } from '../../../src/migrations-postgres/20260824_022230_phase1_payload_schema'
import { down as downLocaleRisk, up as upLocaleRisk } from '../../../src/migrations-postgres/20260825_022400_phase1_locale_risk'
import { down as downGoldenApproval, up as upGoldenApproval } from '../../../src/migrations-postgres/20260825_030000_phase1_golden_approval'

type PgClient = {
  connect: () => Promise<void>
  end: () => Promise<void>
  query: (query: string) => Promise<{ rows: Record<string, unknown>[] }>
}
const require = createRequire(import.meta.url)
const { Client } = require(path.resolve(process.cwd(), 'node_modules/.pnpm/pg@8.20.0/node_modules/pg')) as {
  Client: new (input: { connectionString: string }) => PgClient
}

describe('P1-T03 migration plan', () => {
  it('applies every registered Phase 1 migration in version order', () => {
    expect(PHASE1_MIGRATION_PLAN.map((migration) => migration.name)).toEqual([
      '20260824_022230_phase1_payload_schema',
      '20260825_022400_phase1_locale_risk',
      '20260825_030000_phase1_golden_approval',
    ])
  })

  it('preserves persisted locale-risk facts through restore-required rollback and replay on PostgreSQL', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bo-p1-golden-migration-'))
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    if (address === null || typeof address === 'string') throw new Error('test could not reserve a PostgreSQL port')

    const password = `phase1_${globalThis.crypto.randomUUID().replaceAll('-', '')}`
    const cluster = new EmbeddedPostgres({ databaseDir: root, user: 'postgres', password, port: address.port, persistent: false, onLog: () => {} })
    const client = new Client({ connectionString: `postgres://postgres:${password}@127.0.0.1:${address.port}/postgres` })
    const db = drizzle(client as never)
    try {
      await cluster.initialise()
      await cluster.start()
      await client.connect()

      await upPayloadSchema({ db } as never)
      await upLocaleRisk({ db } as never)
      const localeVariant = await client.query(`
        INSERT INTO "locale_variants" (
          "stable_id", "source_version", "entity_key", "locale", "source_locale",
          "translation_model", "translation_prompt_version", "localized_fields", "content_revision"
        ) VALUES (
          'locale-risk-rollback-fixture', 'fixture-v1', 'locale-risk-entity', 'en', 'en',
          'fixture-model', 'fixture-prompt', '{}'::jsonb, 1
        )
        RETURNING "id"
      `)
      const localeVariantID = Number(localeVariant.rows[0]?.id)
      if (!Number.isInteger(localeVariantID)) throw new Error('locale risk fixture parent was not created')
      await client.query(`
        INSERT INTO "locale_variants_risk_classes" ("order", "parent_id", "value") VALUES
          (1, ${localeVariantID}, 'money'),
          (2, ${localeVariantID}, 'legal_rights')
      `)

      await downLocaleRisk({ db } as never)
      await expect(upLocaleRisk({ db } as never)).resolves.toBeUndefined()
      await expect(client.query(`
        SELECT "value"::text AS "value"
        FROM "locale_variants_risk_classes"
        WHERE "parent_id" = ${localeVariantID}
        ORDER BY "order"
      `)).resolves.toMatchObject({ rows: [{ value: 'money' }, { value: 'legal_rights' }] })

      await upGoldenApproval({ db } as never)
      await downGoldenApproval({ db } as never)
      await expect(upGoldenApproval({ db } as never)).resolves.toBeUndefined()
      await expect(client.query("SELECT to_regclass('public.golden_replacement_approvals') AS table_name")).resolves.toMatchObject({
        rows: [{ table_name: 'golden_replacement_approvals' }],
      })
    } finally {
      await client.end().catch(() => {})
      await cluster.stop().catch(() => {})
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
