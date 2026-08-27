import { chmod, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'

import {
  D12_APPLICABILITY,
  PHASE2_ACCEPTANCE_COMMANDS,
  P2_LOCAL_VERDICT,
  buildAcceptancePackage,
  sealAcceptancePackage,
  validateSealedAcceptancePackage,
  validateAcceptancePackage,
} from '../../../scripts/phase2/acceptance'

const passedCommands = Object.fromEntries(PHASE2_ACCEPTANCE_COMMANDS.map((name) => [name, { exit_status: 0 }]))

vi.setConfig({ testTimeout: 30_000 })

const makeTreeWritable = async (directory: string): Promise<void> => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) await makeTreeWritable(target)
    else await chmod(target, 0o644)
  }
  await chmod(directory, 0o755)
}

describe('P2-T07 acceptance package', () => {
  it('publishes the exact D12 21-row applicability inventory', () => {
    expect(D12_APPLICABILITY).toHaveLength(21)
    expect(new Set(D12_APPLICABILITY.map((row) => row.row_id)).size).toBe(21)
  })

  it('builds an honest local package with deferred production evidence', () => {
    const result = buildAcceptancePackage({ cwd: process.cwd(), run_id: 'p2-local-test', now: '2026-08-25T00:00:00.000Z', allowDirty: true, commandResults: passedCommands })
    expect(result.run.profile).toBe('p2-local')
    expect(result.run.profile_verdict).toBe(P2_LOCAL_VERDICT)
    expect(result.run.production_gate).toBe('NO-GO')
    expect(result.requirements).toHaveLength(21)
    expect(result.requirements.filter((row) => row.applicability === 'deferred-to-P0').every((row) => row.status === 'NOT_RUN')).toBe(true)
    expect(result.requirements.filter((row) => row.applicability === 'not-applicable-yet').every((row) => row.status === 'NOT_APPLICABLE')).toBe(true)
    expect(validateAcceptancePackage(result, { cwd: process.cwd(), allowDirty: true }).ok).toBe(true)
  })

  it('rejects an omitted, mutated, or non-local canonical row', () => {
    const result = buildAcceptancePackage({ cwd: process.cwd(), run_id: 'p2-local-test', now: '2026-08-25T00:00:00.000Z', allowDirty: true, commandResults: passedCommands })
    const missing = { ...result, requirements: result.requirements.slice(1) }
    expect(validateAcceptancePackage(missing, { cwd: process.cwd(), allowDirty: true }).ok).toBe(false)
    const mutated = { ...result, requirements: result.requirements.map((row, index) => index === 0 ? { ...row, environment: 'production' as const } : row) }
    expect(validateAcceptancePackage(mutated, { cwd: process.cwd(), allowDirty: true }).ok).toBe(false)
  })

  it('rejects a sealed package with an unknown manifest schema', async () => {
    const root = await mkdtemp(join(tmpdir(), 'p2l-manifest-schema-'))
    try {
      const result = buildAcceptancePackage({ cwd: process.cwd(), run_id: `p2-local-schema-${process.pid}`, now: '2026-08-25T00:00:00.000Z', allowDirty: true, commandResults: passedCommands })
      const sealed = await sealAcceptancePackage(result, { cwd: process.cwd(), outputRoot: root })
      const manifestPath = join(sealed.directory, 'package-manifest.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
      await chmod(manifestPath, 0o644)
      await writeFile(manifestPath, `${JSON.stringify({ ...manifest, schema_version: 'unknown-v1' })}\n`)
      expect(validateSealedAcceptancePackage(sealed.directory, { cwd: process.cwd() }).errors).toContain('MANIFEST_SCHEMA_INVALID')
    } finally {
      const packageDirectories = await readdir(root, { withFileTypes: true })
      for (const entry of packageDirectories) if (entry.isDirectory()) await makeTreeWritable(join(root, entry.name))
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a sealed package whose run commit is not the verified HEAD', async () => {
    const root = await mkdtemp(join(tmpdir(), 'p2l-manifest-head-'))
    try {
      const result = buildAcceptancePackage({ cwd: process.cwd(), run_id: `p2-local-head-${process.pid}`, now: '2026-08-25T00:00:00.000Z', allowDirty: true, commandResults: passedCommands })
      const mismatched = { ...result, run: { ...result.run, git_commit: 'a'.repeat(40) } }
      const sealed = await sealAcceptancePackage(mismatched, { cwd: process.cwd(), outputRoot: root })
      const verification = validateSealedAcceptancePackage(sealed.directory, { cwd: process.cwd() })
      expect(verification.errors).toContain('RUN_PREREQUISITE_HEAD_MISMATCH')
      expect(verification.errors).toContain('RUN_CURRENT_HEAD_MISMATCH')
    } finally {
      const packageDirectories = await readdir(root, { withFileTypes: true })
      for (const entry of packageDirectories) if (entry.isDirectory()) await makeTreeWritable(join(root, entry.name))
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects unmanifested package files while allowing screenshot and trace artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'p2l-manifest-closed-world-'))
    try {
      const result = buildAcceptancePackage({ cwd: process.cwd(), run_id: `p2-local-closed-world-${process.pid}`, now: '2026-08-25T00:00:00.000Z', allowDirty: true, commandResults: passedCommands })
      const sealed = await sealAcceptancePackage(result, { cwd: process.cwd(), outputRoot: root })
      await makeTreeWritable(sealed.directory)
      await writeFile(join(sealed.directory, 'unexpected.txt'), 'must be rejected\n')
      await writeFile(join(sealed.directory, 'screenshots', 'evidence.png'), 'allowed artifact\n')
      await writeFile(join(sealed.directory, 'traces', 'trace.zip'), 'allowed artifact\n')
      const verification = validateSealedAcceptancePackage(sealed.directory, { cwd: process.cwd() })
      expect(verification.errors).toContain('MANIFEST_EXTRA_FILE:unexpected.txt')
      expect(verification.errors).not.toContain('MANIFEST_EXTRA_FILE:screenshots/evidence.png')
      expect(verification.errors).not.toContain('MANIFEST_EXTRA_FILE:traces/trace.zip')
    } finally {
      const packageDirectories = await readdir(root, { withFileTypes: true })
      for (const entry of packageDirectories) if (entry.isDirectory()) await makeTreeWritable(join(root, entry.name))
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects symlinks even when they are inside the screenshot and trace artifact directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'p2l-manifest-symlink-'))
    try {
      const result = buildAcceptancePackage({ cwd: process.cwd(), run_id: `p2-local-symlink-${process.pid}`, now: '2026-08-25T00:00:00.000Z', allowDirty: true, commandResults: passedCommands })
      const sealed = await sealAcceptancePackage(result, { cwd: process.cwd(), outputRoot: root })
      await makeTreeWritable(sealed.directory)
      await symlink(join(sealed.directory, 'run.json'), join(sealed.directory, 'screenshots', 'run-link.json'))
      await symlink(join(sealed.directory, 'reports'), join(sealed.directory, 'traces', 'reports-link'), 'dir')
      const verification = validateSealedAcceptancePackage(sealed.directory, { cwd: process.cwd() })
      expect(verification.ok).toBe(false)
      expect(verification.errors).toContain('PACKAGE_SYMLINK:screenshots/run-link.json')
      expect(verification.errors).toContain('PACKAGE_SYMLINK:traces/reports-link')
    } finally {
      const packageDirectories = await readdir(root, { withFileTypes: true })
      for (const entry of packageDirectories) if (entry.isDirectory()) await makeTreeWritable(join(root, entry.name))
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses package overwrite during an immutable seal', async () => {
    const runId = `p2-local-overwrite-${process.pid}`
    const result = buildAcceptancePackage({ cwd: process.cwd(), run_id: runId, now: '2026-08-25T00:00:00.000Z', allowDirty: true, commandResults: passedCommands })
    const first = await sealAcceptancePackage(result, { cwd: process.cwd() })
    expect(first.sealed).toBe(true)
    expect(validateSealedAcceptancePackage(first.directory, { cwd: process.cwd() }).ok).toBe(true)
    await expect(sealAcceptancePackage(result, { cwd: process.cwd() })).rejects.toThrow(/overwrite|sealed/i)
  })
})
