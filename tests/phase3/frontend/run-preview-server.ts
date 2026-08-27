import { spawn } from 'node:child_process'
import { cp, readdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sourceRoot = process.cwd()
const isolatedRoot = await mkdtemp(join(tmpdir(), 'bo-phase3-frontend-'))

try {
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    if (entry.name === '.next' || entry.name === '.git') continue
    if (entry.name === 'src') {
      await cp(join(sourceRoot, entry.name), join(isolatedRoot, entry.name), { recursive: entry.isDirectory() })
      continue
    }
    await symlink(join(sourceRoot, entry.name), join(isolatedRoot, entry.name), entry.isDirectory() ? 'dir' : 'file')
  }

  const child = spawn(process.execPath, [
    join(sourceRoot, 'node_modules/tsx/dist/cli.mjs'),
    join(sourceRoot, 'scripts/run-with-postgres.ts'),
    join(sourceRoot, 'node_modules/next/dist/bin/next'),
    'dev',
    '--hostname',
    '127.0.0.1',
    '--webpack',
  ], { cwd: isolatedRoot, env: process.env, stdio: 'inherit' })

  let forwardedSignal: NodeJS.Signals | undefined
  const forwardSignal = (signal: NodeJS.Signals): void => {
    if (forwardedSignal === undefined) {
      forwardedSignal = signal
      child.kill(signal)
    }
  }
  const onSigint = () => forwardSignal('SIGINT')
  const onSigterm = () => forwardSignal('SIGTERM')
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)
  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve(forwardedSignal !== undefined || signal === 'SIGTERM' || signal === 'SIGINT' ? 0 : (code ?? 1)))
    })
    if (exitCode !== 0) process.exitCode = exitCode
  } finally {
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
  }
} finally {
  await rm(isolatedRoot, { recursive: true, force: true })
}
