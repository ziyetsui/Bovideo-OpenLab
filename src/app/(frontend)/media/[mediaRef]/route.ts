import { APPROVED_MEDIA_CATALOG } from '@/page/media-catalog'

export const dynamic = 'force-static'

export async function GET(_request: Request, { params }: { params: Promise<{ mediaRef: string }> }) {
  const { mediaRef } = await params
  const media = APPROVED_MEDIA_CATALOG[mediaRef]
  if (media === undefined) return new Response('Media not found', { status: 404 })
  if (media.media_type === 'video') return new Response('Media delivery is not configured for this fixture', { status: 503 })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"><title>Approved preview media</title><rect width="1" height="1" fill="white"/></svg>`
  return new Response(svg, { status: 200, headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=60', 'x-rights-state': media.rights_state } })
}
