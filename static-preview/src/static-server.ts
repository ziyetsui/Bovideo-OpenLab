import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'

const contentTypes: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
}

function optionValue(args: readonly string[], name: string): string {
  const index = args.indexOf(name)
  const value = index === -1 ? undefined : args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`Missing required ${name} value`)
  return value
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path !== '' && !path.startsWith('..') && !path.startsWith('/')
}

async function existingFile(path: string): Promise<string | null> {
  try {
    return (await stat(path)).isFile() ? path : null
  } catch {
    return null
  }
}

async function responseFile(root: string, pathname: string): Promise<Readonly<{ path: string; status: 200 | 404 }>> {
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(pathname)
  } catch {
    decodedPath = ''
  }

  const candidate = resolve(root, `.${decodedPath}`)
  if (decodedPath && isWithin(root, candidate)) {
    const direct = await existingFile(candidate)
    if (direct) return { path: direct, status: 200 }
    const directoryIndex = await existingFile(resolve(candidate, 'index.html'))
    if (directoryIndex) return { path: directoryIndex, status: 200 }
  }
  return { path: resolve(root, '404.html'), status: 404 }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const root = resolve(optionValue(args, '--root'))
  const host = optionValue(args, '--host')
  const port = Number(optionValue(args, '--port'))
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Static server port must be an integer between 1 and 65535')
  }

  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' })
      response.end()
      return
    }

    const requestUrl = new URL(request.url ?? '/', `http://${host}:${port}`)
    const file = await responseFile(root, requestUrl.pathname)
    const type = contentTypes[extname(file.path)] ?? 'application/octet-stream'
    const contents = request.method === 'HEAD' ? undefined : await readFile(file.path)
    response.writeHead(file.status, { 'Content-Type': type, 'Content-Length': contents?.byteLength ?? 0 })
    response.end(contents)
  })

  await new Promise<void>((resolveListening) => server.listen(port, host, resolveListening))
  process.stdout.write(`Static Preview available at http://${host}:${port}\n`)
}

if (process.argv[1]?.endsWith('/static-server.ts')) {
  void main()
}
