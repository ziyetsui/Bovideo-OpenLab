import { createHash } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export type SecretScanRule = 'credential' | 'authorization' | 'cookie' | 'restricted-text' | 'absolute-path'
export type SecretScanSeverity = 'error'

/** A finding is deliberately a digest-only projection; matched bytes are never returned. */
export type SecretScanFinding = Readonly<{
  rule_id: SecretScanRule
  path: string
  offset: number
  match_digest: string
  severity: SecretScanSeverity
}>

export type SecretScanResult = Readonly<{
  files_scanned: number
  bytes_scanned: number
  findings: readonly SecretScanFinding[]
  passed: boolean
}>

export type SecretScanOptions = Readonly<{
  cwd?: string
  max_file_bytes?: number
  ignored_directories?: readonly string[]
}>

const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024
const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.open-next',
  '.wrangler',
  '.superpowers',
  '.trees',
  'build',
  'coverage',
  'dist',
  'media',
  'node_modules',
  'test-results',
])

type Detector = Readonly<{
  rule_id: SecretScanRule
  pattern: RegExp
  value_group?: number
}>

// These expressions match a value-bearing occurrence, not a key by itself. This keeps
// ordinary schema names and redactor implementations scan-clean while failing closed on
// captured reports/logs/exports.
const DETECTORS: readonly Detector[] = [
  {
    rule_id: 'authorization',
    pattern: /(?:^|[\s{"'])authorization["']?\s*[:=]\s*["']?((?:(?:bearer|basic|digest|token|jwt)\s+[A-Za-z0-9._~+/=-]{8,}|[A-Za-z0-9._~+/=-]{8,}))/gim,
    value_group: 1,
  },
  {
    rule_id: 'cookie',
    pattern: /(?:^|[\s{"'])(?:set[-_ ]?cookie|cookie)["']?\s*[:=]\s*["']?([A-Za-z0-9_-]{1,64}\s*=\s*[^\s"',;}\]]{4,})/gim,
    value_group: 1,
  },
  {
    rule_id: 'credential',
    pattern: /(?:^|[\s{"'])(?:api[-_ ]?key|access[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?(?:secret|id)|secret|password|passwd|credential|token)["']?\s*[:=]\s*["']?([A-Za-z0-9_./+=:-]{8,})/gim,
    value_group: 1,
  },
  {
    rule_id: 'credential',
    pattern: /\b(?:sk|rk|pk|gh[pousr]|github_pat|xox[baprs]|npm|AIza|AKIA)[_-][A-Za-z0-9_./+=:-]{10,}\b/g,
  },
  {
    rule_id: 'restricted-text',
    pattern: /(?:^|[\s{"'])(?:raw[-_ ]?(?:text|content|prompt|body|response|evidence|html)|full[-_ ]?(?:text|prompt|content)|localized[-_ ]?(?:full[-_ ])?text|third[-_ ]?party[-_ ]?(?:raw|text|content)|private[-_ ]?(?:evidence|(?:r2[-_ ]?)?signed[-_ ]?url))["']?\s*[:=]\s*["']?([^"',;}\]\r\n]{4,})/gim,
    value_group: 1,
  },
  {
    rule_id: 'restricted-text',
    pattern: /https?:\/\/[^\s"']+[?&](?:sig|signature|x-amz-signature|x-goog-signature|token|credential)=[^\s"']+/gim,
  },
  {
    rule_id: 'absolute-path',
    pattern: /(?:^|[\s="'([{,:])((?:\/(?:Users|home|private|tmp|var|Volumes|mnt|root|workspace|workspaces|absolute|opt|etc|usr(?:\/local)?)\/[^\s"'`}),;\]]+|[A-Za-z]:[\\/][^\s"'`}),;\]]+|\\\\[A-Za-z0-9._-]+\\[^\s"'`}),;\]]+))/gm,
    value_group: 1,
  },
]

const binary = (bytes: Buffer): boolean => bytes.includes(0)

const digest = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 16)

const byteOffset = (source: string, codeUnitOffset: number): number =>
  Buffer.byteLength(source.slice(0, codeUnitOffset), 'utf8')

const relativeDisplayPath = (filePath: string, cwd: string): string => {
  const value = relative(cwd, filePath).split(sep).join('/')
  // A path in a finding is metadata, never a way to disclose an absolute local path.
  return value === '' ? basename(filePath) : value
}

const findingFor = (rule_id: SecretScanRule, path: string, source: string, match: RegExpExecArray, value: string): SecretScanFinding => {
  const valueOffset = match.index + (match[0].lastIndexOf(value))
  return {
    rule_id,
    path,
    offset: byteOffset(source, valueOffset),
    match_digest: digest(value),
    severity: 'error',
  }
}

/** Scan one text payload without retaining the matched value in the result. */
export const scanText = (source: string, path = '<inline>'): readonly SecretScanFinding[] => {
  const findings: SecretScanFinding[] = []
  for (const detector of DETECTORS) {
    detector.pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = detector.pattern.exec(source)) !== null) {
      const value = detector.value_group === undefined ? match[0] : match[detector.value_group]
      if (value === undefined || value.length === 0) continue
      findings.push(findingFor(detector.rule_id, path, source, match, value))
      // Prevent a zero-width expression from looping if a detector is edited later.
      if (match[0].length === 0) detector.pattern.lastIndex += 1
    }
  }

  const unique = new Map<string, SecretScanFinding>()
  for (const finding of findings) {
    const key = `${finding.rule_id}:${finding.path}:${finding.offset}:${finding.match_digest}`
    unique.set(key, finding)
  }
  return [...unique.values()].sort((left, right) =>
    left.path.localeCompare(right.path) || left.offset - right.offset || left.rule_id.localeCompare(right.rule_id))
}

const isIgnoredDirectory = (name: string, ignored: ReadonlySet<string>): boolean => ignored.has(name)

const collectFiles = async (input: string, ignored: ReadonlySet<string>): Promise<string[]> => {
  const entry = await lstat(input)
  if (entry.isFile()) return [resolve(input)]
  if (!entry.isDirectory()) return []

  const files: string[] = []
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const child of entries) {
      if (child.isDirectory()) {
        if (!isIgnoredDirectory(child.name, ignored)) await walk(resolve(directory, child.name))
      } else if (child.isFile()) {
        files.push(resolve(directory, child.name))
      }
    }
  }
  await walk(resolve(input))
  return files
}

/**
 * Scan local files or directories. Symlinks are not followed, and no network APIs are
 * used. Inputs are sorted and findings are returned in stable path/offset order.
 */
export const scanPaths = async (
  inputs: readonly string[],
  options: SecretScanOptions = {},
): Promise<SecretScanResult> => {
  if (inputs.length === 0) throw new Error('secret scan requires at least one local path')
  const cwd = resolve(options.cwd ?? process.cwd())
  const maxFileBytes = options.max_file_bytes ?? DEFAULT_MAX_FILE_BYTES
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) throw new Error('max_file_bytes must be a positive safe integer')
  const ignored = new Set(options.ignored_directories ?? DEFAULT_IGNORED_DIRECTORIES)
  const fileBases = new Map<string, string>()
  for (const input of inputs) {
    const absoluteInput = resolve(cwd, input)
    const inputStat = await lstat(absoluteInput)
    const base = inputStat.isDirectory() ? absoluteInput : dirname(absoluteInput)
    for (const file of await collectFiles(absoluteInput, ignored)) fileBases.set(file, fileBases.get(file) ?? base)
  }
  const files = [...fileBases.keys()].sort()
  const findings: SecretScanFinding[] = []
  let bytesScanned = 0
  let filesScanned = 0
  for (const file of files) {
    const bytes = await readFile(file)
    if (bytes.byteLength > maxFileBytes || binary(bytes)) continue
    filesScanned += 1
    bytesScanned += bytes.byteLength
    findings.push(...scanText(bytes.toString('utf8'), relativeDisplayPath(file, fileBases.get(file) ?? cwd)))
  }
  findings.sort((left, right) => left.path.localeCompare(right.path) || left.offset - right.offset || left.rule_id.localeCompare(right.rule_id))
  return { files_scanned: filesScanned, bytes_scanned: bytesScanned, findings, passed: findings.length === 0 }
}

const usage = 'Usage: pnpm exec tsx scripts/phase1/secret-scan.ts [--cwd <dir>] [--max-file-bytes <n>] [--ignore-dir <name>] <path ...>'

export const parseArgs = (args: readonly string[]): { paths: string[]; options: SecretScanOptions } => {
  const paths: string[] = []
  let cwd: string | undefined
  let maxFileBytes: number | undefined
  const ignoredDirectories: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--cwd') {
      cwd = args[++index]
      if (cwd === undefined) throw new Error(usage)
    } else if (arg === '--max-file-bytes') {
      const value = args[++index]
      if (value === undefined) throw new Error(usage)
      maxFileBytes = Number(value)
      if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) throw new Error(usage)
    } else if (arg === '--ignore-dir') {
      const value = args[++index]
      if (value === undefined || value.length === 0 || value.includes('/') || value.includes('\\')) throw new Error(usage)
      ignoredDirectories.push(value)
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${usage}\n`)
      return { paths: [], options: {} }
    } else if (arg.startsWith('-')) {
      throw new Error(usage)
    } else {
      paths.push(arg)
    }
  }
  if (paths.length === 0) throw new Error(usage)
  return {
    paths,
    options: {
      cwd,
      max_file_bytes: maxFileBytes,
      ignored_directories: ignoredDirectories.length > 0
        ? [...new Set([...DEFAULT_IGNORED_DIRECTORIES, ...ignoredDirectories])]
        : undefined,
    },
  }
}

export const main = async (args = process.argv.slice(2)): Promise<number> => {
  try {
    const parsed = parseArgs(args)
    if (parsed.paths.length === 0) return 0
    const result = await scanPaths(parsed.paths, parsed.options)
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return result.passed ? 0 : 1
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'secret scan failed'}\n`)
    return 2
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = await main()
  process.exitCode = exitCode
}
