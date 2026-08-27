import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The reusable `/frontend` source lives beside `src`. Pin Turbopack to this
  // worktree so imports from `src` to that directory are resolved in local dev.
  turbopack: {
    root: process.cwd(),
  },
  // Keep local and CI page-data collection deterministic while Payload shares
  // one bounded PostgreSQL pool. Production request concurrency is unaffected.
  experimental: {
    cpus: 1,
  },
  images: {
    localPatterns: [
      {
        pathname: '/api/media/file/**',
      },
    ],
  },
  async headers() {
    return [
      {
        headers: [
          {
            key: 'X-Robots-Tag',
            value: 'noindex, nofollow, noarchive, nosnippet',
          },
        ],
        source: '/:path*',
      },
    ]
  },
  // Keep authentication and PostgreSQL driver compatibility packages external
  // to the Next.js server bundle.
  serverExternalPackages: ['jose', 'pg-cloudflare'],

  // Your Next.js config here
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
