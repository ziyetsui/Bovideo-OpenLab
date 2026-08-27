import { APPLICATION_LOCALES, type ApplicationLocale } from '@/contracts/locale'
import type { NavigationProjection } from '@/contracts/projection'
import type { PageEnvelope } from '@/page/schema'

import { canRenderPageLink, NodeEdge } from './node-edge'

type ShellPage = Pick<PageEnvelope, 'locale' | 'route' | 'breadcrumbs'>

const localeRoute = (route: string, currentLocale: ApplicationLocale, locale: ApplicationLocale): string =>
  route === `/${currentLocale}` ? `/${locale}` : route.replace(`/${currentLocale}/`, `/${locale}/`)

export const FrontendSiteShell = ({ page, navigation, children }: Readonly<{
  page: ShellPage
  navigation: NavigationProjection
  children: React.ReactNode
}>) => {
  const footerItems = navigation.items.filter(canRenderPageLink)

  return <>
  <a className="skip-link" href="#page-content">Skip to content</a>
  <header className="frontend-site-header">
    <a href={`/${page.locale}/prompts`} aria-label="Bovideo OpenLab prompts home">Bovideo / OpenLab</a>
    <nav aria-label="Primary"><ul>{navigation.items.map((item) => <li key={item.node_ref}><NodeEdge item={item} /></li>)}</ul></nav>
    <details className="locale-control" data-ui="locale-control">
      <summary aria-label={`Current language: ${page.locale}`}>{page.locale}</summary>
      <nav aria-label="Language"><ul>{APPLICATION_LOCALES.map((locale) => <li key={locale}><a href={localeRoute(page.route, page.locale, locale)} aria-current={locale === page.locale ? 'page' : undefined} lang={locale}>{locale}</a></li>)}</ul></nav>
    </details>
    <nav aria-label="Breadcrumb"><ol>{page.breadcrumbs.map((crumb) => <li key={crumb.href}><a href={crumb.href}>{crumb.label}</a></li>)}</ol></nav>
  </header>
  <main id="page-content">{children}</main>
  <footer className="frontend-site-footer">
    <nav aria-label="Footer">{footerItems.length === 0
      ? <p role="status">Footer navigation unavailable.</p>
      : <ul>{footerItems.map((item) => <li key={item.node_ref}><NodeEdge item={item} /></li>)}</ul>}
    </nav>
  </footer>
</>
}
