import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { applicationLocaleSchema } from '@/contracts/locale'
import { buildPageMetadata } from '@/page/shell'
import { FrontendPageRouteView } from '@/page/route-view'
import { resolveFrontendRoute } from '../../../../../../../../frontend/routes/resolve-active-projection'

type Params = Readonly<{ locale: string; page: string }>
export const dynamic = 'force-dynamic'

const readProjection = async (locale: string, requestedPage: number) => {
  const parsed = applicationLocaleSchema.safeParse(locale)
  if (!parsed.success || !Number.isSafeInteger(requestedPage) || requestedPage < 2) return undefined
  const projection = await resolveFrontendRoute({ locale: parsed.data, route: `/${parsed.data}/prompts/video/page/${requestedPage}`, family: 'gallery' })
  return projection?.page.page_type === 'gallery' && projection.page.media_type === 'video' && projection.page.page === requestedPage ? projection : undefined
}

export const generateMetadata = async ({ params }: { params: Promise<Params> }): Promise<Metadata> => {
  const resolved = await params
  const projection = await readProjection(resolved.locale, Number(resolved.page))
  if (projection === undefined) notFound()
  return buildPageMetadata(projection.page)
}

export default async function VideoGalleryPageRoute({ params }: { params: Promise<Params> }) {
  const resolved = await params
  const projection = await readProjection(resolved.locale, Number(resolved.page))
  if (projection === undefined) notFound()
  return <FrontendPageRouteView projection={projection} />
}
