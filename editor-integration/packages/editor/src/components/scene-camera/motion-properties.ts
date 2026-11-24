import {
  type AnyNode,
  type AnyNodeId,
  getEffectiveNode,
  isMotionProperty,
  type MotionValues,
  type NodeUpdate,
  parseUpdatedNode,
  registerNodeUpdateTransform,
  sampleMotionProperties,
  snapshotMotionProperties,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { animationData, animationSite } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { cameraFov } from './camera-math'
import { stageMotionProperties, useMotionEdits } from './motion-edit-session'
import { useObjectMotion } from './motion-object-store'
import { changeMotionDraft, motionData } from './motion-state'
import { sampleRigPropertyAnimation, useRigPropertyEdits } from './rig-property-animation'

let sampledOverrides = new Map<string, MotionValues>()
let samplingProperties = false
export function isSamplingMotionProperties() {
  return samplingProperties
}
export function hasUnrecordedPropertyOverrides() {
  return [...useLiveNodeOverrides.getState().overrides].some(([id, values]) =>
    Object.entries(values).some(
      ([key, value]) =>
        !sampledOverrides.get(id) ||
        !Object.hasOwn(sampledOverrides.get(id)!, key) ||
        !Object.is(sampledOverrides.get(id)![key], value),
    ),
  )
}

export function motionSnapshot(node: AnyNode) {
  return snapshotMotionProperties(getEffectiveNode(node))
}
function sampledValues(
  node: AnyNode,
  points: Parameters<typeof sampleMotionProperties>[0],
  time: number,
) {
  const values = sampleMotionProperties(points, time, snapshotMotionProperties(node))
  if (!Object.keys(values).length) return values
  const normalized = parseUpdatedNode(node, values as Partial<AnyNode>, false)
  return Object.fromEntries(
    Object.keys(values)
      .filter(isMotionProperty)
      .map((k) => [k, (normalized as MotionValues)[k]]),
  )
}
export function bindMotionPropertySampler() {
  let owned = new Map<string, MotionValues>()
  return {
    sample(time: number | null) {
      const next = new Map<string, MotionValues>()
      if (time !== null && useSceneAnimation.getState().open) {
        const data = animationData()
        for (const track of data.tracks) {
          const node = useScene.getState().nodes[track.nodeId as AnyNodeId]
          if (!node || node.parentId !== track.parentId) continue
          const points =
            'segments' in track
              ? track.points.map((p, i) => ({
                  ...p,
                  hold: track.segments?.[i]?.rhythm === 'hold',
                  easing:
                    track.segments?.[i]?.rhythm === 'ease'
                      ? track.segments[i]!.easing
                      : ([0, 0, 1, 1] as [number, number, number, number]),
                }))
              : track.points
          const values = sampledValues(node, points, time)
          if (node.type === 'scene-camera') {
            const base = { ...node, ...values }
            const animated = sampleRigPropertyAnimation(base, time)
            for (const key of Object.keys(animated) as (keyof typeof animated)[])
              if (animated[key] !== base[key]) values[key] = animated[key]
          }
          // Three-dimensional poses have a dedicated synchronous sampling path.
          if ('position' in node && Array.isArray(node.position) && node.position.length === 3) {
            delete values.position
            delete values.rotation
            delete values.scale
          }
          if (Object.keys(values).length) next.set(node.id, values)
        }
        for (const id of Object.keys(useRigPropertyEdits.getState().edits)) {
          if (data.tracks.some((track) => track.nodeId === id)) continue
          const node = useScene.getState().nodes[id as AnyNodeId]
          if (node?.type !== 'scene-camera') continue
          const animated = sampleRigPropertyAnimation(node, time),
            values: MotionValues = {}
          for (const key of Object.keys(animated) as (keyof typeof animated)[])
            if (animated[key] !== node[key]) values[key] = animated[key]
          if (Object.keys(values).length) next.set(id, values)
        }
      }
      if (
        time !== null &&
        !useSceneAnimation.getState().renderingFilm &&
        !useSceneAnimation.getState().exporting
      )
        for (const [id, values] of Object.entries(useMotionEdits.getState().properties))
          next.set(id, { ...next.get(id), ...values })
      const live = useLiveNodeOverrides.getState()
      samplingProperties = true
      try {
        for (const [id, values] of owned) {
          const keys = Object.keys(values).filter((k) => !(k in (next.get(id) ?? {})))
          if (keys.length) {
            live.clearFields(id, keys)
            useScene.getState().markDirty(id as AnyNodeId)
          }
        }
        const changes = [...next].filter(
          ([id, values]) =>
            JSON.stringify(values) !== JSON.stringify(owned.get(id)) ||
            JSON.stringify(values) !== JSON.stringify(live.overrides.get(id)),
        )
        if (changes.length) {
          live.setMany(changes)
          for (const [id] of changes) {
            useScene.getState().markDirty(id as AnyNodeId)
            const node = useScene.getState().nodes[id as AnyNodeId]
            if (node?.parentId) useScene.getState().markDirty(node.parentId as AnyNodeId)
          }
        }
        for (const [id, values] of next) {
          if (!changes.some(([changedId]) => changedId === id) && owned.has(id))
            next.set(id, owned.get(id)!)
        }
        owned = next
        sampledOverrides = next
      } finally {
        samplingProperties = false
      }
    },
  }
}

/** Preview authored changes without changing the document or its animation. */
export function bindMotionDrafts() {
  return registerNodeUpdateTransform((updates) => {
    const state = useSceneAnimation.getState(),
      site = animationSite()
    if (
      !state.open ||
      !site ||
      state.playing ||
      state.exporting ||
      state.previewing ||
      updates.some((u) => u.id === site.id && 'animation' in u.data)
    )
      return updates
    const rest: NodeUpdate[] = []
    for (const update of updates) {
      const node = useScene.getState().nodes[update.id]
      if (
        !node ||
        node.id !== (useObjectMotion.getState().nodeId ?? state.cameraId) ||
        ['site', 'building', 'level'].includes(node.type)
      ) {
        rest.push(update)
        continue
      }
      const editable = Object.fromEntries(
        Object.entries(update.data).filter(([k]) => isMotionProperty(k)),
      )
      const structural = Object.fromEntries(
        Object.entries(update.data).filter(([k]) => !isMotionProperty(k)),
      )
      const lensChanged =
        node.type === 'scene-camera' &&
        ['focalLength', 'verticalFov', 'orthographicHeight'].some((k) => k in editable)
      if (lensChanged && !state.lockedIds.includes(node.id) && !motionData(node).points.length) {
        for (const key of ['focalLength', 'verticalFov', 'orthographicHeight', 'projection']) {
          if (key in editable) {
            structural[key] = editable[key]
            delete editable[key]
          }
        }
      }
      if (Object.keys(structural).length)
        rest.push({ id: update.id, data: structural as Partial<AnyNode> })
      if (Object.keys(editable).length && !state.lockedIds.includes(node.id)) {
        stageMotionProperties(node.id, editable)
        if (lensChanged && node.type === 'scene-camera' && motionData(node).points.length) {
          const frame = { ...getEffectiveNode(node), frameAspect: animationData().aspect }
          // Camera keys store FOV in the pose; updating only properties gets overwritten on save.
          changeMotionDraft(
            {
              verticalFov: cameraFov(frame),
              orthographicHeight: frame.orthographicHeight,
            },
            false,
          )
        }
      }
    }
    return rest
  })
}
