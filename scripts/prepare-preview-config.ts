import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

type Binding = { binding?: unknown; [key: string]: unknown }
type WranglerEnvironment = {
  d1_databases?: Binding[]
  name?: unknown
  r2_buckets?: Binding[]
  [key: string]: unknown
}
type WranglerConfig = {
  env?: Record<string, WranglerEnvironment>
  [key: string]: unknown
}

export type PreparePreviewConfigOptions = {
  destination: string
  source: string
}

const previewWorkerName = 'bovideo-openlab-preview'

function hasBinding(bindings: Binding[] | undefined, expected: string): boolean {
  return bindings?.some(({ binding }) => binding === expected) === true
}

function assertProvisionableBinding(binding: Binding, forbiddenKeys: string[], label: string): void {
  for (const key of forbiddenKeys) {
    if (key in binding) {
      throw new Error(`Committed preview ${label} binding must not contain ${key}`)
    }
  }
}

async function readExistingPreview(destination: string): Promise<WranglerEnvironment | undefined> {
  try {
    const existing = JSON.parse(await readFile(destination, 'utf8')) as WranglerConfig
    return existing.env?.preview
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error(`Existing Preview deploy config is invalid: ${(error as Error).message}`)
  }
}

function preservedBinding(
  existing: Binding[] | undefined,
  bindingName: string,
  isAllowed: (binding: Binding) => boolean,
): Binding | undefined {
  const binding = existing?.find(({ binding }) => binding === bindingName)
  return binding && isAllowed(binding) ? binding : undefined
}

export async function preparePreviewConfig({ destination, source }: PreparePreviewConfigOptions): Promise<void> {
  if (path.resolve(destination) === path.resolve(source)) {
    throw new Error('Preview deploy config must be separate from the committed source config')
  }

  const parsed = JSON.parse(await readFile(source, 'utf8')) as WranglerConfig
  const preview = parsed.env?.preview

  if (!preview || preview.name !== previewWorkerName) {
    throw new Error(`Preview environment must target exactly ${previewWorkerName}`)
  }
  if (!hasBinding(preview.d1_databases, 'D1')) {
    throw new Error('Preview environment must declare an isolated D1 binding')
  }
  if (!hasBinding(preview.r2_buckets, 'R2')) {
    throw new Error('Preview environment must declare an isolated R2 binding')
  }

  const d1 = preview.d1_databases!.find(({ binding }) => binding === 'D1')!
  const r2 = preview.r2_buckets!.find(({ binding }) => binding === 'R2')!
  assertProvisionableBinding(d1, ['database_id', 'database_name'], 'D1')
  assertProvisionableBinding(r2, ['bucket_name', 'jurisdiction'], 'R2')

  const existing = await readExistingPreview(destination)
  const existingD1 = preservedBinding(
    existing?.d1_databases,
    'D1',
    (binding) =>
      typeof binding.database_id === 'string' &&
      binding.database_id.length > 0 &&
      binding.database_name === 'bovideo-openlab-preview',
  )
  const existingR2 = preservedBinding(
    existing?.r2_buckets,
    'R2',
    (binding) => binding.bucket_name === 'bovideo-openlab-preview-media',
  )

  const deployPreview: WranglerEnvironment = {
    ...preview,
    d1_databases: [existingD1 ?? d1],
    r2_buckets: [existingR2 ?? r2],
  }

  const prepared: WranglerConfig = {
    ...parsed,
    env: { preview: deployPreview },
  }
  await writeFile(destination, `${JSON.stringify(prepared, null, 2)}\n`, { mode: 0o600 })
}

async function main(): Promise<void> {
  await preparePreviewConfig({
    destination: path.resolve('wrangler.preview.jsonc'),
    source: path.resolve('wrangler.jsonc'),
  })
  process.stdout.write('Prepared ignored Cloudflare Preview config: wrangler.preview.jsonc\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main()
}
