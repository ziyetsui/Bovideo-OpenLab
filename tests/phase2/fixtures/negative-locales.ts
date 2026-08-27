export const NEGATIVE_LOCALE_FIXTURE_IDS = [
  'p2l-neg-blocked',
  'p2l-neg-stale',
  'p2l-neg-withdrawn',
  'p2l-neg-missing',
  'p2l-neg-duplicate',
  'p2l-neg-bad-language',
  'p2l-neg-bad-placeholder',
  'p2l-neg-stale-revision',
  'p2l-neg-malformed-alias',
] as const

export type NegativeLocaleFixtureId = (typeof NEGATIVE_LOCALE_FIXTURE_IDS)[number]

export const negativeLocaleFixtures = NEGATIVE_LOCALE_FIXTURE_IDS.map((id) => Object.freeze({
  id,
  snapshot_inclusions: 0,
  fallback_count: 0,
}))

