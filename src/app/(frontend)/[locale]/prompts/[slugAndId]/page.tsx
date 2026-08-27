import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { applicationLocaleSchema } from '@/contracts/locale'
import { buildPageMetadata } from '@/page/shell'
import { FrontendPageRouteView } from '@/page/route-view'
import { resolveFrontendRoute } from '../../../../../../frontend/routes/resolve-active-projection'

export type DetailRouteParams = Readonly<{ locale: string; slugAndId: string }>

export const generateStaticParams = (): DetailRouteParams[] => []

const readProjection = async (params: DetailRouteParams) => {
  const locale = applicationLocaleSchema.safeParse(params.locale)
  if (!locale.success) return undefined
  const projection = await resolveFrontendRoute({ locale: locale.data, route: `/${locale.data}/prompts/${params.slugAndId}`, family: 'detail' })
  return projection?.page.page_type === 'detail' && `${projection.page.detail.slug}-${projection.page.detail.routeId}` === params.slugAndId
    ? projection
    : undefined
}

export const generateMetadata = async ({ params }: { params: Promise<DetailRouteParams> }): Promise<Metadata> => {
  const projection = await readProjection(await params)
  if (projection === undefined) notFound()
  return buildPageMetadata(projection.page)
}

export default async function DetailPage({ params }: { params: Promise<DetailRouteParams> }) {
  const projection = await readProjection(await params)
  if (projection === undefined) notFound()
  return <FrontendPageRouteView projection={projection} />
}
