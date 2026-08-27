const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Generates a canonical ULID without encoding document or credential data. */
export const createUlid = (): string => {
  let timestamp = BigInt(Date.now())
  let value = ''
  for (let index = 0; index < 10; index += 1) {
    value = CROCKFORD[Number(timestamp & 31n)] + value
    timestamp >>= 5n
  }
  const random = new Uint8Array(16)
  globalThis.crypto.getRandomValues(random)
  for (let index = 0; index < random.length; index += 1) value += CROCKFORD[random[index] & 31]
  return value
}
