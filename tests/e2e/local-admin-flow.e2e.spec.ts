import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import config from '@/payload.config'
import { principals } from '@/access/principals'
import { LocalObjectStore } from '@/storage/local-object-store'
import { buildContentAddressedKey, type ObjectRef } from '@/storage/object-ref'
import { createObjectAuthority, createObjectIngressCommand, withObjectAuthority } from '@/storage/payload-object-authority'
import { getPayload } from 'payload'

import { login } from '../helpers/login'
import { seedTestUser, testUser } from '../helpers/seedUser'

type Identifier = number | string
type PayloadDocument = { id: Identifier; [key: string]: unknown }

async function read(request: APIRequestContext, path: string): Promise<PayloadDocument> {
  const response = await request.get(path)
  if (!response.ok()) throw new Error(`GET ${path} failed (${response.status()}): ${await response.text()}`)
  return (await response.json()) as PayloadDocument
}

async function choose(page: Page, fieldPath: string, value: string): Promise<void> {
  const field = page.locator(`#field-${fieldPath}`)
  const combobox = field.getByRole('combobox')
  await combobox.click()
  await page.getByRole('option', { name: value, exact: true }).click()
}

test.describe('local Admin editorial lifecycle', () => {
  test.skip(Boolean(process.env.PREVIEW_BASE_URL), 'This suite is local-only and never targets Preview')
  test.skip(
    process.env.PAYLOAD_EPHEMERAL_DATABASE !== 'true',
    'This suite requires the isolated PostgreSQL harness because content deletion is policy-controlled',
  )
  test.setTimeout(120_000)

  test('uses local Admin UI and API-observable editorial transitions', async ({ page }) => {
    const localHosts = new Set(['localhost', '127.0.0.1'])
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.context().route('**/*', async (route) => {
      const hostname = new URL(route.request().url()).hostname
      expect(localHosts, `Blocked non-local request: ${route.request().url()}`).toContain(hostname)
      await route.continue()
    })

    await seedTestUser()
    await login({ page, user: testUser })

    const request = page.context().request
    const runId = `pvb-local-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'bo-p1-e2e-object-store-'))
    let sourceId: Identifier | undefined
    let promptId: Identifier | undefined
    let editedSourceRecordId: string | undefined

    try {
      await test.step('create a local object and source through trusted server ingress, then edit it in Admin', async () => {
        const bytes = new TextEncoder().encode(JSON.stringify({ fixture: runId }))
        const contentHash = `sha256:v1:${createHash('sha256').update(bytes).digest('hex')}`
        const rawRef: ObjectRef = {
          namespace: 'raw-evidence', bucket_class: 'private_raw', key: buildContentAddressedKey('raw-evidence', contentHash),
          content_hash: contentHash, version: 'v1', size_bytes: bytes.byteLength, mime_type: 'application/json',
          rights_state: 'first_party', deletion_state: 'active',
        }
        const store = new LocalObjectStore({ root_dir: fixtureRoot, signer_secret: 'local-e2e-fixture-signer' })
        const receipt = await store.putForIngress({ principal: principals.ingestService, ref: rawRef, bytes, field: 'raw_ref', actor_id: 'local-e2e', correlation_id: runId })
        const payload = await getPayload({ config: await config })
        const source = await payload.create({
          collection: 'sources', overrideAccess: true,
          data: {
            stable_id: crypto.randomUUID(), schema_version: 1, revision: 1, source_version: runId, status: 'active',
            provider: 'first_party', provider_record_id: runId, canonical_url: `https://example.invalid/${runId}`,
            raw_ref: rawRef, captured_at: '2026-08-22T00:00:00.000Z', content_hash: contentHash,
            rights_state: 'first_party', rights_basis: 'Synthetic local acceptance fixture.', deletion_state: 'active',
          } as never,
          req: { context: withObjectAuthority({}, createObjectIngressCommand({ authority: createObjectAuthority(store), receipt, field: 'raw_ref', actor_id: 'local-e2e', correlation_id: runId })) } as never,
        })
        sourceId = source.id
        await page.goto(`/admin/collections/sources/${sourceId}`)

        const editedRecordId = `${runId}-edited`
        await page.locator('input[name="provider_record_id"]').fill(editedRecordId)
        await page.getByRole('button', { name: 'Save', exact: true }).click()
        await expect.poll(async () => {
          return (await read(request, `/api/sources/${sourceId}?depth=0`)).provider_record_id
        }).toBe(editedRecordId)
        editedSourceRecordId = editedRecordId
      })

      await test.step('create a draft synthetic prompt and advance every editorial transition in the real Admin UI', async () => {
        const promptLabel = `Synthetic local editorial fixture ${runId}`
        await page.goto('/admin/collections/prompt-artifacts/create')
        await page.locator('input[name="source_version"]').fill(runId)
        await choose(page, 'kind', 'prompt')
        await page.locator('input[name="canonical_label"]').fill(promptLabel)
        await page.getByRole('textbox', { name: 'Original_text *', exact: true }).fill('Create a synthetic video for {{product_name}}.')
        await choose(page, 'outcome__media_type', 'video')
        await page.getByRole('textbox', { name: 'Summary', exact: true }).fill('Synthetic local-only outcome.')
        await choose(page, 'source', editedSourceRecordId!)
        await choose(page, 'rights_state', 'first_party')
        await choose(page, 'safety_state', 'approved')
        await choose(page, 'evidence_state', 'verified')
        await page.getByRole('button', { name: 'Save', exact: true }).click()
        await expect.poll(async () => {
          const promptResponse = await request.get(
            `/api/prompt-artifacts?where[canonical_label][equals]=${encodeURIComponent(promptLabel)}`,
          )
          if (!promptResponse.ok()) return []
          return ((await promptResponse.json()) as { docs: PayloadDocument[] }).docs
        }).toHaveLength(1)
        const promptResponse = await request.get(
          `/api/prompt-artifacts?where[canonical_label][equals]=${encodeURIComponent(promptLabel)}`,
        )
        promptId = ((await promptResponse.json()) as { docs: PayloadDocument[] }).docs[0]!.id
        expect((await read(request, `/api/prompt-artifacts/${promptId}?depth=0`)).status).toBe('draft')
        await page.goto(`/admin/collections/prompt-artifacts/${promptId}`)

        for (const status of ['review', 'approved', 'published', 'withdrawn'] as const) {
          await choose(page, 'status', status)
          await page.getByRole('button', { name: 'Save', exact: true }).click()
          await expect.poll(async () => {
            return (await read(request, `/api/prompt-artifacts/${promptId}?depth=0`)).status
          }).toBe(status)
        }
      })

      expect(pageErrors).toEqual([])
      expect((await request.delete(`/api/prompt-artifacts/${promptId}`)).status()).toBe(403)
      expect((await request.delete(`/api/sources/${sourceId}`)).status()).toBe(403)
    } finally {
      // The PostgreSQL harness destroys the entire synthetic cluster after Playwright exits.
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  })
})
