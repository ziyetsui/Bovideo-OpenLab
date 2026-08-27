import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { applicationLocaleSchema } from '@/contracts/locale'
import { buildPageMetadata } from '@/page/shell'
import { FrontendPageRouteView } from '@/page/route-view'
import { resolveFrontendRoute } from '../../../../../frontend/routes/resolve-active-projection'

type Params = Readonly<{ locale: string }>
const readProjection = async (locale: string) => {
  const parsed = applicationLocaleSchema.safeParse(locale)
  return parsed.success
    ? resolveFrontendRoute({ locale: parsed.data, route: `/${parsed.data}/prompts`, family: 'hub' })
    : undefined
}
export const generateStaticParams = (): Params[] => []
export const generateMetadata = async ({ params }: { params: Promise<Params> }): Promise<Metadata> => {
  const projection = await readProjection((await params).locale)
  if (projection === undefined) notFound()
  return buildPageMetadata(projection.page)
}
export default async function HubRoute({ params }: { params: Promise<Params> }) {
  const projection = await readProjection((await params).locale)
  if (projection === undefined) notFound()
  return <FrontendPageRouteView projection={projection} />
}
