import type { ReactNode } from 'react'

import type { PageEnvelope } from './schema'
import { PageShell } from './shell'
import { EntityComposer } from './presentation/entity'
import { GalleryComposer } from './presentation/gallery'
import { HubComposer } from './presentation/hub'
import { DetailPage } from '../../frontend/pages/detail-page'
import { EntityPage } from '../../frontend/pages/entity-page'
import { GalleryPage } from '../../frontend/pages/gallery-page'
import { HubPage } from '../../frontend/pages/hub-page'
import { FrontendSiteShell } from '../../frontend/components/site-shell'
import { adaptFrontendProjection } from '../../frontend/projection/adapt'
import type { PageProjection } from '@/contracts/projection'

export const PageRouteView = ({ page, children }: Readonly<{ page: PageEnvelope; children?: ReactNode }>) => <PageShell page={page}>
  {page.page_type === 'hub'
    ? <HubComposer page={page} routeIntro={children} />
    : page.page_type === 'gallery'
      ? <GalleryComposer page={page} routeIntro={children} />
      : page.page_type === 'entity'
        ? <EntityComposer page={page} routeIntro={children} />
        : children}
</PageShell>

/** Renders only a route projection that the route resolver has already bound to publication state. */
export const FrontendPageRouteView = ({ projection }: Readonly<{ projection: PageProjection }>) => {
  const model = adaptFrontendProjection(projection)

  return <FrontendSiteShell page={projection.page} navigation={projection.navigation}>
    <h1 className="frontend-display">{model.h1 ?? model.title}</h1>
    {model.family === 'hub'
      ? <HubPage model={model} />
      : model.family === 'gallery'
        ? <GalleryPage model={model} />
        : model.family === 'entity'
          ? <EntityPage model={model} />
          : <DetailPage model={model} />}
  </FrontendSiteShell>
}
