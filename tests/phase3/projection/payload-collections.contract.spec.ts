import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { drizzle } from 'drizzle-orm/node-postgres'
import EmbeddedPostgres from 'embedded-postgres'
import { describe, expect, it } from 'vitest'

import { validateMediaEvidence } from '@/collections/MediaEvidence'
import { validateModuleEnvelopePayload } from '@/collections/ModuleEnvelopes'
import { PageProjections, validatePageProjection } from '@/collections/PageProjections'
import { serializePromptRelationshipUpdate } from '@/collections/PromptArtifacts'
import { PublicationProjections } from '@/collections/PublicationProjections'
import { APPLICATION_LOCALES } from '@/contracts/locale'
import { mediaEvidenceSchema } from '@/contracts/projection'
import { P3_GOLDEN_FIXTURES } from '@/page/fixtures'
import { up as upPayloadSchema } from '@/migrations-postgres/20260824_022230_phase1_payload_schema'
import { up as upLocaleRisk } from '@/migrations-postgres/20260825_022400_phase1_locale_risk'
import { up as upGoldenApproval } from '@/migrations-postgres/20260825_030000_phase1_golden_approval'
import { up as upProjectionPersistence } from '@/migrations-postgres/20260826_051335_phase3_projection_persistence'
import { up as upProjectionReviewFixes } from '@/migrations-postgres/20260826_053407_phase3_projection_review_fixes'
import { up as upPhaseAFixWave } from '@/migrations-postgres/20260826_070000_phase3_phasea_fix_wave'
import { up as upSourceProviderEnum } from '@/migrations-postgres/20260826_210000_source_provider_public_search'
import { up as upProjectionApplicationLocales } from '@/migrations-postgres/20260827_120000_projection_application_locales'

const ID = '00000000-0000-4000-8000-000000000101'
const OTHER_ID = '00000000-0000-4000-8000-000000000102'
const HASH = `sha256:v1:${'a'.repeat(64)}`
const SOURCE_REF = { type: 'source', id: ID }
const require = createRequire(import.meta.url)
const { Client } = require(path.resolve(process.cwd(), 'node_modules/.pnpm/pg@8.20.0/node_modules/pg')) as {
  Client: new (input: { connectionString: string }) => { connect: () => Promise<void>; end: () => Promise<void>; query: (statement: string) => Promise<{ rows: Record<string, unknown>[] }> }
}

const moduleData = () => ({ module_id: ID, page_id: OTHER_ID, locale: 'en', module_type: 'prompt', module_version: 1, source_refs: [SOURCE_REF], rights_state: 'first_party', generated_by: 'rpa', generator_version: 'rpa-v1', content_hash: HASH, observed_at: '2026-08-26T00:00:00.000Z', expires_at: null, review_state: 'approved', payload: { original_text: 'Use the source prompt.', source_ref: SOURCE_REF, redistribution_allowed: true, token_integrity_hash: 'integrity-v1', variation_of: null }, slot_key: 'primary', position: 0, dependency_hash: HASH, quality_result: { status: 'passed' }, risk_classes: [], visibility: 'public', renderer_version: 'renderer-v1' })

const projectionData = () => {
  const page = P3_GOLDEN_FIXTURES.hub.complete
  return { projection_id: ID, page_id: page.page_id, locale: page.locale, family: page.page_type, state: 'draft', dependency_hash: HASH, content_hash: HASH, link_hash: HASH, schema_hash: HASH, renderer_version: 'renderer-v1', validation_report_ref: 'private/validation/report-v1', workflow_run: 1, projection: { page, navigation: { version: 'v1', items: [] }, slots: [], attacker_supplied_bytes: { raw_source: 'never persist' } } }
}

const mediaData = () => ({ media_evidence_id: ID, source_ref: 1, source_version: HASH, workflow_run: 1, provider: 'x', provider_media_id: 'x-1', media_type: 'image', width: 640, height: 480, duration_ms: null, remote_url: 'https://pbs.twimg.com/media/x.jpg', thumbnail_url: null, observed_at: '2026-08-26T00:00:00.000Z', rights_state: 'display_licensed', sensitive_content_state: 'allowed', content_hash: HASH, visibility: 'internal_preview', delivery_target: 'x_cdn', preview_noindex: true, attribution_url: 'https://x.com/example/status/1' })

describe('Payload projection collections', () => {
  it('atomically claims and increments the PromptArtifact revision before a relationship update', async () => {
    const claimed: Record<string, unknown>[] = []
    const database = {
      update() {
        return { set: (values: Record<string, unknown>) => {
          claimed.push(values)
          return { where: () => ({ returning: async () => [{ id: 10 }] }) }
        } }
      },
    }
    const req = {
      transactionID: 'tx-prompt-relation',
      payload: { db: {
        sessions: { 'tx-prompt-relation': { db: database } },
        tables: { prompt_artifacts: { id: {}, revision: {} } },
      } },
    }
    await expect(serializePromptRelationshipUpdate({
      data: { model_refs: [41] }, operation: 'update', originalDoc: { id: 10, revision: 7 }, req,
    } as never)).resolves.toMatchObject({ model_refs: [41], revision: 8 })
    expect(claimed).toEqual([{ revision: 8 }])
  })

  it('rejects a stale relationship update whose expected PromptArtifact revision lost the CAS', async () => {
    const database = {
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
    }
    await expect(serializePromptRelationshipUpdate({
      data: { taxonomy_refs: [42] }, operation: 'update', originalDoc: { id: 10, revision: 9 },
      req: {
        transactionID: 'tx-stale-relation',
        payload: { db: {
          sessions: { 'tx-stale-relation': { db: database } },
          tables: { prompt_artifacts: { id: {}, revision: {} } },
        } },
      },
    } as never)).rejects.toThrow(/revision conflict/i)
  })

  it('uses the canonical 16-locale set for immutable projections and bindings', () => {
    const pageLocale = PageProjections.fields.find((field) => 'name' in field && field.name === 'locale')
    const bindingLocale = PublicationProjections.fields.find((field) => 'name' in field && field.name === 'locale')
    expect(pageLocale).toMatchObject({ options: [...APPLICATION_LOCALES] })
    expect(bindingLocale).toMatchObject({ options: [...APPLICATION_LOCALES] })
  })

  it('migrates the public-search provider enum additively', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bo-source-provider-enum-'))
    const server = createServer()
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    if (!address || typeof address === 'string') throw new Error('test could not reserve PostgreSQL port')
    const password = `provider_${globalThis.crypto.randomUUID().replaceAll('-', '')}`
    const cluster = new EmbeddedPostgres({ databaseDir: root, user: 'postgres', password, port: address.port, persistent: false, onLog: () => {} })
    const client = new Client({ connectionString: `postgres://postgres:${password}@127.0.0.1:${address.port}/postgres` })
    const db = drizzle(client as never)
    try {
      await cluster.initialise(); await cluster.start(); await client.connect()
      await upPayloadSchema({ db } as never)
      await upSourceProviderEnum({ db } as never)
      await expect(client.query("SELECT 'x_public_search'::enum_sources_provider AS provider"))
        .resolves.toMatchObject({ rows: [{ provider: 'x_public_search' }] })
    } finally {
      await client.end().catch(() => {})
      await cluster.stop().catch(() => {})
      await rm(root, { recursive: true, force: true })
    }
  })

  it('parses module bytes and replaces a supplied module hash', () => {
    const result = validateModuleEnvelopePayload({ data: moduleData(), operation: 'create' } as never) as Record<string, unknown>
    expect(result.payload).toEqual(moduleData().payload)
    expect(result.content_hash).not.toBe(HASH)
  })

  it('rejects a partial module update that tries to forge content_hash', () => {
    expect(() => validateModuleEnvelopePayload({ data: { content_hash: HASH }, operation: 'update', originalDoc: moduleData() } as never)).toThrow(/content_hash/i)
  })

  it('normalizes renderer projections and blocks direct released writes', () => {
    const result = validatePageProjection({ data: projectionData(), operation: 'create' } as never) as Record<string, unknown>
    expect(result.projection).toMatchObject({ page: projectionData().projection.page, navigation: { version: 'v1', items: [] }, slots: [] })
    expect(() => validatePageProjection({ data: { ...projectionData(), state: 'released' }, operation: 'create' } as never)).toThrow(/trusted release eligibility/i)
    expect(() => validatePageProjection({ data: { ...projectionData(), renderer_version: '' }, operation: 'create' } as never)).toThrow(/renderer_version/i)
  })

  it('rejects projection updates and deletes', () => {
    expect(() => validatePageProjection({ data: projectionData(), operation: 'update' } as never)).toThrow(/append-only/i)
    expect(() => PageProjections.hooks?.beforeDelete?.[0]!({} as never)).toThrow(/append-only/i)
  })

  it('validates and normalizes private media policy at the write boundary', () => {
    const { source_version, workflow_run, ...contract } = mediaData()
    const parsed = mediaEvidenceSchema.parse(contract)
    expect(validateMediaEvidence({ data: mediaData(), operation: 'create' } as never)).toMatchObject({ ...parsed, source_version, workflow_run })
    expect(() => validateMediaEvidence({ data: { ...mediaData(), visibility: 'public', preview_noindex: false }, operation: 'create' } as never)).toThrow(/public media requires/i)
    expect(() => validateMediaEvidence({ data: { ...mediaData(), preview_noindex: false }, operation: 'create' } as never)).toThrow(/noindex/i)
  })

  it('ignores Payload-managed identity and timestamps before strict evidence validation', () => {
    expect(validateMediaEvidence({
      data: { ...mediaData(), id: 101, createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z' },
      operation: 'create',
    } as never)).toMatchObject(mediaData())
  })

  it('persists the resolved Payload source database id in MediaEvidence', () => {
    const data = mediaData()
    const normalized = validateMediaEvidence({ data: { ...data, source_ref: 42 }, operation: 'create' } as never) as Record<string, unknown>
    expect(normalized.source_ref).toBe(42)
    expect(() => validateMediaEvidence({ data: { ...data, source_ref: SOURCE_REF }, operation: 'create' } as never)).toThrow(/source_ref/i)
  })

  it('rejects a malformed source version update to existing media evidence', () => {
    expect(() => validateMediaEvidence({
      data: { source_version: 'client-forged-version' },
      operation: 'update',
      originalDoc: mediaData(),
    } as never)).toThrow(/provenance/i)
  })

  it('rejects changed evidence facts on a legacy row without provenance', () => {
    const { source_version: _sourceVersion, workflow_run: _workflowRun, ...legacyEvidence } = mediaData()
    expect(() => validateMediaEvidence({
      data: { content_hash: HASH },
      operation: 'update',
      originalDoc: legacyEvidence,
    } as never)).toThrow(/provenance/i)
  })

  it('migrates a populated legacy module row with nullable projection fields', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bo-payload-projection-migration-'))
    const server = createServer()
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    if (!address || typeof address === 'string') throw new Error('test could not reserve PostgreSQL port')
    const password = `projection_${globalThis.crypto.randomUUID().replaceAll('-', '')}`
    const cluster = new EmbeddedPostgres({ databaseDir: root, user: 'postgres', password, port: address.port, persistent: false, onLog: () => {} })
    const client = new Client({ connectionString: `postgres://postgres:${password}@127.0.0.1:${address.port}/postgres` })
    const db = drizzle(client as never)
    try {
      await cluster.initialise(); await cluster.start(); await client.connect()
      await upPayloadSchema({ db } as never); await upLocaleRisk({ db } as never); await upGoldenApproval({ db } as never)
      await client.query(`INSERT INTO module_envelopes (stable_id, source_version, module_id, page_id, locale, module_type, module_version, rights_state, content_hash, generated_by, observed_at, review_state) VALUES ('legacy-row', 'legacy-v1', 'legacy-module', 'legacy-page', 'en', 'prompt', 1, 'first_party', '${HASH}', 'rpa', '2026-08-26T00:00:00.000Z', 'approved')`)
      await expect(upProjectionPersistence({ db } as never)).resolves.toBeUndefined()
      await expect(upProjectionApplicationLocales({ db } as never)).resolves.toBeUndefined()
      const enumLocales = await client.query('SELECT unnest(enum_range(NULL::enum_page_projections_locale))::text AS locale')
      expect(enumLocales.rows.map((row) => row.locale)).toEqual(expect.arrayContaining([...APPLICATION_LOCALES]))
      await client.query(`INSERT INTO sources (stable_id, source_version, provider, provider_record_id, canonical_url, raw_ref, captured_at, content_hash, rights_state, deletion_state) VALUES ('media-source', 'media-v1', 'first_party', 'media-source', 'https://example.invalid/source', '{}'::jsonb, '2026-08-26T00:00:00.000Z', '${HASH}', 'first_party', 'active')`)
      await client.query(`INSERT INTO media_evidence (media_evidence_id, source_ref_id, provider, provider_media_id, media_type, remote_url, observed_at, rights_state, sensitive_content_state, content_hash, visibility, delivery_target, preview_noindex) VALUES ('legacy-media', 1, 'first_party', 'legacy-media', 'image', 'https://cdn.example.invalid/legacy.jpg', '2026-08-26T00:00:00.000Z', 'first_party', 'allowed', '${HASH}', 'private_evidence', 'private_reference', true)`)
      await expect(upProjectionReviewFixes({ db } as never)).resolves.toBeUndefined()
      await expect(upPhaseAFixWave({ db } as never)).resolves.toBeUndefined()
      await expect(client.query("SELECT payload, slot_key, dependency_hash, renderer_version FROM module_envelopes WHERE stable_id = 'legacy-row'"))
        .resolves.toMatchObject({ rows: [{ payload: null, slot_key: null, dependency_hash: null, renderer_version: null }] })
      await expect(client.query("SELECT source_version, workflow_run_id FROM media_evidence WHERE media_evidence_id = 'legacy-media'"))
        .resolves.toMatchObject({ rows: [{ source_version: null, workflow_run_id: null }] })
    } finally {
      await client.end().catch(() => {}); await cluster.stop().catch(() => {}); await rm(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('migrates populated ambiguous legacy edges fail-closed without fabricating canonical semantics', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bo-edge-legacy-migration-'))
    const server = createServer()
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    if (!address || typeof address === 'string') throw new Error('test could not reserve PostgreSQL port')
    const password = `edge_${globalThis.crypto.randomUUID().replaceAll('-', '')}`
    const cluster = new EmbeddedPostgres({ databaseDir: root, user: 'postgres', password, port: address.port, persistent: false, onLog: () => {} })
    const client = new Client({ connectionString: `postgres://postgres:${password}@127.0.0.1:${address.port}/postgres` })
    const db = drizzle(client as never)
    try {
      await cluster.initialise(); await cluster.start(); await client.connect()
      await upPayloadSchema({ db } as never); await upLocaleRisk({ db } as never); await upGoldenApproval({ db } as never)
      await client.query(`INSERT INTO edges (stable_id, source_version, "from_key", relation, "to_key", confidence, review_state) VALUES ('legacy-edge', 'legacy-v1', 'source:one', 'belongs_to', 'taxonomy:two', 0.5, 'candidate')`)
      await expect(upProjectionPersistence({ db } as never)).resolves.toBeUndefined()
      await expect(upPhaseAFixWave({ db } as never)).resolves.toBeUndefined()
      await expect(client.query("SELECT relation, legacy_relation_label, relation_migration_state, review_state FROM edges WHERE stable_id = 'legacy-edge'"))
        .resolves.toMatchObject({ rows: [{ relation: null, legacy_relation_label: 'belongs_to', relation_migration_state: 'requires_review', review_state: 'candidate' }] })
    } finally {
      await client.end().catch(() => {}); await cluster.stop().catch(() => {}); await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
