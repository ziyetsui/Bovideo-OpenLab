import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const previewWorkerName = 'bovideo-openlab-preview'
const previewD1Name = 'bovideo-openlab-preview'
const previewR2Name = 'bovideo-openlab-preview-media'

type Binding = Record<string, unknown>
type PreviewConfig = {
  env?: {
    preview?: {
      d1_databases?: Binding[]
      name?: unknown
      r2_buckets?: Binding[]
    }
  }
}

export type PreviewReadiness = {
  accountID: string
  config: PreviewConfig
  remoteD1?: { name?: unknown; uuid?: unknown }
  remoteR2?: { name?: unknown }
  secretNames: string[]
}

function binding(bindings: Binding[] | undefined, name: string): Binding | undefined {
  return bindings?.find((candidate) => candidate.binding === name)
}

export function assertPreviewReadiness({
  accountID,
  config,
  remoteD1,
  remoteR2,
  secretNames,
}: PreviewReadiness): void {
  if (!/^[0-9a-f]{32}$/i.test(accountID)) {
    throw new Error('A 32-character CLOUDFLARE_ACCOUNT_ID is required for Preview')
  }

  const preview = config.env?.preview
  if (preview?.name !== previewWorkerName) throw new Error(`Preview Worker must be ${previewWorkerName}`)

  const d1 = binding(preview.d1_databases, 'D1')
  if (
    d1?.database_name !== previewD1Name ||
    typeof d1.database_id !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(d1.database_id)
  ) {
    throw new Error(`Preview D1 must be provisioned as ${previewD1Name}`)
  }

  const r2 = binding(preview.r2_buckets, 'R2')
  if (r2?.bucket_name !== previewR2Name) {
    throw new Error(`Preview R2 must be provisioned as ${previewR2Name}`)
  }
  if (remoteD1?.name !== previewD1Name || remoteD1.uuid !== d1.database_id) {
    throw new Error('Preview D1 config does not match the selected account resource')
  }
  if (remoteR2?.name !== previewR2Name) {
    throw new Error('Preview R2 config does not match the selected account resource')
  }
  if (!secretNames.includes('PAYLOAD_SECRET')) {
    throw new Error('PAYLOAD_SECRET must exist on the Preview Worker before migration or deploy')
  }
}

async function runWrangler(args: string[], accountID: string): Promise<string> {
  const wrangler = path.resolve('node_modules/wrangler/bin/wrangler.js')
  const result = await execFileAsync(process.execPath, [wrangler, ...args], {
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountID },
    maxBuffer: 8 * 1024 * 1024,
  })
  return result.stdout
}

async function main(): Promise<void> {
  const accountID = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? ''
  const configPath = path.resolve('wrangler.preview.jsonc')
  const config = JSON.parse(await readFile(configPath, 'utf8')) as PreviewConfig

  await runWrangler(['whoami', '--account', accountID, '--json'], accountID)
  const remoteD1 = JSON.parse(
    await runWrangler(
      ['d1', 'info', previewD1Name, '--json', '--config', configPath, '--env', 'preview'],
      accountID,
    ),
  ) as { name?: unknown; uuid?: unknown }
  const remoteR2 = JSON.parse(
    await runWrangler(
      ['r2', 'bucket', 'info', previewR2Name, '--json', '--config', configPath, '--env', 'preview'],
      accountID,
    ),
  ) as { name?: unknown }
  const secretOutput = await runWrangler(
    ['secret', 'list', '--config', configPath, '--env', 'preview', '--format', 'json'],
    accountID,
  )
  const secrets = JSON.parse(secretOutput) as Array<{ name?: unknown }>
  assertPreviewReadiness({
    accountID,
    config,
    remoteD1,
    remoteR2,
    secretNames: secrets.flatMap(({ name }) => (typeof name === 'string' ? [name] : [])),
  })
  process.stdout.write('Cloudflare Preview resources and PAYLOAD_SECRET are ready.\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main()
}
