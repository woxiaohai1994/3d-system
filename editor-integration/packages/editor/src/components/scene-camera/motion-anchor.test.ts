import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import {
  ColumnNode,
  cameraTracks,
  LevelNode,
  SceneCameraNode,
  SiteNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { BoxGeometry, Euler, Group, Mesh, Quaternion, Vector3 } from 'three'
import { animationSite } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import {
  changeMotionDraft,
  commitMotionPoint,
  constrainedMotionSegments,
  endSceneAnimation,
  freeMotionPointOrientation,
  motionData,
  motionPose,
  motionPreviewPose,
  motionTarget,
  openMotion,
  pickMotionAnchor,
  resolveMotionTarget,
  seekMotion,
  updateMotionAnchor,
} from './motion-state'

const oldRaf = globalThis.requestAnimationFrame,
  oldCancel = globalThis.cancelAnimationFrame
const ids: string[] = []
beforeAll(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
})
afterAll(() => {
  globalThis.requestAnimationFrame = oldRaf
  globalThis.cancelAnimationFrame = oldCancel
})
afterEach(() => {
  endSceneAnimation(true)
  ids.splice(0).forEach((id) => {
    sceneRegistry.nodes.delete(id)
  })
})
function setup() {
  const level = LevelNode.parse({}),
    camera = SceneCameraNode.parse({ parentId: level.id }),
    target = ColumnNode.parse({ parentId: level.id })
  const site = SiteNode.parse({ children: [level.id] })
  useScene.setState({
    nodes: { [site.id]: site, [level.id]: level, [camera.id]: camera, [target.id]: target },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  const parent = new Group(),
    object = new Mesh(new BoxGeometry(2, 4, 6))
  parent.position.set(10, 4, -2)
  parent.rotation.y = 0.7
  object.position.set(3, 1, -2)
  object.rotation.set(0.2, 0.8, 0)
  object.scale.set(2, 3, 0.5)
  parent.add(object)
  parent.updateMatrixWorld(true)
  sceneRegistry.nodes.set(level.id, parent)
  sceneRegistry.nodes.set(target.id, object)
  ids.push(level.id, target.id)
  openMotion(camera)
  commitMotionPoint()
  seekMotion(3)
  changeMotionDraft({ position: [4, 3, 5] })
  commitMotionPoint()
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  return { camera, target, object, parent, segmentId: motionData().segments[0]!.id }
}
test('picked world surfaces become stable local anchors and offsets follow rotation and nonuniform scale', () => {
  const { target, object, parent, segmentId } = setup()
  const local = new Vector3(0.25, 1, -1),
    hit = object.localToWorld(local.clone())
  useSceneAnimation.setState({ pickingAnchor: { segmentId, field: 'target' } })
  expect(pickMotionAnchor(target.id, hit.toArray())).toBe(true)
  let anchor = motionData().segments[0]!.target!
  expect(new Vector3(...anchor.localPoint!).distanceTo(local)).toBeLessThan(1e-9)
  expect(updateMotionAnchor(segmentId, 'target', { ...anchor, offset: [0.1, 0.4, -0.2] })).toBe(
    true,
  )
  anchor = motionData().segments[0]!.target!
  const expected = parent.worldToLocal(
    object.localToWorld(local.clone().add(new Vector3(...anchor.offset))),
  )
  expect(resolveMotionTarget(anchor).distanceTo(expected)).toBeLessThan(1e-9)
  object.position.x += 3
  object.rotation.y += 0.4
  object.updateWorldMatrix(true, false)
  const moved = parent.worldToLocal(
    object.localToWorld(local.clone().add(new Vector3(...anchor.offset))),
  )
  expect(resolveMotionTarget(anchor).distanceTo(moved)).toBeLessThan(1e-9)
  const remaining = { ...useScene.getState().nodes }
  delete remaining[target.id]
  useScene.setState({ nodes: remaining })
  expect(sceneRegistry.nodes.has(target.id)).toBe(true)
  expect(resolveMotionTarget(anchor).toArray()).toEqual(anchor.fallback)
  sceneRegistry.nodes.delete(target.id)
  expect(resolveMotionTarget(anchor).toArray()).toEqual(anchor.fallback)
  object.geometry.dispose()
})
test('target draft framing equals committed framing, keeps legacy target constraints, and frees orientation without a jump', () => {
  const { target, object, segmentId } = setup()
  updateMotionAnchor(segmentId, 'target', motionTarget(target.id)!)
  const point = motionData().points[1]!
  seekMotion(point.time, point.id)
  expect(constrainedMotionSegments()).toHaveLength(1)
  changeMotionDraft({ rotation: [1, 2, 3] }, false)
  expect(useSceneAnimation.getState().draft?.rotation).toEqual([1, 2, 3])
  changeMotionDraft({ position: [8, 3, 2], verticalFov: 65 }, false)
  const preview = motionPreviewPose()!
  commitMotionPoint()
  const saved = motionPose()!
  expect(saved).toEqual(preview)
  freeMotionPointOrientation()
  const free = motionPose()!
  const q = (rotation: [number, number, number]) =>
    new Quaternion().setFromEuler(new Euler(...rotation))
  expect(q(free.rotation).angleTo(q(saved.rotation))).toBeLessThan(1e-7)
  expect(constrainedMotionSegments()).toHaveLength(0)
  useScene.temporal.getState().undo()
  expect(constrainedMotionSegments()).toHaveLength(1)
  object.geometry.dispose()
})
test('binding and offset survive scene JSON reload and are one undo step each', () => {
  const { camera, target, object, segmentId } = setup()
  updateMotionAnchor(segmentId, 'target', motionTarget(target.id, [0.1, 0.2, 0.3])!)
  const first = motionData().segments[0]!.target!
  updateMotionAnchor(segmentId, 'target', { ...first, offset: [0, 1, 0] })
  expect(useScene.temporal.getState().pastStates).toHaveLength(2)
  useScene.temporal.getState().undo()
  expect(motionData().segments[0]!.target).toEqual(first)
  useScene.temporal.getState().redo()
  const saved = cameraTracks(
    SiteNode.parse(JSON.parse(JSON.stringify(animationSite()))).animation!,
  ).find((t) => t.nodeId === camera.id)!
  expect(saved.segments[0]!.target!.offset).toEqual([0, 1, 0])
  expect(saved.segments[0]!.target!.localPoint).toEqual([0.1, 0.2, 0.3])
  seekMotion(0)
  expect(useSceneAnimation.getState().pointId).toBe(saved.points[0]!.id)
  expect(() => seekMotion(1, 'removed-shot')).not.toThrow()
  expect(useSceneAnimation.getState().pointId).toBeNull()
  object.geometry.dispose()
})
