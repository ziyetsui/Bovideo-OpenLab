import { APPLICATION_LOCALES, type PreviewRoute } from './contracts'

const localeSet = new Set<string>(APPLICATION_LOCALES)

function validateLocale(locale: string): void {
  if (!localeSet.has(locale)) {
    throw new Error(`Unknown locale: ${locale}`)
  }
}

function validateSegments(route: PreviewRoute): void {
  if (!route.segments.length || route.segments.some((segment) => !/^[a-z0-9-]+$/.test(segment))) {
    throw new Error(`Unsafe route path for ${route.routeId}`)
  }
}

export function routePath(locale: string, route: PreviewRoute): string {
  validateLocale(locale)
  validateSegments(route)
  return `/${locale}/${route.segments.join('/')}`
}

export function outputPath(locale: string, route: PreviewRoute): string {
  return `${routePath(locale, route)}/index.html`
}
