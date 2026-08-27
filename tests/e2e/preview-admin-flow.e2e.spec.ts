import { expect, test, type APIRequestContext } from '@playwright/test'

import { APPLICATION_LOCALES } from '../../src/collections/shared'
import { login } from '../helpers/login'

type Identifier = number | string
type PayloadDocument = { id: Identifier; [key: string]: unknown }

const previewBaseURL = process.env.PREVIEW_BASE_URL?.replace(/\/$/, '')
const trustedSourceID = process.env.PREVIEW_TRUSTED_SOURCE_ID
const previewUser = {
  email: process.env.PREVIEW_ADMIN_EMAIL ?? '',
  password: process.env.PREVIEW_ADMIN_PASSWORD ?? '',
}

async function payloadMutation(
  request: APIRequestContext,
  method: 'POST' | 'PATCH',
  path: string,
  data: Record<string, unknown>,
): Promise<PayloadDocument> {
  const response = await request.fetch(path, { data, method })
  if (!response.ok()) {
    throw new Error(`${method} ${path} failed (${response.status()}): ${await response.text()}`)
  }
  const body = (await response.json()) as { doc?: PayloadDocument } & PayloadDocument
  return body.doc ?? body
}

async function payloadRead(request: APIRequestContext, path: string): Promise<PayloadDocument> {
  const response = await request.get(path)
  if (!response.ok()) throw new Error(`GET ${path} failed (${response.status()}): ${await response.text()}`)
  return (await response.json()) as PayloadDocument
}

async function payloadDelete(request: APIRequestContext, path: string): Promise<void> {
  const response = await request.delete(path)
  if (!response.ok() && response.status() !== 404) {
    throw new Error(`DELETE ${path} failed (${response.status()}): ${await response.text()}`)
  }
}

test.describe('Cloudflare Preview Admin acceptance', () => {
  test.skip(!previewBaseURL, 'PREVIEW_BASE_URL is required for remote Preview acceptance')
  test.skip(!trustedSourceID, 'PREVIEW_TRUSTED_SOURCE_ID must name a source created through trusted object ingress')

  test('login → create → edit → review → approve → publish → withdraw with 16 locales', async ({ page }) => {
    expect(previewUser.email, 'PREVIEW_ADMIN_EMAIL must be configured outside the repository').not.toBe('')
    expect(previewUser.password, 'PREVIEW_ADMIN_PASSWORD must be configured outside the repository').not.toBe('')

    await login({ page, serverURL: previewBaseURL!, user: previewUser })
    const request = page.context().request
    const runID = `p0-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    const created: Array<{ collection: string; id: Identifier }> = []

    try {
      const source = await test.step('create a rights-safe first-party source', async () => {
        return payloadRead(request, `/api/sources/${encodeURIComponent(trustedSourceID!)}`)
      })

      const prompt = await test.step('create a draft prompt artifact', async () => {
        const document = await payloadMutation(request, 'POST', '/api/prompt-artifacts', {
          source_version: runID,
          status: 'draft',
          kind: 'prompt',
          canonical_label: `Preview acceptance ${runID}`,
          prompt: { original_text: 'Create a synthetic product video for {{product_name}}.' },
          outcome: { media_type: 'video', summary: 'Synthetic Preview-only outcome.' },
          source: source.id,
          rights_state: 'first_party',
          safety_state: 'approved',
          evidence_state: 'verified',
        })
        created.push({ collection: 'prompt-artifacts', id: document.id })
        return document
      })

      await test.step('open the created record in Payload Admin', async () => {
        await page.goto(`/admin/collections/prompt-artifacts/${prompt.id}`)
        await expect(page.locator('input[name="canonical_label"]')).toHaveValue(`Preview acceptance ${runID}`)
      })

      await test.step('edit the prompt artifact', async () => {
        const editedLabel = `Preview acceptance edited ${runID}`
        const document = await payloadMutation(request, 'PATCH', `/api/prompt-artifacts/${prompt.id}`, {
          canonical_label: editedLabel,
          source_version: `${runID}-edited`,
        })
        expect(document.canonical_label).toBe(editedLabel)
        await page.reload()
        await expect(page.locator('input[name="canonical_label"]')).toHaveValue(editedLabel)
      })

      for (const status of ['review', 'approved', 'published'] as const) {
        await test.step(`transition prompt artifact to ${status}`, async () => {
          await payloadMutation(request, 'PATCH', `/api/prompt-artifacts/${prompt.id}`, { status })
          expect((await payloadRead(request, `/api/prompt-artifacts/${prompt.id}?depth=0`)).status).toBe(status)
        })
      }

      const pageRecord = await test.step('create the noindex detail page record', async () => {
        const document = await payloadMutation(request, 'POST', '/api/page-records', {
          source_version: runID,
          page_type: 'detail',
          root_object: { relationTo: 'prompt-artifacts', value: prompt.id },
          intent: `Preview-only acceptance page for ${runID}`,
          inventory: { prompt_artifact_id: prompt.id },
          qualification_score: { total: 100, result: 'preview_acceptance_only' },
          index_state: 'discoverable_noindex',
          reason_codes: ['preview_acceptance_fixture'],
        })
        created.push({ collection: 'page-records', id: document.id })
        return document
      })

      await test.step('create exactly 16 locale variants without indexing them', async () => {
        for (const locale of APPLICATION_LOCALES) {
          const document = await payloadMutation(request, 'POST', '/api/locale-variants', {
            source_version: runID,
            entity: { relationTo: 'page-records', value: pageRecord.id },
            locale,
            source_locale: 'en',
            translation_model: 'preview-fixture-no-external-call',
            translation_prompt_version: 'p0-v1',
            localized_fields: { title: `[${locale}] Preview acceptance ${runID}` },
            quality: {
              terminology_score: 1,
              placeholder_integrity: 'pass',
              factual_consistency: 'pass',
              language_detection: 'pass',
            },
            workflow_state: 'machine_draft',
          })
          created.push({ collection: 'locale-variants', id: document.id })
        }
        expect(created.filter(({ collection }) => collection === 'locale-variants')).toHaveLength(16)
      })

      await test.step('withdraw the prompt artifact', async () => {
        await payloadMutation(request, 'PATCH', `/api/prompt-artifacts/${prompt.id}`, { status: 'withdrawn' })
        expect((await payloadRead(request, `/api/prompt-artifacts/${prompt.id}?depth=0`)).status).toBe('withdrawn')
      })
    } finally {
      for (const { collection, id } of created.reverse()) {
        await payloadDelete(request, `/api/${collection}/${id}`)
      }
    }
  })
})
