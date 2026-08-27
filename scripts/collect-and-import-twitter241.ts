import { spawn } from 'node:child_process'
import { lstat, mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { runSnapshotImportCommand } from './import-higgsfield-snapshot'

export type Twitter241CollectCommand = Readonly<{
  credentialFile: string
  outDir: string | undefined
  count: number
  maxPages: number
}>

const parseBoundedPositiveInteger = (value: string, option: '--count' | '--max-pages'): number => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) throw new Error(`${option} must be an integer from 1 through 100`)
  return parsed
}

export const parseTwitter241CollectArgs = (
  argumentsAfterCommand: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): Twitter241CollectCommand => {
  let credentialFile = environment.TWITTER241_CREDENTIAL_FILE?.trim() || undefined
  let outDir = environment.TWITTER241_SNAPSHOT_DIR?.trim() || undefined
  let count = 20
  let maxPages = parseBoundedPositiveInteger(environment.TWITTER241_MAX_PAGES?.trim() || '1', '--max-pages')
  for (let index = 0; index < argumentsAfterCommand.length; index += 1) {
    const argument = argumentsAfterCommand[index]
    if (argument === '--' && index === 0) continue
    if (argument === '--credentials' || argument === '--out-dir' || argument === '--count' || argument === '--max-pages') {
      const value = argumentsAfterCommand[index + 1]?.trim()
      if (!value) throw new Error(`${argument} requires a value`)
      if (argument === '--credentials') credentialFile = value
      else if (argument === '--out-dir') outDir = value
      else if (argument === '--count') count = parseBoundedPositiveInteger(value, '--count')
      else maxPages = parseBoundedPositiveInteger(value, '--max-pages')
      index += 1
      continue
    }
    throw new Error(`unknown Twitter241 collection argument: ${argument}`)
  }
  if (!credentialFile) throw new Error('a private Twitter241 credential file is required (--credentials or TWITTER241_CREDENTIAL_FILE)')
  return Object.freeze({ credentialFile, outDir, count, maxPages })
}

const assertPrivateCredentialFile = async (filename: string): Promise<void> => {
  const info = await lstat(filename)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Twitter241 credential path must be a regular file')
  if ((info.mode & 0o077) !== 0) throw new Error('Twitter241 credential file permissions must be 0600 or stricter')
}

const collect = async (input: Readonly<{ credentialFile: string; outDir: string; count: number; maxPages: number; collectorScript: string }>): Promise<void> => {
  const result = await new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>((resolveResult, reject) => {
    const child = spawn('python3', [input.collectorScript, '--env-file', input.credentialFile, '--out-dir', input.outDir, '--count', String(input.count), '--max-pages', String(input.maxPages)], {
      cwd: process.cwd(), env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'],
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolveResult({ code, signal }))
  })
  if (result.code !== 0 || result.signal !== null) throw new Error('Twitter241 collector failed; no Payload import was attempted')
}

/**
 * The collector is intentionally separate from the write plane: API output is
 * first materialized as a manifest-verified snapshot, then the normal
 * idempotent Payload importer accepts it. API credentials never appear in a
 * command argument to the importer, in Payload rows, or in command output.
 */
export async function runTwitter241CollectAndImportCommand(
  argumentsAfterCommand = process.argv.slice(2),
  environment = process.env,
): Promise<unknown> {
  const command = parseTwitter241CollectArgs(argumentsAfterCommand, environment)
  await assertPrivateCredentialFile(command.credentialFile)
  const snapshotsRoot = resolve(environment.TWITTER241_SNAPSHOTS_ROOT?.trim() || join(process.cwd(), '.payload-local', 'snapshots'))
  await mkdir(snapshotsRoot, { recursive: true, mode: 0o700 })
  const outDir = command.outDir ? resolve(command.outDir) : await mkdtemp(join(snapshotsRoot, 'twitter241-'))
  const collectorScript = resolve(environment.TWITTER241_COLLECTOR_SCRIPT?.trim() || join(process.cwd(), 'scripts', 'fetch_higgsfield_twitter241.py'))
  await collect({ credentialFile: resolve(command.credentialFile), outDir, count: command.count, maxPages: command.maxPages, collectorScript })
  const result = await runSnapshotImportCommand(['--snapshot', outDir], environment)
  return Object.freeze({ snapshotDir: outDir, import: result })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runTwitter241CollectAndImportCommand()
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exit(0)
}
