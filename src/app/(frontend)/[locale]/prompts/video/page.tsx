import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { applicationLocaleSchema } from '@/contracts/locale'
import { buildPageMetadata } from '@/page/shell'
import { FrontendPageRouteView } from '@/page/route-view'
import { resolveFrontendRoute } from '../../../../../../frontend/routes/resolve-active-projection'
type Params = Readonly<{ locale: string }>
const readProjection = async (locale: string, requestedPage: number) => {
  const parsed = applicationLocaleSchema.safeParse(locale)
  if (!parsed.success || !Number.isInteger(requestedPage) || requestedPage < 1) return undefined
  const projection = await resolveFrontendRoute({ locale: parsed.data, route: `/${parsed.data}/prompts/video`, family: 'gallery' })
  return projection?.page.page_type === 'gallery' && projection.page.media_type === 'video' && projection.page.page === requestedPage ? projection : undefined
}
export const generateStaticParams = (): Params[] => []
export const generateMetadata = async ({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ page?: string }> }): Promise<Metadata> => {
  const query = await searchParams
  const projection = await readProjection((await params).locale, query.page === undefined ? 1 : Number(query.page))
  if (projection === undefined) notFound()
  return buildPageMetadata(projection.page)
}
export default async function VideoGalleryRoute({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ page?: string }> }) {
  const query = await searchParams
  const projection = await readProjection((await params).locale, query.page === undefined ? 1 : Number(query.page))
  if (projection === undefined) notFound()
  return <FrontendPageRouteView projection={projection} />
}
