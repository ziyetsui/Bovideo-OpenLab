import { LocalObjectStore } from './local-object-store'
import type { ObjectIngressStore } from './object-ingress-store'
import { resolveR2ObjectStoreFromEnvironment } from './r2-object-store'

export type RawEvidenceStoreEnvironment = Readonly<Record<string, string | undefined>>

const localKeys = ['RAW_EVIDENCE_STORE_DIR', 'RAW_EVIDENCE_SIGNER_SECRET'] as const

const configuredKeys = (environment: RawEvidenceStoreEnvironment, keys: readonly string[]): readonly string[] =>
  keys.filter((key) => environment[key]?.trim().length)

/**
 * Selects exactly one private evidence backend. A partial or mixed setup is a
 * deployment error, never a silent fallback to ephemeral local disk.
 */
export const resolveRawEvidenceStoreFromEnvironment = (environment: RawEvidenceStoreEnvironment): ObjectIngressStore => {
  const localConfigured = configuredKeys(environment, localKeys)
  const hasAnyR2 = configuredKeys(environment, [
    'RAW_EVIDENCE_R2_ACCESS_KEY_ID',
    'RAW_EVIDENCE_R2_SECRET_ACCESS_KEY',
    'RAW_EVIDENCE_R2_ENDPOINT',
    'RAW_EVIDENCE_R2_BUCKET',
    'RAW_EVIDENCE_R2_REGION',
  ]).length > 0
  if (localConfigured.length > 0 && hasAnyR2) throw new Error('raw evidence storage configuration is ambiguous: configure either local or R2 storage')
  if (hasAnyR2) {
    const store = resolveR2ObjectStoreFromEnvironment(environment)
    if (store === null) throw new Error('R2 raw evidence configuration is missing')
    return store
  }
  if (localConfigured.length !== localKeys.length) {
    const missing = localKeys.filter((key) => !environment[key]?.trim().length)
    throw new Error(`raw evidence storage configuration is incomplete: missing ${missing.join(', ')}`)
  }
  return new LocalObjectStore({
    root_dir: environment.RAW_EVIDENCE_STORE_DIR!.trim(),
    signer_secret: environment.RAW_EVIDENCE_SIGNER_SECRET!.trim(),
  })
}
