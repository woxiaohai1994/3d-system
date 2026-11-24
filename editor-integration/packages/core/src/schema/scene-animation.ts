import { z } from 'zod'
import { CameraPropertyCurve } from './animation-fcurve'
import { type CameraMotion, CameraMotionPoint } from './camera-motion'
import { FilmSequence, FilmShot, FilmSource, validateFilm } from './film'
import { MotionSegment, MotionTarget, MotionTrack, validateMotionTrack } from './motion'
import type { SceneCameraNode } from './nodes/scene-camera'
import { SceneCameraMarker } from './scene-camera-marker'

export const SceneCameraTrack = MotionTrack.extend({
  propertyCurves: z.array(CameraPropertyCurve).optional(),
  follow: z
    .object({ target: MotionTarget, origin: z.tuple([z.number(), z.number(), z.number()]) })
    .optional(),
  points: z.array(CameraMotionPoint).max(200),
  segments: z.array(MotionSegment).max(199),
})
export type SceneCameraTrack = z.infer<typeof SceneCameraTrack>
export const SceneTrack = z.discriminatedUnion('kind', [
  SceneCameraTrack.extend({ kind: z.literal('camera') }),
  MotionTrack.extend({ kind: z.literal('object') }),
])
export type SceneTrack = z.infer<typeof SceneTrack>
type TrackKind = SceneTrack['kind']
type TrackOf<K extends TrackKind> = Extract<SceneTrack, { kind: K }>
export function cameraTracks(animation: { tracks: SceneTrack[] }) {
  return animation.tracks.filter((track): track is TrackOf<'camera'> => track.kind === 'camera')
}
export function objectTracks(animation: { tracks: SceneTrack[] }) {
  return animation.tracks.filter((track): track is TrackOf<'object'> => track.kind === 'object')
}
export function replaceAnimationTracks<T extends object, K extends TrackKind>(
  animation: T,
  kind: K,
  tracks: Omit<TrackOf<K>, 'kind'>[],
): Omit<T, 'tracks'> & { tracks: SceneTrack[] } {
  const previous = (animation as { tracks?: SceneTrack[] }).tracks ?? []
  return {
    ...animation,
    tracks: [
      ...previous.filter((track) => track.kind !== kind),
      ...tracks.map((track) => ({ ...track, kind }) as SceneTrack),
    ],
  }
}
export function upsertAnimationTrack(animation: SceneAnimation, track: SceneTrack): SceneAnimation {
  const index = animation.tracks.findIndex((t) => t.nodeId === track.nodeId)
  return {
    ...animation,
    tracks:
      index < 0
        ? [...animation.tracks, track]
        : animation.tracks.map((current, i) => (i === index ? track : current)),
  }
}
export const SceneAnimation = z
  .object({
    version: z.literal(2).default(2),
    activeCameraId: z.string().nullable().optional(),
    cameraMarkers: z.array(SceneCameraMarker).optional(),
    playbackRange: z.tuple([z.number().min(0).max(600), z.number().min(0).max(600)]).optional(),
    cameraRanges: z
      .record(z.string(), z.tuple([z.number().min(0).max(600), z.number().min(0).max(600)]))
      .optional(),
    duration: z.number().finite().min(0).max(600).default(5),
    fps: z.union([z.literal(24), z.literal(30)]).default(24),
    resolution: z.union([z.literal(720), z.literal(1080)]).default(720),
    aspect: z
      .number()
      .finite()
      .positive()
      .max(100)
      .default(16 / 9),
    shots: z.array(FilmShot).default([]),
    sources: z.array(FilmSource).default([]),
    sequence: FilmSequence.default({ tracks: [] }),
    tracks: z.array(SceneTrack).max(200).default([]),
  })
  .superRefine((animation, context) => {
    for (const range of [animation.playbackRange, ...Object.values(animation.cameraRanges ?? {})])
      if (range && range[1] - range[0] < 1 / animation.fps - 1e-7)
        context.addIssue({ code: 'custom', message: 'Range must contain at least one frame' })
    const ids = new Set<string>()
    for (const track of animation.tracks) {
      if (ids.has(track.nodeId))
        context.addIssue({ code: 'custom', message: 'Duplicate animated object' })
      ids.add(track.nodeId)
      validateMotionTrack(track, animation.fps, context)
      if (track.kind === 'camera') {
        const channels = new Set<string>()
        for (const curve of track.propertyCurves ?? []) {
          const id = JSON.stringify([curve.owner, curve.dataPath, curve.index])
          if (channels.has(id)) context.addIssue({ code: 'custom', message: '相机属性曲线重复' })
          channels.add(id)
        }
      }
    }
    validateFilm(animation, context)
  })
export type SceneAnimation = z.infer<typeof SceneAnimation>

export function sceneAnimationDuration(animation: SceneAnimation) {
  return Math.max(
    animation.duration,
    ...animation.tracks.flatMap((track) => [
      track.points.at(-1)?.time ?? 0,
      ...(track.kind === 'camera'
        ? (track.propertyCurves ?? []).map(
            (curve) => (curve.keys.at(-1)?.co[0] ?? 0) / animation.fps,
          )
        : []),
    ]),
  )
}
export function cameraMotionFromScene(animation: SceneAnimation, cameraId: string): CameraMotion {
  const track = cameraTracks(animation).find((t) => t.nodeId === cameraId)
  return {
    version: 1,
    points: track?.points ?? [],
    segments: track?.segments ?? [],
    duration: sceneAnimationDuration(animation),
    fps: animation.fps,
    resolution: animation.resolution,
  }
}
export function updateSceneCameraMotion(
  animation: SceneAnimation,
  node: Pick<SceneCameraNode, 'id' | 'parentId'>,
  motion: CameraMotion,
): SceneAnimation {
  const track: SceneTrack = {
    ...cameraTracks(animation).find((t) => t.nodeId === node.id),
    kind: 'camera',
    nodeId: node.id,
    parentId: node.parentId,
    points: motion.points,
    segments: motion.segments,
  }
  return upsertAnimationTrack(
    { ...animation, duration: motion.duration, fps: motion.fps, resolution: motion.resolution },
    track,
  )
}
