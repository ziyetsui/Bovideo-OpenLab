import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'

async function reservePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Could not reserve a local PostgreSQL port')
  }
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  return address.port
}

async function run(): Promise<number> {
  const commandArguments = process.argv.slice(2)
  if (commandArguments[0] === '--') commandArguments.shift()
  if (commandArguments.length === 0) {
    throw new Error('run-with-postgres requires a Node.js entrypoint and its arguments')
  }

  const databaseDir = await mkdtemp(path.join(tmpdir(), 'bo-phase1-postgres-'))
  const port = await reservePort()
  const password = `phase1_${globalThis.crypto.randomUUID().replaceAll('-', '')}`
  const database = new EmbeddedPostgres({
    databaseDir,
    user: 'postgres',
    password,
    port,
    persistent: false,
    onLog: () => {},
  })

  try {
    await database.initialise()
    await database.start()
    const payloadSecret = process.env.PAYLOAD_SECRET || `local_${globalThis.crypto.randomUUID().replaceAll('-', '')}`

    const child = spawn(process.execPath, commandArguments, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: `postgres://postgres:${password}@127.0.0.1:${port}/postgres`,
        DB_POOL_MAX: '5',
        PAYLOAD_EPHEMERAL_DATABASE: 'true',
        PAYLOAD_DB_PUSH: 'true',
        PAYLOAD_SECRET: payloadSecret,
      },
      stdio: 'inherit',
    })

    let forwardedSignal: NodeJS.Signals | undefined
    const forwardSignal = (signal: NodeJS.Signals): void => {
      if (forwardedSignal !== undefined) return
      forwardedSignal = signal
      child.kill(signal)
    }
    const onSigint = () => forwardSignal('SIGINT')
    const onSigterm = () => forwardSignal('SIGTERM')
    process.once('SIGINT', onSigint)
    process.once('SIGTERM', onSigterm)

    try {
      return await new Promise<number>((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', (code, signal) => {
          if (forwardedSignal !== undefined && signal === forwardedSignal) resolve(0)
          else if (signal) reject(new Error(`Child process terminated by ${signal}`))
          else resolve(code ?? 1)
        })
      })
    } finally {
      process.off('SIGINT', onSigint)
      process.off('SIGTERM', onSigterm)
    }
  } finally {
    await database.stop().catch(() => {})
    await rm(databaseDir, { recursive: true, force: true })
  }
}

const exitCode = await run()
if (exitCode !== 0) {
  throw new Error(`PostgreSQL-backed command exited with code ${exitCode}`)
}
