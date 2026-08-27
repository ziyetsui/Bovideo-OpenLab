import { type NextRequest, NextResponse } from 'next/server'

const p1vPublicPaths = new Set(['/healthz', '/readyz'])

export function proxy(request: NextRequest): NextResponse {
  if (process.env.P1V_RUNTIME === 'true' && !p1vPublicPaths.has(request.nextUrl.pathname)) {
    return new NextResponse(null, {
      status: 404,
      headers: {
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow, noarchive, nosnippet',
      },
    })
  }
  return NextResponse.next()
}
