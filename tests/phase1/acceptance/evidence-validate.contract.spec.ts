import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  buildPhase1AcceptanceManifest,
  type Phase1AcceptanceManifest,
} from '../../../scripts/phase1/acceptance'
import {
  validateEvidenceManifest,
  type EvidenceValidationResult,
} from '../../../scripts/phase1/evidence-validate'

const manifest = (): Phase1AcceptanceManifest => buildPhase1AcceptanceManifest({
  run_id: 'p1-local-contract-test',
  started_at: '2026-08-25T00:00:00.000Z',
  ended_at: '2026-08-25T00:01:00.000Z',
})

const manifestWithCommit = (git_commit: string): Phase1AcceptanceManifest => buildPhase1AcceptanceManifest({
  run_id: 'p1-local-historical-contract-test',
  git_commit,
  started_at: '2026-08-25T00:00:00.000Z',
  ended_at: '2026-08-25T00:01:00.000Z',
})

const errorCodes = (result: EvidenceValidationResult): string[] => result.errors.map((error) => error.code)

describe('P1-T09 required-local evidence contract', () => {
  it('builds a nine-task local index while preserving P1-V NOT_RUN as machine WIP', () => {
    const value = manifest()
    const result = validateEvidenceManifest(value)

    expect(result.ok).toBe(true)
    expect(result.aggregate_status).toBe('WIP')
    expect(value.run.profile_verdict).toBe('Phase 1 LOCAL-DEV COMPLETE — production Phase 0 remains NO-GO')
    expect(value.run.p1v_status).toBe('NOT_RUN_REQUIRED_REMOTE')
    expect(value.tasks).toHaveLength(9)
    expect(value.tasks.map((task) => task.task_id)).toEqual([
      'P1-T01', 'P1-T02', 'P1-T03', 'P1-T04', 'P1-T05', 'P1-T06', 'P1-T07', 'P1-T08', 'P1-T09',
    ])
    expect(value.requirements.filter((row) => row.applicability === 'required-local').every((row) => row.status === 'PASS')).toBe(true)
    expect(value.tasks.flatMap((task) => task.evidence_refs).every((ref) => existsSync(ref))).toBe(true)
    expect(value.requirements.flatMap((row) => row.evidence_refs).every((ref) => existsSync(ref))).toBe(true)
    expect(value.run.git_commit).toBe(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim())
  })

  it('requires evidence refs and machine evidence for every required-local PASS row', () => {
    const value = manifest()
    const row = value.requirements.find((candidate) => candidate.id === 'AC-P1L-CON-001')
    if (!row) throw new Error('fixture row missing')
    row.evidence_refs = []

    const result = validateEvidenceManifest(value)

    expect(result.ok).toBe(false)
    expect(errorCodes(result)).toContain('REQUIRED_LOCAL_EVIDENCE_MISSING')
  })

  it.each(['FAIL', 'NOT_RUN'] as const)('rejects required-local rows with status %s', (status) => {
    const value = manifest()
    const row = value.requirements.find((candidate) => candidate.applicability === 'required-local')
    if (!row) throw new Error('required-local fixture row missing')
    row.status = status

    const result = validateEvidenceManifest(value)

    expect(result.ok).toBe(false)
    expect(errorCodes(result)).toContain('REQUIRED_LOCAL_STATUS_INVALID')
  })

  it('rejects a required-local task that is not PASS', () => {
    const value = manifest()
    value.tasks[0].status = 'NOT_RUN'

    const result = validateEvidenceManifest(value)

    expect(result.ok).toBe(false)
    expect(errorCodes(result)).toContain('REQUIRED_LOCAL_TASK_STATUS_INVALID')
  })

  it('rejects evidence symlinks whose realpath escapes the repository', () => {
    const value = manifest()
    const temporaryDirectory = mkdtempSync(join('/tmp', 'p1-evidence-'))
    const outsideFile = join(temporaryDirectory, 'outside.json')
    const symlinkName = `.p1-evidence-symlink-${process.pid}-${Date.now()}`
    const symlinkPath = join(process.cwd(), symlinkName)
    mkdirSync(temporaryDirectory, { recursive: true })
    writeFileSync(outsideFile, '{}')
    symlinkSync(outsideFile, symlinkPath)
    try {
      value.tasks[0].evidence_refs = [symlinkName]

      const result = validateEvidenceManifest(value)

      expect(result.ok).toBe(false)
      expect(errorCodes(result)).toContain('EVIDENCE_REF_OUTSIDE_REPOSITORY')
    } finally {
      rmSync(symlinkPath, { force: true })
      rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  })

  it('requires run and task commits to resolve to the same current HEAD', () => {
    const value = manifest()
    const historicalCommit = execFileSync('git', ['rev-parse', 'HEAD^'], { encoding: 'utf8' }).trim()
    value.run.git_commit = historicalCommit

    const result = validateEvidenceManifest(value)

    expect(result.ok).toBe(false)
    expect(errorCodes(result)).toEqual(expect.arrayContaining(['COMMIT_NOT_CURRENT_HEAD', 'TASK_COMMIT_MISMATCH']))
  })

  it('allows an explicitly selected historical commit only when it is verifiable', () => {
    const historicalCommit = execFileSync('git', ['rev-parse', 'HEAD^'], { encoding: 'utf8' }).trim()
    const value = manifestWithCommit(historicalCommit)

    const result = validateEvidenceManifest(value, { allowHistoricalCommit: true })

    expect(result.ok).toBe(true)
  })

  it('rejects deferred or remote claims that turn NOT_RUN into PASS or N/A', () => {
    const value = manifest()
    const deferred = value.requirements.find((row) => row.applicability === 'deferred-to-P0')
    const remote = value.requirements.find((row) => row.applicability === 'required-remote')
    if (!deferred || !remote) throw new Error('fixture applicability rows missing')
    deferred.status = 'PASS'
    remote.status = 'PASS'

    const result = validateEvidenceManifest(value)

    expect(result.ok).toBe(false)
    expect(errorCodes(result)).toEqual(expect.arrayContaining(['DEFERRED_STATUS_INVALID', 'P1V_NOT_RUN_CLAIMED_PASS']))
  })

  it('rejects production-shaped evidence refs, invalid commit/hash values, and remote side effects', () => {
    const value = manifest()
    const task = value.tasks[0]
    task.evidence_refs = ['/tmp/secret-report.json']
    task.commit = 'not-a-commit'
    task.fixture_hash = 'not-a-hash'
    task.remote_mutations = 1

    const result = validateEvidenceManifest(value)

    expect(result.ok).toBe(false)
    expect(errorCodes(result)).toEqual(expect.arrayContaining([
      'EVIDENCE_REF_NOT_RELATIVE', 'COMMIT_INVALID', 'FIXTURE_HASH_INVALID', 'REMOTE_SIDE_EFFECT_DECLARED',
    ]))
  })

  it('rejects a generic PASS verdict when P1-V is not run', () => {
    const value = manifest()
    value.run.profile_verdict = 'PASS'

    const result = validateEvidenceManifest(value)

    expect(result.ok).toBe(false)
    expect(errorCodes(result)).toContain('P1V_NOT_RUN_AGGREGATE_PASS')
  })

  it('fails closed when P1-V status and remote requirement statuses disagree', () => {
    const value = manifest()
    value.run.p1v_status = 'PASS'

    const result = validateEvidenceManifest(value)

    expect(result.ok).toBe(false)
    expect(errorCodes(result)).toContain('P1V_STATUS_MISMATCH')
  })

  it('makes the acceptance CLI --check fail for an unverifiable commit', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx/esm', 'scripts/phase1/acceptance.ts', '--check'], {
      cwd: process.cwd(),
      env: { ...process.env, GIT_COMMIT: 'deadbeef' },
      encoding: 'utf8',
    })

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain('COMMIT_UNVERIFIABLE')
  })

  it('rejects a tampered stable payload hash', () => {
    const value = manifest()
    value.requirements[0].observed = 'tampered'

    const result = validateEvidenceManifest(value)

    expect(result.ok).toBe(false)
    expect(errorCodes(result)).toContain('STABLE_HASH_MISMATCH')
  })

  it('rejects a missing or substituted canonical requirement row', () => {
    const value = manifest()
    value.requirements = value.requirements.filter((row) => row.id !== 'AC-CMS-001')
    value.requirements[0].id = 'AC-CMS-001-替代'

    const result = validateEvidenceManifest(value)

    expect(result.ok).toBe(false)
    expect(errorCodes(result)).toEqual(expect.arrayContaining(['REQUIREMENT_CANONICAL_MISSING', 'REQUIREMENT_CANONICAL_UNKNOWN']))
  })
})
