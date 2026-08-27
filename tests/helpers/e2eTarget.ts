type Environment = Readonly<Record<string, string | undefined>>

export type E2ETarget = {
  baseURL: string
  startLocalServer: boolean
}

export function resolveE2ETarget(environment: Environment): E2ETarget {
  const configured = environment.PREVIEW_BASE_URL?.trim()
  if (!configured) {
    return { baseURL: 'http://localhost:3000', startLocalServer: true }
  }

  let url: URL
  try {
    url = new URL(configured)
  } catch {
    throw new Error('Preview base URL must be an absolute HTTPS origin')
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Preview base URL must be a credential-free HTTPS origin without a path, query, or fragment')
  }

  return { baseURL: url.origin, startLocalServer: false }
}
