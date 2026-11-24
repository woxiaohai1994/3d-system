import {
  guardSceneApiRequest,
  sceneApiJson,
  sceneApiPreflight,
  withSceneApiHeaders,
} from '@/lib/scene-api-security'
import { getSceneStore } from '@/lib/scene-store-server'
import { sceneThumbnailRevision } from '@/lib/scene-thumbnail'
import {
  getSceneThumbnailStore,
  MAX_SCENE_THUMBNAIL_BYTES,
  thumbnailMime,
} from '@/lib/scene-thumbnail-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
type Context = { params: Promise<{ id: string }> }

export function OPTIONS(request: Request) {
  return sceneApiPreflight(request)
}

export async function GET(request: Request, { params }: Context) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard
  const { id } = await params
  const scene = await (await getSceneStore()).load(id)
  if (!scene) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  const thumbnail = await getSceneThumbnailStore().read(id, sceneThumbnailRevision(scene))
  if (!thumbnail) return sceneApiJson(request, { error: 'thumbnail_not_found' }, { status: 404 })
  return withSceneApiHeaders(
    request,
    new Response(new Uint8Array(thumbnail.bytes), {
      headers: { 'Content-Type': thumbnail.mime, 'Cache-Control': 'no-store' },
    }),
  )
}

export async function POST(request: Request, { params }: Context) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard
  const { id } = await params
  const store = await getSceneStore()
  const scene = await store.load(id)
  if (!scene) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  const revision = new URL(request.url).searchParams.get('revision')
  if (revision !== sceneThumbnailRevision(scene))
    return sceneApiJson(request, { error: 'scene_changed' }, { status: 409 })
  if (Number(request.headers.get('content-length')) > MAX_SCENE_THUMBNAIL_BYTES)
    return sceneApiJson(request, { error: 'thumbnail_too_large' }, { status: 413 })
  const chunks: Uint8Array[] = []
  const reader = request.body?.getReader()
  let size = 0
  if (!reader) return sceneApiJson(request, { error: 'invalid_thumbnail' }, { status: 400 })
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_SCENE_THUMBNAIL_BYTES) {
      await reader.cancel()
      return sceneApiJson(request, { error: 'thumbnail_too_large' }, { status: 413 })
    }
    chunks.push(value)
  }
  const bytes = Buffer.concat(chunks)
  if (!thumbnailMime(bytes))
    return sceneApiJson(request, { error: 'invalid_thumbnail' }, { status: 400 })
  const latest = await store.load(id)
  if (!latest || sceneThumbnailRevision(latest) !== revision)
    return sceneApiJson(request, { error: 'scene_changed' }, { status: 409 })
  // A preview is derived data: writing it must not create a model version or trigger live scene sync.
  await getSceneThumbnailStore().write(id, revision, bytes)
  return sceneApiJson(request, { ok: true })
}
