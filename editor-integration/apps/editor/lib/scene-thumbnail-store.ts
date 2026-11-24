import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

export const MAX_SCENE_THUMBNAIL_BYTES = 2 * 1024 * 1024

type StoredThumbnail = { revision: string; mime: string; data: string }

export function thumbnailMime(bytes: Buffer): string | null {
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp'
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return 'image/jpeg'
  return null
}

export class SceneThumbnailStore {
  constructor(readonly directory: string) {}

  private file(id: string) {
    return path.join(this.directory, `${createHash('sha256').update(id).digest('hex')}.json`)
  }

  async read(id: string, revision: string): Promise<{ bytes: Buffer; mime: string } | null> {
    try {
      const stored = JSON.parse(await readFile(this.file(id), 'utf8')) as StoredThumbnail
      if (!stored || stored.revision !== revision || typeof stored.data !== 'string') return null
      const bytes = Buffer.from(stored.data, 'base64')
      if (bytes.length > MAX_SCENE_THUMBNAIL_BYTES || thumbnailMime(bytes) !== stored.mime)
        return null
      return { bytes, mime: stored.mime }
    } catch (error) {
      if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT')
        return null
      throw error
    }
  }

  async write(id: string, revision: string, bytes: Buffer) {
    const mime = thumbnailMime(bytes)
    if (!mime || bytes.length > MAX_SCENE_THUMBNAIL_BYTES) throw new Error('Invalid thumbnail')
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const temporary = path.join(this.directory, `${randomUUID()}.tmp`)
    try {
      await writeFile(
        temporary,
        JSON.stringify({ revision, mime, data: bytes.toString('base64') }),
        { mode: 0o600 },
      )
      await rename(temporary, this.file(id))
    } finally {
      await rm(temporary, { force: true })
    }
  }
}

export function getSceneThumbnailStore() {
  const directory =
    process.env.PASCAL_DATA_DIR ??
    (process.env.PASCAL_DB_PATH
      ? path.dirname(process.env.PASCAL_DB_PATH)
      : path.join(homedir(), '.pascal', 'data'))
  return new SceneThumbnailStore(path.join(directory, 'scene-thumbnails'))
}
