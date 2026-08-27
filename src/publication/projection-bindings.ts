import type { PageProjection } from '@/contracts/projection'

export type PublicationProjectionBinding = Readonly<{
  publish_version: number
  projection: string
  route: string
  locale: string
  family: PageProjection['family']
  internal_noindex: true
}>

/** A release manifest binds a version to exact immutable projection rows. */
export const buildPublicationProjectionBindings = (input: Readonly<{
  publishVersion: number
  projections: readonly PageProjection[]
}>): readonly PublicationProjectionBinding[] => {
  if (!Number.isSafeInteger(input.publishVersion) || input.publishVersion < 1) throw new Error('publishVersion must be a positive integer')
  const seen = new Set<string>()
  return Object.freeze(input.projections.map((projection) => {
    if (projection.state !== 'released' || projection.page.index_state !== 'discoverable_noindex')
      throw new Error('local publication accepts released noindex projections only')
    const identity = `${projection.locale}\u0000${projection.family}\u0000${projection.page.route}`
    if (seen.has(identity)) throw new Error(`duplicate publication projection route ${projection.page.route}`)
    seen.add(identity)
    return Object.freeze({
      publish_version: input.publishVersion,
      projection: projection.projection_id,
      route: projection.page.route,
      locale: projection.locale,
      family: projection.family,
      internal_noindex: true as const,
    })
  }))
}
