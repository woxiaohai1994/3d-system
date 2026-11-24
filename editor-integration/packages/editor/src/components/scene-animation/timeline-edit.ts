import {
  CameraMotionPoint,
  MotionKey,
  MotionSegment,
  type SceneAnimation,
  type SceneTrack,
} from '@pascal-app/core'
import type { MotionPathData } from '@pascal-app/viewer'
import { reconcilePaths } from '../scene-camera/motion-path-data'

export type KeySelection = { nodeId: string; keyId: string }
type Track = SceneTrack
export const keyToken = (nodeId: string, keyId: string) => `${nodeId}/${keyId}`
export const animationTracks = (data: SceneAnimation): Track[] => data.tracks
export function selectedKeys(data: SceneAnimation, selected: KeySelection[]) {
  const ids = new Set(selected.map((k) => keyToken(k.nodeId, k.keyId)))
  return animationTracks(data).flatMap((t) =>
    t.points
      .filter((p) => ids.has(keyToken(t.nodeId, p.id)))
      .map((p) => ({ nodeId: t.nodeId, point: p })),
  )
}
function mapTracks(data: SceneAnimation, edit: (track: Track) => Track): SceneAnimation {
  return {
    ...data,
    tracks: data.tracks.map(edit).filter((t) => t.kind === 'camera' || t.points.length),
  }
}
export function retimeKeys(
  data: SceneAnimation,
  selected: KeySelection[],
  delta: number,
  factor = 1,
): SceneAnimation {
  const keys = selectedKeys(data, selected)
  if (!keys.length || !Number.isFinite(delta) || !Number.isFinite(factor) || factor <= 0)
    return data
  const ids = new Set(selected.map((k) => keyToken(k.nodeId, k.keyId)))
  const first = Math.min(...keys.map((k) => k.point.time))
  let minDelta = -first,
    maxDelta = 600 - Math.max(...keys.map((k) => k.point.time))
  for (const t of animationTracks(data))
    for (let i = 0; i < t.points.length; i++) {
      const p = t.points[i]!
      if (!ids.has(keyToken(t.nodeId, p.id))) continue
      const before = t.points[i - 1],
        after = t.points[i + 1]
      if (before && !ids.has(keyToken(t.nodeId, before.id)))
        minDelta = Math.max(minDelta, before.time + 1 / data.fps - p.time)
      if (after && !ids.has(keyToken(t.nodeId, after.id)))
        maxDelta = Math.min(maxDelta, after.time - 1 / data.fps - p.time)
    }
  const shift = factor === 1 ? Math.max(minDelta, Math.min(maxDelta, delta)) : delta
  return mapTracks(data, (track) => {
    if (!track.points.some((p) => ids.has(keyToken(track.nodeId, p.id)))) return track
    const points = track.points.map((p) =>
      ids.has(keyToken(track.nodeId, p.id))
        ? {
            ...p,
            time: Math.round((first + (p.time - first) * factor + shift) * data.fps) / data.fps,
          }
        : p,
    )
    return {
      ...track,
      ...reconcilePaths<MotionPathData>(points, { ...track, segments: track.segments ?? [] }),
    } as Track
  })
}
export function deleteKeys(data: SceneAnimation, selected: KeySelection[]): SceneAnimation {
  const ids = new Set(selected.map((k) => keyToken(k.nodeId, k.keyId)))
  return mapTracks(data, (track) => {
    const points = track.points.filter((p) => !ids.has(keyToken(track.nodeId, p.id)))
    if (points.length === track.points.length) return track
    return {
      ...track,
      ...reconcilePaths<MotionPathData>(points, { ...track, segments: track.segments ?? [] }),
    } as Track
  })
}
export type KeyClipboard = { tracks: Track[]; start: number }
export function copyKeys(data: SceneAnimation, selected: KeySelection[]): KeyClipboard | null {
  const keys = selectedKeys(data, selected)
  if (!keys.length) return null
  const ids = new Set(selected.map((k) => keyToken(k.nodeId, k.keyId)))
  return structuredClone({
    start: Math.min(...keys.map((k) => k.point.time)),
    tracks: animationTracks(data).flatMap((t) => {
      const points = t.points.filter((p) => ids.has(keyToken(t.nodeId, p.id)))
      return points.length ? [{ ...t, points } as Track] : []
    }),
  })
}
export function pasteKeys(data: SceneAnimation, clipboard: KeyClipboard, time: number) {
  const selection: KeySelection[] = []
  const existing = new Set(animationTracks(data).map((t) => t.nodeId))
  const missing = clipboard.tracks
    .filter((t) => !existing.has(t.nodeId))
    .map((t) => ({ ...t, points: [], segments: [] }))
  const restored: SceneAnimation = { ...data, tracks: [...data.tracks, ...missing] }
  const next = mapTracks(restored, (track) => {
    const source = clipboard.tracks.find((t) => t.nodeId === track.nodeId)
    if (!source) return track
    const schema = track.kind === 'camera' ? CameraMotionPoint : MotionKey
    const copies = source.points.map((p) =>
      schema.parse({
        ...p,
        id: undefined,
        time: Math.round((time + p.time - clipboard.start) * data.fps) / data.fps,
      }),
    )
    selection.push(...copies.map((p) => ({ nodeId: track.nodeId, keyId: p.id })))
    const ids = new Map<string, string>(source.points.map((p, i) => [p.id, copies[i]!.id]))
    const points = [
      ...track.points.filter(
        (p) => !copies.some((c) => Math.abs(p.time - c.time) < 0.5 / data.fps),
      ),
      ...copies,
    ].sort((a, b) => a.time - b.time)
    const result = reconcilePaths<MotionPathData>(points, {
      ...track,
      segments: track.segments ?? [],
    })
    result.segments = result.segments.map((s) => {
      const original = source.segments?.find(
        (old) => ids.get(old.fromId) === s.fromId && ids.get(old.toId) === s.toId,
      )
      return original
        ? MotionSegment.parse({
            ...original,
            id: undefined,
            fromId: s.fromId,
            toId: s.toId,
            knots: original.knots?.map((k) => ({ ...k, id: undefined })),
          })
        : s
    })
    return { ...track, ...result } as Track
  })
  return { data: next, selection }
}
