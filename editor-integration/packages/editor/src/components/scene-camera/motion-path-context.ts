import {
  type AnyNodeId,
  CameraMotionPoint,
  CameraRig,
  MotionKey,
  type SceneAnimation,
  upsertAnimationTrack,
  useScene,
} from '@pascal-app/core'
import { moveCameraRig } from '@pascal-app/viewer'
import type { MotionPathData } from '@pascal-app/viewer'
import { animationData, commitSceneAnimation } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { useObjectMotion } from './motion-object-store'
import { editableBezierPath, objectPathData } from './motion-path-data'
import { motionCamera } from './motion-state'
export function editingPathNode() {
  const id = useObjectMotion.getState().nodeId
  return id ? useScene.getState().nodes[id as AnyNodeId] : motionCamera()
}
export function editingPathData(): MotionPathData {
  const node = editingPathNode()
  const track = animationData().tracks.find((t) => t.nodeId === node?.id)
  return track ? editableBezierPath(objectPathData(track)) : { points: [], segments: [] }
}
export function pathTimeline(data: MotionPathData): SceneAnimation {
  const scene = animationData(),
    node = editingPathNode()
  if (!node) return scene
  if (!data.points.length)
    return { ...scene, tracks: scene.tracks.filter((t) => t.nodeId !== node.id) }
  const previous = scene.tracks.find((t) => t.nodeId === node.id)
  const points = data.points.map((p) => {
    const old = previous?.points.find((k) => k.id === p.id)
    const next = { ...old, ...p }
    if (
      old &&
      'rig' in old &&
      old.rig &&
      JSON.stringify((next as typeof old).rig) === JSON.stringify(old.rig) &&
      p.position.some((v, i) => v !== (old as typeof p).position[i])
    ) {
      const rig = CameraRig.safeParse(old.rig)
      if (rig.success && 'position' in old && 'rotation' in old)
        return { ...next, rig: moveCameraRig(rig.data, old as typeof p, { position: p.position }) }
    }
    return next
  })
  const base = { nodeId: node.id, parentId: node.parentId, segments: data.segments }
  return upsertAnimationTrack(
    scene,
    node.type === 'scene-camera'
      ? {
          ...previous,
          ...base,
          kind: 'camera',
          points: points.map((p) => CameraMotionPoint.parse(p)),
        }
      : { ...base, kind: 'object', points: points.map((p) => MotionKey.parse(p)) },
  )
}
export function previewPath(data: MotionPathData) {
  useSceneAnimation.setState({ sceneDraft: pathTimeline(data) })
}
export function commitPath(data: MotionPathData) {
  return commitSceneAnimation(pathTimeline(data))
}
