import { APPLICATION_LOCALES } from '@/contracts/locale'
import { projectDetailRoute } from '@/detail/projector'
import { completeDetailFixture } from './complete'

export const staleDetailPages = Object.freeze(APPLICATION_LOCALES.map((locale) => projectDetailRoute(
  completeDetailFixture.input, completeDetailFixture.approvedLocaleBatch,
  { locale, staleQuestions: ['variations'] },
)))

export const staleDetailFixture = Object.freeze({
  input: completeDetailFixture.input,
  approvedLocaleBatch: completeDetailFixture.approvedLocaleBatch,
  pages: staleDetailPages,
  route: completeDetailFixture.route,
})

