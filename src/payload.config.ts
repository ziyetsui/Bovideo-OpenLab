import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Sources } from './collections/Sources'
import { SourceObservations } from './collections/SourceObservations'
import { PromptArtifacts } from './collections/PromptArtifacts'
import { TaxonomyNodes } from './collections/TaxonomyNodes'
import { PageRecords } from './collections/PageRecords'
import { LocaleVariants } from './collections/LocaleVariants'
import { Edges } from './collections/Edges'
import { AuditEvents } from './collections/AuditEvents'
import { ModuleEnvelopes } from './collections/ModuleEnvelopes'
import { MediaEvidence } from './collections/MediaEvidence'
import { PageProjections } from './collections/PageProjections'
import { PublicationProjections } from './collections/PublicationProjections'
import { PublicationSnapshots } from './collections/PublicationSnapshots'
import { PublicationStates } from './collections/PublicationStates'
import { ActivePublicationPointers } from './collections/ActivePublicationPointers'
import { DeletionRequests } from './collections/DeletionRequests'
import { GoldenReplacementApprovals } from './collections/GoldenReplacementApprovals'
import { Redirects } from './collections/Redirects'
import { WorkflowRuns } from './collections/WorkflowRuns'
import { APPLICATION_LOCALES } from './contracts/locale'
import { resolvePayloadSecret } from './platform/payload-secret'
import { payloadLogger } from './platform/payload-logger'
import { goldenReplacementCompareEndpoint, localeContentCommandEndpoint } from './localization/content-command'
import { localeContentCommandMutation } from './localization/content-command-graphql'

const dirname = path.dirname(fileURLToPath(import.meta.url))
function resolveDatabaseURL(env: NodeJS.ProcessEnv): string {
  const databaseURL = env.DATABASE_URL?.trim()
  if (!databaseURL) {
    throw new Error('DATABASE_URL is required for the Payload PostgreSQL write plane')
  }
  return databaseURL
}

function resolvePoolMax(env: NodeJS.ProcessEnv): number {
  const raw = env.DB_POOL_MAX?.trim() || '10'
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > 20) {
    throw new Error('DB_POOL_MAX must be an integer from 1 through 20')
  }
  return value
}

export function createPayloadConfig() {
  return buildConfig({
    admin: {
      user: Users.slug,
      avatar: 'default',
      components: {
        providers: ['/components/LocalMonacoProvider'],
      },
      importMap: {
        baseDir: path.resolve(dirname),
      },
    },
    collections: [
      Users,
      Media,
      Sources,
      SourceObservations,
      PromptArtifacts,
      TaxonomyNodes,
      PageRecords,
      LocaleVariants,
      Edges,
      AuditEvents,
      ModuleEnvelopes,
      MediaEvidence,
      PageProjections,
      PublicationProjections,
      PublicationSnapshots,
      PublicationStates,
      ActivePublicationPointers,
      Redirects,
      WorkflowRuns,
      DeletionRequests,
      GoldenReplacementApprovals,
    ],
    localization: {
      locales: [...APPLICATION_LOCALES],
      defaultLocale: 'en',
      fallback: false,
    },
    endpoints: [
      { path: '/locale-content-command', method: 'post', handler: localeContentCommandEndpoint },
      { path: '/golden-replacement-compare', method: 'post', handler: goldenReplacementCompareEndpoint },
    ],
    graphQL: {
      mutations: localeContentCommandMutation,
    },
    editor: lexicalEditor(),
    telemetry: false,
    secret: resolvePayloadSecret(process.env),
    typescript: {
      outputFile: path.resolve(dirname, 'payload-types.ts'),
      // One-shot migration commands must not retain a background type generator.
      // Types are generated explicitly by the project quality gate.
      autoGenerate: false,
    },
    db: postgresAdapter({
      pool: {
        connectionString: resolveDatabaseURL(process.env),
        max: resolvePoolMax(process.env),
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 10_000,
      },
      push: process.env.PAYLOAD_DB_PUSH === 'true',
      migrationDir: path.resolve(dirname, 'migrations-postgres'),
    }),
    logger: payloadLogger,
  })
}

export default createPayloadConfig()
