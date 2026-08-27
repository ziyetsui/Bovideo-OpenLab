import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { PREVIEW_ROUTES } from '../fixtures/routes'
import { APPLICATION_LOCALES } from './contracts'
import { outputPath, routePath } from './paths'
import { sha256 } from './tree'

export type RedactedFinding = Readonly<{
  ruleId: string
  path: string
  offset: number
  matchSha256: string
  severity: 'error'
}>

type Rule = Readonly<{ ruleId: string; expression: RegExp; accepts?: (match: string) => boolean }>

const allowedFiles = new Set([
  'assets/menu.js',
  'assets/OUTFIT-OFL-1.1.txt',
  'assets/outfit-latin-wght-normal.woff2',
  'assets/styles.css',
  '_headers',
  '_redirects',
  'robots.txt',
  '404.html',
  'preview-manifest.json',
])
const allowedRouteFiles = new Set(
  APPLICATION_LOCALES.flatMap((locale) => PREVIEW_ROUTES.map((route) => outputPath(locale, route).replace(/^\//, ''))),
)
const allowedRootRelativePaths = new Set([
  '/#main',
  '/assets/menu.js',
  '/assets/OUTFIT-OFL-1.1.txt',
  '/assets/outfit-latin-wght-normal.woff2',
  '/assets/styles.css',
  ...APPLICATION_LOCALES.flatMap((locale) => PREVIEW_ROUTES.map((route) => routePath(locale, route))),
])
const allowedExternalUrl = 'https://github.com/ziyetsui/Bovideo-OpenLab'
const codeGap = String.raw`(?:\s|/\*[\s\S]*?\*/|//[^\r\n]*(?:\r?\n|$))*`
const privateRuntimeSpecifier = String.raw`(?:@payloadcms(?:\/[^"']*)?|payload(?:\/[^"']*)?|@opennextjs(?:\/[^"']*)?|next(?:\/[^"']*)?|@cloudflare(?:\/[^"']*)?|cloudflare(?:\/[^"']*)?|wrangler(?:\/[^"']*)?)`
const esmNamedClause = String.raw`\{[^}]*\}`
const esmImportClause = String.raw`import${codeGap}(?:type${codeGap})?(?:[A-Za-z_$][\w$]*(?:${codeGap},${codeGap}(?:\*${codeGap}as${codeGap}[A-Za-z_$][\w$]*|${esmNamedClause}))?|\*${codeGap}as${codeGap}[A-Za-z_$][\w$]*|${esmNamedClause})${codeGap}from`
const esmExportClause = String.raw`export${codeGap}(?:type${codeGap})?(?:\*(?:${codeGap}as${codeGap}[A-Za-z_$][\w$]*)?|${esmNamedClause})${codeGap}from`
const runtimeImportExpression = new RegExp(
  String.raw`\b(?:` +
    String.raw`(?:import${codeGap}(?:\(${codeGap})?|require${codeGap}\(${codeGap})` +
    String.raw`|(?:${esmImportClause}|${esmExportClause})${codeGap}` +
    String.raw`)["']${privateRuntimeSpecifier}["']`,
  'gi',
)

function isAllowedRootRelativeMatch(match: string): boolean {
  const path = match.trim().replace(/^(?:file:)?["'=()\s]*/, '')
  return allowedRootRelativePaths.has(path)
}

const contentRules: readonly Rule[] = [
  {
    ruleId: 'absolute-local-path',
    expression: /(?:file:\/\/\/[^\s"'<>)]*|(?:^|["'=()\s])(?:\/[A-Za-z0-9._-]+(?:\/[^\s"'<>)]*)?|[A-Za-z]:[\\/][^\s"'<>)]*|\\\\[^\\/\s]+[\\/][^\s"'<>)]*))/g,
    accepts: isAllowedRootRelativeMatch,
  },
  { ruleId: 'non-example-pii', expression: /\b[A-Z0-9._%+-]+@(?!(?:example\.com|example\.org)\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { ruleId: 'openai-api-key', expression: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { ruleId: 'github-token', expression: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { ruleId: 'pem-private-key', expression: /-----BEGIN\s+(?:(?:[A-Z0-9]+\s+){0,3})?PRIVATE\s+KEY-----/g },
  { ruleId: 'jwt-credential', expression: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}\b/g },
  {
    ruleId: 'phone-number',
    expression: /(?<![\w.-])(?:\+?[\d٠-٩０-９]{1,3}[ .-]?)?(?:\(?[\d٠-٩０-９]{2,4}\)?[ .-]?){2}[\d٠-٩０-９]{3,4}(?![\w.-])/g,
  },
  {
    ruleId: 'session-cookie',
    expression: /(?:^|[;{,\s])["']?(?:session(?:[_-]?id)?|sid|connect\.sid)["']?\s*[:=]\s*(?:"(?:\\.|[^"]){12,}"|'(?:\\.|[^']){12,}'|[A-Za-z0-9._~+\/-]{12,})/gim,
  },
  {
    ruleId: 'private-handle',
    expression: /(?:\b(?:private[_ -]?(?:handle|user(?:name)?|account)|handle)\s*[:=]\s*["']?|(?<![A-Za-z0-9._%+-])@(?!media\b|font(?:-face|source)?\b|supports\b|keyframes\b|layer\b|container\b|property\b|charset\b|import\b|namespace\b|page\b)[A-Za-z0-9_]{3,}\b)/gi,
  },
  {
    ruleId: 'postal-address',
    expression: /(?:\b\d{1,5}\s+[A-Za-z][A-Za-z .'-]{2,}\s+(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Lane|Ln\.?|Drive|Dr\.?)\b|(?:地址|住址|所在地)\s*[:：]?\s*[\p{Script=Han}]{2,}(?:省|市|区|县|路|街|巷)[\p{Script=Han}\d-]{2,}(?:号|室)?\s*\d{5,6}|(?:住所|郵便番号)\s*[:：]?\s*〒?\d{3}-\d{4}\s*[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}|العنوان\s*[:：]?\s*[\p{Script=Arabic}\s]+[٠-٩]{1,5}[،,\s]+[\p{Script=Arabic}\s]+[٠-٩]{4,6})/giu,
  },
  {
    ruleId: 'unauthorized-third-party-content',
    expression: /\b(?:third[_ -]?party\s+(?:full\s+)?(?:prompt|translation|media)|copied\s+(?:prompt|translation|media))\b/gi,
  },
  {
    ruleId: 'prompt-injection-marker',
    expression: /\b(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior)\s+(?:instructions|rules)\b/gi,
  },
  { ruleId: 'unsupported-hreflang', expression: /\bhreflang\s*=/gi },
  {
    ruleId: 'private-source-or-audit-field',
    expression: /\b(?:provider[_ -]?(?:id|record)|queue(?:[_ -]?message)?|audit(?:[_ -]?(?:record|log))|user(?:[_ -]?(?:id|email|record)))\s*[:=]/gi,
  },
  { ruleId: 'forbidden-publication-transition', expression: /\bnot[_ -]?generated\s*(?:→|->|to)\s*indexable\b/gi },
  { ruleId: 'github-export-field', expression: /\bgithub[_ -]?export\s*[:=]/gi },
  { ruleId: 'secret-assignment', expression: /(?:["']\s*)?\b(?:(?:api|access|auth|payload|session|private)[_-]?(?:secret|token|key)|(?:secret|token|key))(?:\s*["'])?\s*[=:]\s*(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s,;)}\]]+)/gi },
  { ruleId: 'authorization-credential', expression: /(?:["']\s*)?\bauthorization(?:\s*["'])?\s*:\s*(?:"\s*bearer\s+[^"]*"|'\s*bearer\s+[^']*'|bearer\s+[^\s"']+)/gi },
  { ruleId: 'rapidapi-credential', expression: /(?:["']\s*)?\bx-rapidapi-(?:key|host)(?:\s*["'])?\s*:\s*(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s,;)}\]]+)/gi },
  { ruleId: 'raw-field', expression: /["']?raw["']?\s*:\s*true\b/gi },
  { ruleId: 'private-field', expression: /["']?private["']?\s*:\s*true\b/gi },
  { ruleId: 'unsafe-rights', expression: /\brights(?:Code)?\s*[:=]\s*["']?(?:third[_ -]?party|unknown|unsafe)/gi },
  { ruleId: 'external-url', expression: /https?:\/\/[^\s"'<>]+/gi },
  {
    ruleId: 'runtime-import',
    expression: runtimeImportExpression,
  },
  {
    ruleId: 'private-runtime-identifier',
    expression: /\b(?:new\s+Payload\s*\(|(?:const|let|var)\s+payload\s*=\s*(?:get|create)?Payload\s*\(|(?:get|create)Payload\s*\(|Payload\s*\.\s*(?:find|create|update|delete|init)\s*\()/g,
  },
  { ruleId: 'environment-access', expression: /\b(?:process\s*(?:\.\s*env|\[\s*["']env["']\s*\])|Deno\s*\.\s*env|Bun\s*\.\s*env)\b/gi },
  { ruleId: 'runtime-config', expression: /\b(?:wrangler|cloudflare|payload)(?:Config|_config|\.config)?\b/gi },
]

function sensitivePathComponents(path: string): readonly string[] {
  return path.split('/').filter((component) => {
    for (const rule of contentRules) {
      rule.expression.lastIndex = 0
      if ([...component.matchAll(rule.expression)].some((match) => !rule.accepts?.(match[0]))) return true
    }
    return false
  })
}

function redactPath(path: string): string {
  const sensitive = new Set(sensitivePathComponents(path))
  return path.split('/').map((component) => (sensitive.has(component) ? `[redacted-sha256:${sha256(component)}]` : component)).join('/')
}

function pathFinding(ruleId: string, path: string, matchedValue = path): RedactedFinding {
  return { ruleId, path: redactPath(path), offset: 0, matchSha256: sha256(matchedValue), severity: 'error' }
}

function contentFindings(path: string, contents: string): RedactedFinding[] {
  const findings: RedactedFinding[] = []
  for (const rule of contentRules) {
    rule.expression.lastIndex = 0
    for (const match of contents.matchAll(rule.expression)) {
      if ((rule.ruleId === 'external-url' && match[0] === allowedExternalUrl) || rule.accepts?.(match[0])) continue
      findings.push({
        ruleId: rule.ruleId,
        path,
        offset: match.index ?? 0,
        matchSha256: sha256(match[0]),
        severity: 'error',
      })
    }
  }
  return findings
}

function forbiddenPathRules(path: string): string[] {
  const normalized = path.toLowerCase()
  const rules: string[] = []
  if (path.startsWith('/') || /^[a-z]:/i.test(path) || path.includes('../')) rules.push('absolute-or-traversal-path')
  if (normalized.split('/').some((part) => part.startsWith('.env'))) rules.push('environment-file')
  if (normalized.split('/').some((part) => ['build', 'dist', '.next', 'node_modules', 'src'].includes(part))) rules.push('build-or-source-path')
  if (/\.map(?:$|\.)/i.test(normalized)) rules.push('source-map')
  if (/\.(?:db|sqlite|sqlite3|sql)(?:$|\.)/i.test(normalized)) rules.push('database-or-dump')
  if (/\.(?:log|zip|tar|tgz|gz|7z)(?:$|\.)/i.test(normalized)) rules.push('log-or-archive')
  if (normalized.split('/').some((part) => ['functions', 'admin', 'api', 'graphql'].includes(part))) rules.push('forbidden-runtime-path')
  if (normalized.split('/').some((part) => part === '_worker.js')) rules.push('forbidden-runtime-path')
  if (!allowedFiles.has(path) && !allowedRouteFiles.has(path)) rules.push('file-not-allow-listed')
  return rules
}

function pathContentFindings(path: string): RedactedFinding[] {
  const findings: RedactedFinding[] = []
  for (const component of path.split('/')) {
    for (const rule of contentRules) {
      rule.expression.lastIndex = 0
      for (const match of component.matchAll(rule.expression)) {
        if (rule.accepts?.(match[0])) continue
        findings.push(pathFinding(rule.ruleId, path, match[0]))
      }
    }
  }
  return findings
}

function isScannableTextFile(path: string): boolean {
  return allowedRouteFiles.has(path) || ['assets/menu.js', 'assets/styles.css', '_headers', 'robots.txt', '404.html', 'preview-manifest.json'].includes(path)
}

export async function scanPreview(root: string): Promise<readonly RedactedFinding[]> {
  const findings: RedactedFinding[] = []

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      const absolutePath = join(directory, entry.name)
      const path = relative(root, absolutePath).replaceAll('\\', '/')
      if (entry.isDirectory()) {
        await visit(absolutePath)
        continue
      }
      if (!entry.isFile()) {
        findings.push(pathFinding('non-regular-file', path))
        continue
      }
      findings.push(...forbiddenPathRules(path).map((ruleId) => pathFinding(ruleId, path)))
      findings.push(...pathContentFindings(path))
      if (isScannableTextFile(path)) findings.push(...contentFindings(path, await readFile(absolutePath, 'utf8')))
    }
  }

  await visit(root)
  return findings.sort((left, right) =>
    left.path.localeCompare(right.path, 'en') || left.offset - right.offset || left.ruleId.localeCompare(right.ruleId, 'en'),
  )
}
