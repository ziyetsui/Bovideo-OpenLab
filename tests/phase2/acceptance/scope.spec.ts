import { describe, expect, it } from 'vitest'

import {
  SCOPE_COUNTER_NAMES,
  scanScope,
  validateScopeCounters,
} from '../../../scripts/phase2/scope-scan'

describe('P2-T07 local scope scanner', () => {
  it('uses exactly the twelve zero-valued counters', () => {
    expect(SCOPE_COUNTER_NAMES).toHaveLength(12)
    expect(validateScopeCounters(Object.fromEntries(SCOPE_COUNTER_NAMES.map((name) => [name, 0])))).toEqual({ ok: true, errors: [] })
  })

  it('rejects secrets, absolute paths, remote URLs and public listeners', () => {
    const result = scanScope({
      files: {
        'fixture.json': JSON.stringify({ token: 'sk-test-1234567890', path: '/Users/a1/private', url: 'https://api.example.com' }),
        'server.ts': "listen(0, '0.0.0.0')",
      },
    })
    expect(result.counters.valid_credentials).toBeGreaterThan(0)
    expect(result.counters.absolute_paths).toBeGreaterThan(0)
    expect(result.counters.undeclared_network_calls).toBeGreaterThan(0)
    expect(result.counters.public_listeners).toBeGreaterThan(0)
    expect(result.ok).toBe(false)
  })

  it('accepts the declared loopback-only, injection-boundary fixture', () => {
    const result = scanScope({
      files: {
        'transport.ts': "export const transport = (url: string) => url.startsWith('http://127.0.0.1')",
        'fixture.json': JSON.stringify({ source: 'synthetic', network_calls: 0, remote_mutations: 0 }),
      },
    })
    expect(result.ok).toBe(true)
    expect(Object.values(result.counters).every((value) => value === 0)).toBe(true)
  })

  it('requires an exact finding fingerprint for a scope exemption', () => {
    const allowed = scanScope({
      files: { 'fixture.ts': 'export const source = "https://fixture.example.test"' },
      allowlistedFindings: [{ path: 'fixture.ts', code: 'NETWORK_SCOPE', fingerprint: 'https://fixture.example.test' }],
    })
    expect(allowed.ok).toBe(true)

    const changed = scanScope({
      files: { 'fixture.ts': 'export const source = "https://new.example.test"' },
      allowlistedFindings: [{ path: 'fixture.ts', code: 'NETWORK_SCOPE', fingerprint: 'https://fixture.example.test' }],
    })
    expect(changed.ok).toBe(false)
    expect(changed.errors).toEqual([{ code: 'NETWORK_SCOPE', path: 'fixture.ts', message: 'non-loopback or undeclared network access is forbidden', fingerprint: 'https://new.example.test' }])
  })

  it('reports every matching finding across the guarded scope rules', () => {
    const result = scanScope({
      files: {
        'scope.ts': [
          'const urls = ["https://one.example.test", "https://two.example.test"]',
          'github.com/one; github.com/two; Cloudflare.api(); wrangler.route(); r2.bucket(); gsc.search(); search console:submit',
          'indexable: true; <link rel="canonical">; hreflang; <url>',
          'telemetry.one(); opentelemetry.two(); sentry.three(); datadog.four()',
          'delete https://one.example.test; put https://two.example.test; remote_mutations: 1; remote_mutations: 2',
          'import "one/static-preview/a"; from "two/static-preview/b"',
          'url_count: 1; production_sitemap_urls=2; <sitemap>',
        ].join('\n'),
      },
    })

    expect(result.ok).toBe(false)
    expect(result.counters.undeclared_network_calls).toBe(6)
    expect(result.counters.github_mutations).toBe(2)
    expect(result.counters.cloudflare_mutations).toBe(2)
    expect(result.counters.gsc_calls).toBe(2)
    expect(result.counters.indexable_urls).toBe(4)
    expect(result.counters.remote_telemetry_calls).toBe(4)
    expect(result.counters.remote_mutations).toBe(4)
    expect(result.errors.filter((error) => error.code === 'REVERSE_STATIC_IMPORT')).toHaveLength(1)
    expect(result.counters.production_sitemap_urls).toBe(3)
  })

  it('does not let one exact allowlisted finding hide a second finding of the same type', () => {
    const result = scanScope({
      files: { 'fixture.ts': 'export const sources = ["https://fixture.example.test", "https://additional.example.test"]' },
      allowlistedFindings: [{ path: 'fixture.ts', code: 'NETWORK_SCOPE', fingerprint: 'https://fixture.example.test' }],
    })
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([{ code: 'NETWORK_SCOPE', path: 'fixture.ts', message: 'non-loopback or undeclared network access is forbidden', fingerprint: 'https://fixture.example.test\nhttps://additional.example.test' }])
  })
})
