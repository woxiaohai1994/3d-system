import {
  type AnyNodeId,
  sceneRegistry,
  type TransformPose,
  useLiveTransforms,
  usePlaybackTransforms,
  useScene,
} from '@pascal-app/core'
import { Euler, type Object3D, Quaternion } from 'three'

export function objectMotionPose(object: Object3D): TransformPose {
  return {
    position: object.position.toArray(),
    scale: object.scale.toArray(),
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
  }
}
function apply(object: Object3D, pose: TransformPose) {
  if (pose.scale) object.scale.fromArray(pose.scale)
  object.position.fromArray(pose.position)
  object.rotation.set(...pose.rotation)
  object.updateWorldMatrix(true, true)
}

function sourcePose(id: string): TransformPose | null {
  const node = useScene.getState().nodes[id as AnyNodeId]
  if (!node || !('position' in node) || !Array.isArray(node.position) || node.position.length !== 3)
    return null
  const rotation = 'rotation' in node ? node.rotation : 0
  return {
    position: [...node.position] as [number, number, number],
    rotation: Array.isArray(rotation)
      ? ([...rotation] as [number, number, number])
      : [0, typeof rotation === 'number' ? rotation : 0, 0],
  }
}

export function bindPlaybackTransforms() {
  type Original = { object: Object3D; pose: TransformPose; source: TransformPose | null }
  const originals = new Map<string, Original>()
  const refreshBase = (id: string, original: Original) => {
    const current = sourcePose(id),
      before = original.source
    if (!current || !before) return
    // Document edits made while previewing remain the restoration target; retain renderer elevation offsets.
    original.pose.position = original.pose.position.map(
      (v, i) => v + (current.position[i]! - before.position[i]!),
    ) as [number, number, number]
    if (current.rotation.some((v, i) => v !== before.rotation[i])) {
      const q = new Quaternion()
        .setFromEuler(new Euler(...original.pose.rotation))
        .multiply(new Quaternion().setFromEuler(new Euler(...before.rotation)).invert())
        .multiply(new Quaternion().setFromEuler(new Euler(...current.rotation)))
      const e = new Euler().setFromQuaternion(q, 'XYZ')
      original.pose.rotation = [e.x, e.y, e.z]
    }
    original.source = current
  }
  const sync = () => {
    const poses = usePlaybackTransforms.getState().poses
    for (const [id, original] of originals) {
      refreshBase(id, original)
      if (useLiveTransforms.getState().get(id)) continue
      if (!poses.has(id) || sceneRegistry.nodes.get(id) !== original.object) {
        apply(original.object, original.pose)
        if (useScene.getState().nodes[id as AnyNodeId])
          useScene.getState().markDirty(id as AnyNodeId)
        originals.delete(id)
      }
    }
    for (const [id, pose] of poses) {
      // Live manipulation owns the mesh until its preview is committed or cleared.
      if (useLiveTransforms.getState().get(id)) continue
      const object = sceneRegistry.nodes.get(id)
      if (!object) continue
      if (!originals.has(id))
        originals.set(id, { object, pose: objectMotionPose(object), source: sourcePose(id) })
      apply(object, pose)
    }
  }
  const unsubscribe = usePlaybackTransforms.subscribe(sync)
  sync()
  return {
    sync,
    dispose() {
      unsubscribe()
      for (const [id, original] of originals) {
        refreshBase(id, original)
        apply(original.object, original.pose)
      }
      originals.clear()
    },
  }
}
