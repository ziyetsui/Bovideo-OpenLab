import { isIP } from 'node:net'

import { EndpointPolicyError } from './errors'
import type { DnsResolver } from './types'

const HOST = 'twitter241.p.rapidapi.com'
const PATHS = new Set(['/search-v2'])
const QUERY_KEYS = new Set(['query', 'type', 'count', 'cursor'])

type Ipv4Cidr = readonly [base: number, prefix: number]
const ipv4Number = (octets: readonly number[]): number => ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0
/** IANA special-purpose IPv4 allocations are denied before and after connect. */
const IPV4_SPECIAL_PURPOSE: readonly Ipv4Cidr[] = [
  [ipv4Number([0, 0, 0, 0]), 8], [ipv4Number([10, 0, 0, 0]), 8], [ipv4Number([100, 64, 0, 0]), 10], [ipv4Number([127, 0, 0, 0]), 8], [ipv4Number([169, 254, 0, 0]), 16], [ipv4Number([172, 16, 0, 0]), 12],
  [ipv4Number([192, 0, 0, 0]), 24], [ipv4Number([192, 0, 2, 0]), 24], [ipv4Number([192, 31, 196, 0]), 24], [ipv4Number([192, 52, 193, 0]), 24], [ipv4Number([192, 88, 99, 0]), 24], [ipv4Number([192, 168, 0, 0]), 16], [ipv4Number([192, 175, 48, 0]), 24],
  [ipv4Number([198, 18, 0, 0]), 15], [ipv4Number([198, 51, 100, 0]), 24], [ipv4Number([203, 0, 113, 0]), 24], [ipv4Number([224, 0, 0, 0]), 4], [ipv4Number([240, 0, 0, 0]), 4],
] as const
const inCidr = (value: number, [base, prefix]: Ipv4Cidr): boolean => ((value & (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0)) >>> 0) === base

const ipv4PrivateOrReserved = (address: string): boolean => {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true
  return IPV4_SPECIAL_PURPOSE.some((cidr) => inCidr(ipv4Number(octets), cidr))
}

const ipv6Bytes = (address: string): Uint8Array | undefined => {
  const value = address.toLowerCase().replace(/%.+$/, '')
  const embedded = value.includes('.') ? value.replace(/(?:\d+\.){3}\d+$/, (ipv4) => {
    const octets = ipv4.split('.').map(Number); return octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) ? `${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}` : 'invalid'
  }) : value
  if (embedded.includes('invalid') || embedded.split('::').length > 2) return undefined
  const [left, right = ''] = embedded.split('::'); const leftParts = left ? left.split(':') : []; const rightParts = right ? right.split(':') : []
  const groups = embedded.includes('::') ? [...leftParts, ...Array(8 - leftParts.length - rightParts.length).fill('0'), ...rightParts] : leftParts
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return undefined
  const out = new Uint8Array(16); groups.forEach((group, index) => { const parsed = Number.parseInt(group, 16); out[index * 2] = parsed >> 8; out[index * 2 + 1] = parsed & 0xff })
  return out
}
const ipv6PrivateOrReserved = (address: string): boolean => {
  const bytes = ipv6Bytes(address); if (!bytes) return true
  // Dotted IPv4 tails are never acceptable in provider DNS answers, even when syntactically IPv6.
  if (address.includes('.')) return true
  const allZero = bytes.every((value) => value === 0)
  const loopback = bytes.slice(0, 15).every((value) => value === 0) && bytes[15] === 1
  const mapped = bytes.slice(0, 10).every((value) => value === 0) && bytes[10] === 0xff && bytes[11] === 0xff
  const compatibleV4 = bytes.slice(0, 12).every((value) => value === 0)
  const globalUnicast = (bytes[0]! & 0xe0) === 0x20
  const special2001 = bytes[0] === 0x20 && bytes[1] === 0x01 && (
    (bytes[2] === 0x0d && bytes[3] === 0xb8) || // documentation 2001:db8::/32
    (bytes[2] === 0x00 && (bytes[3] === 0x00 || bytes[3] === 0x02 || bytes[3] === 0x03 || bytes[3] === 0x10 || (bytes[3]! & 0xf0) === 0x20 || (bytes[3]! & 0xf0) === 0x30)) || // Teredo, benchmark, AMT, ORCHID, ORCHIDv2, AS112
    (bytes[2] === 0x00 && bytes[3] === 0x04 && bytes[4] === 0x01 && bytes[5] === 0x12) // AS112-v6 2001:4:112::/48
  )
  const iana2001Reserved = bytes[0] === 0x20 && bytes[1] === 0x01 && (bytes[2]! & 0xfe) === 0
  const special2001Host = bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x01 && bytes.slice(4, 15).every((value) => value === 0) && [1, 2, 3].includes(bytes[15]!)
  const special2620 = bytes[0] === 0x26 && bytes[1] === 0x20 && bytes[2] === 0x00 && bytes[3] === 0x4f && bytes[4] === 0x80 && bytes[5] === 0x00
  const special3fff = bytes[0] === 0x3f && bytes[1] === 0xff && (bytes[2]! & 0xf0) === 0x00
  const nat64 = bytes[0] === 0x64 && bytes[1] === 0xff && bytes[2] === 0x9b
  const sixToFour = bytes[0] === 0x20 && bytes[1] === 0x02
  // Accept only ordinary 2000::/3 global unicast. Everything else is fail-closed, including
  // loopback, link-local, ULA, multicast and IPv4 translation/embedding forms.
  return allZero || loopback || !globalUnicast || bytes[0] === 0xff || (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) ||
    (bytes[0]! & 0xfe) === 0xfc || mapped || compatibleV4 || nat64 || sixToFour || iana2001Reserved || special2001 || special2001Host || special2620 || special3fff
}

const assertAddress = (address: string): void => {
  const family = isIP(address)
  if (family === 0) throw new EndpointPolicyError('DNS answer is not an IP address')
  if ((family === 4 && ipv4PrivateOrReserved(address)) || (family === 6 && ipv6PrivateOrReserved(address)))
    throw new EndpointPolicyError('DNS answer is private or reserved')
}

/** Pure canonical provider URL gate shared by legacy compatibility and DNS-pinned fetches. */
export const parseTwitter241Endpoint = (value: string): URL => {
  let url: URL
  try { url = new URL(value) } catch { throw new EndpointPolicyError('URL is invalid') }
  if (url.protocol !== 'https:' || url.hostname !== HOST || url.hostname.endsWith('.') || url.port !== '' || url.username !== '' || url.password !== '' || url.hash !== '' || !PATHS.has(url.pathname) || isIP(url.hostname) !== 0)
    throw new EndpointPolicyError('scheme, host, port, path, or credentials are not allowlisted')
  const seenQueryKeys = new Set<string>()
  for (const [key, value] of url.searchParams) {
    if (seenQueryKeys.has(key)) throw new EndpointPolicyError('duplicate query parameter is not allowlisted')
    seenQueryKeys.add(key)
    if (!QUERY_KEYS.has(key) || value.length === 0) throw new EndpointPolicyError('query parameter is not allowlisted')
    if (key === 'type' && value !== 'Latest' && value !== 'Top') throw new EndpointPolicyError('query type is not allowlisted')
    if (key === 'count' && (!/^[1-9][0-9]{0,2}$/.test(value) || Number(value) > 100)) throw new EndpointPolicyError('query count is not allowlisted')
  }
  if (!url.searchParams.has('query') || !url.searchParams.has('type') || !url.searchParams.has('count'))
    throw new EndpointPolicyError('required query parameters are missing')
  return url
}

/** Enforces the only P1 provider endpoint and validates every A/AAAA answer on every hop. */
export const assertTwitter241Endpoint = async (value: string, dns: DnsResolver): Promise<URL> => {
  const url = parseTwitter241Endpoint(value)
  const answers = await dns.resolve(url.hostname)
  if (answers.length === 0) throw new EndpointPolicyError('DNS returned no addresses')
  answers.forEach(assertAddress)
  return url
}

export const resolvePinnedTwitter241Endpoint = async (value: string, dns: DnsResolver): Promise<Readonly<{ url: URL; allowed_peers: readonly string[] }>> => {
  const url = await assertTwitter241Endpoint(value, dns)
  const answers = await dns.resolve(url.hostname)
  if (answers.length === 0) throw new EndpointPolicyError('DNS returned no addresses')
  answers.forEach(assertAddress)
  return Object.freeze({ url, allowed_peers: Object.freeze([...answers]) })
}

/** Connect-time re-resolution defeats DNS rebinding between request validation and the peer connection. */
export const assertTwitter241ConnectPeer = async (hostname: string, peerAddress: string, dns: DnsResolver): Promise<void> => {
  if (hostname !== HOST) throw new EndpointPolicyError('connect host is not allowlisted')
  assertAddress(peerAddress)
  const current = await dns.resolve(hostname)
  if (current.length === 0) throw new EndpointPolicyError('connect-time DNS returned no addresses')
  current.forEach(assertAddress)
  if (!current.includes(peerAddress)) throw new EndpointPolicyError('connect peer does not match revalidated DNS')
}
