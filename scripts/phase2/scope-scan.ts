import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'

export const SCOPE_COUNTER_NAMES = Object.freeze([
  'valid_credentials', 'restricted_data_leaks', 'absolute_paths', 'undeclared_network_calls',
  'remote_mutations', 'public_listeners', 'indexable_urls', 'github_mutations',
  'cloudflare_mutations', 'gsc_calls', 'production_sitemap_urls', 'remote_telemetry_calls',
] as const)

export type ScopeCounterName = (typeof SCOPE_COUNTER_NAMES)[number]
export type ScopeCounters = Readonly<Record<ScopeCounterName, number>>
export interface ScopeIssue { code: string; path: string; message: string; fingerprint?: string }
export interface ScopeScanResult { ok: boolean; counters: ScopeCounters; errors: ScopeIssue[]; files: string[] }
export interface ScopeAllowlistedFinding { path: string; code: string; fingerprint: string }
export interface ScopeScanInput { cwd?: string; files?: Record<string, string>; paths?: readonly string[]; allowlistedFindings?: readonly ScopeAllowlistedFinding[] }

const emptyCounters = (): Record<ScopeCounterName, number> => Object.fromEntries(SCOPE_COUNTER_NAMES.map((name) => [name, 0])) as Record<ScopeCounterName, number>
const add = (errors: ScopeIssue[], counters: Record<ScopeCounterName, number>, name: ScopeCounterName, code: string, path: string, message: string, count = 1, fingerprint?: string): void => {
  counters[name] += count
  errors.push({ code, path, message, ...(fingerprint === undefined ? {} : { fingerprint }) })
}

export const validateScopeCounters = (value: unknown): { ok: boolean; errors: ScopeIssue[] } => {
  const errors: ScopeIssue[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, errors: [{ code: 'COUNTERS_INVALID', path: '$', message: 'scope counters must be an object' }] }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (keys.join(',') !== [...SCOPE_COUNTER_NAMES].sort().join(',')) errors.push({ code: 'COUNTER_KEYS_INVALID', path: '$', message: 'scope counters must contain exactly the canonical twelve keys' })
  for (const name of SCOPE_COUNTER_NAMES) if (typeof record[name] !== 'number' || !Number.isInteger(record[name]) || record[name] !== 0) errors.push({ code: 'COUNTER_NONZERO', path: name, message: 'local scope counters must be literal numeric zero' })
  return { ok: errors.length === 0, errors }
}

const isSafeLoopback = (value: string): boolean => /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(value)
const isProtocolUrl = (value: string): boolean => /^https?:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9$/i.test(value)
const scanText = (path: string, text: string, counters: Record<ScopeCounterName, number>, errors: ScopeIssue[], isAllowlisted: (path: string, code: string, fingerprint: string) => boolean = () => false): void => {
  const report = (name: ScopeCounterName, code: string, message: string, fingerprint: string, count = 1): void => { if (!isAllowlisted(path, code, fingerprint)) add(errors, counters, name, code, path, message, count, fingerprint) }
  const reportAll = (name: ScopeCounterName, code: string, message: string, findings: string[]): void => {
    if (findings.length) report(name, code, message, findings.join('\n'), findings.length)
  }
  const credential = /(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|(?:api[-_]?key|token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{12,}|authorization\s*:\s*bearer\s+[A-Za-z0-9._-]{12,})/gi
  const credentials = text.match(credential) ?? []
  if (credentials.length) report('valid_credentials', 'CREDENTIAL_PRESENT', 'credential-like material is forbidden', credentials.join('\n'), credentials.length)
  const restricted = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:session|cookie|authorization)\s*[:=]\s*["']?[A-Za-z0-9._=-]{8,}|third[- ]party full text|raw restricted|private handle)/gi
  const restrictedHits = text.match(restricted) ?? []
  if (restrictedHits.length) report('restricted_data_leaks', 'RESTRICTED_DATA', 'restricted or personal data pattern is forbidden', restrictedHits.join('\n'), restrictedHits.length)
  const absolute = /(?:^|["'\s])\/(?:Users|home|private|var\/folders|tmp|opt|etc)\/[A-Za-z0-9._~ -]+/g
  const absoluteHits = text.match(absolute) ?? []
  if (absoluteHits.length) report('absolute_paths', 'ABSOLUTE_PATH', 'absolute filesystem paths are forbidden', absoluteHits.join('\n'), absoluteHits.length)
  const urls = [...text.matchAll(/https?:\/\/[^\s"'<>`)\\]+/gi)].map((match) => match[0])
  const remoteUrls = urls.filter((url) => !isSafeLoopback(url) && !isProtocolUrl(url))
  const networkCall = text.match(/(?<!\.)\bfetch\s*\(|\baxios\.|\bgot\s*\(|\bundici\./i)?.[0]
  if (remoteUrls.length) reportAll('undeclared_network_calls', 'NETWORK_SCOPE', 'non-loopback or undeclared network access is forbidden', remoteUrls)
  else if (networkCall && !/injection boundary|declared transport/i.test(text)) report('undeclared_network_calls', 'NETWORK_SCOPE', 'non-loopback or undeclared network access is forbidden', networkCall)
  reportAll('github_mutations', 'GITHUB_SCOPE', 'GitHub access is forbidden in P2-L', [...text.matchAll(/(?:github\.com|api\.github)\s*(?:\.|\/|\(|:|=)/gi)].map((match) => match[0]))
  reportAll('cloudflare_mutations', 'CLOUDFLARE_SCOPE', 'Cloudflare/R2 access is forbidden in P2-L', [...text.matchAll(/(?:cloudflare|wrangler|r2\.)\s*(?:\.|\/|\(|:|=)/gi)].map((match) => match[0]))
  reportAll('gsc_calls', 'GSC_SCOPE', 'GSC access is forbidden in P2-L', [...text.matchAll(/(?:gsc|search console)\s*(?:\.|\/|\(|:|=)/gi)].map((match) => match[0]))
  const listeners = [...text.matchAll(/listen\s*\([^)]*?(["'])([^"']+)\1/gi)].map((match) => match[2])
  const publicListeners = listeners.filter((host) => !/^(?:localhost|127\.0\.0\.1|::1)$/i.test(host))
  if (/0\.0\.0\.0|\[::\]|(?:^|["'])::(?:["'])/i.test(text)) publicListeners.push('wildcard')
  if (publicListeners.length) report('public_listeners', 'PUBLIC_LISTENER', 'non-loopback listener is forbidden', publicListeners.join('\n'), publicListeners.length)
  reportAll('indexable_urls', 'INDEXABLE_OUTPUT', 'indexable/canonical output is forbidden in P2-L', [...text.matchAll(/(?:indexable\s*[:=]\s*true|<link[^>]+canonical|hreflang|<url(?:\s|>))/gi)].map((match) => match[0]))
  const sitemapCount = [...text.matchAll(/(?:url_count|production_sitemap_urls)\s*[=:]\s*(\d+)/gi)].reduce((sum, match) => sum + Number(match[1] ?? 0), 0)
  const sitemapFindings = [...text.matchAll(/(?:url_count|production_sitemap_urls)\s*[=:]\s*[1-9]\d*|<sitemap(?:\s|>)/gi)].map((match) => match[0])
  if (sitemapCount > 0 || sitemapFindings.length) reportAll('production_sitemap_urls', 'SITEMAP_OUTPUT', 'production Sitemap entries are forbidden', sitemapFindings.length ? sitemapFindings : ['production-sitemap'])
  if (!/remote_telemetry_calls\s*[:=]\s*0/i.test(text)) reportAll('remote_telemetry_calls', 'REMOTE_TELEMETRY', 'remote telemetry is forbidden in P2-L', [...text.matchAll(/(?:telemetry|opentelemetry|sentry|datadog)\s*(?:\.|\/|\(|:|=)/gi)].map((match) => match[0]))
  reportAll('remote_mutations', 'REMOTE_MUTATION', 'remote mutations are forbidden in P2-L', [...text.matchAll(/\b(?:delete|put|post|patch)\s+https?:\/\/|remote_mutations\s*[:=]\s*[1-9]/gi)].map((match) => match[0]))
  reportAll('undeclared_network_calls', 'REVERSE_STATIC_IMPORT', 'P2-L may not import from static-preview', [...text.matchAll(/(?:from|import)\s+["'][^"']*static-preview\//gi)].map((match) => match[0]))
}

const collectFiles = (cwd: string, paths: readonly string[]): Record<string, string> => {
  const output: Record<string, string> = {}
  const visit = (relativePath: string): void => {
    const absolute = resolve(cwd, relativePath)
    if (!existsSync(absolute)) return
    const stat = statSync(absolute)
    if (stat.isFile()) output[relative(cwd, absolute).split('\\').join('/')] = readFileSync(absolute, 'utf8')
    else if (stat.isDirectory()) for (const child of readdirSync(absolute)) visit(`${relativePath}/${child}`)
  }
  for (const path of paths) visit(path)
  return output
}

export const scanScope = (input: ScopeScanInput = {}): ScopeScanResult => {
  const cwd = resolve(input.cwd ?? process.cwd())
  const files = input.files ?? collectFiles(cwd, input.paths ?? ['src', 'scripts/phase2', 'tests/phase2', 'package.json'])
  const allowlistedFindings = new Set((input.allowlistedFindings ?? []).map(({ path, code, fingerprint }) => `${path}|${code}|${fingerprint}`))
  const counters = emptyCounters()
  const errors: ScopeIssue[] = []
  for (const path of Object.keys(files).sort()) scanText(path, files[path] ?? '', counters, errors, (filePath, code, fingerprint) => allowlistedFindings.has(`${filePath}|${code}|${fingerprint}`))
  return { ok: errors.length === 0 && validateScopeCounters(counters).ok, counters, errors, files: Object.keys(files).sort() }
}

export const scanScopeCounters = scanScope
