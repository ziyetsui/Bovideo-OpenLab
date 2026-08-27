type Environment = Readonly<Record<string, string | undefined>>

/**
 * Remote bindings are an explicit privileged operation. Production builds use
 * local emulation; a deployed Worker receives its bindings from the runtime.
 */
export function shouldUseRemoteBindings(environment: Environment): boolean {
  return environment.PAYLOAD_REMOTE_BINDINGS === 'true'
}

/** Restricts alternate Wrangler configs to the explicit Preview migration path. */
export function resolveWranglerConfigPath(environment: Environment): string | undefined {
  const configPath = environment.PAYLOAD_WRANGLER_CONFIG_PATH?.trim()
  if (!configPath) return undefined
  if (!shouldUseRemoteBindings(environment)) {
    throw new Error('An alternate Wrangler config requires explicit remote bindings')
  }
  if (environment.CLOUDFLARE_ENV !== 'preview' || configPath !== 'wrangler.preview.jsonc') {
    throw new Error('Only the isolated wrangler.preview.jsonc target is allowed for Preview migration')
  }
  return configPath
}
