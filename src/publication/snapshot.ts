import type { LocalPublicationManifest } from './manifest'

export type LocalPublicationLifecycle = 'validated' | 'active' | 'superseded' | 'rolled_back' | 'withdrawn'
export type LocalPointer = Readonly<{
  publish_version: number | null
  previous_verified_version: number | null
  revision: number
}>
export type LocalPublicationRecord = Readonly<{
  publish_version: number
  status: LocalPublicationLifecycle
  revision: number
  manifest: LocalPublicationManifest
  withdrawn_locales: readonly string[]
}>
export type PublicationAudit = Readonly<{
  action: 'activate' | 'rollback' | 'withdraw'
  outcome: 'allowed' | 'failed'
  publish_version: number
  correlation_id: string
  at: string
  reason_code: string
}>

export type LocalPublicationTransaction = Readonly<{
  pointer: LocalPointer
  state: (version: number) => LocalPublicationRecord | undefined
  setState: (record: LocalPublicationRecord) => void
  deleteState: (version: number) => void
  setPointer: (pointer: LocalPointer) => void
  audit: (event: PublicationAudit) => void
}>

const cloneRecord = (record: LocalPublicationRecord): LocalPublicationRecord => Object.freeze({
  ...record,
  withdrawn_locales: Object.freeze([...record.withdrawn_locales]),
})

/** A deterministic, transaction-shaped write plane for the local P2-L emulator. */
export class LocalPublicationStore {
  #pointer: LocalPointer = Object.freeze({ publish_version: null, previous_verified_version: null, revision: 0 })
  readonly #states = new Map<number, LocalPublicationRecord>()
  readonly #audits: PublicationAudit[] = []

  pointer(): LocalPointer { return this.#pointer }
  state(version: number): LocalPublicationRecord | undefined {
    const record = this.#states.get(version)
    return record === undefined ? undefined : cloneRecord(record)
  }
  states(): readonly LocalPublicationRecord[] { return [...this.#states.values()].sort((a, b) => a.publish_version - b.publish_version).map(cloneRecord) }
  audits(): readonly PublicationAudit[] { return this.#audits.map((event) => Object.freeze({ ...event })) }

  transaction<T>(expectedRevision: number, work: (tx: LocalPublicationTransaction) => T, afterCommit?: () => void): T {
    if (this.#pointer.revision !== expectedRevision) throw new Error(`publication pointer revision conflict: expected ${expectedRevision}, got ${this.#pointer.revision}`)
    const beforePointer = this.#pointer
    const beforeStates = new Map(this.#states)
    const beforeAudits = this.#audits.slice()
    const stagedAudits: PublicationAudit[] = []
    const tx: LocalPublicationTransaction = {
      pointer: this.#pointer,
      state: (version) => this.#states.get(version),
      setState: (record) => this.#states.set(record.publish_version, cloneRecord(record)),
      deleteState: (version) => this.#states.delete(version),
      setPointer: (pointer) => { this.#pointer = Object.freeze({ ...pointer }) },
      audit: (event) => stagedAudits.push(Object.freeze({ ...event })),
    }
    try {
      const result = work(tx)
      this.#audits.push(...stagedAudits)
      afterCommit?.()
      return result
    } catch (error) {
      this.#pointer = beforePointer
      this.#states.clear()
      for (const [version, record] of beforeStates) this.#states.set(version, record)
      this.#audits.splice(0, this.#audits.length, ...beforeAudits)
      throw error
    }
  }

  seedValidated(manifest: LocalPublicationManifest): LocalPublicationRecord {
    const record = Object.freeze({ publish_version: manifest.snapshot.publish_version, status: 'validated' as const, revision: 1, manifest, withdrawn_locales: Object.freeze([]) })
    this.#states.set(record.publish_version, record)
    return record
  }
}

export const InMemoryPublicationStore = LocalPublicationStore
