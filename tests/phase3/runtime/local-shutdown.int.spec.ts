import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'

const reservePort = async (): Promise<number> => {
  const server = createServer()
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('loopback port unavailable')
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

const waitForReady = async (url: string, diagnostics: () => string): Promise<void> => {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok && (await response.json() as { status?: string }).status === 'ready') return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`local runtime did not become ready\n${diagnostics()}`)
}

describe('local Payload runtime', () => {
  it('declares the embedded PostgreSQL entrypoint and closes on SIGTERM', async () => {
    const manifest = JSON.parse(await readFile('package.json', 'utf8')) as { scripts: Record<string, string> }
    expect(manifest.scripts['dev:local']).toBe(
      'cross-env NODE_OPTIONS=--no-deprecation tsx scripts/run-with-postgres.ts node_modules/next/dist/bin/next dev --hostname 127.0.0.1',
    )
    expect(manifest.scripts['dev:persistent']).toBe(
      'cross-env PSEO_FRONTEND_PREVIEW=0 NODE_OPTIONS=--no-deprecation tsx scripts/run-persistent-postgres.ts --migrate -- node_modules/next/dist/bin/next dev --hostname 127.0.0.1',
    )
    const port = await reservePort()
    let diagnostics = ''
    const child = spawn('pnpm', ['dev:local'], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const capture = (chunk: Buffer) => { diagnostics = `${diagnostics}${chunk.toString()}`.slice(-16_384) }
    child.stdout.on('data', capture)
    child.stderr.on('data', capture)
    try {
      await waitForReady(`http://127.0.0.1:${port}/readyz`, () => diagnostics)
      child.kill('SIGTERM')
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('local runtime ignored SIGTERM')), 15_000)
        child.once('exit', () => { clearTimeout(timeout); resolve() })
      })
      await expect(fetch(`http://127.0.0.1:${port}/healthz`)).rejects.toThrow()
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
    }
  }, 90_000)
})
