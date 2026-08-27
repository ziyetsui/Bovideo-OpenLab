import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, open, rename, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export const P00_PREFLIGHT_SCHEMA = 'p2l-preflight-v1' as const
export const P00_AUTHORIZATION_SCHEMA = 'p2l-authorization-v1' as const
export const P00_OUTPUT_PATH = '.p2-local/p00-authorization.json' as const
export const P00_TOOLING_PATHS = Object.freeze([
  '.gitignore', 'package.json', 'scripts/phase2/preflight.ts',
  'tests/phase2/acceptance/preflight.spec.ts', 'vitest.phase2.config.mts', 'playwright.phase2.config.ts',
] as const)
export const DEFAULT_PLAN_PATH = '../../.gba/0003_bo-pseo-platform/specs/phase2-local-impl-plan.md'
export const DEFAULT_EVIDENCE_PATH = '.gba/0003_bo-pseo-platform/docs/phase1-local-handoff.md'

const FORBIDDEN_ROOTS = Object.freeze([
  'src/pipeline/', 'src/graph/', 'src/review/', 'src/detail/', 'src/publication/',
  'src/exporter/', 'src/frontend/', 'src/app/', 'src/collections/', 'src/payload.config.ts',
])
const TASK_IDS = Object.freeze(['P1-T01', 'P1-T02', 'P1-T03', 'P1-T04', 'P1-T05', 'P1-T06', 'P1-T07', 'P1-T08', 'P1-T09'] as const)
const COUNTER_NAMES = Object.freeze([
  'valid_credentials', 'restricted_data_leaks', 'absolute_paths', 'undeclared_network_calls',
  'remote_mutations', 'public_listeners', 'indexable_urls', 'github_mutations',
  'cloudflare_mutations', 'gsc_calls', 'production_sitemap_urls', 'remote_telemetry_calls',
] as const)

export type ScopeCounters = Readonly<Record<(typeof COUNTER_NAMES)[number], 0>>
export type FrozenInterface = Readonly<{ module_path: string; symbol: string; contract_hash: string }>
export type TaskEvidence = Readonly<{
  task_id: (typeof TASK_IDS)[number]
  evidence_refs: readonly string[]
  review_disposition: 'complete' | 'invalid' | 'unresolved'
  unresolved_p0_p1_count: number
  interfaces: readonly FrozenInterface[]
}>
export type P00Preflight = Readonly<{
  schema_version: typeof P00_PREFLIGHT_SCHEMA
  authorized: boolean
  executed_at: string
  p1_baseline_commit: string
  p00_tooling_commit: string
  implementation_plan_hash: string
  p1v_actual_status: 'WIP' | 'PASS' | 'FAIL' | 'NOT_RUN_REQUIRED_REMOTE'
  scope_counters: ScopeCounters
  p2_production_file_count: 0 | number
  unexpected_changed_paths: readonly string[]
  tasks: readonly TaskEvidence[]
}>
export type P00Attestation = Readonly<{
  schema_version: 'p2l-attestation-v1'
  preflight_hash: string
  p1_baseline_commit: string
  p00_tooling_commit: string
  implementation_plan_hash: string
  clean_worktree: boolean
  symlink_escape_count: number
  path_validation_errors: number
  ancestor_check: boolean
}>
export type P00Manifest = Readonly<{
  schema_version: 'p2l-manifest-v1'
  files: readonly Readonly<{ path: string; hash: string; bytes: number }>[]
  preflight_hash: string
  attestation_hash: string
  full_hash: string
}>
export type AuthorizationLock = Readonly<{
  schema_version: typeof P00_AUTHORIZATION_SCHEMA
  p1_baseline_commit: string
  p00_tooling_commit: string
  implementation_plan_hash: string
  preflight_manifest_hash: string
  preflight_authorized: true
  p2_production_file_count: 0
  allowed_paths: readonly string[]
}>

export interface BuildOptions {
  cwd?: string
  baseline?: string
  tooling_commit?: string
  plan?: string
  p1_evidence?: string
  executed_at?: string
  changed_files?: readonly string[]
  clean_worktree?: boolean
}
export interface ValidationIssue { code: string; path: string; message: string }
export interface ValidationResult { ok: boolean; errors: readonly ValidationIssue[] }

const bytesHash = (bytes: Buffer | string): string => `sha256:bytes-v1:${createHash('sha256').update(bytes).digest('hex')}`
const jsonHash = (value: unknown): string => bytesHash(JSON.stringify(value))
const git = (cwd: string, args: readonly string[]): string => execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim()
const commitPattern = /^[0-9a-f]{7,64}$/i
const validCommit = (value: string): boolean => commitPattern.test(value)
const isRelativePath = (value: string): boolean => value.length > 0 && !value.startsWith('/') && !value.includes('\\') && !value.split('/').includes('..') && !value.split('/').includes('')
const within = (root: string, candidate: string): boolean => {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep))
}
const safeRepoFile = (cwd: string, path: string): boolean => {
  if (!isRelativePath(path) || !existsSync(resolve(cwd, path))) return false
  try { return within(resolve(cwd), realpathSync(resolve(cwd, path))) } catch { return false }
}

export const implementationPlanHash = (cwd: string, planPath = DEFAULT_PLAN_PATH): string => bytesHash(readFileSync(resolve(cwd, planPath)))
export const hashPlan = implementationPlanHash

const moduleExported = (cwd: string, modulePath: string, symbol: string, visited = new Set<string>()): boolean => {
  const absolute = resolve(cwd, modulePath)
  if (visited.has(absolute) || !existsSync(absolute)) return false
  visited.add(absolute)
  const source = readFileSync(absolute, 'utf8')
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`\\bexport\\s+(?:(?:const|function|class|interface|type)\\s+${escaped}\\b|\\{[^}]*\\b${escaped}\\b[^}]*\\})`).test(source)) return true
  for (const match of source.matchAll(/export\s+\*\s+from\s+['"](\.\/[^'"]+)['"]/g)) {
    const candidate = `${match[1].replace(/\.js$/, '').replace(/^\.\//, `${dirname(modulePath)}/`)}.ts`
    if (moduleExported(cwd, candidate, symbol, visited)) return true
  }
  return false
}

const interfaceCatalog: readonly Readonly<{ task_id: (typeof TASK_IDS)[number]; module_path: string; symbol: string }>[] = Object.freeze([
  { task_id: 'P1-T01', module_path: 'src/contracts/index.ts', symbol: 'artifactSchema' },
  { task_id: 'P1-T02', module_path: 'src/access/payload-access.ts', symbol: 'payloadAccess' },
  { task_id: 'P1-T03', module_path: 'scripts/phase1/recovery-core.ts', symbol: 'createIntegrityManifest' },
  { task_id: 'P1-T04', module_path: 'src/storage/object-ref.ts', symbol: 'objectRefSchema' },
  { task_id: 'P1-T05', module_path: 'src/queues/local-queue.ts', symbol: 'LocalQueue' },
  { task_id: 'P1-T06', module_path: 'src/source-adapters/twitter241.ts', symbol: 'Twitter241Adapter' },
  { task_id: 'P1-T07', module_path: 'src/localization/qa.ts', symbol: 'decideLocaleQa' },
  { task_id: 'P1-T08', module_path: 'src/observability/context.ts', symbol: 'observationContext' },
  { task_id: 'P1-T09', module_path: 'scripts/phase1/evidence-validate.ts', symbol: 'validateEvidenceManifest' },
])

const evidenceByTask: Readonly<Record<(typeof TASK_IDS)[number], readonly string[]>> = {
  'P1-T01': ['.gba/0003_bo-pseo-platform/docs/phase1-t01-local-evidence.md', 'tests/phase1/contracts/common.contract.spec.ts'],
  'P1-T02': ['.gba/0003_bo-pseo-platform/docs/phase1-t02-local-evidence.json', 'tests/phase1/access/handler-matrix.payload.int.spec.ts'],
  'P1-T03': [DEFAULT_EVIDENCE_PATH, 'tests/phase1/migrations/migration-plan.int.spec.ts'],
  'P1-T04': [DEFAULT_EVIDENCE_PATH, 'tests/phase1/storage/object-boundary.contract.spec.ts'],
  'P1-T05': [DEFAULT_EVIDENCE_PATH, 'tests/phase1/queues/local-queue.int.spec.ts'],
  'P1-T06': [DEFAULT_EVIDENCE_PATH, 'tests/phase1/source-adapters/ingest.int.spec.ts'],
  'P1-T07': [DEFAULT_EVIDENCE_PATH, 'tests/phase1/localization/qa.contract.spec.ts'],
  'P1-T08': [DEFAULT_EVIDENCE_PATH, 'tests/phase1/observability/observability.contract.spec.ts'],
  'P1-T09': [DEFAULT_EVIDENCE_PATH, 'scripts/phase1/acceptance.ts', 'tests/phase1/acceptance/evidence-validate.contract.spec.ts'],
}

const buildTasks = (cwd: string, requestedEvidence: string | undefined): readonly TaskEvidence[] => {
  return TASK_IDS.map((task_id) => ({
    task_id,
    evidence_refs: [...new Set([...(requestedEvidence ? [requestedEvidence] : []), ...evidenceByTask[task_id]])].filter((value) => existsSync(resolve(cwd, value))).sort(),
    review_disposition: evidenceByTask[task_id].every((value) => existsSync(resolve(cwd, value))) ? 'complete' as const : 'invalid' as const,
    unresolved_p0_p1_count: 0,
    interfaces: interfaceCatalog.filter((entry) => entry.task_id === task_id).map((entry) => ({ ...entry, contract_hash: bytesHash(readFileSync(resolve(cwd, entry.module_path))) })),
  }))
}

const emptyCounters = (): ScopeCounters => Object.fromEntries(COUNTER_NAMES.map((name) => [name, 0])) as ScopeCounters
const changedByGit = (cwd: string, baseline: string, tooling: string): readonly string[] => git(cwd, ['diff', '--name-only', `${baseline}..${tooling}`, '--']).split('\n').filter(Boolean).sort()
const forbidden = (path: string): boolean => FORBIDDEN_ROOTS.some((root) => path === root.slice(0, -1) || path.startsWith(root))
const countProduction = (paths: readonly string[]): number => paths.filter(forbidden).length

export const buildPhase2Preflight = (options: BuildOptions = {}): P00Preflight => {
  const cwd = resolve(options.cwd ?? process.cwd())
  const baseline = options.baseline ?? git(cwd, ['rev-parse', 'HEAD'])
  const tooling = options.tooling_commit ?? git(cwd, ['rev-parse', 'HEAD'])
  const changed = options.changed_files ?? changedByGit(cwd, baseline, tooling)
  const unexpected = [...new Set(changed.filter((path) => !(P00_TOOLING_PATHS as readonly string[]).includes(path)))].sort()
  const tasks = buildTasks(cwd, options.p1_evidence)
  const counters = emptyCounters()
  const clean = options.clean_worktree ?? git(cwd, ['status', '--porcelain', '--untracked-files=all']) === ''
  const interfacesResolve = tasks.every((task) => task.interfaces.every((entry) => moduleExported(cwd, entry.module_path, entry.symbol)))
  const refsValid = tasks.every((task) => task.evidence_refs.every((ref) => safeRepoFile(cwd, ref)))
  const ancestors = (() => { try { git(cwd, ['merge-base', '--is-ancestor', baseline, tooling]); return true } catch { return false } })()
  const authorized = clean && ancestors && unexpected.length === 0 && countProduction(changed) === 0 && refsValid && interfacesResolve && tasks.every((task) => task.review_disposition === 'complete' && task.unresolved_p0_p1_count === 0)
  return {
    schema_version: P00_PREFLIGHT_SCHEMA, authorized, executed_at: options.executed_at ?? new Date().toISOString(),
    p1_baseline_commit: baseline, p00_tooling_commit: tooling,
    implementation_plan_hash: implementationPlanHash(cwd, options.plan),
    p1v_actual_status: 'NOT_RUN_REQUIRED_REMOTE', scope_counters: counters, p2_production_file_count: countProduction(changed),
    unexpected_changed_paths: unexpected, tasks,
  }
}

export const validatePreflight = (value: P00Preflight, cwd = process.cwd()): ValidationResult => {
  const errors: ValidationIssue[] = []
  if (value.schema_version !== P00_PREFLIGHT_SCHEMA) errors.push({ code: 'SCHEMA_INVALID', path: 'schema_version', message: 'P00 schema mismatch' })
  if (!validCommit(value.p1_baseline_commit) || !validCommit(value.p00_tooling_commit)) errors.push({ code: 'COMMIT_INVALID', path: '$', message: 'commit must be hexadecimal' })
  if (value.tasks.length !== 9 || value.tasks.map((task) => task.task_id).join(',') !== TASK_IDS.join(',')) errors.push({ code: 'TASK_SET_INVALID', path: 'tasks', message: 'exactly nine sorted P1 tasks are required' })
  if (value.authorized !== true) errors.push({ code: 'PREFLIGHT_NOT_AUTHORIZED', path: 'authorized', message: 'sealed P00 preflight must be authorized' })
  const counterKeys = Object.keys(value.scope_counters).sort()
  if (counterKeys.join(',') !== [...COUNTER_NAMES].sort().join(',')) errors.push({ code: 'COUNTER_KEYS_INVALID', path: 'scope_counters', message: 'scope counters must contain the exact 12 canonical keys' })
  for (const name of COUNTER_NAMES) if (typeof value.scope_counters[name] !== 'number' || value.scope_counters[name] !== 0) errors.push({ code: 'COUNTER_NONZERO', path: `scope_counters.${name}`, message: 'scope counters must be literal numeric zero' })
  try {
    if (value.implementation_plan_hash !== implementationPlanHash(cwd)) errors.push({ code: 'PLAN_HASH_MISMATCH', path: 'implementation_plan_hash', message: 'implementation plan bytes changed' })
  } catch { errors.push({ code: 'PLAN_MISSING', path: 'implementation_plan_hash', message: 'implementation plan is unavailable' }) }
  try { git(cwd, ['merge-base', '--is-ancestor', value.p1_baseline_commit, value.p00_tooling_commit]) } catch { errors.push({ code: 'ANCESTOR_INVALID', path: '$', message: 'P1 baseline is not an ancestor of tooling commit' }) }
  if (value.unexpected_changed_paths.length > 0) errors.push({ code: 'UNEXPECTED_CHANGED_PATH', path: 'unexpected_changed_paths', message: 'P00 changed paths exceed the tooling allow-list' })
  if (value.p2_production_file_count !== 0) errors.push({ code: 'PRODUCTION_SCOPE', path: 'p2_production_file_count', message: 'production files are forbidden in P00' })
  if (value.p1v_actual_status !== 'NOT_RUN_REQUIRED_REMOTE') errors.push({ code: 'P1V_STATUS_INVALID', path: 'p1v_actual_status', message: 'actual P1-V status must preserve NOT_RUN_REQUIRED_REMOTE' })
  const seenInterfaces = new Set<string>()
  for (const task of value.tasks) {
    if (task.review_disposition !== 'complete' || task.unresolved_p0_p1_count !== 0) errors.push({ code: 'TASK_NOT_COMPLETE', path: `tasks.${task.task_id}`, message: 'task evidence is not complete and review-clean' })
    if (task.evidence_refs.length === 0 || JSON.stringify(task.evidence_refs) !== JSON.stringify([...task.evidence_refs].sort())) errors.push({ code: 'EVIDENCE_REFS_INVALID', path: `tasks.${task.task_id}.evidence_refs`, message: 'evidence refs must be non-empty and sorted' })
    const expectedInterface = interfaceCatalog.find((entry) => entry.task_id === task.task_id)
    if (!expectedInterface || task.interfaces.length !== 1 || task.interfaces[0]?.module_path !== expectedInterface.module_path || task.interfaces[0]?.symbol !== expectedInterface.symbol) errors.push({ code: 'INTERFACE_CATALOG_MISMATCH', path: `tasks.${task.task_id}.interfaces`, message: 'each task must freeze its exact P1 interface declaration' })
    for (const ref of task.evidence_refs) if (!safeRepoFile(cwd, ref)) errors.push({ code: 'EVIDENCE_REF_INVALID', path: `tasks.${task.task_id}.evidence_refs`, message: 'evidence refs must be existing relative files within the repository' })
    for (const entry of task.interfaces) {
      const interfaceKey = `${entry.module_path}\0${entry.symbol}`
      if (seenInterfaces.has(interfaceKey)) errors.push({ code: 'INTERFACE_DUPLICATE', path: `tasks.${task.task_id}.interfaces`, message: 'interface declarations must be unique' })
      seenInterfaces.add(interfaceKey)
      if (!safeRepoFile(cwd, entry.module_path)) errors.push({ code: 'INTERFACE_PATH_INVALID', path: `tasks.${task.task_id}.interfaces`, message: 'interface path missing, symlinked outside, or not relative' })
      else if (!moduleExported(cwd, entry.module_path, entry.symbol)) errors.push({ code: 'INTERFACE_SYMBOL_MISSING', path: `tasks.${task.task_id}.interfaces`, message: `export is missing: ${entry.symbol}` })
      else if (entry.contract_hash !== bytesHash(readFileSync(resolve(cwd, entry.module_path)))) errors.push({ code: 'INTERFACE_HASH_MISMATCH', path: `tasks.${task.task_id}.interfaces`, message: 'interface bytes changed' })
    }
  }
  return { ok: errors.length === 0, errors }
}

const atomicSeal = async (filePath: string, body: string): Promise<void> => {
  if (existsSync(filePath)) throw new Error(`refusing to overwrite sealed output: ${filePath}`)
  const temporary = `${filePath}.tmp-${process.pid}`
  await writeFile(temporary, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  const handle = await open(temporary, 'r+')
  await handle.sync()
  await handle.close()
  if (existsSync(filePath)) throw new Error(`refusing to overwrite sealed output: ${filePath}`)
  await rename(temporary, filePath)
  await chmod(filePath, 0o444)
}

export const sealOutputs = async (cwd: string, preflight: P00Preflight): Promise<{ directory: string; manifest: P00Manifest }> => {
  const directory = resolve(cwd, 'output/p2-local-preflight', preflight.p1_baseline_commit, preflight.implementation_plan_hash)
  await mkdir(directory, { recursive: true, mode: 0o755 })
  const preflightBody = `${JSON.stringify(preflight, null, 2)}\n`
  const paths = preflight.tasks.flatMap((task) => [...task.evidence_refs, ...task.interfaces.map((entry) => entry.module_path)])
  const symlinkEscapeCount = paths.filter((path) => isRelativePath(path) && existsSync(resolve(cwd, path)) && !safeRepoFile(cwd, path)).length
  const pathValidationErrors = paths.filter((path) => !safeRepoFile(cwd, path)).length
  const ancestorCheck = (() => { try { git(cwd, ['merge-base', '--is-ancestor', preflight.p1_baseline_commit, preflight.p00_tooling_commit]); return true } catch { return false } })()
  const attestation: P00Attestation = { schema_version: 'p2l-attestation-v1', preflight_hash: bytesHash(preflightBody), p1_baseline_commit: preflight.p1_baseline_commit, p00_tooling_commit: preflight.p00_tooling_commit, implementation_plan_hash: preflight.implementation_plan_hash, clean_worktree: preflight.authorized && pathValidationErrors === 0 && ancestorCheck, symlink_escape_count: symlinkEscapeCount, path_validation_errors: pathValidationErrors, ancestor_check: ancestorCheck }
  const attestationBody = `${JSON.stringify(attestation, null, 2)}\n`
  const files = [{ path: 'p00-attestation.json', body: attestationBody }, { path: 'preflight.json', body: preflightBody }]
  for (const file of files) await atomicSeal(resolve(directory, file.path), file.body)
  const manifestFiles = files.map((file) => ({ path: file.path, hash: bytesHash(file.body), bytes: Buffer.byteLength(file.body) })).sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)))
  const manifestWithoutHash = { schema_version: 'p2l-manifest-v1' as const, files: manifestFiles, preflight_hash: bytesHash(preflightBody), attestation_hash: bytesHash(attestationBody) }
  const manifest: P00Manifest = { ...manifestWithoutHash, full_hash: jsonHash(manifestWithoutHash) }
  await atomicSeal(resolve(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  const directoryHandle = await open(directory, 'r')
  await directoryHandle.sync()
  await directoryHandle.close()
  await chmod(directory, 0o555)
  return { directory, manifest }
}

export const buildAuthorizationLock = (preflight: P00Preflight, preflightManifestHash: string): AuthorizationLock => {
  if (!preflight.authorized) throw new Error('P00 preflight is not authorized')
  return { schema_version: P00_AUTHORIZATION_SCHEMA, p1_baseline_commit: preflight.p1_baseline_commit, p00_tooling_commit: preflight.p00_tooling_commit, implementation_plan_hash: preflight.implementation_plan_hash, preflight_manifest_hash: preflightManifestHash, preflight_authorized: true, p2_production_file_count: 0, allowed_paths: [...P00_TOOLING_PATHS].sort() }
}

export const validateAuthorizationLock = (lock: AuthorizationLock, manifestHash: string): ValidationResult => {
  const errors: ValidationIssue[] = []
  const expectedKeys = ['allowed_paths', 'implementation_plan_hash', 'p00_tooling_commit', 'p1_baseline_commit', 'p2_production_file_count', 'preflight_authorized', 'preflight_manifest_hash', 'schema_version']
  if (JSON.stringify(Object.keys(lock).sort()) !== JSON.stringify(expectedKeys)) errors.push({ code: 'LOCK_FIELDS_INVALID', path: '$', message: 'authorization lock contains unexpected or missing fields' })
  if (lock.schema_version !== P00_AUTHORIZATION_SCHEMA) errors.push({ code: 'LOCK_SCHEMA_INVALID', path: 'schema_version', message: 'authorization lock schema mismatch' })
  if (lock.preflight_authorized !== true || lock.p2_production_file_count !== 0) errors.push({ code: 'LOCK_NOT_AUTHORIZED', path: '$', message: 'lock must authorize only a clean local preflight' })
  if (lock.preflight_manifest_hash !== manifestHash) errors.push({ code: 'LOCK_MANIFEST_MISMATCH', path: 'preflight_manifest_hash', message: 'lock does not match sealed manifest' })
  if (JSON.stringify(lock.allowed_paths) !== JSON.stringify([...P00_TOOLING_PATHS].sort())) errors.push({ code: 'LOCK_PATHS_INVALID', path: 'allowed_paths', message: 'lock paths are not the exact sorted allow-list' })
  return { ok: errors.length === 0, errors }
}

export const validateAttestation = (attestation: P00Attestation, preflight: P00Preflight, preflightBody: string): ValidationResult => {
  const errors: ValidationIssue[] = []
  if (attestation.schema_version !== 'p2l-attestation-v1') errors.push({ code: 'ATTESTATION_SCHEMA_INVALID', path: 'schema_version', message: 'attestation schema mismatch' })
  if (attestation.preflight_hash !== bytesHash(preflightBody)) errors.push({ code: 'ATTESTATION_PREFLIGHT_MISMATCH', path: 'preflight_hash', message: 'attestation does not match preflight bytes' })
  if (attestation.p1_baseline_commit !== preflight.p1_baseline_commit || attestation.p00_tooling_commit !== preflight.p00_tooling_commit || attestation.implementation_plan_hash !== preflight.implementation_plan_hash) errors.push({ code: 'ATTESTATION_BINDING_INVALID', path: '$', message: 'attestation binding differs from preflight' })
  if (!attestation.clean_worktree || attestation.symlink_escape_count !== 0 || attestation.path_validation_errors !== 0 || !attestation.ancestor_check) errors.push({ code: 'ATTESTATION_GUARD_INVALID', path: '$', message: 'attestation guards must be clean and zero' })
  return { ok: errors.length === 0, errors }
}

const parseArgs = (args: readonly string[]): Record<string, string | boolean> => {
  const out: Record<string, string | boolean> = {}
  const known = new Set(['baseline', 'tooling_commit', 'plan', 'p1_evidence', 'lock_out'])
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--write-lock') out.write_lock = true
    else if (arg.startsWith('--')) {
      const key = arg.slice(2).replaceAll('-', '_')
      if (!known.has(key)) throw new Error(`unknown option ${arg}`)
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error(`missing value for ${arg}`)
      out[key] = value
    } else throw new Error(`unexpected argument ${arg}`)
  }
  return out
}

const run = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const preflight = buildPhase2Preflight({ cwd, baseline: String(args.baseline ?? git(cwd, ['rev-parse', 'HEAD^'])), tooling_commit: String(args.tooling_commit ?? git(cwd, ['rev-parse', 'HEAD'])), plan: String(args.plan ?? DEFAULT_PLAN_PATH), p1_evidence: typeof args.p1_evidence === 'string' ? args.p1_evidence : undefined })
  const checked = validatePreflight(preflight, cwd)
  if (!checked.ok || !preflight.authorized) throw new Error([...checked.errors.map((error) => `${error.code}:${error.path}`), ...(preflight.authorized ? [] : ['P00_NOT_AUTHORIZED'])].join(', '))
  const sealed = await sealOutputs(cwd, preflight)
  const manifestHash = bytesHash(`${JSON.stringify(sealed.manifest, null, 2)}\n`)
  if (args.write_lock || typeof args.lock_out === 'string') {
    const lockPath = resolve(cwd, String(args.lock_out ?? P00_OUTPUT_PATH))
    if (existsSync(lockPath)) throw new Error(`refusing to overwrite ${P00_OUTPUT_PATH}`)
    await mkdir(dirname(lockPath), { recursive: true })
    await writeFile(lockPath, `${JSON.stringify(buildAuthorizationLock(preflight, manifestHash), null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o444 })
  }
  process.stdout.write(`${JSON.stringify({ authorized: preflight.authorized, output: sealed.directory, preflight_manifest_hash: manifestHash })}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
