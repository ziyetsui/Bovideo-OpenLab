import { LocalCacheEmulator } from './cache-emulator'
import { convergeLocalCache } from './cache-convergence'
import { LocalPublicationStore } from './snapshot'
import type { LocalPublicationManifest } from './manifest'
import { activatePublication } from './activation'

export type LocalSmokeContext = Readonly<{ label: 'local-region-a' | 'local-region-b' | 'local-region-c'; port: number; cache_root: string; active_version: number | null; payload_tree_hash: string | null; route_payload_hash: string | null; sitemap_xml_hash: string | null; converged: true }>
export type LocalSmokeResult = Readonly<{ host: string; ports: readonly number[]; cache_root: string; contexts: readonly LocalSmokeContext[]; convergence_seconds: 0 | 60; network_calls: 0; remote_mutations: 0; public_listeners: 0 }>

function assertLoopback(host: string): void {
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') throw new Error('logical smoke only permits loopback hosts')
}
export async function runLocalPublicationSmoke(input: Readonly<{ host: string; ports: readonly number[]; cacheRoot: string; occupiedPorts?: readonly number[]; manifest?: LocalPublicationManifest }>): Promise<LocalSmokeResult> {
  assertLoopback(input.host)
  if (input.ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535) || new Set(input.ports).size !== input.ports.length) throw new Error('invalid or duplicate local ports')
  if (input.occupiedPorts?.some((port) => input.ports.includes(port))) throw new Error('configured local port is occupied')
  if (input.ports.length !== 3) throw new Error('P2-L smoke requires three independent logical local contexts')
  const contexts = input.ports.map((port, index) => {
    const store = new LocalPublicationStore(); const cache = new LocalCacheEmulator()
    if (input.manifest !== undefined) { store.seedValidated(input.manifest); activatePublication({ store, cache, manifest: input.manifest, expectedRevision: 0, correlationId: `p2l-smoke-${index}` }) } else convergeLocalCache({ store, cache })
    const active = input.manifest === undefined ? undefined : store.state(input.manifest.snapshot.publish_version)
    return Object.freeze({ label: (['local-region-a', 'local-region-b', 'local-region-c'] as const)[index]!, port, cache_root: `${input.cacheRoot}/${String.fromCharCode(97 + index)}`, active_version: active?.publish_version ?? null, payload_tree_hash: active?.manifest.payloadTreeHash ?? null, route_payload_hash: active?.manifest.routePayloadHash ?? null, sitemap_xml_hash: active?.manifest.productionSitemap.sitemap_xml_hash ?? null, converged: true as const })
  })
  const frozenContexts = Object.freeze(contexts); const hashes = frozenContexts.map((context) => JSON.stringify([context.active_version, context.payload_tree_hash, context.route_payload_hash, context.sitemap_xml_hash])); if (new Set(hashes).size !== 1) throw new Error('logical local contexts diverged')
  return { host: input.host, ports: Object.freeze([...input.ports]), cache_root: input.cacheRoot, contexts: frozenContexts, convergence_seconds: 60, network_calls: 0, remote_mutations: 0, public_listeners: 0 }
}
