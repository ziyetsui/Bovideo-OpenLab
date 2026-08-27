import { describe, expect, it } from 'vitest'

import { buildSevenDayNoindexSoakFixture, evaluateNoindexSoak, runNoindexSoak, serializeNoindexSoakEvidence, type NoindexSoakDay } from '@/page/soak'

const day = (dayNumber: number, overrides: Partial<NoindexSoakDay> = {}): NoindexSoakDay => ({ day: dayNumber, availability: 1, unresolvedP0P1: 0, oldestQueueAgeSeconds: 0, successfulPublishes: dayNumber === 3 ? 3 : 0, plannedRollbacks: dayNumber === 4 ? 1 : 0, localeSmokePasses: 16, noindexRoutes: 16, sitemapUrlCount: 0, ...overrides })

describe('P3-T10 seven-day internal noindex soak', () => {
  it('passes the complete seven-day control set', () => {
    const report = evaluateNoindexSoak([1, 2, 3, 4, 5, 6, 7].map((number) => day(number)))
    expect(report).toEqual({ passed: true, errors: [], days: 7 })
  })

  it('fails closed for short runs, incidents, queue age, locale gaps and indexable output', () => {
    const report = evaluateNoindexSoak([day(1), day(2, { availability: 0.98, unresolvedP0P1: 1, oldestQueueAgeSeconds: 61, localeSmokePasses: 15, sitemapUrlCount: 1 })])
    expect(report.passed).toBe(false)
    expect(report.errors).toEqual(expect.arrayContaining(['SOAK_DAYS_INCOMPLETE', 'DAY_2_AVAILABILITY_BELOW_TARGET', 'DAY_2_UNRESOLVED_INCIDENT', 'DAY_2_QUEUE_SLA_BREACH', 'DAY_2_LOCALE_SMOKE_INCOMPLETE', 'DAY_2_SITEMAP_NOT_EMPTY', 'ROLLBACK_CONTROL_MISSING']))
  })

  it('uses the documented queue SLA instead of requiring an empty queue', () => {
    expect(evaluateNoindexSoak(buildSevenDayNoindexSoakFixture({ 2: { oldestQueueAgeSeconds: 30 } })).passed).toBe(true)
    expect(evaluateNoindexSoak(buildSevenDayNoindexSoakFixture({ 2: { oldestQueueAgeSeconds: 31 } }), 16, { queueSlaSeconds: 30 }).errors).toContain('DAY_2_QUEUE_SLA_BREACH')
  })

  it('runs a deterministic seven-day measurement harness', () => {
    const measuredDays: number[] = []
    const report = runNoindexSoak((dayNumber) => {
      measuredDays.push(dayNumber)
      return day(dayNumber)
    })
    expect(measuredDays).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(report).toEqual({ passed: true, errors: [], days: 7 })
  })

  it('serializes all daily measurements into a durable evidence artifact', () => {
    const json = serializeNoindexSoakEvidence('p3-local-soak-2026-08-25', buildSevenDayNoindexSoakFixture(), '2026-08-19T00:00:00.000Z', '2026-08-25T23:59:59.000Z')
    const evidence = JSON.parse(json) as { run_id: string; measurements: NoindexSoakDay[] }
    expect(evidence.run_id).toBe('p3-local-soak-2026-08-25')
    expect(evidence.measurements).toHaveLength(7)
  })

  it('persists each daily measurement as it is collected', () => {
    const persisted: number[] = []
    const report = runNoindexSoak((dayNumber) => day(dayNumber), 16, { persistMeasurement: (measurement) => persisted.push(measurement.day) })
    expect(report.passed).toBe(true)
    expect(persisted).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
})
