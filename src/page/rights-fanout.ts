import type { PageModule } from './modules'

export type RightsFanoutStore = Readonly<{
  modules: readonly PageModule[]
  pageIndexState: 'discoverable_noindex' | 'index_candidate' | 'indexable' | 'retired'
  snapshotState: 'active' | 'withdrawn'
  exportIncluded: boolean
}>

/** Local write-plane executor used by withdrawal/revocation workflows. */
export const executeRightsRevocationFanout = (store: RightsFanoutStore, rightsState: PageModule['rights_state']): RightsFanoutStore => {
  if (!['revoked', 'blocked', 'unknown'].includes(rightsState)) return store
  return {
    modules: store.modules.map((module) => ({ ...module, rights_state: 'revoked' as const, review_state: 'blocked' as const })),
    pageIndexState: 'retired',
    snapshotState: 'withdrawn',
    exportIncluded: false,
  }
}
