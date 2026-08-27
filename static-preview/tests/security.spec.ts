import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { scanPreview } from '../src/scan'

const temporaryDirectories: string[] = []
const joinParts = (...parts: readonly string[]): string => parts.join('')
const previewFile = 'en/prompts/index.html'

async function writePoison(path: string, contents: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pvb-security-'))
  temporaryDirectories.push(root)
  const destination = join(root, path)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, contents, 'utf8')
  return root
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('static Preview security scanner', () => {
  it('rejects dynamically assembled poison samples with their relevant rules and redacted findings', async () => {
    const samples = [
      ['.env.preview', 'x', ['environment-file']],
      [joinParts('b', 'uild/styles.css.map'), 'x', ['build-or-source-path', 'source-map']],
      [joinParts('dump', '.sql.log.zip'), 'x', ['database-or-dump', 'log-or-archive']],
      [joinParts('fun', 'ctions/worker.js'), 'x', ['forbidden-runtime-path']],
      [joinParts('_wor', 'ker.js'), 'x', ['forbidden-runtime-path']],
      [joinParts('Ad', 'min/index.html'), 'x', ['forbidden-runtime-path']],
      [joinParts('a', 'pi/index.html'), 'x', ['forbidden-runtime-path']],
      [joinParts('Graph', 'QL/index.html'), 'x', ['forbidden-runtime-path']],
      ['en/prompts/synthetic-prompt-021/index.html', 'x', ['file-not-allow-listed']],
      [previewFile, joinParts('/', 'etc', '/local-only.conf'), ['absolute-local-path']],
      [previewFile, joinParts('person', '@', 'company.test'), ['non-example-pii']],
      [previewFile, joinParts('s', 'k', '-', 'proj', '-', 'preview', 'Only', 'Not', 'AReal', 'Credential', 'Value'), ['openai-api-key']],
      [previewFile, joinParts('gh', 'p', '_', 'preview', 'Only', 'Not', 'AReal', 'Credential', 'Value'), ['github-token']],
      [previewFile, joinParts('+', '86', ' ', '138', ' ', '1234', ' ', '5678'), ['phone-number']],
      [previewFile, joinParts('session', '_', 'id', '=', 'preview', 'Only', 'Not', 'AReal', 'Cookie', 'Value'), ['session-cookie']],
      [previewFile, joinParts('private', 'Handle', ': @', 'preview', '_', 'only'), ['private-handle']],
      [previewFile, joinParts('123', ' ', 'Preview', ' ', 'Street'), ['postal-address']],
      [previewFile, joinParts('third', '_', 'party', ' full prompt'), ['unauthorized-third-party-content']],
      [previewFile, joinParts('copied', ' media'), ['unauthorized-third-party-content']],
      [previewFile, joinParts('ignore', ' previous instructions'), ['prompt-injection-marker']],
      [previewFile, joinParts('<link rel="alternate" hreflang="xx', '-', 'ZZ">'), ['unsupported-hreflang']],
      [previewFile, joinParts('provider', 'Id: duplicate-preview-record'), ['private-source-or-audit-field']],
      [previewFile, joinParts('not', '_', 'generated -> indexable'), ['forbidden-publication-transition']],
      [previewFile, joinParts('github', 'Export: newly-added-field'), ['github-export-field']],
      [previewFile, joinParts('api', 'Key', ':', 'not-a-real-value'), ['secret-assignment']],
      [previewFile, joinParts('api', 'Key', ': ', "'", 'not-a-real-value', "'"), ['secret-assignment']],
      [previewFile, joinParts('{"', 'api', 'Key', '":"', 'not-a-real-value', '"}'), ['secret-assignment']],
      [previewFile, joinParts('Author', 'ization', ': ', 'Bearer ', 'not-a-real-value'), ['authorization-credential']],
      [previewFile, joinParts('Author', 'ization', ': ', "'", 'Bearer ', 'not-a-real-value', "'"), ['authorization-credential']],
      [previewFile, joinParts('{"', 'Author', 'ization', '":"', 'Bearer ', 'not-a-real-value', '"}'), ['authorization-credential']],
      [previewFile, joinParts('x-', 'rapid', 'api-', 'key', ': ', 'not-a-real-value'), ['rapidapi-credential']],
      [previewFile, joinParts('x-', 'rapid', 'api-', 'key', ': ', '"', 'not-a-real-value', '"'), ['rapidapi-credential']],
      [previewFile, joinParts('{"x-', 'rapid', 'api-', 'key', '":"', 'not-a-real-value', '"}'), ['rapidapi-credential']],
      [previewFile, joinParts('href=', '/', 'etc', '/local-only.conf'), ['absolute-local-path']],
      [previewFile, joinParts('body{background:', 'url', '(', '/', 'etc', '/local-only.conf', ')}'), ['absolute-local-path']],
      [previewFile, joinParts('file', ':', '///', 'etc', '/local-only.conf'), ['absolute-local-path']],
      [previewFile, joinParts('/', 'var', '/local\n', '/', 'Library', '/local\n', '/', 'private', '/local'), ['absolute-local-path']],
      [previewFile, joinParts('"', 'raw', '"', ':true\n', '"', 'private', '"', ':true\n', 'rights', 'Code: third_party'), ['raw-field', 'private-field', 'unsafe-rights']],
      [previewFile, joinParts('https', '://not-approved.example/path'), ['external-url']],
      [
        previewFile,
        joinParts(
          'im', 'port', ' ', "'", 'payload', "'", '\n',
          'im', 'port', '(', "'", 'next', "'", ')', '\n',
          'req', 'uire', '(', "'", 'wrangler', "'", ')', '\n',
          'process', '.', 'env', '.PREVIEW', '\n',
          'Deno', '.', 'env', '.get', '(', "'", 'PREVIEW', "'", ')',
        ),
        ['runtime-import', 'environment-access'],
      ],
    ] as const

    const findingsBySample = await Promise.all(samples.map(async ([path, contents]) => scanPreview(await writePoison(path, contents))))

    expect(findingsBySample.length).toBeGreaterThanOrEqual(20)
    expect(findingsBySample.every((findings) => findings.length > 0)).toBe(true)

    for (const [index, findings] of findingsBySample.entries()) {
      const ruleIds = findings.map(({ ruleId }) => ruleId)
      for (const expectedRule of samples[index]![2]) {
        expect(ruleIds).toContain(expectedRule)
      }
      for (const finding of findings) {
        expect(Object.keys(finding).sort()).toEqual(['matchSha256', 'offset', 'path', 'ruleId', 'severity'])
        expect(finding.matchSha256).toMatch(/^[a-f0-9]{64}$/)
        expect(finding.matchSha256).not.toBe(createHash('sha256').update('not-a-real-value').digest('hex'))
        expect(finding.path.startsWith('/')).toBe(false)
        expect(finding.offset).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('rejects high-confidence private runtime, credential, and multilingual PII forms in an allow-listed executable asset', async () => {
    // This must fail if scan.ts stops recognising the listed public-leak classes.
    const root = await writePoison(
      'assets/menu.js',
      [
        joinParts('-----BEGIN ', 'PRIVATE ', 'KEY-----\n', 'cHJldmlldy1vbmx5LW5vdC1hLXByaXZhdGUta2V5LWJvZHk=\n', '-----END ', 'PRIVATE ', 'KEY-----'),
        joinParts('eyJhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiJwcmV2aWV3LXRlc3QifQ', '.', 'preview_signature_value_which_is_long_enough'),
        joinParts('im', 'port ', 'Payload ', 'from ', "'", '@payloadcms/next', "'"),
        joinParts('const ', 'cms', ' = ', 'req', 'uire', "('@payloadcms/db-d1-sqlite')"),
        joinParts('im', 'port ', 'payload ', 'from ', "'", 'payload', "'"),
        joinParts('const ', 'cms', ' = ', 'req', 'uire', "('payload')"),
        joinParts('const ', 'payload', ' = ', 'get', 'Payload', '()'),
        joinParts('new ', 'Payload', '()'),
        joinParts('contact ', '@', 'private_preview_handle'),
        joinParts('地址：北京市朝阳区建国路', '88', '号 ', '100020'),
        joinParts('郵便番号：〒', '150', '-', '0001 東京都渋谷区'),
        joinParts('العنوان: شارع التحرير ', '١٢', '، القاهرة ', '١١٥١١'),
        joinParts('+', '٩٧١', ' ', '٥٠', ' ', '١٢٣', ' ', '٤٥٦٧'),
        joinParts('rapid', 'api', 'Config = true'),
      ].join('\n'),
    )

    const findings = await scanPreview(root)
    const ruleIds = findings.map(({ ruleId }) => ruleId)

    expect(ruleIds).toEqual(expect.arrayContaining([
      'pem-private-key',
      'jwt-credential',
      'runtime-import',
      'private-runtime-identifier',
      'private-handle',
      'postal-address',
      'runtime-config',
    ]))
    expect(findings.every((finding) => finding.path === 'assets/menu.js')).toBe(true)
  })

  it('recognizes each supported non-Latin postal-address variant independently', async () => {
    // This must fail if a Unicode postal form is dropped while another one masks the coverage gap.
    const samples = [
      joinParts('地址：北京市朝阳区建国路', '88', '号 ', '100020'),
      joinParts('郵便番号：〒', '150', '-', '0001 東京都渋谷区'),
      joinParts('العنوان: شارع التحرير ', '١٢', '، القاهرة ', '١١٥١١'),
    ]

    for (const contents of samples) {
      const findings = await scanPreview(await writePoison('assets/menu.js', contents))
      expect(findings.map(({ ruleId }) => ruleId)).toContain('postal-address')
    }
  })

  it('rejects private-runtime ESM re-exports and comment-separated import forms without serializing module text', async () => {
    // This must fail if a re-export or comment-separated runtime import bypasses the static boundary.
    const samples = [
      joinParts('ex', 'port { cookies } from ', "'", 'next/headers', "'"),
      joinParts('ex', 'port * from ', "'", '@payloadcms/next', "'"),
      joinParts('ex', 'port type { Config } from ', "'", 'payload', "'"),
      joinParts('ex', 'port /* reviewed */ { getPayload } /* approved */ from /* reviewed */ ', "'", '@payloadcms/db-d1-sqlite', "'"),
      joinParts('im', 'port /* reviewed */ ( /* reviewed */ ', "'", '@payloadcms/next', "'", ' )'),
      joinParts('req', 'uire /* reviewed */ ( /* reviewed */ ', "'", 'payload', "'", ' )'),
    ]

    for (const contents of samples) {
      const findings = await scanPreview(await writePoison('assets/menu.js', contents))
      const serialized = JSON.stringify(findings)

      expect(findings.map(({ ruleId }) => ruleId)).toContain('runtime-import')
      expect(serialized).not.toContain('next/headers')
      expect(serialized).not.toContain('@payloadcms')
      expect(serialized).not.toContain("'payload'")
    }
  })

  it('rejects combined, namespace, and arbitrarily long private-runtime ESM clauses', async () => {
    // This must fail if legal ESM clause shapes or length evade the private-runtime boundary.
    const longNames = Array.from({ length: 160 }, (_, index) => `syntheticMember${index}`).join(', ')
    const samples = [
      joinParts('im', 'port Next, { cookies } from ', "'", 'next/headers', "'"),
      joinParts('im', 'port /* reviewed */ Next, /* reviewed */ { cookies } /* reviewed */ from ', "'", '@payloadcms/next', "'"),
      joinParts('im', 'port * as NextRuntime from ', "'", 'next', "'"),
      joinParts('ex', 'port * as NextRuntime from ', "'", 'next', "'"),
      joinParts('im', 'port { ', longNames, ' } from ', "'", '@payloadcms/next', "'"),
      joinParts('ex', 'port { ', longNames, ' } from ', "'", 'payload', "'"),
    ]

    for (const contents of samples) {
      const findings = await scanPreview(await writePoison('assets/menu.js', contents))
      expect(findings.map(({ ruleId }) => ruleId)).toContain('runtime-import')
      expect(JSON.stringify(findings)).not.toContain('syntheticMember')
    }
  })

  it('does not classify ordinary prose as a runtime import', async () => {
    // This must fail if broad clause matching loses its syntactic module-specifier boundary.
    const root = await writePoison('assets/menu.js', 'Export your work from a local source, then import next steps into the preview checklist.')

    expect(await scanPreview(root)).toEqual([])
  })

  it('rejects JSON session credentials and Windows absolute paths without serializing values', async () => {
    // This must fail if JSON delimiters or Windows path syntax bypasses the public-output scanner.
    const sessionValue = joinParts('preview', 'Only', 'Session', 'Value', '123')
    const samples = [
      [joinParts('{"session', '_id":"', sessionValue, '"}'), 'session-cookie'],
      [joinParts("{'session", "-id':'", sessionValue, "'}"), 'session-cookie'],
      [joinParts('{"connect', '.sid":"', sessionValue, '"}'), 'session-cookie'],
      [joinParts('C:', '\\', 'Users', '\\', 'alice', '\\', 'private-preview.txt'), 'absolute-local-path'],
      [joinParts('\\', '\\', 'private-host', '\\', 'share', '\\', 'preview.txt'), 'absolute-local-path'],
    ] as const

    for (const [contents, expectedRule] of samples) {
      const findings = await scanPreview(await writePoison('assets/menu.js', contents))
      const serialized = JSON.stringify(findings)

      expect(findings.map(({ ruleId }) => ruleId)).toContain(expectedRule)
      expect(serialized).not.toContain(sessionValue)
      expect(serialized).not.toContain('C:\\Users')
      expect(serialized).not.toContain('private-host')
    }
  })

  it('redacts credential and PII path components before findings are serialized', async () => {
    // This must fail if a reporting path can expose the sensitive filename component.
    const credentialComponent = joinParts('sk', '-', 'proj', '-', 'path', 'Only', 'Not', 'AReal', 'Credential', 'Value')
    const piiComponent = joinParts('person', '@', 'company.test')
    const root = await writePoison(join('leaks', credentialComponent, `${piiComponent}.txt`), 'x')

    const findings = await scanPreview(root)
    const serialized = JSON.stringify(findings)

    expect(findings.length).toBeGreaterThan(0)
    expect(serialized).not.toContain(credentialComponent)
    expect(serialized).not.toContain(piiComponent)
    expect(findings.some(({ path }) => path.includes('[redacted-sha256:'))).toBe(true)
  })

  it('does not treat standard CSS at-rules as private handles', async () => {
    // This must fail if the standalone-handle rule starts treating executable CSS syntax as a user handle.
    const root = await writePoison('assets/styles.css', '@font-face { font-family: preview; }\n@media (min-width: 1px) {}\n@keyframes preview {}')

    expect(await scanPreview(root)).toEqual([])
  })
})
