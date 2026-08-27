/**
 * Historical D1-only Payload configuration retained for the Phase-0 roundtrip evidence runner.
 * The active application imports payload.config.ts and uses PostgreSQL.
 */
import fs from 'fs'
import path from 'path'
import { sqliteD1Adapter } from '@payloadcms/db-d1-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig, type PayloadLogger } from 'payload'
import { fileURLToPath } from 'url'
import { CloudflareContext, getCloudflareContext } from '@opennextjs/cloudflare'
import { GetPlatformProxyOptions } from 'wrangler'
import { r2Storage } from '@payloadcms/storage-r2'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Sources } from './collections/Sources'
import { PromptArtifacts } from './collections/PromptArtifacts'
import { TaxonomyNodes } from './collections/TaxonomyNodes'
import { PageRecords } from './collections/PageRecords'
import { LocaleVariants } from './collections/LocaleVariants'
import { Edges } from './collections/Edges'
import { AuditEvents } from './collections/AuditEvents'
import { ModuleEnvelopes } from './collections/ModuleEnvelopes'
import { PublicationSnapshots } from './collections/PublicationSnapshots'
import { PublicationStates } from './collections/PublicationStates'
import { ActivePublicationPointers } from './collections/ActivePublicationPointers'
import { DeletionRequests } from './collections/DeletionRequests'
import { APPLICATION_LOCALES } from './contracts/locale'
import { resolveWranglerConfigPath, shouldUseRemoteBindings } from './platform/cloudflare-mode'
import { resolvePayloadSecret } from './platform/payload-secret'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const realpath = (value: string) => {
    try {
        return fs.existsSync(value) ? fs.realpathSync(value) : undefined
    } catch {
        return undefined
    }
}
const isCLI = process.argv.some((value) => {
    const resolved = realpath(value)
    if (!resolved) return false
    return (
        resolved.endsWith(path.join('payload', 'bin.js')) ||
        resolved.endsWith(path.join('next', 'dist', 'bin', 'next'))
    )
})
const isProduction = process.env.NODE_ENV === 'production'

const createLog =
    (level: string, fn: typeof console.log) => (objOrMsg: object | string, msg?: string) => {
        if (typeof objOrMsg === 'string') {
            fn(JSON.stringify({ level, msg: objOrMsg }))
        } else {
            fn(JSON.stringify({ level, ...objOrMsg, msg: msg ?? (objOrMsg as { msg?: string }).msg }))
        }
    }

const cloudflareLogger = {
    level: process.env.PAYLOAD_LOG_LEVEL || 'info',
    trace: createLog('trace', console.debug),
    debug: createLog('debug', console.debug),
    info: createLog('info', console.log),
    warn: createLog('warn', console.warn),
    error: createLog('error', console.error),
    fatal: createLog('fatal', console.error),
    silent: () => { },
} as unknown as PayloadLogger

const localContextDisposers = new WeakMap<object, () => Promise<void>>()

/** Creates an isolated local binding context for tests and migration harnesses. */
export async function createPayloadConfig() {
    const localMigrationDir = process.env.PAYLOAD_LOCAL_MIGRATION_DIR
    if (localMigrationDir && (!process.env.PAYLOAD_LOCAL_BINDINGS_PATH || shouldUseRemoteBindings(process.env))) {
        throw new Error('PAYLOAD_LOCAL_MIGRATION_DIR requires local bindings and forbids remote bindings')
    }
    const cloudflare =
        isCLI || !isProduction
            ? await getCloudflareContextFromWrangler()
            : await getCloudflareContext({ async: true })

    const config = buildConfig({
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
        PromptArtifacts,
        TaxonomyNodes,
        PageRecords,
        LocaleVariants,
        Edges,
        AuditEvents,
        ModuleEnvelopes,
        PublicationSnapshots,
        PublicationStates,
        ActivePublicationPointers,
        DeletionRequests,
    ],
    localization: {
        locales: [...APPLICATION_LOCALES],
        defaultLocale: 'en',
        fallback: false,
    },
    editor: lexicalEditor(),
    secret: resolvePayloadSecret(process.env),
    typescript: {
        outputFile: path.resolve(dirname, 'payload-types.ts'),
    },
    db: sqliteD1Adapter({
        binding: cloudflare.env.D1,
        migrationDir: localMigrationDir,
    }),
    logger: isProduction ? cloudflareLogger : undefined,
    plugins: [
        r2Storage({
            bucket: cloudflare.env.R2,
            collections: { media: true },
        }),
    ],
    })
    const disposableCloudflare = cloudflare as unknown as { dispose?: () => Promise<void> }
    if (typeof disposableCloudflare.dispose === 'function') {
        localContextDisposers.set(config as object, () => disposableCloudflare.dispose!())
    }
    return config
}

/** Flushes a local Miniflare context so Wrangler can open the same persistence state. */
export async function disposePayloadConfigContext(config: object): Promise<void> {
    await localContextDisposers.get(config)?.()
    localContextDisposers.delete(config)
}

export default createPayloadConfig()

// Adapted from https://github.com/opennextjs/opennextjs-cloudflare/blob/d00b3a13e42e65aad76fba41774815726422cc39/packages/cloudflare/src/api/cloudflare-context.ts#L328C36-L328C46
function getCloudflareContextFromWrangler(): Promise<CloudflareContext> {
    const localBindingsPath = process.env.PAYLOAD_LOCAL_BINDINGS_PATH
    // getPlatformProxy consumes a Miniflare root, whereas `wrangler d1 execute
    // --persist-to <root>` stores D1 under `<root>/v3/d1`. Point both at the
    // same physical state so migration harnesses and local operators agree.
    const localMiniflareRoot = localBindingsPath ? path.join(localBindingsPath, 'v3') : undefined

    return import(/* webpackIgnore: true */ `${'__wrangler'.replaceAll('_', '')}`).then(
        ({ getPlatformProxy }) =>
            getPlatformProxy({
                configPath: resolveWranglerConfigPath(process.env),
                environment: process.env.CLOUDFLARE_ENV,
                persist: localMiniflareRoot ? { path: localMiniflareRoot } : true,
                remoteBindings: shouldUseRemoteBindings(process.env),
            } satisfies GetPlatformProxyOptions),
    )
}
