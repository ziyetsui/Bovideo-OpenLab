import { createHash } from 'node:crypto'

import { objectDeletionStateSchema, objectNamespaceSchema, type ObjectDeletionState, type ObjectNamespace } from './object-ref'
import { rightsStateSchema, type RightsState } from '@/contracts/rights'

export type ObjectUploadInput = Readonly<{
  namespace: ObjectNamespace
  key: string
  bytes: Uint8Array
  declared_size: number
  declared_hash: string
  declared_mime_type: string
  rights_state: RightsState
  deletion_state: ObjectDeletionState
}>

export type ValidatedObjectUpload = Readonly<{
  computed_hash: string
  size_bytes: number
  mime_type: string
}>

const MAX_RAW_BYTES = 25 * 1024 * 1024
const MAX_MEDIA_BYTES = 50 * 1024 * 1024
const allowedMimeTypes: Readonly<Record<ObjectNamespace, ReadonlySet<string>>> = {
  'raw-evidence': new Set(['application/json', 'text/plain', 'application/pdf', 'image/png', 'image/jpeg']),
  'review-media': new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4']),
  'published-snapshots': new Set(['application/json', 'text/html', 'application/xml', 'application/zip']),
  'public-media': new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4']),
}
const extensions: Readonly<Record<string, readonly string[]>> = {
  'application/json': ['.json'], 'text/plain': ['.txt'], 'application/pdf': ['.pdf'], 'text/html': ['.html'], 'application/xml': ['.xml'], 'application/zip': ['.zip'],
  'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/gif': ['.gif'], 'image/webp': ['.webp'], 'video/mp4': ['.mp4'],
}

const starts = (bytes: Uint8Array, prefix: readonly number[]): boolean => prefix.every((value, index) => bytes[index] === value)
const hasMagic = (bytes: Uint8Array, mimeType: string): boolean => {
  switch (mimeType) {
    case 'image/png': return starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'image/jpeg': return starts(bytes, [0xff, 0xd8, 0xff])
    case 'image/gif': return starts(bytes, [0x47, 0x49, 0x46, 0x38])
    case 'image/webp': return starts(bytes, [0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
    case 'video/mp4': return String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp'
    case 'application/pdf': return starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])
    default: return true
  }
}
const contains = (bytes: Uint8Array, sequence: readonly number[], from = 0): boolean => {
  for (let index = from; index <= bytes.length - sequence.length; index += 1)
    if (sequence.every((value, offset) => bytes[index + offset] === value)) return true
  return false
}
const looksLikePolyglot = (bytes: Uint8Array, mimeType: string): boolean => {
  if (!mimeType.startsWith('image/') && mimeType !== 'video/mp4') return false
  // Container parsers above establish terminal framing; this is a bounded
  // second-line rejection for embedded executable/archive containers without
  // decoding arbitrary binary bytes as text.
  return contains(bytes, [0x50, 0x4b, 0x03, 0x04], 8) || contains(bytes, [0x4d, 0x5a], 8)
}
const MAX_CONTAINER_UNITS = 4096
const u16be = (bytes: Uint8Array, offset: number): number => ((bytes[offset] ?? 0) * 0x100) + (bytes[offset + 1] ?? 0)
const u16le = (bytes: Uint8Array, offset: number): number => (bytes[offset] ?? 0) + ((bytes[offset + 1] ?? 0) * 0x100)
const u32 = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] ?? 0) * 0x1000000) + ((bytes[offset + 1] ?? 0) * 0x10000) + ((bytes[offset + 2] ?? 0) * 0x100) + (bytes[offset + 3] ?? 0)
const u32le = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] ?? 0) + ((bytes[offset + 1] ?? 0) * 0x100) + ((bytes[offset + 2] ?? 0) * 0x10000) + ((bytes[offset + 3] ?? 0) * 0x1000000)
const ascii = (bytes: Uint8Array, start: number, end: number): string => String.fromCharCode(...bytes.slice(start, end))
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) === 0 ? 0 : 0xedb88320)
  return value >>> 0
})
const crc32 = (bytes: Uint8Array, start: number, end: number): number => {
  let value = 0xffffffff
  for (let index = start; index < end; index += 1) value = (value >>> 8) ^ crcTable[(value ^ bytes[index]!) & 0xff]!
  return (value ^ 0xffffffff) >>> 0
}

/**
 * These are intentionally bounded structural parsers, not content decoders.
 * They reject a valid-looking header followed by active/trailing payload bytes.
 */
const completePng = (bytes: Uint8Array): boolean => {
  if (!starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return false
  let offset = 8
  let colorType = -1
  let sawPlte = false
  let sawIdat = false
  let idatClosed = false
  for (let chunks = 0; chunks < MAX_CONTAINER_UNITS && offset + 12 <= bytes.length; chunks += 1) {
    const length = u32(bytes, offset)
    const type = ascii(bytes, offset + 4, offset + 8)
    const next = offset + 12 + length
    if (!Number.isSafeInteger(next) || next > bytes.length) return false
    if (crc32(bytes, offset + 4, next - 4) !== u32(bytes, next - 4)) return false
    if (chunks === 0) {
      const bitDepth = bytes[offset + 16]
      colorType = bytes[offset + 17] ?? -1
      const validDepth = (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth ?? -1)) ||
        (colorType === 2 && [8, 16].includes(bitDepth ?? -1)) ||
        (colorType === 3 && [1, 2, 4, 8].includes(bitDepth ?? -1)) ||
        ((colorType === 4 || colorType === 6) && [8, 16].includes(bitDepth ?? -1))
      if (type !== 'IHDR' || length !== 13 || u32(bytes, offset + 8) === 0 || u32(bytes, offset + 12) === 0 || !validDepth || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || ![0, 1].includes(bytes[offset + 20] ?? -1)) return false
      offset = next
      continue
    } else if (type === 'IHDR') return false
    if (type === 'PLTE') {
      if (sawPlte || sawIdat || colorType === 0 || colorType === 4 || length < 3 || length > 768 || length % 3 !== 0) return false
      sawPlte = true
    } else if (type === 'IDAT') {
      if (length === 0 || idatClosed || (colorType === 3 && !sawPlte)) return false
      sawIdat = true
    } else if (type === 'IEND') return length === 0 && sawIdat && next === bytes.length
    else {
      if (sawIdat) idatClosed = true
      const first = bytes[offset + 4] ?? 0
      if (first >= 0x41 && first <= 0x5a) return false
    }
    offset = next
  }
  return false
}

const isSofMarker = (marker: number): boolean =>
  (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
  (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)

const readJpegQuantizationTables = (bytes: Uint8Array, start: number, end: number, tables: Set<number>): boolean => {
  let offset = start
  while (offset < end) {
    const info = bytes[offset++]
    if (info === undefined || (info & 0x0f) > 3 || (info & 0xf0) > 0x10) return false
    const width = (info & 0x10) === 0 ? 64 : 128
    if (offset + width > end || tables.has(info & 0x0f)) return false
    tables.add(info & 0x0f)
    offset += width
  }
  return offset === end
}
const readJpegHuffmanTables = (bytes: Uint8Array, start: number, end: number, tables: Set<string>): boolean => {
  let offset = start
  while (offset < end) {
    const info = bytes[offset++]
    if (info === undefined || (info & 0x0f) > 3 || (info & 0xf0) > 0x10 || offset + 16 > end || tables.has(`${info >> 4}:${info & 0x0f}`)) return false
    let symbols = 0
    for (let index = 0; index < 16; index += 1) symbols += bytes[offset + index] ?? 0
    offset += 16
    if (symbols === 0 || offset + symbols > end) return false
    tables.add(`${info >> 4}:${info & 0x0f}`)
    offset += symbols
  }
  return offset === end
}

const completeJpeg = (bytes: Uint8Array): boolean => {
  if (!starts(bytes, [0xff, 0xd8])) return false
  let offset = 2
  let sawFrame = false
  const quantizationTables = new Set<number>()
  const huffmanTables = new Set<string>()
  for (let units = 0; units < MAX_CONTAINER_UNITS && offset < bytes.length; units += 1) {
    if (bytes[offset] !== 0xff) return false
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset++]
    if (marker === undefined || marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) return false
    if (marker === 0xd9) return sawFrame && offset === bytes.length
    if (marker === 0x01) continue
    if (offset + 2 > bytes.length) return false
    const segmentLength = u16be(bytes, offset)
    offset += 2
    if (segmentLength < 2 || offset + segmentLength - 2 > bytes.length) return false
    const segmentEnd = offset + segmentLength - 2
    if (isSofMarker(marker)) {
      const components = bytes[offset + 5] ?? 0
      if (sawFrame || components < 1 || components > 4 || segmentLength !== 8 + (3 * components) || u16be(bytes, offset + 1) === 0 || u16be(bytes, offset + 3) === 0) return false
      for (let index = 0; index < components; index += 1) if (!quantizationTables.has(bytes[offset + 8 + (3 * index)] ?? -1)) return false
      sawFrame = true
    }
    if (marker === 0xdb && !readJpegQuantizationTables(bytes, offset, segmentEnd, quantizationTables)) return false
    if (marker === 0xc4 && !readJpegHuffmanTables(bytes, offset, segmentEnd, huffmanTables)) return false
    if (marker !== 0xda) { offset = segmentEnd; continue }
    const scanComponents = bytes[offset] ?? 0
    if (!sawFrame || quantizationTables.size === 0 || huffmanTables.size === 0 || scanComponents < 1 || scanComponents > 4 || segmentLength !== 6 + (2 * scanComponents)) return false
    for (let index = 0; index < scanComponents; index += 1) {
      const tableSelector = bytes[offset + 2 + (2 * index)] ?? -1
      if (!huffmanTables.has(`${tableSelector >> 4}:${tableSelector & 0x0f}`) || !huffmanTables.has(`1:${tableSelector & 0x0f}`)) return false
    }
    offset = segmentEnd
    let entropyBytes = 0
    for (let entropy = 0; entropy < bytes.length && offset < bytes.length; entropy += 1) {
      if (bytes[offset++] !== 0xff) { entropyBytes += 1; continue }
      while (bytes[offset] === 0xff) offset += 1
      const entropyMarker = bytes[offset++]
      if (entropyMarker === undefined) return false
      if (entropyMarker === 0x00 || (entropyMarker >= 0xd0 && entropyMarker <= 0xd7)) continue
      return entropyMarker === 0xd9 && entropyBytes > 0 && offset === bytes.length
    }
    return false
  }
  return false
}

const skipGifSubblocks = (bytes: Uint8Array, start: number): Readonly<{ offset: number; data_bytes: number }> | undefined => {
  let offset = start
  let dataBytes = 0
  for (let blocks = 0; blocks < MAX_CONTAINER_UNITS; blocks += 1) {
    const length = bytes[offset++]
    if (length === undefined || offset + length > bytes.length) return undefined
    if (length === 0) return { offset, data_bytes: dataBytes }
    dataBytes += length
    offset += length
  }
  return undefined
}

const completeGif = (bytes: Uint8Array): boolean => {
  if ((ascii(bytes, 0, 6) !== 'GIF87a' && ascii(bytes, 0, 6) !== 'GIF89a') || bytes.length < 14) return false
  if (u16le(bytes, 6) === 0 || u16le(bytes, 8) === 0) return false
  let offset = 13
  const globalPacked = bytes[10] ?? 0
  let hasColorTable = false
  if ((globalPacked & 0x80) !== 0) {
    const tableBytes = 3 * (1 << ((globalPacked & 0x07) + 1))
    if (offset + tableBytes > bytes.length) return false
    offset += tableBytes
    hasColorTable = true
  }
  let sawImage = false
  for (let units = 0; units < MAX_CONTAINER_UNITS && offset < bytes.length; units += 1) {
    const block = bytes[offset++]
    if (block === 0x3b) return sawImage && offset === bytes.length
    if (block === 0x2c) {
      const descriptor = offset - 1
      if (offset + 9 > bytes.length || u16le(bytes, descriptor + 5) === 0 || u16le(bytes, descriptor + 7) === 0) return false
      const packed = bytes[offset + 8] ?? 0
      offset += 9
      if ((packed & 0x80) !== 0) {
        const tableBytes = 3 * (1 << ((packed & 0x07) + 1))
        if (offset + tableBytes > bytes.length) return false
        offset += tableBytes
        hasColorTable = true
      }
      const lzwMinimumCodeSize = bytes[offset++]
      if (lzwMinimumCodeSize === undefined || lzwMinimumCodeSize < 2 || lzwMinimumCodeSize > 8) return false
      const next = skipGifSubblocks(bytes, offset)
      if (next === undefined || next.data_bytes === 0 || !hasColorTable) return false
      offset = next.offset
      sawImage = true
      continue
    }
    if (block !== 0x21 || offset >= bytes.length) return false
    offset += 1 // extension label
    const next = skipGifSubblocks(bytes, offset)
    if (next === undefined) return false
    offset = next.offset
  }
  return false
}

const completeWebp = (bytes: Uint8Array): boolean => {
  if (!starts(bytes, [0x52, 0x49, 0x46, 0x46]) || ascii(bytes, 8, 12) !== 'WEBP' || u32le(bytes, 4) + 8 !== bytes.length) return false
  let offset = 12
  let sawPrimary = false
  for (let chunks = 0; chunks < MAX_CONTAINER_UNITS && offset < bytes.length; chunks += 1) {
    if (offset + 8 > bytes.length) return false
    const type = ascii(bytes, offset, offset + 4)
    const length = u32le(bytes, offset + 4)
    const data = offset + 8
    const padded = length + (length & 1)
    const next = data + padded
    if (!Number.isSafeInteger(next) || next > bytes.length) return false
    if (!sawPrimary) {
      if (type === 'VP8 ') {
        const frameTag = (bytes[data] ?? 0) | ((bytes[data + 1] ?? 0) << 8) | ((bytes[data + 2] ?? 0) << 16)
        const frameSize = frameTag >>> 5
        if (length < 12 || (frameTag & 1) !== 0 || frameSize < 12 || frameSize > length || bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a || (u16le(bytes, data + 6) & 0x3fff) === 0 || (u16le(bytes, data + 8) & 0x3fff) === 0) return false
      } else if (type === 'VP8L') {
        if (length < 5 || bytes[data] !== 0x2f) return false
        const dimensions = u32le(bytes, data + 1)
        if ((dimensions & 0x3fff) === 0 || ((dimensions >>> 14) & 0x3fff) === 0) return false
      } else return false
      sawPrimary = true
    } else if (type === 'VP8 ' || type === 'VP8L' || type === 'VP8X') return false
    offset = next
  }
  return sawPrimary && offset === bytes.length
}

type IsoBox = Readonly<{ type: string; payload_start: number; end: number }>
const isoBoxes = (bytes: Uint8Array, start: number, end: number, budget: { remaining: number }): readonly IsoBox[] | undefined => {
  const boxes: IsoBox[] = []
  let offset = start
  while (offset < end && budget.remaining > 0) {
    if (offset + 8 > end) return undefined
    let size = u32(bytes, offset)
    const type = ascii(bytes, offset + 4, offset + 8)
    let header = 8
    if (size === 0) return undefined
    if (size === 1) {
      if (offset + 16 > end || u32(bytes, offset + 8) !== 0) return undefined
      size = u32(bytes, offset + 12)
      header = 16
    }
    if (size < header || size > end - offset) return undefined
    boxes.push(Object.freeze({ type, payload_start: offset + header, end: offset + size }))
    offset += size
    budget.remaining -= 1
  }
  return offset === end && budget.remaining >= 0 ? boxes : undefined
}
const onlyBox = (boxes: readonly IsoBox[], type: string): IsoBox | undefined => {
  const found = boxes.filter((box) => box.type === type)
  return found.length === 1 ? found[0] : undefined
}
const validMvhd = (bytes: Uint8Array, box: IsoBox): boolean =>
  box.end - box.payload_start >= 100 && bytes[box.payload_start] === 0 && u32(bytes, box.payload_start + 12) > 0 && u32(bytes, box.payload_start + 16) > 0 && u32(bytes, box.payload_start + 20) === 0x00010000 && u16be(bytes, box.payload_start + 24) === 0x0100
const validMdhd = (bytes: Uint8Array, box: IsoBox): boolean =>
  box.end - box.payload_start >= 24 && bytes[box.payload_start] === 0 && u32(bytes, box.payload_start + 12) > 0 && u32(bytes, box.payload_start + 16) > 0
const validTkhd = (bytes: Uint8Array, box: IsoBox): boolean =>
  box.end - box.payload_start >= 84 && bytes[box.payload_start] === 0 && u32(bytes, box.payload_start + 12) > 0 && u32(bytes, box.payload_start + 20) > 0 && u32(bytes, box.payload_start + 76) > 0 && u32(bytes, box.payload_start + 80) > 0
const fullBoxEntryCount = (bytes: Uint8Array, box: IsoBox, entryBytes: number): number | undefined => {
  if (box.end - box.payload_start < 8 || bytes[box.payload_start] !== 0) return undefined
  const count = u32(bytes, box.payload_start + 4)
  if (count === 0 || count > MAX_CONTAINER_UNITS || box.end - box.payload_start !== 8 + (count * entryBytes)) return undefined
  return count
}
/** Bounded AVCDecoderConfigurationRecord parser for the narrow avc1 MP4 profile. */
const validAvcDecoderConfiguration = (bytes: Uint8Array, box: IsoBox): boolean => {
  let offset = box.payload_start
  const end = box.end
  // version/profile/compatibility/level, reserved length-size byte, reserved SPS-count byte.
  if (end - offset < 7 || bytes[offset] !== 1 || (bytes[offset + 4]! & 0xfc) !== 0xfc || (bytes[offset + 4]! & 0x03) === 2 || (bytes[offset + 5]! & 0xe0) !== 0xe0) return false
  const spsCount = bytes[offset + 5]! & 0x1f
  if (spsCount === 0 || spsCount > 16) return false
  offset += 6
  const parseNals = (count: number, expectedType: number): boolean => {
    for (let index = 0; index < count; index += 1) {
      if (offset + 2 > end) return false
      const length = u16be(bytes, offset); offset += 2
      if (length === 0 || length > end - offset || length > 1_048_576 || (bytes[offset]! & 0x1f) !== expectedType) return false
      offset += length
    }
    return true
  }
  if (!parseNals(spsCount, 7) || offset >= end) return false
  const ppsCount = bytes[offset]!
  if (ppsCount === 0 || ppsCount > 16) return false
  offset += 1
  return parseNals(ppsCount, 8) && offset === end
}
const validAvc1SampleDescription = (bytes: Uint8Array, box: IsoBox, budget: { remaining: number }): boolean => {
  if (box.end - box.payload_start < 8 || bytes[box.payload_start] !== 0 || u32(bytes, box.payload_start + 4) !== 1) return false
  const entries = isoBoxes(bytes, box.payload_start + 8, box.end, budget)
  const entry = entries?.length === 1 ? entries[0] : undefined
  if (entry === undefined || entry.type !== 'avc1' || entry.end - entry.payload_start < 82 || u16be(bytes, entry.payload_start + 6) === 0 || u16be(bytes, entry.payload_start + 24) === 0 || u16be(bytes, entry.payload_start + 26) === 0 || u16be(bytes, entry.payload_start + 74) === 0) return false
  const configuration = isoBoxes(bytes, entry.payload_start + 78, entry.end, budget)
  const avcC = configuration?.length === 1 ? configuration[0] : undefined
  return avcC !== undefined && avcC.type === 'avcC' && validAvcDecoderConfiguration(bytes, avcC)
}
const validSampleTable = (bytes: Uint8Array, stsd: IsoBox, stts: IsoBox, stsc: IsoBox, stsz: IsoBox, chunkOffsets: IsoBox, mdat: IsoBox, budget: { remaining: number }): boolean => {
  if (!validAvc1SampleDescription(bytes, stsd, budget)) return false
  const timingCount = fullBoxEntryCount(bytes, stts, 8)
  const chunkMapCount = fullBoxEntryCount(bytes, stsc, 12)
  if (timingCount !== 1 || chunkMapCount !== 1) return false
  const timingSamples = u32(bytes, stts.payload_start + 8)
  const timingDelta = u32(bytes, stts.payload_start + 12)
  if (timingSamples === 0 || timingDelta === 0) return false
  if (u32(bytes, stsc.payload_start + 8) !== 1 || u32(bytes, stsc.payload_start + 12) === 0 || u32(bytes, stsc.payload_start + 16) !== 1) return false
  if (stsz.end - stsz.payload_start < 12 || bytes[stsz.payload_start] !== 0) return false
  const fixedSize = u32(bytes, stsz.payload_start + 4)
  const sampleCount = u32(bytes, stsz.payload_start + 8)
  if (sampleCount !== timingSamples || sampleCount !== 1 || sampleCount > MAX_CONTAINER_UNITS) return false
  let mappedBytes = fixedSize
  if (fixedSize === 0) {
    if (stsz.end - stsz.payload_start !== 12 + (sampleCount * 4)) return false
    mappedBytes = u32(bytes, stsz.payload_start + 12)
  } else if (stsz.end - stsz.payload_start !== 12) return false
  if (mappedBytes === 0 || !Number.isSafeInteger(mappedBytes)) return false
  const offsetEntryBytes = chunkOffsets.type === 'stco' ? 4 : 8
  const offsetCount = fullBoxEntryCount(bytes, chunkOffsets, offsetEntryBytes)
  if (offsetCount !== 1) return false
  const offset = chunkOffsets.type === 'stco'
    ? u32(bytes, chunkOffsets.payload_start + 8)
    : u32(bytes, chunkOffsets.payload_start + 8) === 0 ? u32(bytes, chunkOffsets.payload_start + 12) : Number.NaN
  if (!Number.isSafeInteger(offset) || offset < mdat.payload_start || offset >= mdat.end || mappedBytes > mdat.end - offset) return false
  return u32(bytes, stsc.payload_start + 12) === sampleCount
}
const validTrack = (bytes: Uint8Array, track: IsoBox, mdat: IsoBox, budget: { remaining: number }): boolean => {
  const children = isoBoxes(bytes, track.payload_start, track.end, budget)
  const tkhd = children === undefined ? undefined : onlyBox(children, 'tkhd')
  const mdia = children === undefined ? undefined : onlyBox(children, 'mdia')
  if (tkhd === undefined || !validTkhd(bytes, tkhd) || mdia === undefined) return false
  const media = isoBoxes(bytes, mdia.payload_start, mdia.end, budget)
  const mdhd = media === undefined ? undefined : onlyBox(media, 'mdhd')
  const hdlr = media === undefined ? undefined : onlyBox(media, 'hdlr')
  const minf = media === undefined ? undefined : onlyBox(media, 'minf')
  if (mdhd === undefined || !validMdhd(bytes, mdhd) || hdlr === undefined || hdlr.end - hdlr.payload_start < 12 || ascii(bytes, hdlr.payload_start + 8, hdlr.payload_start + 12) !== 'vide' || minf === undefined) return false
  const minfChildren = isoBoxes(bytes, minf.payload_start, minf.end, budget)
  const stbl = minfChildren === undefined ? undefined : onlyBox(minfChildren, 'stbl')
  if (stbl === undefined) return false
  const sampleTable = isoBoxes(bytes, stbl.payload_start, stbl.end, budget)
  const stsd = sampleTable === undefined ? undefined : onlyBox(sampleTable, 'stsd')
  const stts = sampleTable === undefined ? undefined : onlyBox(sampleTable, 'stts')
  const stsc = sampleTable === undefined ? undefined : onlyBox(sampleTable, 'stsc')
  const stsz = sampleTable === undefined ? undefined : onlyBox(sampleTable, 'stsz')
  const stco = sampleTable === undefined ? undefined : onlyBox(sampleTable, 'stco')
  const co64 = sampleTable === undefined ? undefined : onlyBox(sampleTable, 'co64')
  if (stsd === undefined || stts === undefined || stsc === undefined || stsz === undefined || (stco === undefined && co64 === undefined) || (stco !== undefined && co64 !== undefined)) return false
  return validSampleTable(bytes, stsd, stts, stsc, stsz, stco ?? co64!, mdat, budget)
}
const completeMp4 = (bytes: Uint8Array): boolean => {
  const approvedBrands = new Set(['isom', 'iso2', 'mp41', 'mp42', 'avc1'])
  const budget = { remaining: MAX_CONTAINER_UNITS }
  const top = isoBoxes(bytes, 0, bytes.length, budget)
  if (top === undefined || top.length !== 3 || top[0]?.type !== 'ftyp' || top[1]?.type !== 'moov' || top[2]?.type !== 'mdat') return false
  const [ftyp, moov, mdat] = top
  if (ftyp.end - ftyp.payload_start < 8 || !approvedBrands.has(ascii(bytes, ftyp.payload_start, ftyp.payload_start + 4)) || mdat.end - mdat.payload_start < 1) return false
  const movie = isoBoxes(bytes, moov.payload_start, moov.end, budget)
  const mvhd = movie === undefined ? undefined : onlyBox(movie, 'mvhd')
  const track = movie === undefined ? undefined : onlyBox(movie, 'trak')
  return mvhd !== undefined && validMvhd(bytes, mvhd) && track !== undefined && validTrack(bytes, track, mdat, budget)
}

const hasCompleteContainer = (bytes: Uint8Array, mimeType: string): boolean => {
  switch (mimeType) {
    case 'image/png': return completePng(bytes)
    case 'image/jpeg': return completeJpeg(bytes)
    case 'image/gif': return completeGif(bytes)
    case 'image/webp': return completeWebp(bytes)
    case 'video/mp4': return completeMp4(bytes)
    default: return true
  }
}
const sha256 = (bytes: Uint8Array): string => `sha256:v1:${createHash('sha256').update(bytes).digest('hex')}`

/** Validates untrusted upload metadata and bytes before the local object adapter accepts them. */
export const validateObjectUpload = (input: ObjectUploadInput): ValidatedObjectUpload => {
  const namespace = objectNamespaceSchema.parse(input.namespace)
  const deletionState = objectDeletionStateSchema.parse(input.deletion_state)
  const rightsState = rightsStateSchema.parse(input.rights_state)
  if (!Number.isSafeInteger(input.declared_size) || input.declared_size < 0 || input.declared_size !== input.bytes.byteLength)
    throw new Error('declared size does not match streamed size')
  const maxSize = namespace === 'raw-evidence' ? MAX_RAW_BYTES : MAX_MEDIA_BYTES
  if (input.bytes.byteLength > maxSize) throw new Error('upload size exceeds namespace limit')
  if (!allowedMimeTypes[namespace].has(input.declared_mime_type)) throw new Error('MIME type is not allowed for namespace')
  const suffixes = extensions[input.declared_mime_type]
  if (namespace !== 'raw-evidence' && (suffixes === undefined || !suffixes.some((suffix) => input.key.endsWith(suffix))))
    throw new Error('key suffix does not match declared MIME type')
  if (namespace === 'raw-evidence' && !/^sha256\/[a-f0-9]{2}\/[a-f0-9]{64}$/.test(input.key))
    throw new Error('raw evidence key must be canonical content-addressed key')
  if (!hasMagic(input.bytes, input.declared_mime_type)) throw new Error('MIME magic bytes do not match declared type')
  if (!hasCompleteContainer(input.bytes, input.declared_mime_type)) throw new Error('binary format container is incomplete or has trailing bytes')
  if (looksLikePolyglot(input.bytes, input.declared_mime_type)) throw new Error('polyglot or malformed binary format is not allowed')
  const computedHash = sha256(input.bytes)
  if (input.declared_hash !== computedHash) throw new Error('declared hash does not match computed SHA-256')
  if (deletionState !== 'active' || rightsState === 'revoked') throw new Error('deleted or revoked object is not uploadable')
  if (namespace === 'public-media' &&
    (rightsState !== 'first_party' && rightsState !== 'redistribution_licensed' || deletionState !== 'active'))
    throw new Error('public media rights are not eligible')
  return Object.freeze({ computed_hash: computedHash, size_bytes: input.bytes.byteLength, mime_type: input.declared_mime_type })
}
