export type DeployContext = Readonly<{
  branch: string
  headSha: string
  statusPorcelain: string
  manifestGitSha: string
}>

const PROJECT_NAME = 'bovideo-openlab-preview'
const PREVIEW_BRANCH = 'preview-beta'
const SHA_PATTERN = /^[a-f0-9]{40}$/
const CONFIGURATION_KEYS = ['$schema', 'name', 'compatibility_date', 'pages_build_output_dir'] as const

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertCommitSha(sha: string): void {
  if (!SHA_PATTERN.test(sha)) {
    throw new Error('Pages deployment requires an exact lower-case 40-hex commit SHA')
  }
}

function assertPagesOnlyConfig(wranglerConfig: unknown): void {
  if (!isRecord(wranglerConfig)) {
    throw new Error('Pages deployment requires an object configuration')
  }

  const keys = Reflect.ownKeys(wranglerConfig)
  if (
    keys.length !== CONFIGURATION_KEYS.length ||
    CONFIGURATION_KEYS.some((key) => !keys.includes(key)) ||
    keys.some((key) => typeof key !== 'string' || !CONFIGURATION_KEYS.includes(key as (typeof CONFIGURATION_KEYS)[number]))
  ) {
    throw new Error('Pages deployment configuration must contain only the approved Pages keys')
  }

  if (wranglerConfig.name !== PROJECT_NAME) {
    throw new Error(`Pages deployment project must be ${PROJECT_NAME}`)
  }
  if (typeof wranglerConfig.$schema !== 'string' || !wranglerConfig.$schema) {
    throw new Error('Pages deployment configuration requires a schema path')
  }
  if (
    typeof wranglerConfig.compatibility_date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(wranglerConfig.compatibility_date)
  ) {
    throw new Error('Pages deployment configuration requires an ISO compatibility date')
  }
  if (wranglerConfig.pages_build_output_dir !== './dist') {
    throw new Error('Pages deployment output must be ./dist')
  }
}

export function assertDeployable(context: DeployContext, wranglerConfig: unknown): void {
  if (context.branch !== PREVIEW_BRANCH) {
    throw new Error(`Pages deployment branch must be ${PREVIEW_BRANCH}`)
  }
  if (context.statusPorcelain !== '') {
    throw new Error('Pages deployment requires a clean Git worktree')
  }
  assertCommitSha(context.headSha)
  assertCommitSha(context.manifestGitSha)
  if (context.manifestGitSha !== context.headSha) {
    throw new Error('Pages deployment manifest Git SHA must match HEAD exactly')
  }
  assertPagesOnlyConfig(wranglerConfig)
}

export function pagesDeployArgs(sha: string): readonly string[] {
  assertCommitSha(sha)
  return [
    'pages',
    'deploy',
    'dist',
    '--cwd',
    'static-preview',
    `--project-name=${PROJECT_NAME}`,
    `--branch=${PREVIEW_BRANCH}`,
    `--commit-hash=${sha}`,
  ]
}
