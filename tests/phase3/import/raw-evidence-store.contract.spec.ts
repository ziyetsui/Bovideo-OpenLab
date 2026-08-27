import { describe, expect, it } from 'vitest'

import { R2ObjectStore } from '@/storage/r2-object-store'
import { resolveRawEvidenceStoreFromEnvironment } from '@/storage/raw-evidence-store'

const r2Environment = Object.freeze({
  RAW_EVIDENCE_R2_ACCESS_KEY_ID: 'access-key',
  RAW_EVIDENCE_R2_SECRET_ACCESS_KEY: 'secret-key',
  RAW_EVIDENCE_R2_ENDPOINT: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
  RAW_EVIDENCE_R2_BUCKET: 'bovideo-openlab-raw-evidence',
  RAW_EVIDENCE_R2_REGION: 'auto',
})

describe('raw evidence store environment selection', () => {
  it('selects private R2 only when its complete configuration is present', () => {
    expect(resolveRawEvidenceStoreFromEnvironment(r2Environment)).toBeInstanceOf(R2ObjectStore)
  })

  it('rejects ambiguous local and R2 storage configuration', () => {
    expect(() => resolveRawEvidenceStoreFromEnvironment({
      ...r2Environment,
      RAW_EVIDENCE_STORE_DIR: '/private/evidence',
      RAW_EVIDENCE_SIGNER_SECRET: 'local-signer',
    })).toThrow(/ambiguous/i)
  })

  it('rejects a partial R2 configuration instead of falling back to local disk', () => {
    expect(() => resolveRawEvidenceStoreFromEnvironment({
      RAW_EVIDENCE_R2_BUCKET: 'bovideo-openlab-raw-evidence',
    })).toThrow(/incomplete/i)
  })
})
