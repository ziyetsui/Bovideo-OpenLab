export type LocaleEntityReference = Readonly<{
  relationTo: 'prompt-artifacts'
  value: number | string
}>

/** The entity relation is the source of truth for a locale fanout identity. */
export const localeEntityKey = (entity: unknown): string => {
  if (typeof entity !== 'object' || entity === null)
    throw new Error('locale entity must be an authoritative prompt artifact')
  const reference = entity as Record<string, unknown>
  const value = reference.value
  if (
    reference.relationTo !== 'prompt-artifacts' ||
    !(
      (typeof value === 'number' && Number.isInteger(value) && value > 0) ||
      (typeof value === 'string' && value.length > 0)
    )
  ) throw new Error('locale entity must be an authoritative prompt artifact')
  return `prompt-artifact:${value}`
}
