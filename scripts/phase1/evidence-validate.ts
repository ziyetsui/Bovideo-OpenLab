import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export const PHASE1_LOCAL_VERDICT = 'Phase 1 LOCAL-DEV COMPLETE — production Phase 0 remains NO-GO' as const
export const PHASE1_EVIDENCE_SCHEMA = 'p1l-acceptance-v1' as const

export type EvidenceApplicability = 'required-local' | 'required-remote' | 'deferred-to-P0' | 'not-applicable-yet' | 'production'
export type EvidenceStatus = 'PASS' | 'FAIL' | 'NOT_RUN' | 'NOT_APPLICABLE'
export type EvidenceMethod = 'unit' | 'integration' | 'e2e' | 'inspection' | 'load' | 'security' | 'cohort'
export type P1VStatus = 'PASS' | 'FAIL' | 'NOT_RUN_REQUIRED_REMOTE'

export interface EvidenceRequirement {
  id: string
  severity: 'P0' | 'P1' | 'P2' | 'P3'
  applicability: EvidenceApplicability
  status: EvidenceStatus
  environment: 'local' | 'preview' | 'production'
  method: EvidenceMethod
  evidence_refs: string[]
  successor_gate: string | null
  observed: string
  expected: string
  owner: string
  executed_at: string
}

export interface EvidenceInterface {
  module_path: string
  symbol: string
  contract_hash: string
}

export interface TaskEvidence {
  task_id: string
  status: 'PASS' | 'FAIL' | 'NOT_RUN'
  evidence_refs: string[]
  commit: string
  fixture_hash: string
  command_hash: string
  commands: string[]
  review_disposition: 'complete' | 'incomplete'
  unresolved_p0_p1_count: number
  interfaces: EvidenceInterface[]
  remote_mutations: number
  undeclared_network_calls: number
}

export interface Phase1AcceptanceManifest {
  schema_version: typeof PHASE1_EVIDENCE_SCHEMA
  run: {
    run_id: string
    git_commit: string
    schema_version: typeof PHASE1_EVIDENCE_SCHEMA
    started_at: string
    ended_at: string
    environment: 'local'
    executor: string
    profile: 'p1-local'
    profile_verdict: typeof PHASE1_LOCAL_VERDICT | 'PASS' | 'CONDITIONAL PASS' | 'FAIL' | 'NOT RUN'
    aggregate_status: 'WIP' | 'COMPLETE' | 'FAIL'
    p1v_status: P1VStatus
    production_gate: 'NO-GO'
    remote_mutations: number
    stable_payload_hash: string
  }
  tasks: TaskEvidence[]
  requirements: EvidenceRequirement[]
}

export interface EvidenceValidationIssue {
  code: string
  path: string
  message: string
}

export interface EvidenceValidationResult {
  ok: boolean
  errors: EvidenceValidationIssue[]
  warnings: EvidenceValidationIssue[]
  aggregate_status: 'WIP' | 'COMPLETE' | 'FAIL'
}

export const REQUIRED_LOCAL_TASKS = Object.freeze([
  'P1-T01', 'P1-T02', 'P1-T03', 'P1-T04', 'P1-T05', 'P1-T06', 'P1-T07', 'P1-T08', 'P1-T09',
])

export interface CanonicalPhase1Requirement {
  id: string
  applicability: EvidenceApplicability
}

const requiredLocalIDs = [
  ...['001', '002', '003'].map((suffix) => `AC-P1L-CON-${suffix}`),
  ...['001', '002', '003', '004', '005', '006', '007', '008', '010'].map((suffix) => `AC-CMS-${suffix}`),
  'AC-SEC-002', 'AC-SEC-003', 'AC-P1L-MIG-001', 'AC-P1L-MIG-002', 'AC-CF-003', 'AC-CF-004', 'AC-PUB-009',
  'AC-CF-001', 'AC-CF-002', 'AC-SEC-005', 'AC-PUB-004', 'AC-PUB-005', 'AC-CF-005', 'AC-SEC-007', 'AC-OPS-002',
  ...Array.from({ length: 9 }, (_, index) => `AC-ING-${String(index + 1).padStart(3, '0')}`),
  ...Array.from({ length: 11 }, (_, index) => `AC-L10N-${String(index + 1).padStart(3, '0')}`),
  'AC-OPS-001', 'AC-OPS-003', 'AC-SEC-001', 'AC-CF-006', 'AC-P1L-T09-001',
]

export const CANONICAL_PHASE1_REQUIREMENTS: readonly CanonicalPhase1Requirement[] = Object.freeze([
  ...requiredLocalIDs.map((id) => ({ id, applicability: 'required-local' as const })),
  { id: 'AC-CMS-009', applicability: 'required-remote' as const },
  ...['001', '002', '003', '004', '005'].map((suffix) => ({ id: `AC-P1V-PG-${suffix}`, applicability: 'required-remote' as const })),
  { id: 'AC-P0-001', applicability: 'deferred-to-P0' as const },
  { id: 'AC-OPS-004', applicability: 'deferred-to-P0' as const },
  { id: 'AC-P2L-T01', applicability: 'not-applicable-yet' as const },
])

const commitPattern = /^[0-9a-f]{7,64}$/i
const shaPattern = /^sha256(?::[A-Za-z0-9._-]+)?:[0-9a-f]{64}$/i
const hashPlaceholderPattern = /^NOT_(?:APPLICABLE|CAPTURED)(?:_[A-Z0-9_-]+)*$/
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

const validRef = (value: unknown): value is string => {
  if (!isNonEmptyString(value) || value.includes('\\') || value.startsWith('/') || value.startsWith('http:') || value.startsWith('https:')) return false
  return !value.split('/').some((segment) => segment === '..' || segment === '')
}

const validHash = (value: unknown): value is string => typeof value === 'string' && (shaPattern.test(value) || hashPlaceholderPattern.test(value))

const add = (errors: EvidenceValidationIssue[], code: string, path: string, message: string): void => {
  errors.push({ code, path, message })
}

const validateRefs = (refs: unknown, path: string, errors: EvidenceValidationIssue[], cwd: string): void => {
  if (!Array.isArray(refs) || refs.length === 0) {
    add(errors, 'REQUIRED_LOCAL_EVIDENCE_MISSING', path, 'machine evidence refs must be a non-empty array')
    return
  }
  refs.forEach((ref, index) => {
    if (!validRef(ref)) add(errors, 'EVIDENCE_REF_NOT_RELATIVE', `${path}[${index}]`, 'evidence refs must be relative repository paths')
    else {
      const resolved = repoPath(cwd, ref)
      if (!resolved) add(errors, 'EVIDENCE_REF_OUTSIDE_REPOSITORY', `${path}[${index}]`, 'evidence ref realpath must remain within the repository')
      else if (!existsSync(resolved.absolute) || !statSync(resolved.real).isFile()) add(errors, 'EVIDENCE_REF_MISSING', `${path}[${index}]`, 'evidence ref must resolve to an existing file within the repository')
    }
  })
}

const validateTask = (task: unknown, index: number, errors: EvidenceValidationIssue[], cwd: string): void => {
  const path = `tasks[${index}]`
  if (!isRecord(task)) {
    add(errors, 'TASK_INVALID', path, 'task evidence must be an object')
    return
  }
  validateRefs(task.evidence_refs, `${path}.evidence_refs`, errors, cwd)
  if (!isNonEmptyString(task.task_id)) add(errors, 'TASK_ID_MISSING', `${path}.task_id`, 'task id is required')
  if (task.status !== 'PASS') add(errors, 'REQUIRED_LOCAL_TASK_STATUS_INVALID', `${path}.status`, 'required-local task evidence must be PASS')
  if (typeof task.commit !== 'string' || !commitPattern.test(task.commit)) add(errors, 'COMMIT_INVALID', `${path}.commit`, 'task commit must be a short or full hexadecimal Git SHA')
  if (!validHash(task.fixture_hash)) add(errors, 'FIXTURE_HASH_INVALID', `${path}.fixture_hash`, 'fixture_hash must use sha256 framing or an explicit NOT_* placeholder')
  if (!validHash(task.command_hash)) add(errors, 'COMMAND_HASH_INVALID', `${path}.command_hash`, 'command_hash must use sha256 framing or an explicit NOT_* placeholder')
  if (!Array.isArray(task.commands) || task.commands.length === 0 || task.commands.some((command) => !isNonEmptyString(command))) add(errors, 'COMMANDS_INVALID', `${path}.commands`, 'machine evidence must include one or more commands')
  if (task.review_disposition !== 'complete') add(errors, 'REVIEW_INCOMPLETE', `${path}.review_disposition`, 'required-local task evidence must be independently reviewed')
  if (typeof task.unresolved_p0_p1_count !== 'number' || !Number.isInteger(task.unresolved_p0_p1_count) || task.unresolved_p0_p1_count !== 0) add(errors, 'UNRESOLVED_FINDINGS', `${path}.unresolved_p0_p1_count`, 'required-local evidence may not contain unresolved P0/P1 findings')
  if (task.remote_mutations !== 0) add(errors, 'REMOTE_SIDE_EFFECT_DECLARED', `${path}.remote_mutations`, 'required-local evidence must declare zero remote mutations')
  if (task.undeclared_network_calls !== 0) add(errors, 'NETWORK_SIDE_EFFECT_DECLARED', `${path}.undeclared_network_calls`, 'required-local evidence must declare zero undeclared network calls')
  if (!Array.isArray(task.interfaces)) add(errors, 'INTERFACES_INVALID', `${path}.interfaces`, 'interfaces must be an array')
  else task.interfaces.forEach((entry, interfaceIndex) => {
    if (!isRecord(entry) || !isNonEmptyString(entry.module_path) || !isNonEmptyString(entry.symbol) || !validHash(entry.contract_hash)) add(errors, 'INTERFACE_INVALID', `${path}.interfaces[${interfaceIndex}]`, 'interface entries require module_path, symbol, and a framed contract_hash')
  })
}

const validateRequirement = (row: unknown, index: number, p1vStatus: P1VStatus, errors: EvidenceValidationIssue[], cwd: string): void => {
  const path = `requirements[${index}]`
  if (!isRecord(row)) {
    add(errors, 'REQUIREMENT_INVALID', path, 'requirement must be an object')
    return
  }
  const applicability = row.applicability
  const status = row.status
  if (!isNonEmptyString(row.id)) add(errors, 'REQUIREMENT_ID_MISSING', `${path}.id`, 'requirement id is required')
  if (!['P0', 'P1', 'P2', 'P3'].includes(String(row.severity))) add(errors, 'SEVERITY_INVALID', `${path}.severity`, 'severity must be P0 through P3')
  if (!['required-local', 'required-remote', 'deferred-to-P0', 'not-applicable-yet', 'production'].includes(String(applicability))) add(errors, 'APPLICABILITY_INVALID', `${path}.applicability`, 'unknown applicability')
  if (!['PASS', 'FAIL', 'NOT_RUN', 'NOT_APPLICABLE'].includes(String(status))) add(errors, 'STATUS_INVALID', `${path}.status`, 'unknown evidence status')
  if (row.environment !== 'local') add(errors, 'NON_LOCAL_EVIDENCE', `${path}.environment`, 'Phase 1 local evidence must use environment=local')
  if (!isNonEmptyString(row.executed_at) || !isoPattern.test(row.executed_at)) add(errors, 'TIMESTAMP_INVALID', `${path}.executed_at`, 'executed_at must be an RFC3339 UTC timestamp')
  if (!isNonEmptyString(row.observed) || !isNonEmptyString(row.expected) || !isNonEmptyString(row.owner)) add(errors, 'REQUIREMENT_DETAIL_MISSING', path, 'observed, expected and owner are required')
  if (applicability === 'required-local') validateRefs(row.evidence_refs, `${path}.evidence_refs`, errors, cwd)
  if (applicability === 'required-local' && status !== 'PASS') add(errors, 'REQUIRED_LOCAL_STATUS_INVALID', `${path}.status`, 'required-local evidence must be PASS')
  else if (applicability === 'required-remote' && p1vStatus === 'NOT_RUN_REQUIRED_REMOTE' && status === 'PASS') add(errors, 'P1V_NOT_RUN_CLAIMED_PASS', `${path}.status`, 'P1-V rows cannot PASS while P1-V is NOT_RUN')
  else if (applicability === 'deferred-to-P0') {
    if (status !== 'NOT_RUN') add(errors, 'DEFERRED_STATUS_INVALID', `${path}.status`, 'deferred-to-P0 rows must remain NOT_RUN')
    if (!isNonEmptyString(row.successor_gate)) add(errors, 'SUCCESSOR_GATE_MISSING', `${path}.successor_gate`, 'deferred rows require a successor gate')
  } else if (applicability === 'not-applicable-yet') {
    if (status !== 'NOT_APPLICABLE') add(errors, 'NOT_APPLICABLE_STATUS_INVALID', `${path}.status`, 'not-applicable-yet rows must remain NOT_APPLICABLE')
    if (!isNonEmptyString(row.successor_gate)) add(errors, 'SUCCESSOR_GATE_MISSING', `${path}.successor_gate`, 'not-applicable rows require a successor gate')
  } else if (applicability === 'production') {
    if (status !== 'NOT_RUN') add(errors, 'PRODUCTION_STATUS_INVALID', `${path}.status`, 'production rows cannot be claimed from a local profile')
    if (!isNonEmptyString(row.successor_gate)) add(errors, 'SUCCESSOR_GATE_MISSING', `${path}.successor_gate`, 'production rows require a successor gate')
  }
  if (['security', 'load'].includes(String(row.method)) && Array.isArray(row.evidence_refs) && row.evidence_refs.length > 0 && row.evidence_refs.every((ref) => typeof ref === 'string' && /\.(?:png|jpe?g|webp|gif)$/i.test(ref))) add(errors, 'SCREENSHOT_ONLY_PROOF', `${path}.evidence_refs`, 'screenshots cannot be the sole proof for security or load requirements')
  if (Array.isArray(row.evidence_refs)) row.evidence_refs.forEach((ref, refIndex) => {
    if (!validRef(ref)) add(errors, 'EVIDENCE_REF_NOT_RELATIVE', `${path}.evidence_refs[${refIndex}]`, 'evidence refs must be relative repository paths')
    else {
      const resolved = repoPath(cwd, ref)
      if (!resolved) add(errors, 'EVIDENCE_REF_OUTSIDE_REPOSITORY', `${path}.evidence_refs[${refIndex}]`, 'evidence ref realpath must remain within the repository')
      else if (!existsSync(resolved.absolute) || !statSync(resolved.real).isFile()) add(errors, 'EVIDENCE_REF_MISSING', `${path}.evidence_refs[${refIndex}]`, 'evidence ref must resolve to an existing file within the repository')
    }
  })
}

export interface EvidenceValidationOptions {
  cwd?: string
  /** Require the selected commit to be the current HEAD unless explicitly overridden. */
  allowHistoricalCommit?: boolean
}

const gitOutputCache = new Map<string, string | undefined>()

const gitOutput = (cwd: string, args: string[]): string | undefined => {
  const cacheKey = `${cwd}\0${args.join('\0')}`
  const cached = gitOutputCache.get(cacheKey)
  if (cached !== undefined || gitOutputCache.has(cacheKey)) return cached
  try {
    const output = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    gitOutputCache.set(cacheKey, output)
    return output
  } catch {
    gitOutputCache.set(cacheKey, undefined)
    return undefined
  }
}

const resolvedCommit = (cwd: string, commit: string): string | undefined => {
  if (!commitPattern.test(commit)) return undefined
  return gitOutput(cwd, ['rev-parse', '--verify', `${commit}^{commit}`])
}

const isWithin = (root: string, candidate: string): boolean => {
  const relativePath = relative(root, candidate)
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
}

const repoPath = (cwd: string, ref: string): { absolute: string; real: string; root: string } | undefined => {
  try {
    const root = realpathSync(cwd)
    const absolute = resolve(root, ref)
    if (!isWithin(root, absolute)) return undefined
    const real = realpathSync(absolute)
    if (!isWithin(root, real)) return undefined
    return { absolute, real, root }
  } catch {
    return undefined
  }
}

export const validateEvidenceManifest = (input: unknown, options: EvidenceValidationOptions = {}): EvidenceValidationResult => {
  const errors: EvidenceValidationIssue[] = []
  const warnings: EvidenceValidationIssue[] = []
  const cwd = resolve(options.cwd ?? process.cwd())
  const currentHead = gitOutput(cwd, ['rev-parse', 'HEAD'])
  if (!isRecord(input)) return { ok: false, errors: [{ code: 'MANIFEST_INVALID', path: '$', message: 'manifest must be an object' }], warnings, aggregate_status: 'FAIL' }
  const run = input.run
  if (!isRecord(run)) return { ok: false, errors: [{ code: 'RUN_INVALID', path: 'run', message: 'run metadata is required' }], warnings, aggregate_status: 'FAIL' }
  if (input.schema_version !== PHASE1_EVIDENCE_SCHEMA || run.schema_version !== PHASE1_EVIDENCE_SCHEMA) add(errors, 'SCHEMA_VERSION_INVALID', 'schema_version', 'unsupported evidence schema')
  if (run.profile !== 'p1-local' || run.environment !== 'local' || run.production_gate !== 'NO-GO') add(errors, 'PROFILE_SCOPE_INVALID', 'run', 'P1 acceptance is local-only and production-gated NO-GO')
  if (!isNonEmptyString(run.run_id) || !isNonEmptyString(run.git_commit)) add(errors, 'RUN_ID_OR_COMMIT_MISSING', 'run', 'run_id and git_commit are required')
  if (typeof run.git_commit !== 'string' || !commitPattern.test(run.git_commit)) add(errors, 'COMMIT_INVALID', 'run.git_commit', 'run git_commit must be a hexadecimal Git SHA')
  const runResolvedCommit = typeof run.git_commit === 'string' ? resolvedCommit(cwd, run.git_commit) : undefined
  if (typeof run.git_commit === 'string' && commitPattern.test(run.git_commit) && !runResolvedCommit) add(errors, 'COMMIT_UNVERIFIABLE', 'run.git_commit', 'run git_commit must resolve to a commit in the repository')
  if (runResolvedCommit && currentHead && !options.allowHistoricalCommit && runResolvedCommit !== currentHead) add(errors, 'COMMIT_NOT_CURRENT_HEAD', 'run.git_commit', 'run git_commit must resolve to the repository HEAD unless an explicit historical commit is allowed')
  if (!isNonEmptyString(run.started_at) || !isoPattern.test(run.started_at) || !isNonEmptyString(run.ended_at) || !isoPattern.test(run.ended_at)) add(errors, 'TIMESTAMP_INVALID', 'run', 'run timestamps must be RFC3339 UTC values')
  if (!['PASS', 'FAIL', 'NOT_RUN_REQUIRED_REMOTE'].includes(String(run.p1v_status))) add(errors, 'P1V_STATUS_INVALID', 'run.p1v_status', 'P1-V status must be explicit')
  if (typeof run.remote_mutations !== 'number' || run.remote_mutations !== 0) add(errors, 'REMOTE_SIDE_EFFECT_DECLARED', 'run.remote_mutations', 'local acceptance cannot claim remote mutations')
  if (!validHash(run.stable_payload_hash)) add(errors, 'STABLE_HASH_INVALID', 'run.stable_payload_hash', 'stable payload hash must use sha256 framing')

  const tasks = input.tasks
  if (!Array.isArray(tasks)) add(errors, 'TASKS_INVALID', 'tasks', 'exactly nine task evidence rows are required')
  else {
    const ids = tasks.map((task) => isRecord(task) ? task.task_id : undefined)
    REQUIRED_LOCAL_TASKS.forEach((taskID) => { if (!ids.includes(taskID)) add(errors, 'TASK_MISSING', 'tasks', `${taskID} evidence row is missing`) })
    if (new Set(ids).size !== ids.length) add(errors, 'TASK_DUPLICATE', 'tasks', 'task evidence rows must have unique task ids')
    tasks.forEach((task, index) => {
      validateTask(task, index, errors, cwd)
      if (isRecord(task) && runResolvedCommit && typeof task.commit === 'string' && commitPattern.test(task.commit)) {
        const taskResolvedCommit = resolvedCommit(cwd, task.commit)
        if (!taskResolvedCommit) add(errors, 'COMMIT_UNVERIFIABLE', `tasks[${index}].commit`, 'task commit must resolve to a commit in the repository')
        else if (taskResolvedCommit !== runResolvedCommit) add(errors, 'TASK_COMMIT_MISMATCH', `tasks[${index}].commit`, 'task commit must resolve to the run commit')
      }
    })
  }
  const requirements = input.requirements
  if (!Array.isArray(requirements) || requirements.length === 0) add(errors, 'REQUIREMENTS_INVALID', 'requirements', 'requirement rows are required')
  else {
    const ids = requirements.map((row) => isRecord(row) ? row.id : undefined)
    if (new Set(ids).size !== ids.length) add(errors, 'REQUIREMENT_DUPLICATE', 'requirements', 'requirement ids must be unique')
    requirements.forEach((row, index) => validateRequirement(row, index, run.p1v_status as P1VStatus, errors, cwd))
    const expected = new Map(CANONICAL_PHASE1_REQUIREMENTS.map((row) => [row.id, row.applicability]))
    const actual = new Map(requirements.filter(isRecord).map((row) => [row.id, row.applicability]))
    expected.forEach((applicability, id) => {
      if (!actual.has(id)) add(errors, 'REQUIREMENT_CANONICAL_MISSING', 'requirements', `${id} canonical row is missing`)
      else if (actual.get(id) !== applicability) add(errors, 'REQUIREMENT_APPLICABILITY_INVALID', `requirements[${id}]`, `${id} must use applicability=${applicability}`)
    })
    actual.forEach((_, id) => { if (typeof id === 'string' && !expected.has(id)) add(errors, 'REQUIREMENT_CANONICAL_UNKNOWN', `requirements[${id}]`, `${id} is not a canonical Phase 1 row`) })
  }
  if (Array.isArray(tasks) && Array.isArray(requirements) && validHash(run.stable_payload_hash)) {
    const expectedStableHash = hashAcceptancePayload({ tasks, requirements })
    if (run.stable_payload_hash !== expectedStableHash) add(errors, 'STABLE_HASH_MISMATCH', 'run.stable_payload_hash', 'stable payload hash does not match tasks and requirements')
  }
  const remoteRequirements = Array.isArray(requirements)
    ? requirements.filter((row): row is Record<string, unknown> => isRecord(row) && row.applicability === 'required-remote')
    : []
  const remoteStatuses = remoteRequirements.map((row) => row.status)
  if (run.p1v_status === 'NOT_RUN_REQUIRED_REMOTE') {
    if (remoteStatuses.some((status) => status !== 'NOT_RUN')) add(errors, 'P1V_STATUS_MISMATCH', 'run.p1v_status', 'P1-V NOT_RUN requires every required-remote row to remain NOT_RUN')
    if (run.profile_verdict === 'PASS') add(errors, 'P1V_NOT_RUN_AGGREGATE_PASS', 'run.profile_verdict', 'generic PASS cannot be emitted while P1-V is NOT_RUN')
    if (run.aggregate_status !== 'WIP') add(errors, 'AGGREGATE_STATUS_INVALID', 'run.aggregate_status', 'aggregate_status must be WIP while P1-V is NOT_RUN')
    if (run.profile_verdict !== PHASE1_LOCAL_VERDICT && run.profile_verdict !== 'FAIL') add(errors, 'PROFILE_VERDICT_INVALID', 'run.profile_verdict', 'local handoff must use the exact local verdict or FAIL')
  } else if (run.p1v_status === 'PASS') {
    if (remoteStatuses.length === 0 || remoteStatuses.some((status) => status !== 'PASS')) add(errors, 'P1V_STATUS_MISMATCH', 'run.p1v_status', 'P1-V PASS requires every required-remote row to be PASS')
    if (run.aggregate_status !== 'COMPLETE' || run.profile_verdict !== 'PASS') add(errors, 'P1V_STATUS_MISMATCH', 'run', 'P1-V PASS requires aggregate_status=COMPLETE and profile_verdict=PASS')
  } else if (run.p1v_status === 'FAIL') {
    if (remoteStatuses.length === 0 || remoteStatuses.some((status) => status === 'NOT_RUN') || !remoteStatuses.includes('FAIL')) add(errors, 'P1V_STATUS_MISMATCH', 'run.p1v_status', 'P1-V FAIL requires at least one failed remote row and no NOT_RUN rows')
    if (run.aggregate_status !== 'FAIL' || run.profile_verdict !== 'FAIL') add(errors, 'P1V_STATUS_MISMATCH', 'run', 'P1-V FAIL requires aggregate_status=FAIL and profile_verdict=FAIL')
  }
  const aggregate_status = errors.length > 0 ? 'FAIL' : run.aggregate_status === 'COMPLETE' ? 'COMPLETE' : 'WIP'
  return { ok: errors.length === 0, errors, warnings, aggregate_status }
}

export function hashAcceptancePayload(value: unknown): string {
  const canonicalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(canonicalize)
    if (isRecord(entry)) return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, canonicalize(entry[key])]))
    return entry
  }
  const canonical = JSON.stringify(canonicalize(value))
  return `sha256:p1l-v1:${createHash('sha256').update(canonical).digest('hex')}`
}
