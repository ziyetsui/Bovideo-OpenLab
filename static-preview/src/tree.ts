import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

export type FileDigest = Readonly<{ path: string; sha256: string; bytes: number }>

export function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function compareUtf8Bytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

export function sortPaths<T extends Readonly<{ path: string }>>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => compareUtf8Bytes(left.path, right.path))
}

export async function readTree(root: string): Promise<readonly FileDigest[]> {
  const files: FileDigest[] = []

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => compareUtf8Bytes(left.name, right.name))) {
      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(absolutePath)
      } else if (entry.isFile()) {
        const contents = await readFile(absolutePath)
        files.push({ path: relative(root, absolutePath).replaceAll('\\', '/'), sha256: sha256(contents), bytes: contents.length })
      }
    }
  }

  await visit(root)
  return sortPaths(files)
}

export function snapshotId(files: readonly FileDigest[]): string {
  return sha256(sortPaths(files).map(({ path, sha256: digest }) => `${path}\u0000${digest}\n`).join(''))
}
