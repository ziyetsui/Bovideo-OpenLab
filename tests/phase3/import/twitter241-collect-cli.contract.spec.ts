import { describe, expect, it } from 'vitest'

import { parseTwitter241CollectArgs } from '../../../scripts/collect-and-import-twitter241'

describe('Twitter241 collection CLI', () => {
  it('requires a private credential file and accepts controlled collection limits', () => {
    expect(parseTwitter241CollectArgs(['--credentials', '/private/twitter241.env', '--out-dir', '/private/snapshots/run-1', '--count', '12', '--max-pages', '3'], {})).toEqual({
      credentialFile: '/private/twitter241.env', outDir: '/private/snapshots/run-1', count: 12, maxPages: 3,
    })
  })

  it('caps each query unit at one page unless an explicit page limit is supplied', () => {
    expect(parseTwitter241CollectArgs([], { TWITTER241_CREDENTIAL_FILE: '/private/twitter241.env' })).toMatchObject({
      count: 20,
      maxPages: 1,
    })
    expect(() => parseTwitter241CollectArgs(['--max-pages', '0'], { TWITTER241_CREDENTIAL_FILE: '/private/twitter241.env' })).toThrow(/max-pages/i)
  })

  it('rejects a missing credential file and unknown options before any collector or Payload work', () => {
    expect(() => parseTwitter241CollectArgs([], {})).toThrow(/credential/i)
    expect(() => parseTwitter241CollectArgs(['--unsafe'], { TWITTER241_CREDENTIAL_FILE: '/private/twitter241.env' })).toThrow(/unknown Twitter241 collection argument/i)
  })
})
