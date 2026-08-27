import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it } from 'vitest'

import { proxy } from '@/proxy'
import { assertP1VEnvironment } from '../../../scripts/run-p1v-postgres'

const originalMode = process.env.P1V_RUNTIME

afterEach(() => {
  if (originalMode === undefined) delete process.env.P1V_RUNTIME
  else process.env.P1V_RUNTIME = originalMode
})

describe('P1-V public request boundary', () => {
  it('refuses to produce remote evidence unless the public boundary is active', () => {
    expect(() =>
      assertP1VEnvironment({
        DATABASE_URL: 'postgresql://user:secret@ep-example.us-east-2.aws.neon.tech/db?sslmode=require',
        PAYLOAD_DB_PUSH: 'false',
        P1V_TARGET: 'render-free-neon-free-synthetic',
        RENDER: 'true',
        RENDER_EXTERNAL_URL: 'https://bo-p1v.onrender.com',
        RENDER_SERVICE_ID: 'srv-example',
        RENDER_SERVICE_TYPE: 'web',
      }),
    ).toThrow('P1V_RUNTIME=true')
  })

  it.each(['/admin', '/api/users', '/api/graphql', '/', '/_next/static/chunk.js'])(
    'hides %s while the Render validation runtime is active',
    (path) => {
      process.env.P1V_RUNTIME = 'true'
      const response = proxy(new NextRequest(`https://p1v.example.test${path}`))
      expect(response.status).toBe(404)
    },
  )

  it.each(['/healthz', '/readyz'])('allows only the %s probe', (path) => {
    process.env.P1V_RUNTIME = 'true'
    const response = proxy(new NextRequest(`https://p1v.example.test${path}`))
    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('does not change the local Node development surface', () => {
    delete process.env.P1V_RUNTIME
    const response = proxy(new NextRequest('http://localhost:3000/admin'))
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })
})
