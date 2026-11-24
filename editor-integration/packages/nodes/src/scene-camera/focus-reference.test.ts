import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  CameraMotion,
  CameraMotionPoint,
  CameraRig,
  cloneSceneGraph,
  SceneCameraNode,
  SiteNode,
} from '@pascal-app/core'
import { type AnyNodeDefinition, nodeRegistry, registerNode } from '@pascal-app/core/registry'
import { remapRegisteredNodeReferences } from '../../../core/dist/services/node-references'
import { siteDefinition } from '../site/definition'
import { sceneCameraDefinition } from './definition'

let restore: () => void
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
  registerNode(sceneCameraDefinition as unknown as AnyNodeDefinition)
  registerNode(siteDefinition as unknown as AnyNodeDefinition)
})
afterEach(() => restore())

function focusedRig(nodeId: string | null): CameraRig {
  const target = {
    nodeId,
    localPoint: [1, 2, 3],
    offset: [0.5, 0, 0],
    fallback: [4, 5, 6],
  }
  return CameraRig.parse({ type: 'dolly', target, focus: { kind: 'object', target } })
}

function motion(rigs: (CameraRig | null)[]): CameraMotion {
  const points = rigs.map((rig, time) =>
    CameraMotionPoint.parse({
      time,
      position: [0, 1.6, 5],
      rotation: [0, 0, 0],
      verticalFov: 45,
      orthographicHeight: 20,
      orbitDistance: 5,
      rig,
    }),
  )
  return CameraMotion.parse({
    points,
    segments: points.slice(1).map((point, i) => ({
      fromId: points[i]!.id,
      toId: point.id,
    })),
  })
}

function focusId(rig: CameraRig | null | undefined) {
  expect(rig?.focus.kind).toBe('object')
  if (rig?.focus.kind !== 'object') throw new Error('Expected object focus')
  return rig.focus.target.nodeId
}

test('the registered camera definition remaps aim and DOF targets without changing source data', () => {
  const oldTarget = SceneCameraNode.parse({})
  const newTarget = SceneCameraNode.parse({})
  const camera = SceneCameraNode.parse({ rig: focusedRig(oldTarget.id), name: oldTarget.id })
  const before = structuredClone(camera)
  const copy = remapRegisteredNodeReferences(camera, new Map([[oldTarget.id, newTarget.id]]))

  expect(copy.rig!.target!.nodeId).toBe(newTarget.id)
  expect(focusId(copy.rig)).toBe(newTarget.id)
  expect(copy.rig!.focus).toEqual({
    kind: 'object',
    target: { ...before.rig!.target!, nodeId: newTarget.id },
  })
  expect(copy.name).toBe(oldTarget.id)
  expect(camera).toEqual(before)
})

test('camera motion point DOF targets remap while external, null and rig-bone focus remain intact', () => {
  const oldTarget = SceneCameraNode.parse({})
  const newTarget = SceneCameraNode.parse({})
  const external = SceneCameraNode.parse({})
  const boneRig = CameraRig.parse({ type: 'crane', focus: { kind: 'rig', bone: 'Aim' } })
  const manualRig = CameraRig.parse({ type: '2d', focus: { kind: 'manual' } })
  // Copy APIs also preserve legacy per-camera motion payloads before scene migration.
  const camera = {
    ...SceneCameraNode.parse({ rig: focusedRig(external.id) }),
    motion: motion([
      focusedRig(oldTarget.id),
      focusedRig(external.id),
      focusedRig(null),
      boneRig,
      manualRig,
      null,
    ]),
  }
  const before = structuredClone(camera)
  const copy = remapRegisteredNodeReferences(camera, new Map([[oldTarget.id, newTarget.id]]))

  expect(copy.motion.points[0]!.rig!.target!.nodeId).toBe(newTarget.id)
  expect(focusId(copy.motion.points[0]!.rig)).toBe(newTarget.id)
  expect(focusId(copy.rig)).toBe(external.id)
  expect(focusId(copy.motion.points[1]!.rig)).toBe(external.id)
  expect(focusId(copy.motion.points[2]!.rig)).toBeNull()
  expect(copy.motion.points[3]!.rig!.focus).toEqual({ kind: 'rig', bone: 'Aim' })
  expect(copy.motion.points[4]!.rig!.focus).toEqual({ kind: 'manual' })
  expect(copy.motion.points[5]!.rig).toBeNull()
  expect(camera).toEqual(before)
})

test('cloneSceneGraph remaps live camera focus and site animation snapshots with the actual definitions', () => {
  const target = SceneCameraNode.parse({ name: 'Internal target' })
  const external = SceneCameraNode.parse({ name: 'External target' })
  const camera = SceneCameraNode.parse({ name: 'Rig camera', rig: focusedRig(target.id) })
  const savedMotion = motion([focusedRig(target.id), focusedRig(external.id)])
  const key = CameraMotionPoint.parse({
    ...savedMotion.points[0],
    values: { rig: camera.rig, motion: savedMotion, name: target.id },
  })
  const externalKey = CameraMotionPoint.parse({
    ...savedMotion.points[1],
    values: { rig: savedMotion.points[1]!.rig },
  })
  const site = SiteNode.parse({
    children: [camera.id, target.id],
    animation: {
      tracks: [
        {
          kind: 'camera',
          nodeId: camera.id,
          parentId: null,
          points: [key, externalKey],
          segments: savedMotion.segments,
        },
      ],
    },
  })
  camera.parentId = site.id
  target.parentId = site.id
  const cameraBefore = structuredClone(camera)
  const scene = {
    nodes: { [site.id]: site, [camera.id]: camera, [target.id]: target },
    rootNodeIds: [site.id],
  }
  const before = structuredClone(scene)
  const copy = cloneSceneGraph(scene)
  const clonedSite = Object.values(copy.nodes).find((node) => node.type === 'site')!
  const clonedCamera = Object.values(copy.nodes).find(
    (node) => node.type === 'scene-camera' && node.name === camera.name,
  )!
  const clonedTarget = Object.values(copy.nodes).find(
    (node) => node.type === 'scene-camera' && node.name === target.name,
  )!
  if (clonedCamera.type !== 'scene-camera' || clonedSite.type !== 'site')
    throw new Error('Expected cloned camera and site')
  const track = clonedSite.animation!.tracks[0]!
  const values = track.points[0]!.values!
  const savedRig = CameraRig.parse(values.rig)
  const clonedMotion = CameraMotion.parse(values.motion)

  expect(clonedTarget.id).not.toBe(target.id)
  expect(clonedCamera.parentId).toBe(clonedSite.id)
  expect(track.nodeId).toBe(clonedCamera.id)
  if (track.kind !== 'camera') throw new Error('Expected copied camera track')
  expect(track.points[0]!.rig!.target!.nodeId).toBe(clonedTarget.id)
  expect(focusId(track.points[0]!.rig)).toBe(clonedTarget.id)
  expect(focusId(track.points[1]!.rig)).toBe(external.id)
  expect(focusId(CameraRig.parse(track.points[1]!.values!.rig))).toBe(external.id)
  expect(clonedCamera.rig!.target!.nodeId).toBe(clonedTarget.id)
  expect(focusId(clonedCamera.rig)).toBe(clonedTarget.id)
  expect(savedRig.target!.nodeId).toBe(clonedTarget.id)
  expect(focusId(savedRig)).toBe(clonedTarget.id)
  expect(clonedMotion.points[0]!.rig!.target!.nodeId).toBe(clonedTarget.id)
  expect(focusId(clonedMotion.points[0]!.rig)).toBe(clonedTarget.id)
  expect(focusId(clonedMotion.points[1]!.rig)).toBe(external.id)
  expect(values.name).toBe(target.id)
  expect(scene).toEqual(before)
  const snapshotRig = values.rig as unknown as CameraRig
  if (snapshotRig.focus.kind !== 'object') throw new Error('Expected copied DOF target')
  snapshotRig.focus.target.fallback[0] = 99
  expect(camera).toEqual(cameraBefore)
})
