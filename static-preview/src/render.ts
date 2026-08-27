import { APPLICATION_LOCALES, type ApplicationLocale, type PreviewRoute } from './contracts'
import { escapeAttribute, escapeText } from './escape'
import { routePath } from './paths'
import { compareUtf8Bytes } from './tree'
import type { LocaleCopy, PreviewCopy } from '../fixtures/copy'

type RenderInput = Readonly<{
  route: PreviewRoute
  locale: ApplicationLocale
  cohort: readonly PreviewRoute[]
  copy: PreviewCopy
}>

const GITHUB_REPOSITORY = 'https://github.com/ziyetsui/Bovideo-OpenLab'

function countText(template: string, count: number): string {
  return template.replace('{count}', String(count))
}

function section(id: string, heading: string, content: string, className = ''): string {
  return `<section data-section="${escapeAttribute(id)}" class="section ${escapeAttribute(className)}"><h2>${escapeText(heading)}</h2>${content}</section>`
}

function unavailable(copy: LocaleCopy, module: 'case' | 'tutorial' | 'comparison' | 'faq'): string {
  const content = copy.unavailable[module]
  return `<aside class="module-unavailable" data-module-state="unavailable"><h3>${escapeText(content.heading)}</h3><p>${escapeText(content.body)}</p></aside>`
}

function routeLinks(route: PreviewRoute, locale: ApplicationLocale, cohort: readonly PreviewRoute[], copy: LocaleCopy): string {
  const relatedRouteIds = new Set(route.parentRouteIds)
  for (const candidate of cohort) {
    if (candidate.parentRouteIds.includes(route.routeId)) {
      relatedRouteIds.add(candidate.routeId)
    }
  }
  const links = cohort
    .filter((candidate) => candidate.routeId !== route.routeId && relatedRouteIds.has(candidate.routeId))
    .sort((left, right) => compareUtf8Bytes(left.routeId, right.routeId))
    .map(
      (candidate) =>
        `<a class="card-link" href="${escapeAttribute(routePath(locale, candidate))}">${escapeText(copy.routes[candidate.routeId].title)}</a>`,
    )
    .join('')
  return `<nav class="link-mesh" aria-label="${escapeAttribute(copy.chrome.relatedRoutes)}">${links}</nav>`
}

function descendantDetailCount(route: PreviewRoute, cohort: readonly PreviewRoute[]): number {
  const descendants = new Set<string>([route.routeId])
  let discovered = true
  while (discovered) {
    discovered = false
    for (const candidate of cohort) {
      if (!descendants.has(candidate.routeId) && candidate.parentRouteIds.some((parent) => descendants.has(parent))) {
        descendants.add(candidate.routeId)
        discovered = true
      }
    }
  }
  return cohort.filter((candidate) => candidate.family === 'detail' && descendants.has(candidate.routeId)).length
}

function hubProjection(input: RenderInput): string {
  const copy = input.copy[input.locale]
  const content = copy.modules.hub
  const approvedDetailCount = input.cohort.filter((route) => route.family === 'detail').length
  return [
    section(
      'directory',
      content.directory,
      `<form class="search-panel" role="search"><label for="preview-search">${escapeText(content.searchLabel)}</label><input id="preview-search" name="query" type="search" disabled aria-describedby="search-note"><p id="search-note">${escapeText(content.searchUnavailable)}</p></form><p>${escapeText(content.inventory)} ${escapeText(countText(copy.countTemplate, approvedDetailCount))}</p>`,
      'color-yellow',
    ),
    section(
      'featured-collections',
      content.featured,
      `<div class="grid grid-three"><article class="card"><h3>${escapeText(content.imageCard)}</h3><p>${escapeText(copy.modules.hub.inventory)}</p></article><article class="card"><h3>${escapeText(content.videoCard)}</h3><p>${escapeText(copy.modules.hub.inventory)}</p></article><article class="card"><h3>${escapeText(content.modelCard)}</h3><p>${escapeText(copy.modules.hub.inventory)}</p></article></div>`,
    ),
    section('method', content.method, `<p>${escapeText(content.methodBody)}</p>`),
    unavailable(copy, 'case'),
  ].join('')
}

function galleryProjection(input: RenderInput): string {
  const copy = input.copy[input.locale]
  const content = copy.modules.gallery
  const approvedDetailCount = descendantDetailCount(input.route, input.cohort)
  return [
    section(
      'filter-disclosure',
      content.filter,
      `<p>${escapeText(input.copy[input.locale].routes[input.route.routeId].summary)} ${escapeText(countText(copy.countTemplate, approvedDetailCount))}</p>`,
      'color-blue',
    ),
    section(
      'gallery-cards',
      content.cards,
      `<div class="grid grid-three"><article class="card"><h3>${escapeText(content.composition)}</h3><p>${escapeText(content.filterBody)}</p></article><article class="card"><h3>${escapeText(content.motion)}</h3><p>${escapeText(content.filterBody)}</p></article><article class="card"><h3>${escapeText(content.light)}</h3><p>${escapeText(content.filterBody)}</p></article></div>`,
    ),
    section('guide', content.guide, `<p>${escapeText(content.guideBody)}</p>`),
    unavailable(copy, input.route.unavailableModule ?? 'case'),
  ].join('')
}

function entityProjection(input: RenderInput): string {
  const copy = input.copy[input.locale]
  const content = copy.modules.entity
  return [
    section(
      'entity-overview',
      content.overview,
      `<p>${escapeText(content.overviewBody)}</p>`,
      'color-red',
    ),
    section(
      'prompt-list',
      content.list,
      `<p>${escapeText(content.listBody)}</p>`,
    ),
    section('comparison', content.comparison, unavailable(copy, input.route.unavailableModule ?? 'comparison')),
  ].join('')
}

function detailProjection(input: RenderInput): string {
  const copy = input.copy[input.locale]
  const content = copy.modules.detail
  const plain = (key: Exclude<keyof typeof content, 'promptCode'>, id: string = key): string =>
    section(id, content[key].heading, `<p>${escapeText(content[key].body)}</p>`, key === 'identity' ? 'color-blue' : '')
  return [
    plain('identity'),
    plain('outcome'),
    section('prompt', content.prompt.heading, `<pre><code>${escapeText(content.promptCode)}</code></pre>`),
    plain('inputs'),
    plain('variables'),
    plain('parameters'),
    plain('examples'),
    plain('workflow'),
    plain('useCases', 'use-cases'),
    plain('variations'),
    plain('provenance'),
    section('faq', content.faq.heading, unavailable(copy, input.route.unavailableModule ?? 'faq')),
  ].join('')
}

function projection(input: RenderInput): string {
  switch (input.route.family) {
    case 'hub':
      return hubProjection(input)
    case 'gallery':
      return galleryProjection(input)
    case 'entity':
      return entityProjection(input)
    case 'detail':
      return detailProjection(input)
  }
}

export function renderRoute(input: RenderInput): string {
  const copy = input.copy[input.locale]
  const routeCopy = copy.routes[input.route.routeId]
  const h1 = routeCopy.title
  const localeLinks = APPLICATION_LOCALES.map(
    (locale) =>
      `<a data-locale-link href="${escapeAttribute(routePath(locale, input.route))}" lang="${escapeAttribute(locale)}">${escapeText(copy.localeNames[locale])}</a>`,
  ).join('')

  return `<!doctype html>
<html lang="${escapeAttribute(input.locale)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive,nosnippet">
  <title>${escapeText(h1)}</title>
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
  <a class="skip-link" href="#main">${escapeText(copy.chrome.skip)}</a>
  <header class="site-header">
    <a class="brand" href="/${escapeAttribute(input.locale)}/prompts" aria-label="${escapeAttribute(copy.chrome.brandAria)}"><span aria-hidden="true" class="shape circle"></span><span aria-hidden="true" class="shape square"></span><span aria-hidden="true" class="shape triangle"></span>${escapeText(copy.chrome.brand)}</a>
    <p class="preview-disclosure">${escapeText(copy.disclosure.header)}</p>
    <button class="menu-toggle" data-menu-toggle type="button" aria-controls="preview-navigation" aria-expanded="false" data-open-label="${escapeAttribute(copy.chrome.menuOpen)}" data-close-label="${escapeAttribute(copy.chrome.menuClose)}">${escapeText(copy.chrome.menuOpen)}</button>
    <nav id="preview-navigation" data-site-navigation aria-label="${escapeAttribute(copy.chrome.languageSelector)}">${localeLinks}</nav>
  </header>
  <main id="main">
    <section class="hero"><p class="eyebrow">${escapeText(copy.disclosure.eyebrow)}</p><h1>${escapeText(h1)}</h1><p>${escapeText(routeCopy.summary)}</p></section>
    ${projection(input)}
    ${routeLinks(input.route, input.locale, input.cohort, copy)}
  </main>
  <footer class="site-footer"><p>${escapeText(copy.disclosure.footer)}</p><a href="${GITHUB_REPOSITORY}">${escapeText(copy.chrome.publicRepository)}</a></footer>
  <script defer src="/assets/menu.js"></script>
</body>
</html>`
}
