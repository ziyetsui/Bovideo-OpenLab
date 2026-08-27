import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { applicationLocaleSchema } from '@/contracts/locale'
import { FrontendPageRouteView } from '@/page/route-view'
import { buildPageMetadata } from '@/page/shell'
import { resolveFrontendRoute } from '../../../../../../../frontend/routes/resolve-active-projection'

type Params = Readonly<{ locale: string; entitySlug: string }>
export const dynamic = 'force-dynamic'

const readProjection = async (locale: string, entitySlug: string) => {
  const parsed = applicationLocaleSchema.safeParse(locale)
  if (!parsed.success) return undefined
  const projection = await resolveFrontendRoute({ locale: parsed.data, route: `/${parsed.data}/prompts/use-cases/${entitySlug}`, family: 'entity' })
  return projection?.page.page_type === 'entity' && projection.page.entity_kind === 'use_case' && projection.page.entity_slug === entitySlug ? projection : undefined
}

export const generateStaticParams = (): Params[] => []
export const generateMetadata = async ({ params }: { params: Promise<Params> }): Promise<Metadata> => {
  const resolved = await params
  const projection = await readProjection(resolved.locale, resolved.entitySlug)
  if (projection === undefined) notFound()
  return buildPageMetadata(projection.page)
}
export default async function UseCaseEntityRoute({ params }: { params: Promise<Params> }) {
  const resolved = await params
  const projection = await readProjection(resolved.locale, resolved.entitySlug)
  if (projection === undefined) notFound()
  return <FrontendPageRouteView projection={projection} />
}
