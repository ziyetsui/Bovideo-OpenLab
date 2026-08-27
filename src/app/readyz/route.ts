export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  try {
    const [{ default: config }, { getPayload }] = await Promise.all([
      import('@payload-config'),
      import('payload'),
    ])
    const payload = await getPayload({ config })
    await payload.count({ collection: 'users', overrideAccess: true })
    return Response.json(
      { database: 'postgres', status: 'ready' },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch {
    return Response.json(
      { status: 'unavailable' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
}
