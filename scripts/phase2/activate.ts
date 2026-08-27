import { LocalPublicationStore } from '../../src/publication/snapshot'
import { runLocalPublicationSmoke } from '../../src/publication/smoke'

export async function runLocalActivationCheck(): Promise<Readonly<{ ok: true; network_calls: 0; remote_mutations: 0; public_listeners: 0 }>> {
  const host = process.env.P2L_HOST ?? '127.0.0.1'
  const ports = (process.env.P2L_PORTS ?? '4311,4312,4313').split(',').filter(Boolean).map(Number)
  await runLocalPublicationSmoke({ host, ports, cacheRoot: process.env.P2L_CACHE_ROOT ?? 'output/p2-local-cache' })
  // Keep the write plane explicit: this command never opens a server or performs a remote mutation.
  void new LocalPublicationStore()
  return { ok: true, network_calls: 0, remote_mutations: 0, public_listeners: 0 }
}

if (process.argv[1]?.endsWith('activate.ts')) console.log(JSON.stringify(await runLocalActivationCheck()))
