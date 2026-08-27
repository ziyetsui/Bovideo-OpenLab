# Local Payload Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a one-command, disposable local Payload + PostgreSQL development runtime with verified readiness, Admin login, and clean shutdown.

**Architecture:** Keep `pnpm dev` bound to an operator-supplied persistent PostgreSQL database. Add `pnpm dev:local` as a thin entrypoint over the existing `run-with-postgres.ts` process supervisor, then test the HTTP boundary and signal cleanup on a dedicated loopback port.

**Tech Stack:** Node.js 24.19.0, pnpm 11.19.0, Next.js 16.3.0, Payload 3.88.0, embedded-postgres, Vitest 4, Playwright 1.58.

**Spec:** `.gba/0003_bo-pseo-platform/specs/phase3-ui-runtime-remediation-design.md`

## Global Constraints

- Preserve `pnpm dev` for an externally managed `DATABASE_URL`.
- `dev:local` is ephemeral: editorial data is discarded on exit.
- `PAYLOAD_DB_PUSH=true` may exist only inside the generated ephemeral-database environment.
- Bind verification to loopback and use a dedicated port with no existing-server reuse.
- `/healthz` proves process health; `/readyz` must additionally prove Payload/PostgreSQL readiness.
- Do not change Payload collections, migrations, permissions or production deployment configuration.

---

## File map

- Modify `package.json`: own `dev:local` and `test:local-runtime` scripts.
- Modify `scripts/run-with-postgres.ts`: forward shutdown signals and await child termination before database cleanup.
- Create `playwright.local-runtime.config.ts`: isolated local runtime web server.
- Create `tests/e2e/local-runtime.e2e.spec.ts`: HTTP/Admin/no-external-network acceptance.
- Create `tests/phase3/runtime/local-shutdown.int.spec.ts`: bounded process shutdown and closed-port proof.
- Modify `vitest.phase3.config.mts`: continue matching the new Phase 3 integration spec.
- Modify `README.md`: document persistent and ephemeral local paths.

### Task 1: Specify the package entrypoint and shutdown contract

**Files:**

- Modify: `package.json`
- Create: `tests/phase3/runtime/local-shutdown.int.spec.ts`
- Modify: `scripts/run-with-postgres.ts`

**Interfaces:**

- Consumes: `run-with-postgres.ts <node-entrypoint> [...arguments]`
- Produces: `pnpm dev:local`, which runs Next dev with an isolated PostgreSQL cluster and forwards `SIGINT`/`SIGTERM` to its child.

- [ ] **Step 1: Write the failing package and process contract**

Create a Vitest spec that reads `package.json`, reserves a loopback port, starts the exact local command, waits for `/readyz`, signals it, and verifies the port closes:

```ts
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

const waitForReady = async (url: string): Promise<void> => {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok && (await response.json() as { status?: string }).status === 'ready') return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('local runtime did not become ready')
}

describe('local Payload runtime', () => {
  it('declares the embedded PostgreSQL entrypoint and closes on SIGTERM', async () => {
    const manifest = JSON.parse(await readFile('package.json', 'utf8')) as { scripts: Record<string, string> }
    expect(manifest.scripts['dev:local']).toBe(
      'cross-env NODE_OPTIONS=--no-deprecation tsx scripts/run-with-postgres.ts node_modules/next/dist/bin/next dev',
    )
    const port = await reservePort()
    const child = spawn('pnpm', ['dev:local'], {
      cwd: process.cwd(),
      env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: String(port) },
      stdio: 'ignore',
    })
    try {
      await waitForReady(`http://127.0.0.1:${port}/readyz`)
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
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/runtime/local-shutdown.int.spec.ts
```

Expected: failure because `scripts.dev:local` is absent.

- [ ] **Step 3: Add the exact package command**

Add to `package.json`:

```json
"dev:local": "cross-env NODE_OPTIONS=--no-deprecation tsx scripts/run-with-postgres.ts node_modules/next/dist/bin/next dev"
```

- [ ] **Step 4: Make shutdown forwarding idempotent**

In `run-with-postgres.ts`, after spawning the child, install handlers that keep the wrapper alive while the child exits, remove the handlers after settlement, and let the existing `finally` stop PostgreSQL and remove its temporary directory:

```ts
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
```

- [ ] **Step 5: Run the test and static checks**

Run:

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/runtime/local-shutdown.int.spec.ts
pnpm exec tsc --noEmit
pnpm run lint
git diff --check
```

Expected: all pass; `/readyz` becomes ready and the dedicated port refuses connections after termination.

- [ ] **Step 6: Commit the runtime process boundary**

```bash
git add package.json scripts/run-with-postgres.ts tests/phase3/runtime/local-shutdown.int.spec.ts
git commit -m "feat: add disposable local Payload runtime"
```

### Task 2: Verify the local HTTP and Admin boundary

**Files:**

- Create: `playwright.local-runtime.config.ts`
- Create: `tests/e2e/local-runtime.e2e.spec.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**

- Consumes: `pnpm dev:local`, `/healthz`, `/readyz`, `/admin/login`
- Produces: `pnpm test:local-runtime` and documented local startup semantics.

- [ ] **Step 1: Write the local runtime browser test**

Create `tests/e2e/local-runtime.e2e.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test('embedded PostgreSQL makes Payload and Admin ready without external requests', async ({ page, request }) => {
  const health = await request.get('/healthz')
  expect(health.status()).toBe(200)
  expect(await health.json()).toEqual({ status: 'ok' })
  expect(health.headers()['cache-control']).toBe('no-store')

  const ready = await request.get('/readyz')
  expect(ready.status()).toBe(200)
  expect(await ready.json()).toEqual({ database: 'postgres', status: 'ready' })
  expect(ready.headers()['cache-control']).toBe('no-store')

  await page.context().route('**/*', async (route) => {
    expect(['127.0.0.1', 'localhost']).toContain(new URL(route.request().url()).hostname)
    await route.continue()
  })
  await page.goto('/admin/login')
  await expect(page.locator('#field-email')).toBeVisible()
  await expect(page.locator('#field-password')).toBeVisible()
  await expect(page.locator('button[type="submit"]')).toBeVisible()
})
```

- [ ] **Step 2: Add an isolated Playwright configuration**

Create `playwright.local-runtime.config.ts` with a dedicated port and no server reuse:

```ts
import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://127.0.0.1:3417'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /local-runtime\.e2e\.spec\.ts/,
  reporter: 'list',
  workers: 1,
  use: { ...devices['Desktop Chrome'], baseURL },
  webServer: {
    command: 'cross-env HOSTNAME=127.0.0.1 PORT=3417 pnpm dev:local',
    reuseExistingServer: false,
    timeout: 120_000,
    url: `${baseURL}/healthz`,
  },
})
```

- [ ] **Step 3: Add the test script and verify the expected failure/pass transition**

Add:

```json
"test:local-runtime": "cross-env NODE_OPTIONS=\"--no-deprecation --import=tsx/esm\" playwright test --config=playwright.local-runtime.config.ts"
```

Run:

```bash
pnpm run test:local-runtime
```

Expected: one Chromium test passes and the Playwright-managed server exits after the run.

- [ ] **Step 4: Document both development modes**

Update `README.md` Local development with these exact operational distinctions:

```markdown
For a disposable zero-configuration local database, run `pnpm dev:local`. It starts an isolated embedded PostgreSQL cluster, pushes the Payload schema only into that cluster, and deletes the database on exit. Use it for UI/Admin development; do not expect editorial data to survive a restart.

For a persistent operator-managed PostgreSQL database, set `PAYLOAD_SECRET` and `DATABASE_URL`, then run `pnpm dev`. This path never enables schema push implicitly.

Check process health at `/healthz`, database readiness at `/readyz`, and Payload Admin at `/admin`.
```

- [ ] **Step 5: Run the runtime acceptance set**

```bash
pnpm run test:local-runtime
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/runtime/local-shutdown.int.spec.ts
pnpm exec tsc --noEmit
pnpm run lint
git diff --check
```

Expected: all commands pass with no external PostgreSQL process.

- [ ] **Step 6: Commit the HTTP/Admin acceptance**

```bash
git add README.md package.json playwright.local-runtime.config.ts tests/e2e/local-runtime.e2e.spec.ts
git commit -m "test: verify local Payload readiness"
```
