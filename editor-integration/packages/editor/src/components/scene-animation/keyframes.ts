import type { MotionValues } from '@pascal-app/core'
import { type SceneAnimation, type SceneTrack, upsertAnimationTrack } from '@pascal-app/core'
import { objectPathData, reconcilePaths } from '../scene-camera/motion-path-data'

export function seedPropertyOrigins<
  P extends { id: string; time: number; channels?: string[]; values?: MotionValues },
>(points: P[], authored: P, base: MotionValues): P[] {
  const first = points[0]
  if (!first || first.time >= authored.time) return points
  const introduced = (authored.channels ?? []).filter(
    (key) => !points.some((p) => p.id !== authored.id && p.channels?.includes(key)),
  )
  if (!introduced.length) return points
  return points.map((p) =>
    p !== first
      ? p
      : {
          ...p,
          channels: [...new Set([...(p.channels ?? []), ...introduced])],
          values: {
            ...p.values,
            ...Object.fromEntries(
              introduced.filter((key) => base[key] !== undefined).map((key) => [key, base[key]]),
            ),
          },
        },
  )
}

export function recordTrackKey(
  scene: SceneAnimation,
  track: SceneTrack,
  key: SceneTrack['points'][number],
  base: MotionValues,
) {
  const existing = track.points.find((p) => Math.abs(p.time - key.time) < 0.5 / scene.fps)
  const point = { ...key, id: existing?.id ?? key.id }
  const points = seedPropertyOrigins(
    [...track.points.filter((p) => p.id !== existing?.id), point].sort((a, b) => a.time - b.time),
    point,
    base,
  )
  const path = reconcilePaths(points, objectPathData(track))
  return upsertAnimationTrack(scene, { ...track, ...path } as SceneTrack)
}
