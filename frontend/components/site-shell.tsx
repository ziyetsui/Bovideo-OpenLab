import { APPLICATION_LOCALES, type ApplicationLocale } from '@/contracts/locale'
import type { NavigationProjection } from '@/contracts/projection'
import type { PageEnvelope } from '@/page/schema'
import { messagesFor } from '../localization/messages'

import { canRenderPageLink, NodeEdge } from './node-edge'

type ShellPage = Pick<PageEnvelope, 'locale' | 'route' | 'breadcrumbs' | 'translation_state'>

const localeRoute = (route: string, currentLocale: ApplicationLocale, locale: ApplicationLocale): string =>
  route === `/${currentLocale}` ? `/${locale}` : route.replace(`/${currentLocale}/`, `/${locale}/`)

export const FrontendSiteShell = ({ page, navigation, children }: Readonly<{
  page: ShellPage
  navigation: NavigationProjection
  children: React.ReactNode
}>) => {
  const footerItems = navigation.items.filter(canRenderPageLink)
  const messages = messagesFor(page.locale)
  const languageNames = new Intl.DisplayNames([page.locale], { type: 'language' })

  return <div className="frontend-locale-root" lang={page.locale} data-translation-state={page.translation_state ?? 'source'}>
  <a className="skip-link" href="#page-content">{messages.chrome.skipToContent}</a>
  <header className="frontend-site-header">
    <a href={`/${page.locale}/prompts`} aria-label="Bovideo OpenLab prompts home">Bovideo / OpenLab</a>
    <nav aria-label={messages.chrome.primaryNavigation}><ul>{navigation.items.map((item) => <li key={item.node_ref}><NodeEdge item={item} /></li>)}</ul></nav>
    <details className="locale-control" data-ui="locale-control">
      <summary aria-label={`${messages.chrome.languageNavigation}: ${page.locale}`}>{languageNames.of(page.locale) ?? page.locale}</summary>
      <nav aria-label={messages.chrome.languageNavigation}><ul>{APPLICATION_LOCALES.map((locale) => <li key={locale}><a href={localeRoute(page.route, page.locale, locale)} aria-current={locale === page.locale ? 'page' : undefined} lang={locale}>{languageNames.of(locale) ?? locale}</a></li>)}</ul></nav>
    </details>
    <nav aria-label={messages.chrome.breadcrumbNavigation}><ol>{page.breadcrumbs.map((crumb) => <li key={crumb.href}><a href={crumb.href}>{crumb.label}</a></li>)}</ol></nav>
  </header>
  <main id="page-content">
    {page.translation_state === 'source_fallback' ? <p className="locale-fallback-notice" role="status">{messages.sourceFallback}</p> : null}
    {children}
  </main>
  <footer className="frontend-site-footer">
    <nav aria-label={messages.chrome.footerNavigation}>{footerItems.length === 0
      ? <p role="status">{messages.chrome.footerUnavailable}</p>
      : <ul>{footerItems.map((item) => <li key={item.node_ref}><NodeEdge item={item} /></li>)}</ul>}
    </nav>
  </footer>
</div>
}
