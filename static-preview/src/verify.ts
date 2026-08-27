import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildPreview, type PreviewManifest } from './build'
import { APPLICATION_LOCALES, PREVIEW_MODES, type PreviewMode, type PreviewRoute } from './contracts'
import { scanPreview } from './scan'
import { readTree, snapshotId, type FileDigest } from './tree'

function sameFiles(left: readonly FileDigest[], right: readonly FileDigest[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

const manifestKeys = [
  'schemaVersion',
  'generatorVersion',
  'gitSha',
  'inputHash',
  'previewSnapshotId',
  'routeIds',
  'locales',
  'routeFiles',
  'files',
] as const
const fileDigestKeys = ['path', 'sha256', 'bytes'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value)
  return actualKeys.length === keys.length && actualKeys.every((key, index) => key === keys[index])
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isFileDigest(value: unknown): value is FileDigest {
  return (
    isRecord(value) &&
    hasExactKeys(value, fileDigestKeys) &&
    typeof value.path === 'string' &&
    isHash(value.sha256) &&
    typeof value.bytes === 'number' &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes >= 0
  )
}

export function parsePreviewManifest(serialized: string): PreviewManifest {
  if (!serialized.endsWith('\n')) {
    throw new Error('Preview manifest must end with a newline')
  }
  const value: unknown = JSON.parse(serialized)
  if (
    !isRecord(value) ||
    !hasExactKeys(value, manifestKeys) ||
    value.schemaVersion !== 1 ||
    value.generatorVersion !== '1.0.0' ||
    !/^[a-f0-9]{40}$/.test(String(value.gitSha)) ||
    !isHash(value.inputHash) ||
    !isHash(value.previewSnapshotId) ||
    !isStringArray(value.routeIds) ||
    !isStringArray(value.locales) ||
    !isStringArray(value.routeFiles) ||
    !Array.isArray(value.files) ||
    !value.files.every(isFileDigest)
  ) {
    throw new Error('Preview manifest does not match the exact schema')
  }
  if (JSON.stringify(value.locales) !== JSON.stringify(APPLICATION_LOCALES)) {
    throw new Error('Preview manifest locales do not match the normative locale sequence')
  }
  if (serialized !== `${JSON.stringify(value)}\n`) {
    throw new Error('Preview manifest must use canonical bytes')
  }
  return value as PreviewManifest
}

async function readEmittedManifest(outDir: string): Promise<PreviewManifest> {
  return parsePreviewManifest(await readFile(join(outDir, 'preview-manifest.json'), 'utf8'))
}

function assertManifestTree(manifest: PreviewManifest, tree: readonly FileDigest[]): void {
  const snapshotFiles = tree.filter(({ path }) => path !== 'preview-manifest.json')
  if (!sameFiles(manifest.files, snapshotFiles)) {
    throw new Error('Preview manifest file digests do not match the generated tree')
  }
  if (manifest.previewSnapshotId !== snapshotId(snapshotFiles)) {
    throw new Error('Preview manifest snapshot ID does not match the generated tree')
  }
  if (manifest.routeFiles.length !== manifest.routeIds.length * manifest.locales.length) {
    throw new Error('Preview manifest route matrix is incomplete')
  }
  if (new Set(manifest.routeFiles).size !== manifest.routeFiles.length) {
    throw new Error('Preview manifest contains duplicate route files')
  }
}

export type PreviewVerificationOptions = Readonly<{
  outDir: string
  gitSha: string
  routes?: readonly PreviewRoute[]
  mode?: PreviewMode
}>

export async function verifyExistingPreview(options: PreviewVerificationOptions): Promise<PreviewManifest> {
  const manifest = await readEmittedManifest(options.outDir)
  if (manifest.gitSha !== options.gitSha) {
    throw new Error('Preview manifest Git SHA does not match the intended clean commit')
  }
  const [tree, findings] = await Promise.all([readTree(options.outDir), scanPreview(options.outDir)])
  assertManifestTree(manifest, tree)
  if (findings.length) {
    throw new Error(`Preview verification found ${findings.length} redacted security finding(s)`)
  }

  const comparisonDirectory = await mkdtemp(join(tmpdir(), 'pvb-verify-'))
  try {
    const comparisonReturnedManifest = await buildPreview({ ...options, outDir: comparisonDirectory })
    const comparisonManifest = await readEmittedManifest(comparisonDirectory)
    const comparisonTree = await readTree(comparisonDirectory)
    if (
      JSON.stringify(comparisonManifest) !== JSON.stringify(comparisonReturnedManifest) ||
      JSON.stringify(manifest) !== JSON.stringify(comparisonManifest) ||
      !sameFiles(tree, comparisonTree)
    ) {
      throw new Error('Preview two-build verification failed: generated trees differ')
    }
  } finally {
    await rm(comparisonDirectory, { recursive: true, force: true })
  }
  return manifest
}

export async function verifyPreview(options: PreviewVerificationOptions): Promise<PreviewManifest> {
  await buildPreview(options)
  return verifyExistingPreview(options)
}

function optionValue(args: readonly string[], name: string): string {
  const index = args.indexOf(name)
  const value = index === -1 ? undefined : args[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing required ${name} value`)
  }
  return value
}

function previewModeOption(args: readonly string[]): PreviewMode {
  const index = args.indexOf('--mode')
  if (index === -1) return 'baseline'
  const value = args[index + 1]
  if (!value || !PREVIEW_MODES.includes(value as PreviewMode)) {
    throw new Error('Preview mode must be baseline or withdrawn')
  }
  return value as PreviewMode
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)
  const options = { outDir: optionValue(args, '--out-dir'), gitSha: optionValue(args, '--git-sha'), mode: previewModeOption(args) }
  const manifest = command === 'build' ? await buildPreview(options) : command === 'verify' ? await verifyPreview(options) : null
  if (!manifest) {
    throw new Error('Expected preview command: build or verify')
  }
  process.stdout.write(`${manifest.previewSnapshotId}\n`)
}

if (process.argv[1]?.endsWith('/verify.ts')) {
  void main()
}
