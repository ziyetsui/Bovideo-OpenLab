import { describe, expect, it } from 'vitest'

import { assertPreviewReadiness } from '../../scripts/assert-preview-ready'

const readyConfig = {
  env: {
    preview: {
      name: 'bovideo-openlab-preview',
      d1_databases: [
        {
          binding: 'D1',
          database_id: '11111111-1111-1111-1111-111111111111',
          database_name: 'bovideo-openlab-preview',
        },
      ],
      r2_buckets: [{ binding: 'R2', bucket_name: 'bovideo-openlab-preview-media' }],
    },
  },
}

describe('assertPreviewReadiness', () => {
  it('accepts only the provisioned resources and required secret', () => {
    expect(() =>
      assertPreviewReadiness({
        accountID: '11111111111111111111111111111111',
        config: readyConfig,
        remoteD1: { name: 'bovideo-openlab-preview', uuid: '11111111-1111-1111-1111-111111111111' },
        remoteR2: { name: 'bovideo-openlab-preview-media' },
        secretNames: ['PAYLOAD_SECRET'],
      }),
    ).not.toThrow()
  })

  it('rejects a private config that does not match the selected account resources', () => {
    expect(() =>
      assertPreviewReadiness({
        accountID: '11111111111111111111111111111111',
        config: readyConfig,
        remoteD1: { name: 'bovideo-openlab-preview', uuid: '22222222-2222-2222-2222-222222222222' },
        remoteR2: { name: 'bovideo-openlab-preview-media' },
        secretNames: ['PAYLOAD_SECRET'],
      }),
    ).toThrow(/selected account/i)
  })

  it.each([
    ['missing account', { accountID: '', config: readyConfig, secretNames: ['PAYLOAD_SECRET'] }],
    ['missing secret', { accountID: '11111111111111111111111111111111', config: readyConfig, secretNames: [] }],
    [
      'wrong D1',
      {
        accountID: '11111111111111111111111111111111',
        config: { env: { preview: { ...readyConfig.env.preview, d1_databases: [{ binding: 'D1' }] } } },
        secretNames: ['PAYLOAD_SECRET'],
      },
    ],
    [
      'wrong R2',
      {
        accountID: '11111111111111111111111111111111',
        config: { env: { preview: { ...readyConfig.env.preview, r2_buckets: [{ binding: 'R2' }] } } },
        secretNames: ['PAYLOAD_SECRET'],
      },
    ],
  ])('fails closed for %s', (_label, value) => {
    expect(() => assertPreviewReadiness(value)).toThrow(/Preview|PAYLOAD_SECRET|account/i)
  })
})
