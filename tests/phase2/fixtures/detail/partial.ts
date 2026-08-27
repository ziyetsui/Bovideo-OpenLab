import { APPLICATION_LOCALES } from '@/contracts/locale'
import { projectDetailRoute } from '@/detail/projector'
import { completeDetailFixture } from './complete'

export const partialDetailPages = Object.freeze(APPLICATION_LOCALES.map((locale) => projectDetailRoute(
  completeDetailFixture.input, completeDetailFixture.approvedLocaleBatch,
  { locale, unavailableQuestions: ['examples', 'workflow'] },
)))

export const partialDetailFixture = Object.freeze({
  input: completeDetailFixture.input,
  approvedLocaleBatch: completeDetailFixture.approvedLocaleBatch,
  pages: partialDetailPages,
  route: completeDetailFixture.route,
})

