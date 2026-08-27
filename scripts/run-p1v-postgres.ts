import { spawn } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const requiredAcknowledgement = 'render-free-neon-free-synthetic'

export function assertP1VEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (env.P1V_TARGET !== requiredAcknowledgement) {
    throw new Error(`P1V_TARGET must equal ${requiredAcknowledgement}`)
  }
  if (env.P1V_RUNTIME !== 'true') {
    throw new Error('P1V_RUNTIME=true is required to keep public Admin/API routes hidden')
  }
  if (
    env.RENDER !== 'true' ||
    env.RENDER_SERVICE_TYPE !== 'web' ||
    !env.RENDER_SERVICE_ID ||
    !env.RENDER_EXTERNAL_URL?.startsWith('https://')
  ) {
    throw new Error('P1-V must run inside the declared Render Web Service')
  }

  const databaseURL = env.DATABASE_URL
  if (!databaseURL) throw new Error('DATABASE_URL is required')
  const parsed = new URL(databaseURL)
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !parsed.hostname.endsWith('.neon.tech') ||
    parsed.hostname.includes('-pooler.') ||
    parsed.searchParams.get('sslmode') !== 'require'
  ) {
    throw new Error('P1-V requires a direct Neon PostgreSQL URL with sslmode=require')
  }
  if (env.PAYLOAD_DB_PUSH === 'true') {
    throw new Error('P1-V forbids schema push; apply the reviewed PostgreSQL migration first')
  }
}

async function run(): Promise<number> {
  assertP1VEnvironment()
  const vitest = path.resolve('node_modules/vitest/vitest.mjs')
  const child = spawn(
    process.execPath,
    [vitest, 'run', '--config', './vitest.phase1.access-payload.config.mts'],
    { env: { ...process.env, DB_POOL_MAX: '5', PAYLOAD_DB_PUSH: 'false' }, stdio: 'inherit' },
  )
  return await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`P1-V test process terminated by ${signal}`))
      else resolve(code ?? 1)
    })
  })
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined
if (import.meta.url === invokedPath) {
  const exitCode = await run()
  if (exitCode !== 0) throw new Error(`P1-V PostgreSQL tests exited with code ${exitCode}`)
}
