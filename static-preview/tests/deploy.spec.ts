import { execFile as executeFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { assertDeployable, pagesDeployArgs, type DeployContext } from '../src/deploy-preflight'
import { queryIsolatedRemoteRef, runPagesDeploy, runPagesDeployCli, type RemoteGitInvocation } from '../src/pages-deploy'
import { buildPreview } from '../src/build'
import { verifyExistingPreview } from '../src/verify'

const SHA = '0123456789abcdef0123456789abcdef01234567'
const PUBLIC_ORIGIN = 'https://github.com/ziyetsui/Bovideo-OpenLab.git'

const cleanContext: DeployContext = {
  branch: 'preview-beta',
  headSha: SHA,
  statusPorcelain: '',
  manifestGitSha: SHA,
}

const pagesConfig = {
  $schema: '../node_modules/wrangler/config-schema.json',
  name: 'bovideo-openlab-preview',
  compatibility_date: '2026-08-22',
  pages_build_output_dir: './dist',
}

const execFile = promisify(executeFile)
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function git(cwd: string, args: readonly string[]): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout.trim()
}

function canonicalRemoteResponse(sha: string, calls?: RemoteGitInvocation[]): (invocation: RemoteGitInvocation) => Promise<string> {
  return async (invocation) => {
    calls?.push(invocation)
    return `${sha}\trefs/heads/preview-beta`
  }
}

async function cleanPreviewRepository(options: Readonly<{ includeOutput?: boolean }> = {}): Promise<Readonly<{ root: string; origin: string; sha: string }>> {
  const root = await mkdtemp(join(tmpdir(), 'pvb-pages-deploy-'))
  temporaryDirectories.push(root)
  const origin = await mkdtemp(join(tmpdir(), 'pvb-pages-origin-'))
  temporaryDirectories.push(origin)
  await git(origin, ['init', '--bare'])
  await git(root, ['init', '--initial-branch=preview-beta'])
  await git(root, ['config', 'user.email', 'preview@example.invalid'])
  await git(root, ['config', 'user.name', 'Preview Test'])
  await mkdir(join(root, 'static-preview'), { recursive: true })
  await writeFile(join(root, '.gitignore'), 'static-preview/dist/\n', 'utf8')
  await writeFile(join(root, 'static-preview', 'wrangler.jsonc'), `${JSON.stringify(pagesConfig)}\n`, 'utf8')
  await writeFile(join(root, 'README.md'), 'preview fixture\n', 'utf8')
  await git(root, ['add', '.gitignore', 'README.md', 'static-preview/wrangler.jsonc'])
  await git(root, ['commit', '-m', 'preview fixture'])
  const sha = await git(root, ['rev-parse', 'HEAD'])
  await git(root, ['remote', 'add', 'origin', PUBLIC_ORIGIN])
  if (options.includeOutput === true) {
    await buildPreview({ outDir: join(root, 'static-preview', 'dist'), gitSha: sha })
  }
  return { root, origin, sha }
}

describe('Pages Preview deployment preflight', () => {
  it.each([
    ['an altered payload file', async (root: string) => writeFile(join(root, 'en', 'prompts', 'index.html'), 'altered', 'utf8')],
    ['a deleted required asset', async (root: string) => unlink(join(root, 'assets', 'styles.css'))],
    ['an added ignored output file', async (root: string) => writeFile(join(root, 'operator-note.txt'), 'ignored but unsafe', 'utf8')],
    ['a minimal manifest', async (root: string) => writeFile(join(root, 'preview-manifest.json'), '{"gitSha":"0123456789abcdef0123456789abcdef01234567"}\n', 'utf8')],
  ])('rejects %s before a Pages upload can start', async (_description, corrupt) => {
    const root = await mkdtemp(join(tmpdir(), 'pvb-pages-output-'))
    temporaryDirectories.push(root)
    await buildPreview({ outDir: root, gitSha: SHA })
    await corrupt(root)

    await expect(verifyExistingPreview({ outDir: root, gitSha: SHA })).rejects.toThrow()
  })

  it('accepts only a clean preview-beta commit and produces the exact Pages command arguments', () => {
    expect(() => assertDeployable(cleanContext, pagesConfig)).not.toThrow()
    expect(pagesDeployArgs(SHA)).toEqual([
      'pages',
      'deploy',
      'dist',
      '--cwd',
      'static-preview',
      '--project-name=bovideo-openlab-preview',
      '--branch=preview-beta',
      `--commit-hash=${SHA}`,
    ])
  })

  it.each([
    ['a dirty worktree', { ...cleanContext, statusPorcelain: ' M README.md' }],
    ['a non-preview branch', { ...cleanContext, branch: 'main' }],
    ['a manifest SHA that differs from HEAD', { ...cleanContext, manifestGitSha: 'fedcba9876543210fedcba9876543210fedcba98' }],
    ['a short HEAD SHA', { ...cleanContext, headSha: SHA.slice(0, -1) }],
    ['an uppercase manifest SHA', { ...cleanContext, manifestGitSha: SHA.toUpperCase() }],
  ])('rejects %s', (_description, context) => {
    expect(() => assertDeployable(context, pagesConfig)).toThrow()
  })

  it.each([
    ['a Worker main entrypoint', { ...pagesConfig, main: 'worker.ts' }],
    ['an assets configuration', { ...pagesConfig, assets: { directory: './dist' } }],
    ['a Pages Functions directory', { ...pagesConfig, functions: './functions' }],
    ['a binding', { ...pagesConfig, vars: { PUBLIC_VALUE: 'forbidden' } }],
    ['an explicit bindings field', { ...pagesConfig, bindings: { PUBLIC_VALUE: 'forbidden' } }],
    ['a secret-shaped binding', { ...pagesConfig, define: { SECRET_VALUE: 'forbidden' } }],
    ['an explicit secrets field', { ...pagesConfig, secrets: { SECRET_VALUE: 'forbidden' } }],
    ['a resource ID', { ...pagesConfig, d1_databases: [{ binding: 'D1', database_id: 'forbidden' }] }],
    ['a route', { ...pagesConfig, routes: [{ pattern: 'preview.example.invalid/*' }] }],
    ['a custom domain', { ...pagesConfig, route: { pattern: 'preview.example.invalid/*', custom_domain: true } }],
    ['another project name', { ...pagesConfig, name: 'another-project' }],
  ])('rejects %s', (_description, config) => {
    expect(() => assertDeployable(cleanContext, config)).toThrow()
  })

  it('rejects a non-40-hex commit hash when building Pages arguments', () => {
    expect(() => pagesDeployArgs(SHA.slice(0, -1))).toThrow(/40-hex/i)
    expect(() => pagesDeployArgs(SHA.toUpperCase())).toThrow(/40-hex/i)
  })

  it('commits only the allowed Pages configuration keys', async () => {
    const source = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
    const config = JSON.parse(source) as unknown

    expect(() => assertDeployable(cleanContext, config)).not.toThrow()
  })

  it('exposes the withdrawn Pages deployment through the strict executable CLI', async () => {
    const source = await readFile(new URL('../../package.json', import.meta.url), 'utf8')
    const packageJson = JSON.parse(source) as { scripts?: Record<string, unknown> }
    expect(packageJson.scripts?.['deploy:pvb:pages:withdrawn']).toBe('tsx static-preview/src/pages-deploy.ts --mode withdrawn')
  })

  it('documents the withdrawn publication and baseline restoration commands with the canonical remote proof', async () => {
    const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8')
    expect(readme).toContain('pnpm run deploy:pvb:pages:withdrawn')
    expect(readme).toContain('pnpm run deploy:pvb:pages')
    expect(readme).toContain(PUBLIC_ORIGIN)
    expect(readme).toContain('non-repository temporary directory')
    expect(readme).toContain('GIT_CEILING_DIRECTORIES')
  })

  it('reads the real clean preview repository and spawns only the exact Pages deployment command', async () => {
    const { root, sha } = await cleanPreviewRepository()
    const spawned: Array<Readonly<{ command: string; args: readonly string[] }>> = []

    await runPagesDeploy({
      cwd: root,
      remoteGit: canonicalRemoteResponse(sha),
      spawn: async (command, args) => {
        spawned.push({ command, args })
      },
    })

    expect(spawned).toEqual([
      {
        command: 'pnpm',
        args: ['exec', 'wrangler', ...pagesDeployArgs(sha)],
      },
    ])
  })

  it('runs the executable withdrawal CLI path and spawns only after the verified 464-route tree exists', async () => {
    const { root, sha } = await cleanPreviewRepository()
    const spawned: Array<Readonly<{ command: string; args: readonly string[] }>> = []
    await runPagesDeployCli(['--mode', 'withdrawn'], {
      cwd: root,
      remoteGit: canonicalRemoteResponse(sha),
      spawn: async (command, args) => {
        const manifest = await verifyExistingPreview({
          outDir: join(root, 'static-preview', 'dist'),
          gitSha: sha,
          mode: 'withdrawn',
        })
        expect(manifest.routeFiles).toHaveLength(464)
        expect(manifest.routeIds).not.toContain('detail-020')
        spawned.push({ command, args })
      },
    })

    expect(spawned).toEqual([
      {
        command: 'pnpm',
        args: ['exec', 'wrangler', ...pagesDeployArgs(sha)],
      },
    ])
  })

  it('queries the literal public HTTPS URL from an isolated trusted Git environment despite local rewrite configuration', async () => {
    const { root, origin } = await cleanPreviewRepository({ includeOutput: false })
    const calls: RemoteGitInvocation[] = []
    await git(root, ['config', `url.${origin}.insteadOf`, PUBLIC_ORIGIN])

    await expect(
      runPagesDeploy({
        cwd: root,
        remoteGit: async (invocation) => {
          calls.push(invocation)
          return ''
        },
        spawn: async () => undefined,
      }),
    ).rejects.toThrow(/ls-remote/i)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.args).toEqual(['ls-remote', '--heads', PUBLIC_ORIGIN, 'refs/heads/preview-beta'])
    expect(calls[0]?.cwd).not.toBe(root)
    expect(calls[0]?.env).toMatchObject({
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_COUNT: '0',
      XDG_CONFIG_HOME: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
    })
    expect(calls[0]?.env.GIT_CEILING_DIRECTORIES).toBe(calls[0]?.cwd)
    expect(calls[0]?.env).not.toHaveProperty('GIT_DIR')
    expect(calls[0]?.env).not.toHaveProperty('GIT_WORK_TREE')
    expect(calls[0]?.env).not.toHaveProperty('GIT_CONFIG_PARAMETERS')
  })

  it('uses an actual isolated git ls-remote against a temporary bare repository despite a local rewrite rule', async () => {
    const { root, origin, sha } = await cleanPreviewRepository({ includeOutput: false })
    const literalOrigin = pathToFileURL(origin).href
    await git(root, ['push', literalOrigin, 'preview-beta:preview-beta'])
    await git(root, ['config', 'url.file:///definitely-not-the-proof-origin/.insteadOf', literalOrigin])

    await expect(queryIsolatedRemoteRef(literalOrigin)).resolves.toBe(`${sha}\trefs/heads/preview-beta`)
  })

  it('uses the package withdrawal argv to reach the real remote gate instead of rejecting command syntax', async () => {
    const { root } = await cleanPreviewRepository()
    const source = await readFile(new URL('../../package.json', import.meta.url), 'utf8')
    const packageJson = JSON.parse(source) as { scripts?: Record<string, unknown> }
    const script = packageJson.scripts?.['deploy:pvb:pages:withdrawn']
    expect(script).toBe('tsx static-preview/src/pages-deploy.ts --mode withdrawn')
    const argv = String(script).split(' ').slice(2)
    expect(argv).toEqual(['--mode', 'withdrawn'])
    const spawned: Array<Readonly<{ command: string; args: readonly string[] }>> = []
    await git(root, ['remote', 'remove', 'origin'])

    await expect(
      runPagesDeployCli(argv, {
        cwd: root,
        spawn: async (command, args) => {
          spawned.push({ command, args })
        },
      }),
    ).rejects.toThrow(/configured origin/i)
    expect(spawned).toEqual([])
  })

  it.each([
    ['a missing mode value', ['--mode']],
    ['an unknown option', ['--unknown']],
    ['an invalid mode value', ['--mode', 'retired']],
    ['a duplicate mode option', ['--mode', 'baseline', '--mode', 'withdrawn']],
    ['an equals-form option', ['--mode=withdrawn']],
    ['a positional argument', ['withdrawn']],
  ])('rejects executable CLI arguments for %s before a Pages upload can start', async (_description, args) => {
    const spawned: Array<Readonly<{ command: string; args: readonly string[] }>> = []
    await expect(
      runPagesDeployCli(args, {
        spawn: async (command, commandArgs) => {
          spawned.push({ command, args: commandArgs })
        },
      }),
    ).rejects.toThrow(/optional --mode/i)
    expect(spawned).toEqual([])
  })

  it('does not trust a forged local origin tracking ref when the real remote lacks the preview branch', async () => {
    const { root } = await cleanPreviewRepository()
    const spawned: Array<Readonly<{ command: string; args: readonly string[] }>> = []
    const sha = await git(root, ['rev-parse', 'HEAD'])
    await git(root, ['update-ref', 'refs/remotes/origin/preview-beta', sha])

    await expect(
      runPagesDeploy({
        cwd: root,
        remoteGit: async () => '',
        spawn: async (command, args) => {
          spawned.push({ command, args })
        },
      }),
    ).rejects.toThrow(/ls-remote|remote preview-beta/i)
    expect(spawned).toEqual([])
  })

  it('requires the configured origin remote before a Pages upload can start', async () => {
    const { root } = await cleanPreviewRepository()
    const spawned: Array<Readonly<{ command: string; args: readonly string[] }>> = []
    await git(root, ['remote', 'remove', 'origin'])

    await expect(
      runPagesDeploy({
        cwd: root,
        remoteGit: async () => '',
        spawn: async (command, args) => {
          spawned.push({ command, args })
        },
      }),
    ).rejects.toThrow(/configured origin/i)
    expect(spawned).toEqual([])
  })

  it('rejects an arbitrary origin even when it points at a valid local preview branch', async () => {
    const { root, origin } = await cleanPreviewRepository()
    const spawned: Array<Readonly<{ command: string; args: readonly string[] }>> = []
    await git(root, ['remote', 'set-url', 'origin', origin])

    await expect(
      runPagesDeploy({
        cwd: root,
        spawn: async (command, args) => {
          spawned.push({ command, args })
        },
      }),
    ).rejects.toThrow(/canonical public origin/i)
    expect(spawned).toEqual([])
  })

  it('rejects a remote preview branch SHA that differs from HEAD even when the local tracking ref is forged', async () => {
    const { root, sha } = await cleanPreviewRepository()
    const spawned: Array<Readonly<{ command: string; args: readonly string[] }>> = []
    await writeFile(join(root, 'README.md'), 'different local commit\n', 'utf8')
    await git(root, ['add', 'README.md'])
    await git(root, ['commit', '-m', 'different local commit'])
    const localHead = await git(root, ['rev-parse', 'HEAD'])
    await git(root, ['update-ref', 'refs/remotes/origin/preview-beta', localHead])
    expect(localHead).not.toBe(sha)

    await expect(
      runPagesDeploy({
        cwd: root,
        remoteGit: canonicalRemoteResponse(sha),
        spawn: async (command, args) => {
          spawned.push({ command, args })
        },
      }),
    ).rejects.toThrow(/remote preview-beta.*HEAD/i)
    expect(spawned).toEqual([])
  })

  it.each([
    ['a malformed remote response', 'not-a-sha\trefs/heads/preview-beta'],
    ['multiple remote branch responses', `${SHA}\trefs/heads/preview-beta\n${SHA}\trefs/heads/preview-beta`],
  ])('rejects %s before a Pages upload can start', async (_description, remoteOutput) => {
    const { root } = await cleanPreviewRepository()
    const spawned: Array<Readonly<{ command: string; args: readonly string[] }>> = []
    await expect(
      runPagesDeploy({
        cwd: root,
        remoteGit: async () => remoteOutput,
        spawn: async (command, args) => {
          spawned.push({ command, args })
        },
      }),
    ).rejects.toThrow(/ls-remote/i)
    expect(spawned).toEqual([])
  })

  it.each([
    ['an altered ignored payload file', async (root: string) => writeFile(join(root, 'static-preview', 'dist', 'en', 'prompts', 'index.html'), 'altered', 'utf8')],
    ['a deleted ignored required asset', async (root: string) => unlink(join(root, 'static-preview', 'dist', 'assets', 'styles.css'))],
    ['an added ignored output file', async (root: string) => writeFile(join(root, 'static-preview', 'dist', 'operator-note.txt'), 'ignored but unsafe', 'utf8')],
    ['a malformed ignored manifest', async (root: string) => writeFile(join(root, 'static-preview', 'dist', 'preview-manifest.json'), '{"gitSha":"not-a-manifest"}\n', 'utf8')],
  ])('never spawns Wrangler for %s', async (_description, corrupt) => {
    const { root, sha } = await cleanPreviewRepository({ includeOutput: true })
    const spawned: Array<Readonly<{ command: string; args: readonly string[] }>> = []
    await corrupt(root)

    await expect(
      runPagesDeploy({
        cwd: root,
        remoteGit: canonicalRemoteResponse(sha),
        spawn: async (command, args) => {
          spawned.push({ command, args })
        },
      }),
    ).rejects.toThrow()
    expect(spawned).toEqual([])
  })
})
