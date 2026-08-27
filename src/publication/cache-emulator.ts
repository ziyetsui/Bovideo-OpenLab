export type LocalCacheEntry = Readonly<{ key: string; publish_version: number; status: 'active' | 'withdrawn'; revision: number; body_status: 200 | 410 }>

/** In-memory cache only: no sockets, fetches, listeners or remote mutation hooks. */
export class LocalCacheEmulator {
  readonly #entries = new Map<string, LocalCacheEntry>()
  #networkCalls = 0
  #publicListeners = 0
  put(entry: LocalCacheEntry): void { this.#entries.set(entry.key, Object.freeze({ ...entry })) }
  get(key: string): LocalCacheEntry | undefined { return this.#entries.get(key) }
  entries(): readonly LocalCacheEntry[] { return [...this.#entries.values()] }
  purge(key: string): void { this.#entries.delete(key) }
  restore(entries: readonly LocalCacheEntry[]): void {
    this.#entries.clear()
    for (const entry of entries) this.put(entry)
  }
  networkCalls(): number { return this.#networkCalls }
  publicListeners(): number { return this.#publicListeners }
}

export const CacheEmulator = LocalCacheEmulator
