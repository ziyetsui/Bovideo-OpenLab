import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { implementationPlanHash, validateAuthorizationLock, validateAttestation, validatePreflight, type P00Attestation, type P00Manifest, type P00Preflight, type AuthorizationLock } from './preflight'
import { validateScopeCounters, type ScopeCounters } from './scope-scan'

export const P2_LOCAL_EVIDENCE_SCHEMA = 'p2l-acceptance-v1' as const
export const P2_LOCAL_VERDICT = 'Phase 2 LOCAL-DEV COMPLETE — production P0/P1 remain NO-GO' as const
export const D12_APPLICABILITY_SCHEMA = 'd12-applicability-v1' as const
export type Applicability = 'required-local' | 'required-remote' | 'deferred-to-P0' | 'not-applicable-yet' | 'production'
export type EvidenceStatus = 'PASS' | 'FAIL' | 'NOT_RUN' | 'NOT_APPLICABLE'
export type EvidenceMethod = 'unit' | 'integration' | 'e2e' | 'inspection' | 'load' | 'security' | 'cohort'
export interface D12ApplicabilityRow {
  row_id: string
  source_requirement_ids: string
  severity: 'P0' | 'P1' | 'P2' | 'P3'
  applicability: Applicability
  required_status: EvidenceStatus
  successor_gate: string | null
}
export interface EvidenceRequirement extends D12ApplicabilityRow {
  id: string
  status: EvidenceStatus
  environment: 'local' | 'preview' | 'production'
  method: EvidenceMethod
  evidence_refs: string[]
  observed: string
  expected: string
  owner: string
  executed_at: string
}
export interface ValidationIssue { code: string; path: string; message: string }
export interface ValidationResult { ok: boolean; errors: ValidationIssue[] }
export interface PrerequisiteTask { task_id: string; evidence_refs: string[]; review_disposition: 'complete' | 'invalid' | 'unresolved'; unresolved_p0_p1_count: number; interfaces: Array<{ module_path: string; symbol: string; contract_hash: string }> }
export interface Prerequisites {
  schema_version: 'p2l-prerequisites-v1'
  authorized: boolean
  revalidated_at: string
  p1_baseline_commit: string
  p00_tooling_commit: string
  p00_authorization_commit: string
  p00_preflight_manifest_hash: string
  implementation_plan_hash: string
  p1v_actual_status: 'NOT_RUN_REQUIRED_REMOTE' | 'WIP' | 'PASS' | 'FAIL'
  p00_attestation: P00Attestation
  git: { current_head: string; p1_baseline_ancestor: boolean; p00_authorization_ancestor: boolean; current_worktree_clean: boolean; forbidden_at_authorization: string[] }
  tasks: PrerequisiteTask[]
}
export interface RunMetadata {
  run_id: string; git_commit: string; schema_version: typeof P2_LOCAL_EVIDENCE_SCHEMA; started_at: string; ended_at: string; environment: 'local'; executor: string; profile: 'p2-local'; profile_verdict: typeof P2_LOCAL_VERDICT; production_gate: 'NO-GO'; p1_baseline_commit: string; p00_authorization_commit: string; p00_preflight_manifest_hash: string; implementation_plan_hash: string; p1v_actual_status: 'NOT_RUN_REQUIRED_REMOTE';
}
export interface AcceptancePackage {
  run: RunMetadata
  environment: Record<string, unknown>
  prerequisites: Prerequisites
  applicability: D12ApplicabilityRow[]
  requirements: EvidenceRequirement[]
  requirements_csv?: string
  commands_log: string
  fixtures_manifest: Record<string, unknown>
  scope_counters: ScopeCounters
  reports: Record<string, string>
  publish: Record<string, string>
  final_report: string
}

const commitPattern = /^[0-9a-f]{7,64}$/i
const hashPattern = /^sha256:[A-Za-z0-9._-]+:[0-9a-f]{64}$/i
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const requiredTaskIds = Object.freeze(['P1-T01', 'P1-T02', 'P1-T03', 'P1-T04', 'P1-T05', 'P1-T06', 'P1-T07', 'P1-T08', 'P1-T09'])
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const safeRef = (cwd: string, ref: string): boolean => {
  if (!isNonEmpty(ref) || isAbsolute(ref) || ref.includes('\\') || ref.split('/').some((segment) => segment === '' || segment === '..')) return false
  try {
    const root = realpathSync(cwd); const absolute = resolve(root, ref); if (lstatSync(absolute).isSymbolicLink()) return false; const real = realpathSync(absolute); const rel = relative(root, real)
    return (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) && statSync(real).isFile()
  } catch { return false }
}
const hashBytes = (value: string | Buffer, framing = 'p2l-v1'): string => `sha256:${framing}:${createHash('sha256').update(value).digest('hex')}`
const git = (cwd: string, args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const ancestor = (cwd: string, base: string, head: string): boolean => { try { git(cwd, ['merge-base', '--is-ancestor', base, head]); return true } catch { return false } }
const moduleExportsSymbol = (cwd: string, modulePath: string, symbol: string, visited = new Set<string>()): boolean => {
  const absolute = resolve(cwd, modulePath); if (visited.has(absolute) || !existsSync(absolute)) return false; visited.add(absolute)
  const source = readFileSync(absolute, 'utf8'); const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`\\bexport\\s+(?:(?:const|function|class|interface|type)\\s+${escaped}\\b|\\{[^}]*\\b${escaped}\\b[^}]*\\})`).test(source)) return true
  for (const match of source.matchAll(/export\s+\*\s+from\s+["'](\.[^"']+)["']/g)) {
    const child = resolve(cwd, modulePath.replace(/[^/]+$/, ''), `${match[1]}.ts`)
    if (moduleExportsSymbol(cwd, relative(cwd, child), symbol, visited)) return true
  }
  return false
}
const add = (errors: ValidationIssue[], code: string, path: string, message: string): void => { errors.push({ code, path, message }) }

const row = (row_id: string, source_requirement_ids: string, applicability: Applicability, required_status: EvidenceStatus, successor_gate: string | null): D12ApplicabilityRow => ({ row_id, source_requirement_ids, severity: 'P0', applicability, required_status, successor_gate })
export const D12_APPLICABILITY: readonly D12ApplicabilityRow[] = Object.freeze([
  row('P2L-REQ-T01', 'AC-P2L-T01', 'required-local', 'PASS', null), row('P2L-DEFER-T01', 'AC-ING-001..009; AC-OPS-002', 'deferred-to-P0', 'NOT_RUN', 'P0-PRODUCTION-DECISION'), row('P2L-LATER-T01', 'real-third-party-acquisition', 'not-applicable-yet', 'NOT_APPLICABLE', 'NORMAL-P2-T01'),
  row('P2L-REQ-T02', 'AC-P2L-T02', 'required-local', 'PASS', null), row('P2L-DEFER-T02', 'production-graph-cms-concurrency-scale', 'deferred-to-P0', 'NOT_RUN', 'P0-PRODUCTION-DECISION'), row('P2L-LATER-T02', 'public-candidate-elevation-index-qualification', 'not-applicable-yet', 'NOT_APPLICABLE', 'NORMAL-P2-T02'),
  row('P2L-REQ-T03', 'AC-P2L-T03', 'required-local', 'PASS', null), row('P2L-DEFER-T03', 'production-translation-provider-cost-queue', 'deferred-to-P0', 'NOT_RUN', 'P0-PRODUCTION-DECISION'), row('P2L-LATER-T03', 'indexable-locale-routing-production-sitemap', 'not-applicable-yet', 'NOT_APPLICABLE', 'NORMAL-P2-T03'),
  row('P2L-REQ-T04', 'AC-P2L-T04', 'required-local', 'PASS', null), row('P2L-DEFER-T04', 'production-web-accessibility-performance; AC-PERF-001..006', 'deferred-to-P0', 'NOT_RUN', 'P0-PRODUCTION-DECISION'), row('P2L-LATER-T04', 'phase3-four-family-ui', 'not-applicable-yet', 'NOT_APPLICABLE', 'P3-T01'),
  row('P2L-REQ-T05', 'AC-P2L-T05', 'required-local', 'PASS', null), row('P2L-DEFER-T05', 'remote-r2-snapshot-production-sitemap-export', 'deferred-to-P0', 'NOT_RUN', 'P0-PRODUCTION-DECISION'), row('P2L-LATER-T05', 'canonical-hreflang-jsonld-github-mirror; AC-SEO-001..018; AC-GH-001..016', 'not-applicable-yet', 'NOT_APPLICABLE', 'P4-T01'),
  row('P2L-REQ-T06', 'AC-P2L-T06', 'required-local', 'PASS', null), row('P2L-DEFER-T06', 'AC-PUB-006..009; AC-P0-012..014; AC-OPS-004', 'deferred-to-P0', 'NOT_RUN', 'P0-PRODUCTION-DECISION'), row('P2L-LATER-T06', 'cloudflare-public-cache-official-repository-convergence', 'not-applicable-yet', 'NOT_APPLICABLE', 'NORMAL-P2-T06'),
  row('P2L-REQ-T07', 'AC-P2L-T07', 'required-local', 'PASS', null), row('P2L-DEFER-T07', 'production-release-signoff-and-all-deferred-production-AC', 'deferred-to-P0', 'NOT_RUN', 'P0-PRODUCTION-DECISION'), row('P2L-LATER-T07', 'public-demo-openlab-phase4-package', 'not-applicable-yet', 'NOT_APPLICABLE', 'P4-T07'),
])

export const validatePrerequisites = (value: unknown, options: { cwd?: string; allowDirty?: boolean } = {}): ValidationResult => {
  const errors: ValidationIssue[] = []; const cwd = resolve(options.cwd ?? process.cwd())
  if (!isRecord(value)) return { ok: false, errors: [{ code: 'PREREQUISITES_INVALID', path: '$', message: 'prerequisites must be an object' }] }
  if (value.schema_version !== 'p2l-prerequisites-v1') add(errors, 'PREREQUISITES_SCHEMA_INVALID', 'schema_version', 'unexpected prerequisites schema')
  for (const field of ['p1_baseline_commit', 'p00_tooling_commit', 'p00_authorization_commit', 'p00_preflight_manifest_hash', 'implementation_plan_hash']) if (!isNonEmpty(value[field])) add(errors, 'PREREQUISITE_FIELD_MISSING', field, 'prerequisite binding is required')
  if (value.authorized !== true) add(errors, 'PREREQUISITES_NOT_AUTHORIZED', 'authorized', 'prerequisites must remain authorized')
  if (value.p1v_actual_status !== 'NOT_RUN_REQUIRED_REMOTE') add(errors, 'P1V_STATUS_INVALID', 'p1v_actual_status', 'actual P1-V status must remain NOT_RUN_REQUIRED_REMOTE')
  if (Array.isArray(value.tasks)) { const ids = value.tasks.map((task) => isRecord(task) ? task.task_id : undefined); if (ids.join(',') !== requiredTaskIds.join(',')) add(errors, 'TASK_SET_INVALID', 'tasks', 'exactly the nine ordered P1 task rows are required'); for (const task of value.tasks) { if (!isRecord(task)) continue; if (task.review_disposition !== 'complete' || task.unresolved_p0_p1_count !== 0) add(errors, 'REVIEW_UNRESOLVED', `tasks.${String(task.task_id)}`, 'all prerequisite reviews must be complete with zero unresolved P0/P1'); if (!Array.isArray(task.evidence_refs) || task.evidence_refs.length === 0) add(errors, 'EVIDENCE_MISSING', `tasks.${String(task.task_id)}`, 'task evidence refs must be non-empty'); else for (const ref of task.evidence_refs) if (!safeRef(cwd, String(ref))) add(errors, 'EVIDENCE_REF_INVALID', `tasks.${String(task.task_id)}`, 'evidence refs must be relative existing files within repository') } } else add(errors, 'TASK_SET_INVALID', 'tasks', 'tasks must be an array')
  const gitInfo = isRecord(value.git) ? value.git : undefined
  if (!gitInfo || !isNonEmpty(gitInfo.current_head)) add(errors, 'GIT_INFO_INVALID', 'git', 'git revalidation is required')
  else { if (!options.allowDirty && gitInfo.current_worktree_clean !== true) add(errors, 'WORKTREE_DIRTY', 'git.current_worktree_clean', 'sealed package requires a clean runtime tree'); if (gitInfo.p1_baseline_ancestor !== true || gitInfo.p00_authorization_ancestor !== true) add(errors, 'ANCESTOR_INVALID', 'git', 'P00 authorization and P1 baseline must be ancestors') }
  if (!hashPattern.test(String(value.implementation_plan_hash))) add(errors, 'PLAN_HASH_INVALID', 'implementation_plan_hash', 'plan hash must use sha256 framing')
  try {
    const lock = JSON.parse(readFileSync(resolve(cwd, '.p2-local/p00-authorization.json'), 'utf8')) as AuthorizationLock
    const authorizationCommit = git(cwd, ['log', '-1', '--format=%H', '--', '.p2-local/p00-authorization.json'])
    const head = git(cwd, ['rev-parse', 'HEAD'])
    if (value.p00_authorization_commit !== authorizationCommit) add(errors, 'AUTHORIZATION_COMMIT_MISMATCH', 'p00_authorization_commit', 'authorization commit must be the commit that recorded the tracked lock')
    if (value.p00_tooling_commit !== lock.p00_tooling_commit || value.p1_baseline_commit !== lock.p1_baseline_commit || value.p00_preflight_manifest_hash !== lock.preflight_manifest_hash || value.implementation_plan_hash !== implementationPlanHash(cwd)) add(errors, 'P00_BINDING_MISMATCH', '$', 'prerequisite bindings must match the tracked lock and current implementation plan')
    if (!ancestor(cwd, authorizationCommit, head) || !ancestor(cwd, lock.p00_tooling_commit, authorizationCommit) || !ancestor(cwd, lock.p1_baseline_commit, authorizationCommit)) add(errors, 'ANCESTOR_INVALID', 'git', 'authorization commit ancestry is invalid')
    const authorizationPaths = git(cwd, ['diff-tree', '--no-commit-id', '--name-only', '-r', authorizationCommit]).split('\n').filter(Boolean)
    const forbiddenRoots = ['src/pipeline/', 'src/graph/', 'src/review/', 'src/detail/', 'src/publication/', 'src/exporter/', 'src/frontend/', 'src/app/', 'src/collections/', 'src/payload.config.ts']
    const forbidden = authorizationPaths.filter((path) => forbiddenRoots.some((root) => path === root.slice(0, -1) || path.startsWith(root))).sort()
    if (JSON.stringify(value.git && isRecord(value.git) ? value.git.forbidden_at_authorization : undefined) !== JSON.stringify(forbidden)) add(errors, 'AUTHORIZATION_TREE_MISMATCH', 'git.forbidden_at_authorization', 'forbidden authorization-tree file list is not recomputed from Git')
    for (const task of Array.isArray(value.tasks) ? value.tasks : []) if (isRecord(task) && Array.isArray(task.interfaces)) for (const entry of task.interfaces) if (isRecord(entry)) {
      const modulePath = String(entry.module_path); const symbol = String(entry.symbol)
      if (!safeRef(cwd, modulePath)) add(errors, 'INTERFACE_PATH_INVALID', `tasks.${String(task.task_id)}.interfaces`, 'interface must resolve to a repository regular file')
      else { const bytes = readFileSync(resolve(cwd, modulePath), 'utf8'); if (entry.contract_hash !== hashBytes(bytes, 'bytes-v1')) add(errors, 'INTERFACE_HASH_MISMATCH', `tasks.${String(task.task_id)}.interfaces`, 'interface contract hash does not match current file'); if (!moduleExportsSymbol(cwd, modulePath, symbol)) add(errors, 'INTERFACE_SYMBOL_MISSING', `tasks.${String(task.task_id)}.interfaces`, `interface symbol ${symbol} is not exported`) }
    }
  } catch { add(errors, 'P00_REVALIDATION_FAILED', '$', 'tracked P00 lock/Git revalidation failed closed') }
  return { ok: errors.length === 0, errors }
}

export const validateApplicability = (value: unknown): ValidationResult => {
  const errors: ValidationIssue[] = []; if (!Array.isArray(value)) return { ok: false, errors: [{ code: 'APPLICABILITY_INVALID', path: '$', message: 'applicability must be an array' }] }
  const expected = new Map(D12_APPLICABILITY.map((entry) => [entry.row_id, entry])); const seen = new Set<string>()
  for (const [index, entry] of value.entries()) { if (!isRecord(entry) || !isNonEmpty(entry.row_id)) { add(errors, 'ROW_INVALID', `applicability[${index}]`, 'canonical row must be an object with row_id'); continue } const id = String(entry.row_id); if (seen.has(id)) add(errors, 'ROW_DUPLICATE', `applicability[${index}]`, 'duplicate canonical row'); seen.add(id); const canonical = expected.get(id); if (!canonical) { add(errors, 'ROW_UNKNOWN', `applicability[${index}]`, 'unknown D12 row'); continue } for (const key of ['source_requirement_ids', 'severity', 'applicability', 'required_status', 'successor_gate'] as const) if (entry[key] !== canonical[key]) add(errors, 'ROW_MUTATED', `applicability[${index}].${key}`, 'canonical field differs from 0009 §4.6') }
  for (const id of expected.keys()) if (!seen.has(id)) add(errors, 'ROW_MISSING', 'applicability', `canonical row ${id} is missing`)
  if (seen.size !== expected.size) add(errors, 'ROW_SET_INVALID', 'applicability', 'exactly 21 canonical rows are required')
  return { ok: errors.length === 0, errors }
}

export const validateRequirements = (value: unknown, options: { cwd?: string } = {}): ValidationResult => {
  const errors: ValidationIssue[] = []; const cwd = resolve(options.cwd ?? process.cwd()); if (!Array.isArray(value)) return { ok: false, errors: [{ code: 'REQUIREMENTS_INVALID', path: '$', message: 'requirements must be an array' }] }
  const expected = new Map(D12_APPLICABILITY.map((entry) => [entry.row_id, entry])); const seen = new Set<string>()
  for (const [index, item] of value.entries()) { if (!isRecord(item)) { add(errors, 'REQUIREMENT_INVALID', `requirements[${index}]`, 'requirement must be an object'); continue } const id = String(item.id ?? ''); const canonical = expected.get(id); if (!canonical) { add(errors, 'REQUIREMENT_UNKNOWN', `requirements[${index}].id`, 'requirement id is not canonical'); continue } if (seen.has(id)) add(errors, 'REQUIREMENT_DUPLICATE', `requirements[${index}].id`, 'duplicate requirement'); seen.add(id); for (const key of ['source_requirement_ids', 'severity', 'applicability', 'successor_gate'] as const) if (item[key] !== canonical[key]) add(errors, 'REQUIREMENT_CANONICAL_MISMATCH', `requirements[${index}].${key}`, 'requirement canonical field differs from applicability inventory'); if (item.status !== canonical.required_status) add(errors, 'STATUS_INVALID', `requirements[${index}].status`, 'status does not match applicability'); if (item.environment !== 'local') add(errors, 'NON_LOCAL_EVIDENCE', `requirements[${index}].environment`, 'every P2-L requirement must use environment=local'); if (!['unit', 'integration', 'e2e', 'inspection', 'load', 'security', 'cohort'].includes(String(item.method))) add(errors, 'METHOD_INVALID', `requirements[${index}].method`, 'method is invalid'); if (!Array.isArray(item.evidence_refs) || (canonical.applicability === 'required-local' && item.evidence_refs.length === 0)) add(errors, 'EVIDENCE_MISSING', `requirements[${index}].evidence_refs`, 'required-local rows need non-empty evidence'); else for (const ref of item.evidence_refs) if (!safeRef(cwd, String(ref))) add(errors, 'EVIDENCE_REF_INVALID', `requirements[${index}].evidence_refs`, 'evidence ref must be relative and resolve to a regular repository file'); if (!isNonEmpty(item.observed) || !isNonEmpty(item.expected) || !isNonEmpty(item.owner) || !isoPattern.test(String(item.executed_at))) add(errors, 'REQUIREMENT_DETAIL_INVALID', `requirements[${index}]`, 'observed, expected, owner and UTC executed_at are required') }
  for (const id of expected.keys()) if (!seen.has(id)) add(errors, 'REQUIREMENT_MISSING', 'requirements', `canonical requirement ${id} is missing`)
  return { ok: errors.length === 0, errors }
}

export const validateAcceptancePackage = (input: unknown, options: { cwd?: string; allowDirty?: boolean } = {}): ValidationResult => {
  const errors: ValidationIssue[] = []; const cwd = resolve(options.cwd ?? process.cwd()); if (!isRecord(input)) return { ok: false, errors: [{ code: 'PACKAGE_INVALID', path: '$', message: 'acceptance package must be an object' }] }
  const run = isRecord(input.run) ? input.run : undefined; if (!run) add(errors, 'RUN_INVALID', 'run', 'run metadata is required'); else { if (run.schema_version !== P2_LOCAL_EVIDENCE_SCHEMA || run.profile !== 'p2-local' || run.environment !== 'local' || run.production_gate !== 'NO-GO') add(errors, 'PROFILE_SCOPE_INVALID', 'run', 'P2-L run must be local and production-gated NO-GO'); if (run.profile_verdict !== P2_LOCAL_VERDICT) add(errors, 'VERDICT_INVALID', 'run.profile_verdict', 'exact D12 local verdict is required'); if (!commitPattern.test(String(run.git_commit))) add(errors, 'COMMIT_INVALID', 'run.git_commit', 'run commit must be a hexadecimal Git commit'); for (const key of ['p1_baseline_commit', 'p00_authorization_commit', 'p00_preflight_manifest_hash', 'implementation_plan_hash']) if (!isNonEmpty(run[key])) add(errors, 'RUN_BINDING_MISSING', `run.${key}`, 'run binding is required') }
  errors.push(...validateApplicability(input.applicability).errors); errors.push(...validateRequirements(input.requirements, { cwd }).errors); errors.push(...validatePrerequisites(input.prerequisites, { cwd, allowDirty: options.allowDirty }).errors)
  const counters = validateScopeCounters(input.scope_counters); if (!counters.ok) errors.push(...counters.errors)
  if (!isRecord(input.environment) || input.environment.environment !== 'local') add(errors, 'ENVIRONMENT_INVALID', 'environment', 'environment.json must declare local')
  if (!isRecord(input.fixtures_manifest) || !Array.isArray(input.fixtures_manifest.evidence_refs) || input.fixtures_manifest.evidence_refs.length === 0) add(errors, 'FIXTURES_EVIDENCE_MISSING', 'fixtures_manifest', 'fixtures manifest must reference frozen local fixtures')
  for (const name of ['unit.xml', 'integration.xml', 'e2e.xml', 'accessibility.json', 'performance.json', 'seo.json', 'security.json', 'license.json', 'reviews.json']) if (!isRecord(input.reports) || !isNonEmpty(input.reports[name])) add(errors, 'REPORT_MISSING', `reports.${name}`, 'retained report must be non-empty')
  for (const name of ['lifecycle.json', 'hashes.json', 'withdrawal.json', 'logical-contexts.json']) if (!isRecord(input.publish) || !isNonEmpty(input.publish[name])) add(errors, 'PUBLISH_REPORT_MISSING', `publish.${name}`, 'publication report must be non-empty')
  return { ok: errors.length === 0, errors }
}

export const hashAcceptancePayload = (value: unknown): string => hashBytes(JSON.stringify(value), 'p2l-v1')
export const hashFileBytes = (value: string | Buffer): string => hashBytes(value)

export const revalidateP00 = (cwdInput = process.cwd(), allowDirty = false): { prerequisites: Prerequisites; errors: ValidationIssue[] } => {
  const cwd = resolve(cwdInput); const errors: ValidationIssue[] = []; const lockPath = resolve(cwd, '.p2-local/p00-authorization.json')
  if (!existsSync(lockPath)) return { prerequisites: {} as Prerequisites, errors: [{ code: 'P00_LOCK_MISSING', path: lockPath, message: 'tracked P00 authorization lock is required' }] }
  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as AuthorizationLock; const planHash = String(lock.implementation_plan_hash); const outputRoot = resolve(cwd, 'output/p2-local-preflight', lock.p1_baseline_commit, planHash); const preflightPath = resolve(outputRoot, 'preflight.json'); const attestationPath = resolve(outputRoot, 'p00-attestation.json'); const manifestPath = resolve(outputRoot, 'manifest.json')
  if (![preflightPath, attestationPath, manifestPath].every((path) => existsSync(path))) return { prerequisites: {} as Prerequisites, errors: [{ code: 'P00_SEALED_OUTPUT_MISSING', path: outputRoot, message: 'sealed P00 preflight output is required' }] }
  const preflight = JSON.parse(readFileSync(preflightPath, 'utf8')) as P00Preflight; const attestation = JSON.parse(readFileSync(attestationPath, 'utf8')) as P00Attestation; const manifestBody = readFileSync(manifestPath); JSON.parse(manifestBody.toString('utf8')) as P00Manifest; const preflightBody = readFileSync(preflightPath)
  errors.push(...validatePreflight(preflight, cwd).errors); const manifestBytesHash = hashBytes(manifestBody, 'bytes-v1'); errors.push(...validateAuthorizationLock(lock, manifestBytesHash).errors)
  errors.push(...validateAttestation(attestation, preflight, `${preflightBody}`).errors)
  const head = git(cwd, ['rev-parse', 'HEAD']); const authorizationCommit = git(cwd, ['log', '-1', '--format=%H', '--', '.p2-local/p00-authorization.json']); const p1Ancestor = ancestor(cwd, lock.p1_baseline_commit, head); const p00Ancestor = ancestor(cwd, authorizationCommit, head); const status = git(cwd, ['status', '--porcelain', '--untracked-files=all']); const clean = status === ''
  if (!p1Ancestor || !p00Ancestor) errors.push({ code: 'ANCESTOR_INVALID', path: 'git', message: 'current HEAD must descend from P1 baseline and P00 authorization' }); if (!allowDirty && !clean) errors.push({ code: 'WORKTREE_DIRTY', path: 'git', message: 'sealed package requires a clean runtime worktree' })
  const tasks = preflight.tasks.map((task) => ({ task_id: task.task_id, evidence_refs: [...task.evidence_refs].sort(), review_disposition: task.review_disposition, unresolved_p0_p1_count: task.unresolved_p0_p1_count, interfaces: task.interfaces.map((entry) => ({ module_path: entry.module_path, symbol: entry.symbol, contract_hash: entry.contract_hash })) }))
  const authorizationPaths = git(cwd, ['diff-tree', '--no-commit-id', '--name-only', '-r', authorizationCommit]).split('\n').filter(Boolean); const forbiddenRoots = ['src/pipeline/', 'src/graph/', 'src/review/', 'src/detail/', 'src/publication/', 'src/exporter/', 'src/frontend/', 'src/app/', 'src/collections/', 'src/payload.config.ts']; const forbiddenAtAuthorization = authorizationPaths.filter((path) => forbiddenRoots.some((root) => path === root.slice(0, -1) || path.startsWith(root))).sort()
  return { prerequisites: { schema_version: 'p2l-prerequisites-v1', authorized: errors.length === 0 || (allowDirty && errors.every((error) => error.code === 'WORKTREE_DIRTY')), revalidated_at: new Date().toISOString(), p1_baseline_commit: lock.p1_baseline_commit, p00_tooling_commit: lock.p00_tooling_commit, p00_authorization_commit: authorizationCommit, p00_preflight_manifest_hash: lock.preflight_manifest_hash, implementation_plan_hash: lock.implementation_plan_hash, p1v_actual_status: preflight.p1v_actual_status, p00_attestation: attestation, git: { current_head: head, p1_baseline_ancestor: p1Ancestor, p00_authorization_ancestor: p00Ancestor, current_worktree_clean: clean, forbidden_at_authorization: forbiddenAtAuthorization }, tasks }, errors }
}
