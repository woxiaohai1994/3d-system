import {
  CameraMotionPoint,
  type CameraMotionPose,
  MotionKey,
  MotionSegment,
} from '@pascal-app/core'
import { moveCameraRig } from '@pascal-app/viewer'
import type { MotionPathData, TransformKey } from '@pascal-app/viewer'
import { Vector3 } from 'three'
import { drawnCurve } from './motion-curve'
import { reconcilePaths } from './motion-path-data'

type Pose = Omit<TransformKey, 'id' | 'time'> | CameraMotionPose
export function createDrawnTrajectory(
  data: MotionPathData,
  pose: Pose,
  positions: [number, number, number][],
  time: number,
  duration: number,
  fps: number,
  camera: boolean,
  curves?: [number, number, number][][],
  allowStationary = false,
): { data: MotionPathData; segmentId: string } | { error: 'time' | 'overlap' | 'empty' } {
  const startTime = Math.round(time * fps) / fps,
    endTime = Math.round((time + duration) * fps) / fps
  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime) ||
    startTime < 0 ||
    endTime > 600 ||
    endTime - startTime < 1 / fps - 1e-7
  )
    return { error: 'time' }
  if (
    positions.length < 2 ||
    positions.length > 200 ||
    positions.some((p) => p.some((v) => !Number.isFinite(v)))
  )
    return { error: 'empty' }
  if (
    data.points.length > 1 &&
    startTime < data.points.at(-1)!.time - 1e-7 &&
    endTime > data.points[0]!.time + 1e-7
  )
    return { error: 'overlap' }
  if (data.points.some((p) => p.time > startTime + 1e-7 && p.time < endTime - 1e-7))
    return { error: 'overlap' }
  const endExisting = data.points.find((p) => Math.abs(p.time - endTime) < 1e-7)
  if (
    endExisting &&
    new Vector3(...endExisting.position).distanceTo(new Vector3(...positions.at(-1)!)) > 1e-7
  )
    return { error: 'overlap' }
  const schema = camera ? CameraMotionPoint : MotionKey
  const existing = data.points.find((p) => Math.abs(p.time - startTime) < 1e-7)
  const start =
    existing ?? schema.parse({ ...pose, position: pose.position, time: startTime, channels: [] })
  // The bound object's start pose is authoritative; move the drawn route as a whole if needed.
  const delta = new Vector3(...start.position).sub(new Vector3(...positions[0]!))
  const route = positions.map((p) => new Vector3(...p).add(delta).toArray())
  if (
    !allowStationary &&
    !route.some((p) => new Vector3(...p).distanceTo(new Vector3(...route[0]!)) > 1e-7) &&
    !curves?.some((pair) => pair.some((h) => new Vector3(...h).lengthSq() > 1e-14))
  )
    return { error: 'empty' }
  const end =
    endExisting ??
    schema.parse({
      ...pose,
      ...('rig' in pose && pose.rig
        ? { rig: moveCameraRig(pose.rig, pose as CameraMotionPose, { position: route.at(-1)! }) }
        : {}),
      id: undefined,
      time: endTime,
      position: route.at(-1),
      channels: [],
    })
  const points = [
    ...data.points.filter((p) => p.id !== start.id && p.id !== end.id),
    start,
    end,
  ].sort((a, b) => a.time - b.time)
  if (points.length > 200) return { error: 'time' }
  const next = reconcilePaths(points, data)
  const segment = MotionSegment.parse({
    fromId: start.id,
    toId: end.id,
    path: 'bezier',
    rhythm: 'linear',
    ...drawnCurve(route, curves),
  })
  next.segments = next.segments.map((s) =>
    s.fromId === start.id && s.toId === end.id ? segment : s,
  )
  // A gap before a new move is a wait, not an implicit drift toward its starting point.
  next.segments = next.segments.map((s) =>
    s.toId === start.id && !data.segments.some((old) => old.id === s.id)
      ? { ...s, rhythm: 'hold' }
      : s,
  )
  return { data: next, segmentId: segment.id }
}

// Reserve time immediately; drawing replaces geometry without replacing the authored keys.
export function reshapeDrawnTrajectory(
  data: MotionPathData,
  segmentId: string,
  positions: [number, number, number][],
  fps: number,
  camera: boolean,
  curves?: [number, number, number][][],
  allowStationary = false,
): ReturnType<typeof createDrawnTrajectory> {
  const segment = data.segments.find((s) => s.id === segmentId),
    start = data.points.find((p) => p.id === segment?.fromId),
    end = data.points.find((p) => p.id === segment?.toId)
  if (!segment || !start || !end) return { error: 'time' }
  const result = createDrawnTrajectory(
    { points: [], segments: [] },
    start,
    positions,
    start.time,
    end.time - start.time,
    fps,
    camera,
    curves,
    allowStationary,
  )
  if ('error' in result) return result
  const geometry = result.data.segments[0]!
  return {
    segmentId,
    data: {
      ...data,
      points: data.points.map((p) =>
        p.id === end.id
          ? {
              ...p,
              ...('rig' in p && p.rig
                ? {
                    rig: moveCameraRig(p.rig as NonNullable<CameraMotionPose['rig']>, p, {
                      position: result.data.points[1]!.position,
                    }),
                  }
                : {}),
              position: result.data.points[1]!.position,
            }
          : p,
      ),
      segments: data.segments.map((s) =>
        s.id === segmentId
          ? { ...s, path: geometry.path, handles: geometry.handles, knots: geometry.knots }
          : s,
      ),
    },
  }
}
