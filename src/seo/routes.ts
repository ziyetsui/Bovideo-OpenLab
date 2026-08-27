export const PUBLIC_ROUTE_STATUSES = [200, 301, 308, 410] as const
export type PublicRouteStatus = (typeof PUBLIC_ROUTE_STATUSES)[number]

export type RouteValidationInput = Readonly<{
  requestedUrl: string
  canonicalPath: string
  status: PublicRouteStatus
  targetPath?: string | null
}>

export type RouteValidationResult = Readonly<{
  valid: boolean
  status: PublicRouteStatus
  requestedPath: string
  cleanPath: string
  canonicalPath: string
  targetPath: string | null
  queryParameters: readonly string[]
  queryCanonicalized: boolean
  sitemapEligible: boolean
  errors: readonly string[]
}>

export type QueryValidationResult = Readonly<{
  valid: boolean
  path: string
  parameters: readonly string[]
  errors: readonly string[]
}>

const cleanPath = (path: string): string => {
  if (path === '/') return path
  const withoutTrailingSlash = path.replace(/\/+$/, '')
  return withoutTrailingSlash || '/'
}

const parseRequested = (requestedUrl: string): URL | null => {
  try {
    return new URL(requestedUrl, 'https://route.invalid')
  } catch {
    return null
  }
}

const hasUnsafePath = (path: string): boolean => path.includes('//') || path.split('/').some((segment) => segment === '.' || segment === '..')

/** Query/filter parameters are valid only as redirect inputs, never as clean routes. */
export const validateRouteQuery = (requestedUrl: string): QueryValidationResult => {
  const requested = parseRequested(requestedUrl)
  if (requested === null) return { valid: false, path: '', parameters: [], errors: ['requested_url_invalid'] }
  const parameters = [...new Set([...requested.searchParams.keys()])].sort()
  const errors: string[] = []
  if (requested.hash !== '') errors.push('fragment_not_allowed')
  if (hasUnsafePath(requested.pathname)) errors.push('path_contains_unsafe_segment')
  return { valid: errors.length === 0, path: cleanPath(requested.pathname), parameters, errors }
}

/**
 * Validate one public route record. Query/filter URLs are intentionally never
 * Sitemap eligible; they must redirect to the same clean path.
 */
export const validatePublicRoute = (input: RouteValidationInput): RouteValidationResult => {
  const errors: string[] = []
  const requested = parseRequested(input.requestedUrl)
  const requestedPath = requested?.pathname ?? ''
  const canonical = input.canonicalPath
  const canonicalUrl = parseRequested(canonical)
  const clean = cleanPath(requestedPath)
  const queryParameters = requested === null ? [] : [...new Set([...requested.searchParams.keys()])].sort()
  const queryCanonicalized = queryParameters.length > 0

  if (requested === null) errors.push('requested_url_invalid')
  if (!canonical.startsWith('/') || canonicalUrl === null || canonicalUrl.search !== '' || canonicalUrl.hash !== '') errors.push('canonical_path_must_be_clean')
  if (hasUnsafePath(requestedPath) || hasUnsafePath(canonical)) errors.push('path_contains_unsafe_segment')
  if (!PUBLIC_ROUTE_STATUSES.includes(input.status)) errors.push('status_not_public_route_status')

  const canonicalClean = cleanPath(canonical)
  const expectedTarget = input.targetPath ?? null
  if (input.status === 200) {
    if (queryCanonicalized) errors.push('query_url_must_redirect_to_clean_route')
    if (clean !== canonicalClean) errors.push('canonical_200_path_mismatch')
    if (expectedTarget !== null) errors.push('canonical_200_must_not_have_target')
  } else if (input.status === 410) {
    if (expectedTarget !== null) errors.push('410_must_not_have_target')
  } else {
    if (expectedTarget === null) errors.push('redirect_requires_target')
    else if (cleanPath(expectedTarget) !== canonicalClean) errors.push('redirect_target_must_be_canonical')
    if (clean === canonicalClean && !queryCanonicalized) errors.push('redirect_source_must_differ_from_canonical')
  }

  const valid = errors.length === 0
  return Object.freeze({
    valid,
    status: input.status,
    requestedPath,
    cleanPath: clean,
    canonicalPath: canonicalClean,
    targetPath: expectedTarget,
    queryParameters: Object.freeze(queryParameters),
    queryCanonicalized,
    sitemapEligible: valid && input.status === 200 && !queryCanonicalized,
    errors: Object.freeze(errors),
  })
}

export const validateCanonicalRoute = validatePublicRoute
export const validateRoute = validatePublicRoute
