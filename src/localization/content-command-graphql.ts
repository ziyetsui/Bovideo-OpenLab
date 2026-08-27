import type { GraphQLExtension, PayloadRequest } from 'payload'

import { executeLocaleContentCommand } from './content-command'

/** Registers the same server-only command behind the Payload GraphQL transport. */
export const localeContentCommandMutation: GraphQLExtension = (GraphQL, { collections }) => {
  const input = new GraphQL.GraphQLInputObjectType({
    name: 'LocaleContentCommandInput',
    fields: {
      id: { type: new GraphQL.GraphQLNonNull(GraphQL.GraphQLInt) },
      expectedRevision: { type: new GraphQL.GraphQLNonNull(GraphQL.GraphQLInt) },
      expectedContentRevision: { type: new GraphQL.GraphQLNonNull(GraphQL.GraphQLInt) },
      correlationId: { type: new GraphQL.GraphQLNonNull(GraphQL.GraphQLString) },
      reasonCode: { type: new GraphQL.GraphQLNonNull(GraphQL.GraphQLString) },
      // JSON is represented as a string so GraphQL's schema keeps a strict,
      // explicit transport boundary without accepting arbitrary input objects.
      localizedFields: { type: new GraphQL.GraphQLNonNull(GraphQL.GraphQLString) },
    },
  })
  const localeVariantType = collections['locale-variants']?.graphQL?.type
  if (!localeVariantType) throw new Error('locale-variants GraphQL type is required')
  return {
    localeContentCommand: {
      type: localeVariantType,
      args: { input: { type: new GraphQL.GraphQLNonNull(input) } },
      resolve: async (_source: unknown, args: { input: Record<string, unknown> }, context: { req?: PayloadRequest }) => {
        if (!context.req) throw new Error('missing Payload request context')
        let localizedFields: unknown
        try { localizedFields = JSON.parse(String(args.input.localizedFields)) } catch { throw new Error('localizedFields must be JSON') }
        return executeLocaleContentCommand(context.req, {
          id: args.input.id,
          expected_revision: args.input.expectedRevision,
          expected_content_revision: args.input.expectedContentRevision,
          correlation_id: args.input.correlationId,
          reason_code: args.input.reasonCode,
          localized_fields: localizedFields,
        })
      },
    },
  }
}
