export type NoindexSoakDay = Readonly<{
  day: number
  availability: number
  unresolvedP0P1: number
  oldestQueueAgeSeconds: number
  successfulPublishes: number
  plannedRollbacks: number
  localeSmokePasses: number
  noindexRoutes: number
  sitemapUrlCount: number
}>

export type NoindexSoakReport = Readonly<{ passed: boolean; errors: readonly string[]; days: number }>
export type NoindexSoakEvidence = Readonly<{ run_id: string; started_at: string; completed_at: string; measurements: readonly NoindexSoakDay[] }>

export const DEFAULT_QUEUE_SLA_SECONDS = 60
export type NoindexSoakOptions = Readonly<{ queueSlaSeconds?: number; persistMeasurement?: (day: NoindexSoakDay) => void }>

export type NoindexSoakMeasurement = Omit<NoindexSoakDay, 'day'>

/** Builds the committed, deterministic control fixture used by local acceptance tests. */
export const buildSevenDayNoindexSoakFixture = (overrides: Readonly<Record<number, Partial<NoindexSoakMeasurement>>> = {}): readonly NoindexSoakDay[] => Array.from({ length: 7 }, (_, index) => {
  const day = index + 1
  return {
    day,
    availability: 1,
    unresolvedP0P1: 0,
    oldestQueueAgeSeconds: 0,
    successfulPublishes: day === 3 ? 3 : 0,
    plannedRollbacks: day === 4 ? 1 : 0,
    localeSmokePasses: 16,
    noindexRoutes: 16,
    sitemapUrlCount: 0,
    ...overrides[day],
  }
})

/** Runs seven daily measurements synchronously; it does not claim seven days elapsed. */
export const runNoindexSoak = (measure: (day: number) => NoindexSoakMeasurement, expectedLocales = 16, options: NoindexSoakOptions = {}): NoindexSoakReport => {
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = { day: index + 1, ...measure(index + 1) }
    options.persistMeasurement?.(day)
    return day
  })
  return evaluateNoindexSoak(days, expectedLocales, options)
}

export const serializeNoindexSoakEvidence = (runId: string, days: readonly NoindexSoakDay[], startedAt: string, completedAt: string): string => JSON.stringify({ run_id: runId, started_at: startedAt, completed_at: completedAt, measurements: days }, null, 2)

export const evaluateNoindexSoak = (days: readonly NoindexSoakDay[], expectedLocales = 16, options: NoindexSoakOptions = {}): NoindexSoakReport => {
  const queueSlaSeconds = options.queueSlaSeconds ?? DEFAULT_QUEUE_SLA_SECONDS
  const errors: string[] = []
  if (days.length < 7) errors.push('SOAK_DAYS_INCOMPLETE')
  for (const day of days) {
    if (day.availability < 0.999) errors.push(`DAY_${day.day}_AVAILABILITY_BELOW_TARGET`)
    if (day.unresolvedP0P1 !== 0) errors.push(`DAY_${day.day}_UNRESOLVED_INCIDENT`)
    if (day.oldestQueueAgeSeconds > queueSlaSeconds) errors.push(`DAY_${day.day}_QUEUE_SLA_BREACH`)
    if (day.localeSmokePasses !== expectedLocales) errors.push(`DAY_${day.day}_LOCALE_SMOKE_INCOMPLETE`)
    if (day.noindexRoutes <= 0) errors.push(`DAY_${day.day}_NOINDEX_ROUTES_MISSING`)
    if (day.sitemapUrlCount !== 0) errors.push(`DAY_${day.day}_SITEMAP_NOT_EMPTY`)
  }
  if (!days.some((day) => day.successfulPublishes >= 3)) errors.push('PUBLISH_CONTROL_MISSING')
  if (!days.some((day) => day.plannedRollbacks >= 1)) errors.push('ROLLBACK_CONTROL_MISSING')
  return { passed: errors.length === 0, errors, days: days.length }
}
