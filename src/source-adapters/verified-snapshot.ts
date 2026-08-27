import { createHash } from 'node:crypto'

/** Minimal B0 continuity reader used only to prove acquisition failures cannot mutate verified bytes. */
export type VerifiedSnapshotB0 = Readonly<{ pointer: string; version: string; tree_hash: string; payload: Uint8Array; audit_prefix_hash: string }>

export class InMemoryVerifiedSnapshotReader {
  readonly #snapshot: VerifiedSnapshotB0
  constructor(snapshot: VerifiedSnapshotB0) {
    const payload = new Uint8Array(snapshot.payload)
    const hash = `sha256:v1:${createHash('sha256').update(payload).digest('hex')}`
    if (snapshot.tree_hash !== hash) throw new Error('verified snapshot tree hash does not match payload')
    this.#snapshot = Object.freeze({ ...snapshot, payload })
  }
  read(): VerifiedSnapshotB0 { return Object.freeze({ ...this.#snapshot, payload: new Uint8Array(this.#snapshot.payload) }) }
}
