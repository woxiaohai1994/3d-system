import { type AnyNodeId, emitter, sceneRegistry, useScene } from '@pascal-app/core'
import type { MotionPathData } from '@pascal-app/viewer'
import { Box3, type Object3D, Vector3 } from 'three'
import { useSceneAnimation } from '../scene-animation/store'
import { curveNodes, withCurveNodes } from './motion-curve'
import { requestMotionTransition } from './motion-edit-session'
import { useObjectMotion } from './motion-object-store'
import { editingPathData, editingPathNode } from './motion-path-context'
import { leaveMotionCameraView } from './motion-state'

export function pathHandles(data: MotionPathData, segmentId: string, span = 0): [Vector3, Vector3] {
  const nodes = curveNodes(data, segmentId)
  return [new Vector3(...nodes[span]!.outgoing), new Vector3(...nodes[span + 1]!.incoming)]
}

export function reshapeMotionPath<T extends MotionPathData>(
  data: T,
  segmentId: string,
  delta: Vector3,
  handle: 0 | 1 | 'curve',
  span = 0,
): T {
  const nodes = curveNodes(data, segmentId)
  if (handle === 0 || handle === 'curve')
    nodes[span] = {
      ...nodes[span]!,
      outgoing: new Vector3(...nodes[span]!.outgoing)
        .addScaledVector(delta, handle === 'curve' ? 4 / 3 : 1)
        .toArray(),
    }
  if (handle === 1 || handle === 'curve')
    nodes[span + 1] = {
      ...nodes[span + 1]!,
      incoming: new Vector3(...nodes[span + 1]!.incoming)
        .addScaledVector(delta, handle === 'curve' ? 4 / 3 : 1)
        .toArray(),
    }
  return withCurveNodes(data, segmentId, nodes)
}

export function reshapePathNodeHandle<T extends MotionPathData>(
  data: T,
  segmentId: string,
  delta: Vector3,
  handle: 0 | 1,
  independent = false,
  span = 0,
): T {
  const next = reshapeMotionPath(data, segmentId, delta, handle, span)
  if (independent) return next
  const nodes = curveNodes(data, segmentId),
    node = nodes[span + handle]!
  const index = data.segments.findIndex((s) => s.id === segmentId)
  const neighbor =
    handle === 0 && span === 0
      ? data.segments[index - 1]
      : handle === 1 && span === nodes.length - 2
        ? data.segments[index + 1]
        : data.segments[index]
  if (neighbor?.path !== 'bezier') return next
  const others = curveNodes(data, neighbor.id),
    at = others.findIndex((k) => k.id === node.id)
  if (at < 0) return next
  const original = pathHandles(data, segmentId, span)[handle]
  const opposite = new Vector3(...(handle === 0 ? others[at]!.incoming : others[at]!.outgoing))
  if (
    original.lengthSq() < 1e-10 ||
    opposite.lengthSq() < 1e-10 ||
    original.clone().normalize().dot(opposite.clone().normalize()) > -0.9999
  )
    return next
  const adjusted = pathHandles(next, segmentId, span)[handle]
  if (adjusted.lengthSq() < 1e-10) return next
  const updated = curveNodes(next, neighbor.id)
  updated[at] = {
    ...updated[at]!,
    [handle === 0 ? 'incoming' : 'outgoing']: adjusted
      .normalize()
      .multiplyScalar(-opposite.length())
      .toArray(),
  }
  return withCurveNodes(next, neighbor.id, updated)
}

export function translateMotionPath<T extends MotionPathData>(
  data: T,
  delta: Vector3,
  parent: Object3D | null = null,
): T {
  parent?.updateWorldMatrix(true, false)
  const worldDelta = parent
    ? parent.localToWorld(delta.clone()).sub(parent.localToWorld(new Vector3()))
    : delta.clone()
  return {
    ...data,
    points: data.points.map((p) => ({
      ...p,
      position: new Vector3(...p.position).add(delta).toArray(),
    })),
    segments: data.segments.map((segment) => {
      if (segment.path !== 'orbit' || !segment.center)
        return {
          ...segment,
          knots: segment.knots?.map((k) => ({
            ...k,
            position: new Vector3(...k.position).add(delta).toArray(),
          })),
        }
      const center = segment.center
      const object =
        center.nodeId && useScene.getState().nodes[center.nodeId as AnyNodeId]
          ? sceneRegistry.nodes.get(center.nodeId)
          : null
      let offset = center.offset
      if (object) {
        object.updateWorldMatrix(true, false)
        // Bound offsets live in the target frame, while path points live in the track parent.
        const localDelta = object
          .worldToLocal(worldDelta.clone())
          .sub(object.worldToLocal(new Vector3()))
        offset = new Vector3(...offset).add(localDelta).toArray()
      }
      return {
        ...segment,
        center: {
          ...center,
          offset,
          fallback: new Vector3(...center.fallback).add(delta).toArray(),
        },
      }
    }),
  }
}

export function editMotionPath(segmentId: string, fit = false) {
  if (!requestMotionTransition(() => editMotionPath(segmentId, fit))) return false
  const state = useSceneAnimation.getState()
  if (
    useScene.getState().readOnly ||
    state.playing ||
    state.exporting ||
    state.draft ||
    state.sceneDraft ||
    state.pickingAnchor ||
    useObjectMotion.getState().draft
  )
    return false
  const data = editingPathData(),
    node = editingPathNode()
  if (!node || state.lockedIds.includes(node.id) || !data.segments.some((s) => s.id === segmentId))
    return false
  if (fit || !useObjectMotion.getState().nodeId) leaveMotionCameraView()
  useSceneAnimation.setState({
    segmentId,
    pathSelected: false,
    pointId: null,
    navigating: false,
  })
  if (fit) {
    const parent = node.parentId ? sceneRegistry.nodes.get(node.parentId) : null
    parent?.updateWorldMatrix(true, false)
    const points = [...data.points, ...data.segments.flatMap((s) => s.knots ?? [])].map((p) => {
      const v = new Vector3(...p.position)
      return parent ? parent.localToWorld(v) : v
    })
    const bounds = new Box3().setFromPoints(points),
      center = bounds.getCenter(new Vector3())
    const distance = Math.max(3, bounds.getSize(new Vector3()).length() * 1.5)
    const fitPath = () => {
      const current = useSceneAnimation.getState()
      if (current.segmentId !== segmentId || current.cameraView) return
      // The viewport effect restores the observer on exit, after React commits.
      if (current.finishCameraEdit) {
        requestAnimationFrame(fitPath)
        return
      }
      emitter.emit('camera-controls:apply-pose', {
        position: center
          .clone()
          .add(new Vector3(distance, distance * 0.8, distance))
          .toArray(),
        target: center.toArray(),
        projection: 'perspective',
        fov: 50,
      })
    }
    requestAnimationFrame(fitPath)
  }
  return true
}
