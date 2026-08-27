import { execFile as executeFile, spawn as spawnProcess } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { assertDeployable, pagesDeployArgs } from './deploy-preflight'
import { PREVIEW_MODES, type PreviewMode } from './contracts'
import { verifyExistingPreview, verifyPreview } from './verify'

type Spawn = (command: string, args: readonly string[]) => Promise<void>
type Git = (cwd: string, args: readonly string[]) => Promise<string>

export type RemoteGitInvocation = Readonly<{
  cwd: string
  args: readonly string[]
  env: Readonly<NodeJS.ProcessEnv>
}>

type RemoteGit = (invocation: RemoteGitInvocation) => Promise<string>

export type PagesDeployOptions = Readonly<{
  cwd?: string
  git?: Git
  remoteGit?: RemoteGit
  spawn?: Spawn
  mode?: PreviewMode
}>

const execFile = promisify(executeFile)
const CANONICAL_PUBLIC_ORIGIN = 'https://github.com/ziyetsui/Bovideo-OpenLab.git'
const REMOTE_PREVIEW_REF = 'refs/heads/preview-beta'

async function git(cwd: string, args: readonly string[]): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout.trimEnd()
}

function trustedRemoteGitEnvironment(proofCwd: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    NODE_ENV: process.env.NODE_ENV ?? 'production',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_COUNT: '0',
    XDG_CONFIG_HOME: '/dev/null',
    GIT_CEILING_DIRECTORIES: proofCwd,
    GIT_TERMINAL_PROMPT: '0',
    LANG: 'C',
    LC_ALL: 'C',
  }
}

async function literalRemoteGit(invocation: RemoteGitInvocation): Promise<string> {
  return (await execFile('git', invocation.args, { cwd: invocation.cwd, env: invocation.env })).stdout.trimEnd()
}

export async function queryIsolatedRemoteRef(
  remoteUrl: string,
  runRemoteGit: RemoteGit = literalRemoteGit,
): Promise<string> {
  const proofCwd = await mkdtemp(join(tmpdir(), 'pvb-public-remote-proof-'))
  try {
    return await runRemoteGit({
      cwd: proofCwd,
      args: ['ls-remote', '--heads', remoteUrl, REMOTE_PREVIEW_REF],
      env: trustedRemoteGitEnvironment(proofCwd),
    })
  } finally {
    await rm(proofCwd, { recursive: true, force: true })
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function assertPreviewMode(mode: PreviewMode): void {
  if (!PREVIEW_MODES.includes(mode)) {
    throw new Error('Pages deployment mode must be baseline or withdrawn')
  }
}

async function assertRemotePreviewCommit(cwd: string, headSha: string, runGit: Git, runRemoteGit: RemoteGit): Promise<void> {
  let originUrl: string
  try {
    originUrl = await runGit(cwd, ['config', '--get', 'remote.origin.url'])
  } catch {
    throw new Error('Pages deployment requires a configured origin remote')
  }
  if (originUrl !== CANONICAL_PUBLIC_ORIGIN) {
    throw new Error(`Pages deployment requires canonical public origin ${CANONICAL_PUBLIC_ORIGIN}`)
  }

  let remoteOutput: string
  try {
    remoteOutput = await queryIsolatedRemoteRef(CANONICAL_PUBLIC_ORIGIN, runRemoteGit)
  } catch {
    throw new Error('Pages deployment requires an exact remote preview-beta branch from git ls-remote')
  }
  const match = /^([a-f0-9]{40})\trefs\/heads\/preview-beta$/.exec(remoteOutput)
  if (!match) {
    throw new Error('Pages deployment requires exactly one valid remote preview-beta branch from git ls-remote')
  }
  if (match[1] !== headSha) {
    throw new Error('Pages deployment requires remote preview-beta to match HEAD before upload')
  }
}

function spawn(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolveSpawn, rejectSpawn) => {
    const child = spawnProcess(command, args, { stdio: 'inherit' })
    child.once('error', rejectSpawn)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveSpawn()
      } else {
        rejectSpawn(new Error(`Pages deployment command failed with ${signal ?? `exit code ${code ?? 'unknown'}`}`))
      }
    })
  })
}

export async function runPagesDeploy(options: PagesDeployOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd()
  const runGit = options.git ?? git
  const runRemoteGit = options.remoteGit ?? literalRemoteGit
  const mode = options.mode ?? 'baseline'
  assertPreviewMode(mode)
  const outDir = join(cwd, 'static-preview', 'dist')
  const [branch, headSha, statusPorcelain, configSource] = await Promise.all([
    runGit(cwd, ['branch', '--show-current']),
    runGit(cwd, ['rev-parse', 'HEAD']),
    runGit(cwd, ['status', '--porcelain']),
    readFile(join(cwd, 'static-preview', 'wrangler.jsonc'), 'utf8'),
  ])
  const config = JSON.parse(configSource) as unknown

  // Validate the committed release intent before generated output is created or touched.
  assertDeployable({ branch, headSha, statusPorcelain, manifestGitSha: headSha }, config)
  await assertRemotePreviewCommit(cwd, headSha, runGit, runRemoteGit)

  // An existing ignored tree must already be exact. This rejects operator/process tampering
  // instead of silently masking it by rebuilding before the release gate observes it.
  if (await pathExists(outDir)) {
    await verifyExistingPreview({ outDir, gitSha: headSha, mode })
  }

  // This is the same deterministic build+verify operation exposed by preview:static:verify.
  // It rebuilds and fully validates the only tree that Wrangler can upload, immediately
  // before the sole Wrangler spawn.
  const manifest = await verifyPreview({ outDir, gitSha: headSha, mode })
  if (manifest.gitSha !== headSha) {
    throw new Error('Pages deployment manifest Git SHA must match HEAD exactly')
  }

  const finalStatus = await runGit(cwd, ['status', '--porcelain'])
  assertDeployable({ branch, headSha, statusPorcelain: finalStatus, manifestGitSha: manifest.gitSha }, config)
  await (options.spawn ?? spawn)('pnpm', ['exec', 'wrangler', ...pagesDeployArgs(headSha)])
}

export function parsePagesDeployArgs(args: readonly string[]): PreviewMode {
  if (args.length === 0) return 'baseline'
  if (args.length === 2 && args[0] === '--mode' && PREVIEW_MODES.includes(args[1] as PreviewMode)) {
    return args[1] as PreviewMode
  }
  throw new Error('Pages deployment accepts only the optional --mode baseline|withdrawn argument')
}

export async function runPagesDeployCli(
  args: readonly string[] = process.argv.slice(2),
  options: Omit<PagesDeployOptions, 'mode'> = {},
): Promise<void> {
  await runPagesDeploy({ ...options, mode: parsePagesDeployArgs(args) })
}

if (process.argv[1]?.endsWith('/pages-deploy.ts')) {
  void runPagesDeployCli()
}
