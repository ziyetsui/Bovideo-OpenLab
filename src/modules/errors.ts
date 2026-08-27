/** A stable, non-content-bearing reason that a generator cannot safely produce output. */
export class GenerationBlockedError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'GenerationBlockedError'
    this.code = code
  }
}
