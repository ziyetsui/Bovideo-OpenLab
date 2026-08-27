import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import { resolveWranglerConfigPath, shouldUseRemoteBindings } from '@/platform/cloudflare-mode'
import { resolvePayloadSecret } from '@/platform/payload-secret'

describe('Cloudflare binding mode', () => {
  it('keeps production builds on local bindings unless remote access is explicit', () => {
    expect(shouldUseRemoteBindings({ NODE_ENV: 'production' })).toBe(false)
  })

  it('allows an explicit remote binding opt-in for migration operations', () => {
    expect(
      shouldUseRemoteBindings({
        NODE_ENV: 'production',
        PAYLOAD_REMOTE_BINDINGS: 'true',
      }),
    ).toBe(true)
  })

  it('does not treat truthy-looking values as authorization', () => {
    expect(shouldUseRemoteBindings({ PAYLOAD_REMOTE_BINDINGS: '1' })).toBe(false)
    expect(shouldUseRemoteBindings({ PAYLOAD_REMOTE_BINDINGS: 'TRUE' })).toBe(false)
  })

  it('allows the ignored config only for an explicit remote Preview operation', () => {
    expect(
      resolveWranglerConfigPath({
        CLOUDFLARE_ENV: 'preview',
        PAYLOAD_REMOTE_BINDINGS: 'true',
        PAYLOAD_WRANGLER_CONFIG_PATH: 'wrangler.preview.jsonc',
      }),
    ).toBe('wrangler.preview.jsonc')
    expect(() =>
      resolveWranglerConfigPath({
        CLOUDFLARE_ENV: 'production',
        PAYLOAD_REMOTE_BINDINGS: 'true',
        PAYLOAD_WRANGLER_CONFIG_PATH: 'wrangler.preview.jsonc',
      }),
    ).toThrow(/preview/i)
    expect(() =>
      resolveWranglerConfigPath({
        CLOUDFLARE_ENV: 'preview',
        PAYLOAD_WRANGLER_CONFIG_PATH: 'wrangler.preview.jsonc',
      }),
    ).toThrow(/remote/i)
  })

  it('fails every retired Worker/D1 deploy command closed', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    const retiredDeployScripts = Object.entries(manifest.scripts as Record<string, string>).filter(
      ([name]) => name === 'deploy' || name.startsWith('deploy:preview'),
    )

    expect(retiredDeployScripts.length).toBeGreaterThan(0)
    for (const [, command] of retiredDeployScripts) {
      expect(command).toBe('tsx scripts/reject-legacy-d1-deploy.ts')
    }

    const guard = readFileSync(
      new URL('../../scripts/reject-legacy-d1-deploy.ts', import.meta.url),
      'utf8',
    )
    expect(guard).toContain('D11 retired the Worker/D1 deployment path')
  })

  it('keeps schema migration out of the Worker request path', () => {
    const payloadConfig = readFileSync(new URL('../../src/payload.config.ts', import.meta.url), 'utf8')
    expect(payloadConfig).not.toContain('prodMigrations')
  })

  it('fails closed when a production Payload secret is absent', () => {
    expect(() => resolvePayloadSecret({ NODE_ENV: 'production' })).toThrow(/PAYLOAD_SECRET/)
    expect(resolvePayloadSecret({ NODE_ENV: 'production', PAYLOAD_SECRET: 'configured-secret' })).toBe(
      'configured-secret',
    )
  })
})
