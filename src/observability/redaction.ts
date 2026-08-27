const sensitiveKey = /(?:authorization|cookie|set[-_]?cookie|api[-_]?key|token|secret|credential|password|raw[-_]?(?:ref|text|content|prompt)|full[-_]?(?:text|prompt)|prompt|original[-_]?text|localized(?:[-_]?full[-_]?text|[-_]?text)?|email|(?:^|[-_])ip(?:$|[-_])|ip[-_]?address|peer[-_]?address|peerip|client[-_]?ip|clientip|private(?:[-_]?r2)?(?:[-_]?signed)?(?:[-_]?url)?|signed[-_]?url)/i
const sensitiveValue = /(?:\bbearer\s+|rapidapi|secret|(?:api[-_]?key|token|credential|cookie|session|password)\s*[=:]|\bsk-[A-Za-z0-9_-]{8,}|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:\d{1,3}\.){3}\d{1,3}\b|https?:\/\/[^\s]+(?:[?&](?:x-amz-(?:algorithm|credential|date|expires|signedheaders|signature|security-token)|x-goog-(?:algorithm|credential|date|expires|signature)|signature|sig|token|credential)=))/i

/**
 * Removes sensitive values recursively before a local test-double can retain
 * them. It intentionally omits, rather than masks, values so the sink never
 * becomes a second store for sensitive material.
 */
export const redactStructuredValue = (value: unknown): unknown | undefined => {
  if (typeof value === 'string') return sensitiveValue.test(value) ? undefined : value
  if (Array.isArray(value)) return value.flatMap((entry) => {
    const redacted = redactStructuredValue(entry)
    return redacted === undefined ? [] : [redacted]
  })
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    if (sensitiveKey.test(key)) return []
    const redacted = redactStructuredValue(child)
    return redacted === undefined ? [] : [[key, redacted]]
  }))
}

/**
 * Legacy local test-double projection: credentials are masked for audit
 * assertions. Sink-facing `redactStructuredValue` remains the stricter
 * projection that omits raw references, raw/full text, and network addresses.
 */
export const redactObservabilityValue = (value: unknown, key?: string): unknown | undefined => {
  if (key !== undefined && sensitiveKey.test(key)) return '[REDACTED]'
  if (typeof value === 'string') return sensitiveValue.test(value) ? '[REDACTED]' : value
  if (Array.isArray(value)) return value.flatMap((entry) => {
    const redacted = redactObservabilityValue(entry)
    return redacted === undefined ? [] : [redacted]
  })
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([childKey, child]) => {
    const redacted = redactObservabilityValue(child, childKey)
    return redacted === undefined ? [] : [[childKey, redacted]]
  }))
}
