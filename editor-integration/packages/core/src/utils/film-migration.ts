import { z } from 'zod'
import { ensureFilmShots, reconcileFilmSources } from '../lib/film-sources'
import { FilmClip, FilmTrack } from '../schema/film'
import { SceneAnimation, SceneTrack } from '../schema/scene-animation'

const LegacyAnimation = z.object({
  version: z.literal(1).default(1),
  tracks: z.array(SceneTrack),
  duration: z.number().finite().min(0).max(600).default(5),
  fps: z.union([z.literal(24), z.literal(30)]).default(24),
  resolution: z.union([z.literal(720), z.literal(1080)]).default(720),
  aspect: z
    .number()
    .positive()
    .default(16 / 9),
  playbackRange: z.tuple([z.number().nonnegative(), z.number().nonnegative()]).optional(),
  cameraRanges: z.record(z.string(), z.tuple([z.number(), z.number()])).optional(),
  defaultCameraId: z.string().nullable().default(null),
  cuts: z
    .array(z.object({ id: z.string(), time: z.number().min(0).max(600), cameraId: z.string() }))
    .default([]),
})
type CameraIdentity = { id: string; name?: string }
export function migrateFilmAnimation(raw: unknown, cameras: CameraIdentity[] = []): SceneAnimation {
  if (!raw) return ensureFilmShots(SceneAnimation.parse({}), cameras)
  if (typeof raw !== 'object') throw new Error('动画文档格式无效，原始数据未修改')
  if ('version' in raw && raw.version === 2)
    return ensureFilmShots(SceneAnimation.parse(raw), cameras)
  const old = LegacyAnimation.parse(raw)
  const referenced = new Set(
    [
      old.defaultCameraId,
      ...old.cuts.map((c) => c.cameraId),
      ...old.tracks.filter((t) => t.kind === 'camera').map((t) => t.nodeId),
    ].filter((id): id is string => !!id),
  )
  let animation = ensureFilmShots(SceneAnimation.parse({ ...old, version: 2 }), [
    ...cameras,
    ...[...referenced].filter((id) => !cameras.some((c) => c.id === id)).map((id) => ({ id })),
  ])
  const duration = Math.max(
    old.duration,
    ...old.tracks.map((t) => t.points.at(-1)?.time ?? 0),
    ...old.cuts.map((c) => c.time),
  )
  const [start, end] = old.playbackRange ?? [0, duration]
  if (end < start || old.cuts.some((c, i) => i > 0 && c.time <= old.cuts[i - 1]!.time))
    throw new Error('旧动画时间范围或切镜顺序无效，原始数据未修改')
  const track = FilmTrack.parse({ id: 'video-track_migrated', name: '视频 1' })
  const cuts = [{ time: 0, cameraId: old.defaultCameraId }, ...old.cuts]
  for (const [index, cut] of cuts.entries()) {
    const left = Math.max(start, cut.time),
      right = Math.min(end, cuts[index + 1]?.time ?? end)
    if (right <= left || !cut.cameraId) continue
    const shot = animation.shots.find((s) => s.cameraId === cut.cameraId)!
    const source = {
      id: `source_migrated_${index}_${shot.id}`,
      shotId: shot.id,
      name: shot.name,
      start: Math.round(left * old.fps),
      end: Math.round(right * old.fps),
      fromKeyId: null,
      toKeyId: null,
    }
    animation.sources.push(source)
    track.clips.push(
      FilmClip.parse({
        id: `clip_migrated_${index}`,
        sourceId: source.id,
        start: Math.round((left - start) * old.fps),
        in: 0,
        out: source.end - source.start,
      }),
    )
  }
  animation = { ...animation, sequence: { tracks: [track] } }
  return SceneAnimation.parse(reconcileFilmSources(animation))
}
