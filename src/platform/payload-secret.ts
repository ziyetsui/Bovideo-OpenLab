export function resolvePayloadSecret(env: Record<string, string | undefined>): string {
  const secret = env.PAYLOAD_SECRET?.trim()
  if (env.NODE_ENV === 'production' && !secret) {
    throw new Error('PAYLOAD_SECRET is required in production')
  }
  return secret ?? ''
}
