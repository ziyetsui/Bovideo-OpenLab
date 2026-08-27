import { z } from 'zod'

export const RIGHTS_STATES = [
  'unknown',
  'metadata_only',
  'display_licensed',
  'redistribution_licensed',
  'first_party',
  'blocked',
  'revoked',
] as const
export const rightsStateSchema = z.enum(RIGHTS_STATES)
export type RightsState = z.infer<typeof rightsStateSchema>

export type RightsDecision = Readonly<{
  may_display: boolean
  may_export: boolean
  fields: 'none' | 'metadata_only' | 'full_display'
  withdrawal_intent: Readonly<{ priority: 'emergency' }> | null
}>

const deniedRightsDecision = (): RightsDecision => ({
  may_display: false,
  may_export: false,
  fields: 'none',
  withdrawal_intent: null,
})

export const decideRights = (input: unknown): RightsDecision => {
  const parsed = rightsStateSchema.safeParse(input)
  if (!parsed.success) return deniedRightsDecision()
  const rightsState = parsed.data
  switch (rightsState) {
    case 'metadata_only':
      return {
        may_display: true,
        may_export: false,
        fields: 'metadata_only',
        withdrawal_intent: null,
      }
    case 'display_licensed':
      return {
        may_display: true,
        may_export: false,
        fields: 'full_display',
        withdrawal_intent: null,
      }
    case 'redistribution_licensed':
    case 'first_party':
      return {
        may_display: true,
        may_export: true,
        fields: 'full_display',
        withdrawal_intent: null,
      }
    case 'revoked':
      return {
        may_display: false,
        may_export: false,
        fields: 'none',
        withdrawal_intent: { priority: 'emergency' },
      }
    case 'unknown':
    case 'blocked':
      return deniedRightsDecision()
  }
}
