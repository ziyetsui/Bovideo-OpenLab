import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseArgs, scanPaths, scanText } from '@/../scripts/phase1/secret-scan'

const poison = Array.from({ length: 20 }, (_, index) =>
  ['P1', 'T09', 'SAMPLE', String(index).padStart(2, '0'), 'x'.repeat(16)].join('-'),
)

const field = (...parts: string[]) => parts.join('_')
const header = (...parts: string[]) => parts.join('')

describe('P1-T09 local secret and restricted-data scanner', () => {
  it('accepts additional ignored directories without dropping the safe defaults', () => {
    const parsed = parseArgs(['--ignore-dir', 'reports', '--ignore-dir', 'exports', '.'])

    expect(parsed.paths).toEqual(['.'])
    expect(parsed.options.ignored_directories).toEqual(expect.arrayContaining(['.git', 'node_modules', 'reports', 'exports']))
  })

  it('rejects all 20 dynamically assembled poison samples without retaining their values', () => {
    const sources = [
      `${field('api', 'key')}: "${poison[0]}"`,
      `${header('Author', 'ization')}: ${header('Bearer', ' ', poison[1])}`,
      `${header('Co', 'okie')}: session=${poison[2]}`,
      `${field('raw', 'text')}: "${poison[3]}"`,
      `${field('full', 'prompt')}: "${poison[4]}"`,
      `${field('localized', 'full', 'text')}: "${poison[5]}"`,
      `${field('private', 'evidence')}: "${poison[6]}"`,
      `secret = "${poison[7]}"`,
      `password = "${poison[8]}"`,
      `credential = "${poison[9]}"`,
      `access_token = "${poison[10]}"`,
      `${header('Set-', 'Cook', 'ie')}: sid=${poison[11]}`,
      `${header('author', 'ization')} = "${poison[12]}"`,
      `raw_content = "${poison[13]}"`,
      `third_party_raw = "${poison[14]}"`,
      `${field('private', 'r2', 'signed', 'url')} = "https://local.invalid/?sig=${poison[15]}"`,
      `token: "${poison[16]}"`,
      `api-key: "${poison[17]}"`,
      `client_secret: "${poison[18]}"`,
      `${['', 'Users', 'operator', 'exports'].join('/')}/${poison[19]}.json`,
    ]

    const findings = sources.flatMap((source, index) => scanText(source, `fixture-${index}.log`))

    expect(findings.length).toBeGreaterThanOrEqual(20)
    expect(findings.every((finding) => Object.keys(finding).sort().join(',') === 'match_digest,offset,path,rule_id,severity')).toBe(true)
    expect(JSON.stringify(findings)).not.toContain(poison.join(''))
    for (const sample of poison) expect(JSON.stringify(findings)).not.toContain(sample)
    expect(new Set(findings.map((finding) => finding.rule_id))).toEqual(
      new Set(['credential', 'authorization', 'cookie', 'restricted-text', 'absolute-path']),
    )
  })

  it('scans local source/report/log/trace/export trees deterministically and returns relative paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'p1-t09-secret-scan-'))
    await mkdir(join(root, 'source'))
    await mkdir(join(root, 'reports'))
    await mkdir(join(root, 'logs'))
    await mkdir(join(root, 'traces'))
    await mkdir(join(root, 'exports'))
    await writeFile(join(root, 'source', 'safe.ts'), 'export const value = 1\n')
    await writeFile(join(root, 'reports', 'unsafe.json'), JSON.stringify({ [field('raw', 'text')]: ['P1', 'T09', 'restricted', 'value'].join('-') }))
    await writeFile(join(root, 'logs', 'unsafe.log'), `${header('author', 'ization')}: ${header('Bearer', ' ', ['P1', 'T09', 'credential', 'value'].join('-'))}\n`)
    await writeFile(join(root, 'traces', 'unsafe.trace'), `${header('Co', 'okie')}: sid=${['P1', 'T09', 'cookie', 'value'].join('-')}\n`)
    await writeFile(join(root, 'exports', 'unsafe.txt'), `${['', 'home', 'operator', 'private', 'export.json'].join('/')}\n`)

    const first = await scanPaths([root])
    const second = await scanPaths([root])

    expect(first).toEqual(second)
    expect(first.files_scanned).toBe(5)
    expect(first.findings.map(({ path }) => path)).toEqual([
      'exports/unsafe.txt',
      'logs/unsafe.log',
      'reports/unsafe.json',
      'traces/unsafe.trace',
    ])
    expect(first.findings.every(({ path }) => !path.startsWith('/'))).toBe(true)
  })

  it('returns a clean pass for synthetic content and skips binary files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'p1-t09-secret-scan-clean-'))
    await writeFile(join(root, 'safe.md'), 'Synthetic first-party fixture only.\n')
    await writeFile(join(root, 'image.bin'), Buffer.from([0, 1, 2, 3, 4]))

    const result = await scanPaths([root])

    expect(result).toMatchObject({ files_scanned: 1, findings: [], passed: true })
  })
})
