import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { preparePreviewConfig } from '../../scripts/prepare-preview-config'

const temporaryDirectories: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

async function temporaryConfig(config: unknown): Promise<{ destination: string; source: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'bovideo-preview-config-'))
  temporaryDirectories.push(directory)
  const source = path.join(directory, 'wrangler.jsonc')
  const destination = path.join(directory, 'wrangler.preview.jsonc')
  await writeFile(source, `${JSON.stringify(config, null, 2)}\n`)
  return { destination, source }
}

describe('preparePreviewConfig', () => {
  it('copies only a complete, isolated preview target to the ignored deploy config', async () => {
    const fixture = await temporaryConfig({
      main: '.open-next/worker.js',
      name: 'bovideo-openlab-local',
      env: {
        preview: {
          name: 'bovideo-openlab-preview',
          d1_databases: [{ binding: 'D1' }],
          r2_buckets: [{ binding: 'R2' }],
        },
      },
    })

    await preparePreviewConfig(fixture)

    const prepared = JSON.parse(await readFile(fixture.destination, 'utf8'))
    expect(prepared.env.preview.name).toBe('bovideo-openlab-preview')
    expect(prepared.env.preview.d1_databases).toEqual([{ binding: 'D1' }])
    expect(prepared.env.preview.r2_buckets).toEqual([{ binding: 'R2' }])
    expect(prepared.env.preview.d1_databases[0]).not.toHaveProperty('database_id')
    expect(prepared.env.preview.r2_buckets[0]).not.toHaveProperty('bucket_name')
  })

  it('preserves auto-provisioned resource identifiers only in the ignored deploy config', async () => {
    const fixture = await temporaryConfig({
      main: '.open-next/worker.js',
      name: 'bovideo-openlab-local',
      env: {
        preview: {
          name: 'bovideo-openlab-preview',
          d1_databases: [{ binding: 'D1' }],
          r2_buckets: [{ binding: 'R2' }],
        },
      },
    })
    await writeFile(
      fixture.destination,
      JSON.stringify({
        env: {
          preview: {
            name: 'bovideo-openlab-preview',
            d1_databases: [{ binding: 'D1', database_id: 'private-d1-id', database_name: 'bovideo-openlab-preview' }],
            r2_buckets: [{ binding: 'R2', bucket_name: 'bovideo-openlab-preview-media' }],
          },
        },
      }),
    )

    await preparePreviewConfig(fixture)

    const prepared = JSON.parse(await readFile(fixture.destination, 'utf8'))
    expect(prepared.env.preview.d1_databases[0].database_id).toBe('private-d1-id')
    expect(prepared.env.preview.r2_buckets[0].bucket_name).toBe('bovideo-openlab-preview-media')
  })

  it.each([
    ['missing environment', { name: 'bovideo-openlab-local' }],
    ['wrong Worker name', { env: { preview: { name: 'my-app', d1_databases: [{ binding: 'D1' }], r2_buckets: [{ binding: 'R2' }] } } }],
    ['missing D1 binding', { env: { preview: { name: 'bovideo-openlab-preview', r2_buckets: [{ binding: 'R2' }] } } }],
    ['missing R2 binding', { env: { preview: { name: 'bovideo-openlab-preview', d1_databases: [{ binding: 'D1' }] } } }],
  ])('fails closed for %s', async (_label, config) => {
    const fixture = await temporaryConfig(config)
    await expect(preparePreviewConfig(fixture)).rejects.toThrow(/preview/i)
  })
})
