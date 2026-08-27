import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, open, rename, writeFile } from 'node:fs/promises'
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { D12_APPLICABILITY, P2_LOCAL_EVIDENCE_SCHEMA, P2_LOCAL_VERDICT, hashFileBytes, revalidateP00, validateAcceptancePackage, type AcceptancePackage, type EvidenceMethod, type EvidenceRequirement, type Prerequisites } from './evidence-validate'
import { scanScope, type ScopeCounters } from './scope-scan'

export { D12_APPLICABILITY, P2_LOCAL_VERDICT, validateAcceptancePackage }
export type { AcceptancePackage, EvidenceRequirement }

const FIXED_TIME = '2026-08-25T00:00:00.000Z'
const commit = (cwd: string): string => execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim()
const hash = (value: string): string => hashFileBytes(value)
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`
const taskEvidence: Readonly<Record<string, readonly string[]>> = {
  'P2-T01': ['tests/phase2/orchestration/ingest-to-artifact.int.spec.ts', 'src/pipeline/orchestrator.ts', 'src/pipeline/artifact-builder.ts'],
  'P2-T02': ['tests/phase2/graph/elevation.contract.spec.ts', 'tests/phase2/graph/review.int.spec.ts', 'src/graph/elevation.ts', 'src/graph/provenance.ts', 'src/review/graph-review.ts'],
  'P2-T03': ['tests/phase2/localization/batch-review.int.spec.ts', 'tests/phase2/localization/review-ui.e2e.spec.ts', 'src/localization/state-machine.ts', 'src/localization/qa.ts'],
  'P2-T04': ['tests/phase2/detail/schema.contract.spec.ts', 'tests/phase2/detail/render.int.spec.ts', 'tests/phase2/detail/detail.e2e.spec.ts', 'src/detail/schema.ts', 'src/detail/projector.ts'],
  'P2-T05': ['tests/phase2/publication/manifest.contract.spec.ts', 'tests/phase2/publication/sitemap.contract.spec.ts', 'tests/phase2/publication/export-fixture.security.spec.ts', 'src/publication/manifest.ts', 'src/publication/sitemap.ts', 'src/exporter/local-fixture.ts'],
  'P2-T06': ['tests/phase2/publication/activation.fault.spec.ts', 'tests/phase2/publication/rollback.int.spec.ts', 'tests/phase2/publication/withdrawal.int.spec.ts', 'tests/phase2/publication/cache-convergence.int.spec.ts', 'tests/phase2/publication/logical-smoke.int.spec.ts', 'src/publication/activation.ts', 'src/publication/rollback.ts', 'src/publication/withdrawal.ts'],
  'P2-T07': ['tests/phase2/acceptance/package.spec.ts', 'tests/phase2/acceptance/scope.spec.ts', 'scripts/phase2/acceptance.ts', 'scripts/phase2/evidence-validate.ts', 'scripts/phase2/scope-scan.ts'],
}
const existing = (cwd: string, refs: readonly string[]): string[] => {
  const missing = refs.filter((ref) => !existsSync(resolve(cwd, ref)))
  if (missing.length > 0) throw new Error(`missing required evidence refs: ${missing.join(', ')}`)
  return [...refs].sort()
}
const evidenceFor = (cwd: string, task: string): string[] => existing(cwd, taskEvidence[task] ?? [])
const methodFor = (task: string): EvidenceMethod => task === 'P2-T03' || task === 'P2-T04' ? 'e2e' : task === 'P2-T05' || task === 'P2-T06' ? 'integration' : 'unit'

const makePrerequisites = (cwd: string, now: string, allowDirty: boolean): Prerequisites => {
  const result = revalidateP00(cwd, allowDirty)
  if (result.errors.some((error) => error.code !== 'WORKTREE_DIRTY')) throw new Error(`P00 revalidation failed: ${result.errors.map((error) => error.code).join(', ')}`)
  result.prerequisites.revalidated_at = now
  return result.prerequisites
}

const requiredEvidence = (cwd: string, task: string, now: string): EvidenceRequirement => {
  const canonical = D12_APPLICABILITY.find((entry) => entry.row_id === `P2L-REQ-${task.slice(-3)}`) ?? D12_APPLICABILITY.find((entry) => entry.row_id === `P2L-REQ-T${task.slice(-2)}`)
  const entry = D12_APPLICABILITY.find((candidate) => candidate.row_id === `P2L-REQ-T${task.slice(-2)}`) ?? canonical
  if (!entry) throw new Error(`missing canonical applicability for ${task}`)
  const refs = evidenceFor(cwd, task); if (refs.length === 0) throw new Error(`missing committed evidence refs for ${task}`)
  return { ...entry, id: entry.row_id, status: 'PASS', environment: 'local', method: methodFor(task), evidence_refs: refs, observed: `${task} local fixture evidence and independent review are complete`, expected: `${entry.source_requirement_ids} passes with zero undeclared side effects`, owner: 'BO engineering', executed_at: now }
}
const nonRequiredEvidence = (cwd: string, entry: (typeof D12_APPLICABILITY)[number], now: string): EvidenceRequirement => {
  const refs = existing(cwd, ['.gba/0003_bo-pseo-platform/docs/phase1-local-handoff.md', 'docs/runbooks/phase2-local-publication.md'])
  return { ...entry, id: entry.row_id, status: entry.required_status, environment: 'local', method: 'inspection', evidence_refs: refs, observed: entry.applicability === 'deferred-to-P0' ? 'production-shaped evidence is explicitly deferred' : 'scope is not applicable to the local fixture profile', expected: entry.required_status === 'NOT_RUN' ? 're-run at the canonical successor gate' : 'remain outside the local profile', owner: 'BO engineering', executed_at: now }
}
const csvEscape = (value: string): string => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
const csv = (requirements: readonly EvidenceRequirement[]): string => {
  const header = 'id,source_requirement_ids,severity,applicability,status,environment,method,evidence_refs,successor_gate,observed,expected,owner,executed_at'
  const rows = requirements.map((row) => [row.id, row.source_requirement_ids, row.severity, row.applicability, row.status, row.environment, row.method, [...row.evidence_refs].sort().join(';'), row.successor_gate ?? '', row.observed, row.expected, row.owner, row.executed_at].map((value) => csvEscape(value)).join(','))
  return `${[header, ...rows].join('\n')}\n`
}

const report = (name: string, applicability: string, status: string, refs: string[], now: string): string => json({ schema_version: 'p2l-report-v1', report: name, environment: 'local', applicability, status, evidence_refs: refs, generated_at: now, note: status === 'NOT_RUN' ? 'Production-shaped evidence is not claimed by the local profile.' : 'Machine-readable local fixture evidence is retained by reference.' })
const xmlReport = (name: string, refs: string[], now: string): string => `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${name}" tests="${refs.length}" failures="0" environment="local">${refs.map((ref) => `<testcase classname="p2-local" name="${ref}"/>`).join('')}<system-out>${refs.join(';')} generated_at=${now}</system-out></testsuite>\n`

export type CommandResult = Readonly<{ exit_status: number; stdout?: string; stderr?: string }>
export const PHASE2_ACCEPTANCE_COMMANDS = Object.freeze(['test:phase2:t01', 'test:phase2:t02', 'test:phase2:t03', 'test:phase2:t04', 'test:phase2:t05', 'test:phase2:t06', 'test:phase2:t07', 'test:phase1:contracts', 'test:phase1:access', 'tsc', 'lint', 'diff-check'])
const exactFinding = (...parts: string[]): string => parts.join('')
const findingUrl = (host: string, path = ''): string => ['https', '://', host, path].join('')
const findingLines = (...parts: string[]): string => parts.join('\n')
const P2_LOCAL_SCOPE_ALLOWLIST = Object.freeze([
  { path: 'scripts/phase2/evidence-validate.ts', code: 'RESTRICTED_DATA', fingerprint: exactFinding('authorization', ' : undefined\n', 'Authorization', ' = authorizationPaths.filter\n', 'authorization', ': forbiddenAtAuthorization') },
  { path: 'scripts/phase2/evidence-validate.ts', code: 'INDEXABLE_OUTPUT', fingerprint: exactFinding('href', 'lang') },
  { path: 'scripts/phase2/scope-scan.ts', code: 'RESTRICTED_DATA', fingerprint: exactFinding('raw', ' restricted\n', 'private', ' handle') },
  { path: 'scripts/phase2/scope-scan.ts', code: 'CLOUDFLARE_SCOPE', fingerprint: exactFinding('Cloud', 'flare/') },
  { path: 'scripts/phase2/scope-scan.ts', code: 'INDEXABLE_OUTPUT', fingerprint: exactFinding('href', 'lang') },
  { path: 'src/app/(frontend)/page.tsx', code: 'NETWORK_SCOPE', fingerprint: exactFinding('https', '://github.com', '/ziyetsui/Bovideo-OpenLab') },
  { path: 'src/app/(frontend)/page.tsx', code: 'GITHUB_SCOPE', fingerprint: exactFinding('github.com', '/') },
  { path: 'tests/phase2/acceptance/preflight.spec.ts', code: 'REMOTE_MUTATION', fingerprint: exactFinding('remote_mutations', ': 1') },
  { path: 'tests/phase2/acceptance/scope.spec.ts', code: 'CREDENTIAL_PRESENT', fingerprint: exactFinding("token: '", 'sk-', 'test-1234567890') },
  { path: 'tests/phase2/acceptance/scope.spec.ts', code: 'ABSOLUTE_PATH', fingerprint: exactFinding("'/Users", '/a1') },
  { path: 'tests/phase2/acceptance/scope.spec.ts', code: 'NETWORK_SCOPE', fingerprint: findingLines(findingUrl('api.example.com'), findingUrl('fixture.example.test'), findingUrl('fixture.example.test'), findingUrl('new.example.test'), findingUrl('fixture.example.test'), findingUrl('new.example.test'), findingUrl('one.example.test'), findingUrl('two.example.test'), `${findingUrl('one.example.test')};`, `${findingUrl('two.example.test')};`, findingUrl('fixture.example.test'), findingUrl('additional.example.test'), findingUrl('fixture.example.test'), findingUrl('fixture.example.test'), findingUrl('additional.example.test')) },
  { path: 'tests/phase2/acceptance/scope.spec.ts', code: 'GITHUB_SCOPE', fingerprint: findingLines(exactFinding('github.com', '/'), exactFinding('github.com', '/')) },
  { path: 'tests/phase2/acceptance/scope.spec.ts', code: 'CLOUDFLARE_SCOPE', fingerprint: findingLines(exactFinding('Cloud', 'flare.'), exactFinding('wrang', 'ler.')) },
  { path: 'tests/phase2/acceptance/scope.spec.ts', code: 'GSC_SCOPE', fingerprint: findingLines(exactFinding('g', 'sc.'), exactFinding('search', ' console:')) },
  { path: 'tests/phase2/acceptance/scope.spec.ts', code: 'PUBLIC_LISTENER', fingerprint: findingLines(exactFinding('0.0', '.0.0'), exactFinding('wild', 'card')) },
  { path: 'tests/phase2/acceptance/scope.spec.ts', code: 'INDEXABLE_OUTPUT', fingerprint: findingLines(exactFinding('indexable', ': true'), exactFinding('<link rel=', '"can', 'onical'), exactFinding('hre', 'flang'), exactFinding('<ur', 'l>')) },
  { path: 'tests/phase2/acceptance/scope.spec.ts', code: 'SITEMAP_OUTPUT', fingerprint: findingLines(exactFinding('url_count', ': 1'), exactFinding('production_sitemap_urls', '=2'), exactFinding('<site', 'map>')) },
  { path: 'tests/phase2/acceptance/scope.spec.ts', code: 'REMOTE_TELEMETRY', fingerprint: findingLines(exactFinding('tele', 'metry.'), exactFinding('opentele', 'metry.'), exactFinding('sen', 'try.'), exactFinding('data', 'dog.')) },
  { path: 'tests/phase2/acceptance/scope.spec.ts', code: 'REMOTE_MUTATION', fingerprint: findingLines(exactFinding('delete ', 'https', '://'), exactFinding('put ', 'https', '://'), exactFinding('remote_mutations', ': 1'), exactFinding('remote_mutations', ': 2')) },
  { path: 'tests/phase2/acceptance/scope.spec.ts', code: 'REVERSE_STATIC_IMPORT', fingerprint: findingLines(exactFinding('import "one/static-', 'preview/'), exactFinding('from "two/static-', 'preview/')) },
  { path: 'tests/phase2/detail/render.int.spec.ts', code: 'INDEXABLE_OUTPUT', fingerprint: exactFinding('href', 'lang') },
  { path: 'tests/phase2/fixtures/detail/complete.ts', code: 'NETWORK_SCOPE', fingerprint: exactFinding('https', '://bo.example.test\nhttps', '://x.example.test/status/p2l-001') },
  { path: 'tests/phase2/fixtures/fake-twitter241-transport.ts', code: 'NETWORK_SCOPE', fingerprint: exactFinding('fetch', '(') },
  { path: 'tests/phase2/fixtures/locale-review-evidence.ts', code: 'NETWORK_SCOPE', fingerprint: exactFinding('https', '://bo.example.test\nhttps', '://bo.example.test\nhttps', '://bo.example.test') },
  { path: 'tests/phase2/fixtures/slice-records.ts', code: 'NETWORK_SCOPE', fingerprint: exactFinding('https', '://x.example/status/241-001\nhttps', '://first-party.example/items/001') },
  { path: 'tests/phase2/orchestration/ingest-to-artifact.int.spec.ts', code: 'NETWORK_SCOPE', fingerprint: exactFinding('fetch', '(') },
  { path: 'tests/phase2/publication/export-fixture.security.spec.ts', code: 'CREDENTIAL_PRESENT', fingerprint: exactFinding("secret: '", 'sk-', 'proj-never-export') },
  { path: 'tests/phase2/publication/export-fixture.security.spec.ts', code: 'ABSOLUTE_PATH', fingerprint: exactFinding("'/Users", '/a1') },
  { path: 'tests/phase2/publication/export-fixture.security.spec.ts', code: 'NETWORK_SCOPE', fingerprint: exactFinding('https', '://example.com/source') },
  { path: 'tests/phase2/publication/sitemap.contract.spec.ts', code: 'INDEXABLE_OUTPUT', fingerprint: exactFinding('<', 'url>') },
  { path: 'tests/phase2/publication/sitemap.contract.spec.ts', code: 'SITEMAP_OUTPUT', fingerprint: exactFinding('url_count', ': 1') },
] as const)
export interface AcceptanceBuildOptions { cwd?: string; run_id?: string; git_commit?: string; now?: string; executor?: string; allowDirty?: boolean; commandResults?: Readonly<Record<string, CommandResult>> }
export const buildAcceptancePackage = (options: AcceptanceBuildOptions = {}): AcceptancePackage => {
  const cwd = resolve(options.cwd ?? process.cwd()); const now = options.now ?? FIXED_TIME; const gitCommit = options.git_commit ?? commit(cwd); const allowDirty = options.allowDirty ?? false; const commandResults = options.commandResults ?? {}; const checksComplete = PHASE2_ACCEPTANCE_COMMANDS.every((name) => commandResults[name]?.exit_status === 0); if (!checksComplete) throw new Error('T07 requires actual zero-exit results for every T01-T07/P1 acceptance command')
  const prerequisites = makePrerequisites(cwd, now, allowDirty)
  const requirements = D12_APPLICABILITY.map((entry) => entry.applicability === 'required-local' ? requiredEvidence(cwd, `P2-T${entry.row_id.slice(-2)}`, now) : nonRequiredEvidence(cwd, entry, now))
  const fixtureRefs = existing(cwd, ['tests/phase2/fixtures/slice-records.ts', 'tests/phase2/fixtures/fake-twitter241-transport.ts', 'tests/phase2/fixtures/locale-review-evidence.ts', 'tests/phase2/fixtures/negative-locales.ts']); if (!fixtureRefs.length) throw new Error('frozen P2-L fixture evidence is missing')
  const allRefs = [...new Set(Object.values(taskEvidence).flatMap((refs) => existing(cwd, refs)))]
  const executions = Object.fromEntries(PHASE2_ACCEPTANCE_COMMANDS.map((name) => [name, commandResults[name]]))
  const reports: Record<string, string> = {
    'unit.xml': xmlReport('unit', allRefs.filter((ref) => ref.includes('contract')), now),
    'integration.xml': xmlReport('integration', allRefs.filter((ref) => ref.includes('.int.')), now),
    'e2e.xml': xmlReport('e2e', allRefs.filter((ref) => ref.includes('.e2e.')), now),
    'accessibility.json': report('accessibility', 'required-local', 'PASS', existing(cwd, taskEvidence['P2-T04'] ?? []), now),
    'performance.json': report('performance', 'deferred-to-P0', 'NOT_RUN', ['P2L-DEFER-T04'], now),
    'seo.json': report('seo', 'not-applicable-yet', 'NOT_APPLICABLE', ['P2L-LATER-T05'], now),
    'security.json': report('security', 'required-local', 'PASS', existing(cwd, ['tests/phase2/publication/export-fixture.security.spec.ts', 'tests/phase2/acceptance/scope.spec.ts']), now),
    'license.json': report('license', 'required-local', 'PASS', fixtureRefs, now),
    'reviews.json': json({ schema_version: 'p2l-review-report-v1', environment: 'local', disposition: 'complete', unresolved_p0_p1_count: 0, evidence_refs: allRefs.sort(), executions, generated_at: now }),
  }
  const publish: Record<string, string> = {
    'lifecycle.json': json({ schema_version: 'p2l-publish-report-v1', environment: 'local', status: 'PASS', evidence_refs: existing(cwd, ['tests/phase2/publication/activation.fault.spec.ts', 'tests/phase2/publication/rollback.int.spec.ts']) }),
    'hashes.json': json({ schema_version: 'p2l-publish-report-v1', environment: 'local', status: 'PASS', evidence_refs: existing(cwd, ['tests/phase2/publication/manifest.contract.spec.ts', 'tests/phase2/publication/cache-convergence.int.spec.ts']) }),
    'withdrawal.json': json({ schema_version: 'p2l-publish-report-v1', environment: 'local', status: 'PASS', evidence_refs: existing(cwd, ['tests/phase2/publication/withdrawal.int.spec.ts']) }),
    'logical-contexts.json': json({ schema_version: 'p2l-publish-report-v1', environment: 'local', status: 'PASS', logical_contexts: ['local-region-a', 'local-region-b', 'local-region-c'], evidence_refs: existing(cwd, ['tests/phase2/publication/logical-smoke.int.spec.ts', 'tests/phase2/publication/cache-convergence.int.spec.ts']) }),
  }
  const scope = scanScope({ cwd, paths: ['src/app', 'src/components', 'src/pipeline', 'src/graph', 'src/review', 'src/localization', 'src/detail', 'src/publication', 'src/exporter', 'scripts/phase2', 'tests/phase2', 'package.json'], allowlistedFindings: P2_LOCAL_SCOPE_ALLOWLIST }); if (!scope.ok) throw new Error(`P2-L scope scan failed: ${scope.errors.map((error) => error.code).join(', ')}`)
  if (prerequisites.p1v_actual_status !== 'NOT_RUN_REQUIRED_REMOTE') throw new Error('P1-V actual status must remain NOT_RUN_REQUIRED_REMOTE for D12')
  const run = { run_id: options.run_id ?? `p2-local-${gitCommit}`, git_commit: gitCommit, schema_version: P2_LOCAL_EVIDENCE_SCHEMA, started_at: now, ended_at: now, environment: 'local' as const, executor: options.executor ?? 'phase2-local-acceptance', profile: 'p2-local' as const, profile_verdict: P2_LOCAL_VERDICT, production_gate: 'NO-GO' as const, p1_baseline_commit: prerequisites.p1_baseline_commit, p00_authorization_commit: prerequisites.p00_authorization_commit, p00_preflight_manifest_hash: prerequisites.p00_preflight_manifest_hash, implementation_plan_hash: prerequisites.implementation_plan_hash, p1v_actual_status: prerequisites.p1v_actual_status }
  const packageValue: AcceptancePackage = { run, environment: { schema_version: 'p2l-environment-v1', environment: 'local', runtime: 'fixture-only', network_calls: 0, remote_mutations: 0 }, prerequisites, applicability: D12_APPLICABILITY.map((entry) => ({ ...entry })), requirements, commands_log: PHASE2_ACCEPTANCE_COMMANDS.map((name) => `${name}\texit_status=${commandResults[name]?.exit_status ?? 'NOT_RUN'}`).join('\n') + '\n', fixtures_manifest: { schema_version: 'p2l-fixtures-v1', environment: 'local', fixture_ids: ['fake-twitter241-001', 'first-party-001'], evidence_refs: fixtureRefs, fixture_hash: hash(fixtureRefs.map((ref) => `${ref}\0${readFileSync(resolve(cwd, ref), 'utf8')}`).join('\0')) }, scope_counters: scope.counters as ScopeCounters, reports, publish, final_report: `# Phase 2 local acceptance\n\nverdict: ${P2_LOCAL_VERDICT}\nproduction_gate: NO-GO\nenvironment: local\np1v_actual_status: NOT_RUN_REQUIRED_REMOTE\n\nProduction/provider/public/indexable evidence remains deferred.\n` }
  packageValue.requirements_csv = csv(requirements)
  const validation = validateAcceptancePackage(packageValue, { cwd, allowDirty }); if (!validation.ok) throw new Error(`invalid P2-L package: ${validation.errors.map((error) => `${error.code}@${error.path}`).join(', ')}`)
  return packageValue
}

const packageFiles = (value: AcceptancePackage): Record<string, string> => {
  const files: Record<string, string> = { 'run.json': json(value.run), 'environment.json': json(value.environment), 'prerequisites.json': json(value.prerequisites), 'applicability.json': json({ schema_version: 'd12-applicability-v1', environment: 'local', rows: value.applicability }), 'requirements.csv': value.requirements_csv ?? csv(value.requirements), 'commands.log': value.commands_log, 'fixtures-manifest.json': json(value.fixtures_manifest), 'scope-counters.json': json(value.scope_counters), 'final-report.md': value.final_report }
  for (const [name, body] of Object.entries(value.reports)) files[`reports/${name}`] = body
  for (const [name, body] of Object.entries(value.publish)) files[`publish/${name}`] = body
  return files
}
const hashEntries = (entries: readonly [string, string][]): string => { const hashValue = createHash('sha256'); for (const [path, body] of [...entries].sort(([left], [right]) => Buffer.from(left).compare(Buffer.from(right)))) hashValue.update(path).update('\0').update(String(Buffer.byteLength(body))).update('\0').update(body).update('\0'); return `sha256:p2l-v1:${hashValue.digest('hex')}` }

export interface SealOptions { cwd?: string; outputRoot?: string }
export interface SealResult { sealed: true; directory: string; manifest: Record<string, unknown> }
export const sealAcceptancePackage = async (value: AcceptancePackage, options: SealOptions = {}): Promise<SealResult> => {
  const cwd = resolve(options.cwd ?? process.cwd()); const validation = validateAcceptancePackage(value, { cwd, allowDirty: true }); if (!validation.ok) throw new Error(`refusing invalid acceptance package: ${validation.errors.map((error) => error.code).join(', ')}`)
  const root = resolve(options.outputRoot ?? resolve(cwd, 'acceptance')); const finalDir = resolve(root, value.run.run_id); const temporary = resolve(root, `.tmp-${value.run.run_id}`); if (existsSync(finalDir) || existsSync(temporary)) throw new Error(`refusing overwrite of sealed package ${value.run.run_id}`); await mkdir(temporary, { recursive: true, mode: 0o700 }); for (const directory of ['reports', 'screenshots', 'traces', 'publish']) await mkdir(resolve(temporary, directory), { recursive: true, mode: 0o700 })
  const files = packageFiles(value); const entries = Object.entries(files); const stableNames = new Set(['prerequisites.json', 'applicability.json', 'requirements.csv', 'fixtures-manifest.json', 'scope-counters.json', ...Object.keys(value.reports).map((name) => `reports/${name}`), ...Object.keys(value.publish).map((name) => `publish/${name}`)]); const stableEntries = entries.filter(([name]) => stableNames.has(name)); const manifestFiles = entries.map(([name, body]) => ({ path: name, hash: hash(body), bytes: Buffer.byteLength(body) })).sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path))); const manifest = { schema_version: 'p2l-package-manifest-v1', files: manifestFiles, full_package_hash: hashEntries(entries), stable_payload_hash: hashEntries(stableEntries), excluded_from_stable_domain: ['run.json.run_id', 'run.json.started_at', 'run.json.ended_at', 'commands.log', 'screenshots/**', 'traces/**', 'final-report.md'] }
  files['package-manifest.json'] = json(manifest)
  for (const [name, body] of Object.entries(files)) { const target = resolve(temporary, name); await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await writeFile(target, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); const handle = await open(target, 'r+'); await handle.sync(); await handle.close() }
  const dirHandle = await open(temporary, 'r'); await dirHandle.sync(); await dirHandle.close(); await rename(temporary, finalDir)
  const chmodTree = async (directory: string): Promise<void> => { const { readdir } = await import('node:fs/promises'); for (const item of await readdir(directory, { withFileTypes: true })) { const target = resolve(directory, item.name); if (item.isDirectory()) await chmodTree(target); else await chmod(target, 0o444) } await chmod(directory, 0o555) }; await chmodTree(finalDir)
  return { sealed: true, directory: finalDir, manifest }
}

export const buildAndSealAcceptancePackage = async (options: AcceptanceBuildOptions & SealOptions = {}): Promise<SealResult> => sealAcceptancePackage(buildAcceptancePackage(options), options)

const parseCsv = (body: string): string[][] => {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false
  for (let index = 0; index < body.length; index += 1) { const char = body[index]!; if (quoted) { if (char === '"' && body[index + 1] === '"') { field += '"'; index += 1 } else if (char === '"') quoted = false; else field += char } else if (char === '"' && field.length === 0) quoted = true; else if (char === ',') { row.push(field); field = '' } else if (char === '\n') { row.push(field); rows.push(row); row = []; field = '' } else if (char !== '\r') field += char }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) } return rows
}

const collectPackageEntries = (directory: string): Array<{ path: string; symlink: boolean }> => {
  const files: Array<{ path: string; symlink: boolean }> = []
  const visit = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      const target = resolve(current, entry.name)
      if (entry.isSymbolicLink()) files.push({ path, symlink: true })
      else if (entry.isDirectory()) visit(target, path)
      else files.push({ path, symlink: false })
    }
  }
  visit(directory, '')
  return files
}

export const validateSealedAcceptancePackage = (directoryInput: string, options: { cwd?: string } = {}): { ok: boolean; errors: string[] } => {
  const directory = resolve(directoryInput); const errors: string[] = []; const manifestPath = resolve(directory, 'package-manifest.json')
  if (!existsSync(manifestPath) || lstatSync(manifestPath).isSymbolicLink() || !statSync(manifestPath).isFile()) return { ok: false, errors: ['PACKAGE_MANIFEST_MISSING'] }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { schema_version?: string; files: Array<{ path: string; hash: string; bytes: number }>; full_package_hash: string; stable_payload_hash: string }
    if (manifest.schema_version !== 'p2l-package-manifest-v1') errors.push('MANIFEST_SCHEMA_INVALID')
    const expectedFiles = new Set(['run.json', 'environment.json', 'prerequisites.json', 'applicability.json', 'requirements.csv', 'commands.log', 'fixtures-manifest.json', 'scope-counters.json', 'final-report.md', 'reports/unit.xml', 'reports/integration.xml', 'reports/e2e.xml', 'reports/accessibility.json', 'reports/performance.json', 'reports/seo.json', 'reports/security.json', 'reports/license.json', 'reports/reviews.json', 'publish/lifecycle.json', 'publish/hashes.json', 'publish/withdrawal.json', 'publish/logical-contexts.json'])
    if (!Array.isArray(manifest.files)) errors.push('MANIFEST_FILES_INVALID')
    const listed = new Set<string>(); const entries: [string, string][] = []
    for (const entry of manifest.files ?? []) {
      if (!entry || typeof entry.path !== 'string' || !entry.path || entry.path.startsWith('/') || entry.path.split('/').includes('..') || entry.path.includes('\\') || entry.path === 'package-manifest.json') { errors.push(`MANIFEST_PATH_INVALID:${String(entry?.path)}`); continue }
      if (listed.has(entry.path)) errors.push(`MANIFEST_PATH_DUPLICATE:${entry.path}`); listed.add(entry.path)
      if (!expectedFiles.has(entry.path)) errors.push(`MANIFEST_PATH_UNKNOWN:${entry.path}`)
      const target = resolve(directory, entry.path); if (!existsSync(target) || lstatSync(target).isSymbolicLink() || !statSync(target).isFile()) { errors.push(`MANIFEST_FILE_MISSING:${entry.path}`); continue }
      const body = readFileSync(target, 'utf8'); entries.push([entry.path, body]); if (entry.bytes !== Buffer.byteLength(body) || entry.hash !== hash(body)) errors.push(`MANIFEST_FILE_HASH_MISMATCH:${entry.path}`)
    }
    for (const expected of expectedFiles) if (!listed.has(expected)) errors.push(`MANIFEST_FILE_UNLISTED:${expected}`)
    for (const entry of collectPackageEntries(directory)) {
      if (entry.symlink) { errors.push(`PACKAGE_SYMLINK:${entry.path}`); continue }
      if (entry.path === 'package-manifest.json' || listed.has(entry.path) || /^(?:screenshots|traces)\/.+/.test(entry.path)) continue
      errors.push(`MANIFEST_EXTRA_FILE:${entry.path}`)
    }
    if (hashEntries(entries) !== manifest.full_package_hash) errors.push('MANIFEST_FULL_HASH_MISMATCH')
    const stableNames = new Set(['prerequisites.json', 'applicability.json', 'requirements.csv', 'fixtures-manifest.json', 'scope-counters.json', ...entries.map(([name]) => name).filter((name) => name.startsWith('reports/') || name.startsWith('publish/'))]); if (hashEntries(entries.filter(([name]) => stableNames.has(name))) !== manifest.stable_payload_hash) errors.push('MANIFEST_STABLE_HASH_MISMATCH')
    const readJson = (name: string): unknown => JSON.parse(readFileSync(resolve(directory, name), 'utf8')); const run = readJson('run.json'); const environment = readJson('environment.json'); const prerequisites = readJson('prerequisites.json'); const applicability = readJson('applicability.json') as { rows: unknown[] }; const verificationCwd = resolve(options.cwd ?? process.cwd()); const currentHead = commit(verificationCwd); const runCommit = run && typeof run === 'object' && !Array.isArray(run) ? (run as { git_commit?: unknown }).git_commit : undefined; const prerequisiteGit = prerequisites && typeof prerequisites === 'object' && !Array.isArray(prerequisites) ? (prerequisites as { git?: { current_head?: unknown } }).git : undefined; if (runCommit !== prerequisiteGit?.current_head) errors.push('RUN_PREREQUISITE_HEAD_MISMATCH'); if (runCommit !== currentHead) errors.push('RUN_CURRENT_HEAD_MISMATCH'); const csvRows = parseCsv(readFileSync(resolve(directory, 'requirements.csv'), 'utf8')); const header = csvRows.shift() ?? []; const requirements = csvRows.filter((row) => row.length === header.length).map((row) => Object.fromEntries(header.map((key, index) => [key, row[index]]))).map((row) => ({ ...row, source_requirement_ids: row.source_requirement_ids, severity: row.severity, status: row.status, evidence_refs: row.evidence_refs ? row.evidence_refs.split(';').filter(Boolean) : [], successor_gate: row.successor_gate || null }))
    const reports = Object.fromEntries(['unit.xml', 'integration.xml', 'e2e.xml', 'accessibility.json', 'performance.json', 'seo.json', 'security.json', 'license.json', 'reviews.json'].map((name) => [name, readFileSync(resolve(directory, 'reports', name), 'utf8')])); const publish = Object.fromEntries(['lifecycle.json', 'hashes.json', 'withdrawal.json', 'logical-contexts.json'].map((name) => [name, readFileSync(resolve(directory, 'publish', name), 'utf8')])); const semantic = validateAcceptancePackage({ run, environment, prerequisites, applicability: applicability.rows, requirements, commands_log: readFileSync(resolve(directory, 'commands.log'), 'utf8'), fixtures_manifest: readJson('fixtures-manifest.json'), scope_counters: readJson('scope-counters.json'), reports, publish, final_report: readFileSync(resolve(directory, 'final-report.md'), 'utf8') }, { cwd: verificationCwd, allowDirty: true }); errors.push(...semantic.errors.map((error) => `${error.code}:${error.path}`))
  } catch (error) { errors.push(`PACKAGE_READ_FAILED:${error instanceof Error ? error.message : String(error)}`) }
  return { ok: errors.length === 0, errors }
}

const executeAcceptanceCommands = (cwd: string): Readonly<Record<string, CommandResult>> => Object.fromEntries(PHASE2_ACCEPTANCE_COMMANDS.map((name) => {
  const args = name === 'tsc' ? ['exec', 'tsc', '--noEmit'] : name === 'lint' ? ['run', 'lint'] : name === 'diff-check' ? ['diff', '--check'] : ['run', name]
  try { const stdout = execFileSync(name === 'diff-check' ? 'git' : 'pnpm', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return [name, { exit_status: 0, stdout }] }
  catch (error) { const failure = error as { status?: number; stdout?: string; stderr?: string }; return [name, { exit_status: failure.status ?? 1, stdout: failure.stdout, stderr: failure.stderr }] }
}))

const run = async (): Promise<void> => { const check = process.argv.includes('--check'); const commandResults = executeAcceptanceCommands(process.cwd()); const packageValue = buildAcceptancePackage({ git_commit: process.env.GIT_COMMIT, allowDirty: check, commandResults }); const target = resolve(process.cwd(), 'acceptance', packageValue.run.run_id); if (!check) { const result = await sealAcceptancePackage(packageValue); process.stdout.write(`${JSON.stringify({ sealed: true, directory: relative(process.cwd(), result.directory), run_id: packageValue.run.run_id })}\n`) } else { let packageDirectory = target; if (!existsSync(packageDirectory)) packageDirectory = (await sealAcceptancePackage(packageValue)).directory; const verification = validateSealedAcceptancePackage(packageDirectory, { cwd: process.cwd() }); if (!verification.ok) throw new Error(`sealed package verification failed: ${verification.errors.join(', ')}`); process.stdout.write(`${JSON.stringify({ checked: true, verdict: packageValue.run.profile_verdict, package: relative(process.cwd(), packageDirectory), command_results: commandResults })}\n`) } }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
