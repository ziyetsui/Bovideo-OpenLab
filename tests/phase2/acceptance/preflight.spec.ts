import { describe, expect, it } from 'vitest'

import {
  P00_TOOLING_PATHS,
  buildPhase2Preflight,
  buildAuthorizationLock,
  hashPlan,
  validateAuthorizationLock,
  validatePreflight,
} from '../../../scripts/phase2/preflight'

describe('P2-P00 D12 preflight', () => {
  it('fails closed until tooling exists', () => {
    expect(P00_TOOLING_PATHS).toEqual(expect.arrayContaining([
      'scripts/phase2/preflight.ts',
      'tests/phase2/acceptance/preflight.spec.ts',
      'vitest.phase2.config.mts',
      'playwright.phase2.config.ts',
      'package.json',
      '.gitignore',
    ]))
  })

  it('records a deterministic plan hash and the P1-T09 interface freeze', () => {
    const value = buildPhase2Preflight({ cwd: process.cwd(), changed_files: P00_TOOLING_PATHS, clean_worktree: true })

    expect(value.schema_version).toBe('p2l-preflight-v1')
    expect(value.implementation_plan_hash).toBe(hashPlan(process.cwd()))
    expect(value.tasks).toHaveLength(9)
    expect(value.tasks.every((task) => task.interfaces.every((entry) => /^sha256:bytes-v1:[0-9a-f]{64}$/.test(entry.contract_hash)))).toBe(true)
    expect(Object.keys(value.scope_counters)).toHaveLength(12)
    expect(Object.values(value.scope_counters).every((count) => count === 0)).toBe(true)
  })

  it('keeps the P1-V WIP / production NO-GO boundary explicit', () => {
    const value = buildPhase2Preflight({ cwd: process.cwd(), changed_files: P00_TOOLING_PATHS, clean_worktree: true })

    expect(value.p1v_actual_status).toBe('NOT_RUN_REQUIRED_REMOTE')
    expect(value.authorized).toBe(true)
    expect(validatePreflight(value).ok).toBe(true)
  })

  it('rejects a production-scope change', () => {
    const value = buildPhase2Preflight({
      cwd: process.cwd(),
      changed_files: [...P00_TOOLING_PATHS, 'src/pipeline/production.ts'],
      clean_worktree: true,
    })

    const result = validatePreflight(value)

    expect(result.ok).toBe(false)
    expect(result.errors.map((error) => error.code)).toContain('UNEXPECTED_CHANGED_PATH')
  })

  it('rejects a tampered authorization lock manifest hash', () => {
    const value = buildPhase2Preflight({ cwd: process.cwd(), changed_files: P00_TOOLING_PATHS, clean_worktree: true })
    const lock = buildAuthorizationLock(value, `sha256:bytes-v1:${'a'.repeat(64)}`)
    expect(validateAuthorizationLock(lock, lock.preflight_manifest_hash).ok).toBe(true)
    expect(validateAuthorizationLock(lock, `sha256:bytes-v1:${'b'.repeat(64)}`).ok).toBe(false)
  })

  it.each([
    ['authorized', (value: ReturnType<typeof buildPhase2Preflight>) => ({ ...value, authorized: false })],
    ['counter', (value: ReturnType<typeof buildPhase2Preflight>) => ({ ...value, scope_counters: { ...value.scope_counters, remote_mutations: 1 } })],
    ['duplicate interface', (value: ReturnType<typeof buildPhase2Preflight>) => ({ ...value, tasks: value.tasks.map((task, index) => index === 1 ? { ...task, interfaces: value.tasks[0]?.interfaces ?? [] } : task) })],
  ] as const)('fails closed on %s tamper', (_name, mutate) => {
    const value = buildPhase2Preflight({ cwd: process.cwd(), changed_files: P00_TOOLING_PATHS, clean_worktree: true })
    const result = validatePreflight(mutate(value) as ReturnType<typeof buildPhase2Preflight>)
    expect(result.ok).toBe(false)
  })
})
