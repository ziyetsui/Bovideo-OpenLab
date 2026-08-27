import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { config as loadEnvironment } from 'dotenv'

export type PreviewAdminBootstrapOptions = {
  baseURL: string
  email: string
  fetchImpl?: typeof fetch
  password: string
}

function previewOrigin(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PREVIEW_BASE_URL must be a credential-free HTTPS origin')
  }
  return url.origin
}

export async function ensurePreviewAdmin({
  baseURL,
  email,
  fetchImpl = fetch,
  password,
}: PreviewAdminBootstrapOptions): Promise<'created' | 'existing'> {
  if (!email.trim() || !password) throw new Error('Preview Admin credentials are required')
  const origin = previewOrigin(baseURL)
  const request = (pathName: string) =>
    fetchImpl(`${origin}${pathName}`, {
      body: JSON.stringify({ email, password }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })

  const login = await request('/api/users/login')
  if (login.ok) return 'existing'
  if (login.status !== 401 && login.status !== 403) {
    throw new Error(`Preview Admin login failed with status ${login.status}`)
  }

  const register = await request('/api/users/first-register')
  if (register.ok) return 'created'
  throw new Error(
    `Preview Admin bootstrap failed (login=${login.status}, first-register=${register.status})`,
  )
}

async function main(): Promise<void> {
  loadEnvironment({ path: '.env.preview.local' })
  const result = await ensurePreviewAdmin({
    baseURL: process.env.PREVIEW_BASE_URL ?? '',
    email: process.env.PREVIEW_ADMIN_EMAIL ?? '',
    password: process.env.PREVIEW_ADMIN_PASSWORD ?? '',
  })
  process.stdout.write(`Preview administrator ${result === 'created' ? 'created' : 'already exists'}.\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main()
}
