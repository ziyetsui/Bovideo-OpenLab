import { createHash } from 'node:crypto'

export type PageQualityReport = Readonly<{ h1Count: number; missingAltCount: number; dimensionlessMediaCount: number; htmlBytes: number; contentHash: string; errors: readonly string[] }>

export type PageKeyboardReport = Readonly<{ focusableCount: number; deadLinkCount: number; errors: readonly string[] }>
export type PageKeyboardOptions = Readonly<{ requirePageAction?: boolean; requireLocaleSwitch?: boolean }>

export type PagePerformanceMetrics = Readonly<{ ttfbMs: number; lcpMs: number; inpMs: number; cls: number }>
export type PagePerformanceBudgets = Readonly<Partial<PagePerformanceMetrics>>
export type PagePerformanceReport = Readonly<{ errors: readonly string[] }>

export const DEFAULT_PAGE_PERFORMANCE_BUDGETS: Required<PagePerformanceBudgets> = Object.freeze({
  ttfbMs: 800,
  lcpMs: 2_500,
  inpMs: 200,
  cls: 0.1,
})

const count = (html: string, pattern: RegExp): number => html.match(pattern)?.length ?? 0

export const auditPageHtml = (html: string, budgetBytes = 250_000): PageQualityReport => {
  const h1Count = count(html, /<h1\b/gi)
  const missingAltCount = count(html, /<img\b(?![^>]*\balt=)[^>]*>/gi)
  const dimensionlessMediaCount = count(html, /<img\b(?![^>]*\b(?:width|height)=)[^>]*>/gi)
  const htmlBytes = Buffer.byteLength(html, 'utf8')
  const errors = [
    ...(h1Count !== 1 ? ['H1_COUNT_INVALID'] : []),
    ...(missingAltCount > 0 ? ['IMAGE_ALT_MISSING'] : []),
    ...(dimensionlessMediaCount > 0 ? ['IMAGE_DIMENSIONS_MISSING'] : []),
    ...(!/<html\b[^>]*\blang="[^"]+"/i.test(html) ? ['HTML_LANG_MISSING'] : []),
    ...(!/<main\b/i.test(html) ? ['MAIN_LANDMARK_MISSING'] : []),
    ...(!/<meta\b[^>]*name="robots"[^>]*content="noindex/i.test(html) && !/data-page-shell/.test(html) ? ['NOINDEX_MISSING'] : []),
    ...(htmlBytes > budgetBytes ? ['HTML_BUDGET_EXCEEDED'] : []),
  ]
  return { h1Count, missingAltCount, dimensionlessMediaCount, htmlBytes, contentHash: `sha256:v1:${createHash('sha256').update(html).digest('hex')}`, errors }
}

/**
 * A small deterministic keyboard contract for SSR output. It intentionally
 * checks the page's keyboard journey rather than pretending that a static
 * HTML regex is a complete WCAG audit. Browser/axe coverage remains a
 * separate integration concern.
 */
export const auditKeyboardJourney = (html: string, options: PageKeyboardOptions = {}): PageKeyboardReport => {
  const requirePageAction = options.requirePageAction ?? true
  const requireLocaleSwitch = options.requireLocaleSwitch ?? true
  const focusableCount = count(html, /<(?:a\b[^>]*\bhref=|button\b(?![^>]*\bdisabled(?:\s|=|>))|input\b|select\b|textarea\b)/gi)
  const deadLinkCount = count(html, /<a\b[^>]*\bhref=["']#["'][^>]*>/gi)
  const errors = [
    ...(!/<main\b[^>]*\bid=["']page-content["']/i.test(html) ? ['KEYBOARD_MAIN_TARGET_MISSING'] : []),
    ...(!/<a\b[^>]*class=["'][^"']*skip-link[^"']*["'][^>]*href=["']#page-content["']/i.test(html) ? ['KEYBOARD_SKIP_LINK_MISSING'] : []),
    ...(requireLocaleSwitch && !/<nav\b[^>]*data-locale-switch/i.test(html) ? ['KEYBOARD_LOCALE_SWITCH_MISSING'] : []),
    ...(requirePageAction && !/<(?:a\b[^>]*data-page-action|button\b[^>]*data-page-action)/i.test(html) ? ['KEYBOARD_PAGE_ACTION_MISSING'] : []),
    ...(deadLinkCount > 0 ? ['KEYBOARD_DEAD_LINK'] : []),
    ...(/(?:tabindex|tabIndex)=["'](?:[1-9]|\d{2,})["']/i.test(html) ? ['KEYBOARD_POSITIVE_TABINDEX'] : []),
    ...(focusableCount === 0 ? ['KEYBOARD_NO_FOCUSABLE_CONTROL'] : []),
  ]
  return { focusableCount, deadLinkCount, errors }
}

export const auditPagePerformance = (metrics: PagePerformanceMetrics, budgets: PagePerformanceBudgets = DEFAULT_PAGE_PERFORMANCE_BUDGETS): PagePerformanceReport => {
  const errors: string[] = []
  const values: Array<readonly [keyof PagePerformanceMetrics, number]> = [
    ['ttfbMs', metrics.ttfbMs],
    ['lcpMs', metrics.lcpMs],
    ['inpMs', metrics.inpMs],
    ['cls', metrics.cls],
  ]
  const labels: Readonly<Record<keyof PagePerformanceMetrics, string>> = { ttfbMs: 'TTFB', lcpMs: 'LCP', inpMs: 'INP', cls: 'CLS' }
  for (const [metric, value] of values) {
    if (!Number.isFinite(value) || value < 0) errors.push(`PERF_${labels[metric]}_INVALID`)
    const budget = budgets[metric]
    if (budget !== undefined && Number.isFinite(value) && value > budget) errors.push(`PERF_${labels[metric]}_BUDGET_EXCEEDED`)
  }
  return { errors }
}
