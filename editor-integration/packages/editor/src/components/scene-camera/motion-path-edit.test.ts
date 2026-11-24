import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import {
  CameraMotionPoint,
  MotionSegment,
  SceneCameraNode,
  SiteNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { createTransformMotionEvaluator } from '@pascal-app/viewer'
import { Object3D, Vector3 } from 'three'
import { useSceneAnimation } from '../scene-animation/store'
import { commitPath, previewPath } from './motion-path-context'
import { editMotionPath, reshapeMotionPath, translateMotionPath } from './motion-path-edit'
import {
  changeMotionDraft,
  commitMotionPoint,
  endSceneAnimation,
  enterMotionCameraView,
  motionData,
  openMotion,
  seekMotion,
} from './motion-state'

const oldRaf = globalThis.requestAnimationFrame,
  oldCancel = globalThis.cancelAnimationFrame
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
  useScene.setState({ readOnly: false })
})
test('path drag previews without source writes, commits one undo step and preserves all keys and other segments', () => {
  const camera = SceneCameraNode.parse({}),
    site = SiteNode.parse({ children: [camera.id] })
  useScene.setState({
    nodes: { [camera.id]: camera, [site.id]: site },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  openMotion(camera)
  for (const time of [0, 3, 6]) {
    seekMotion(time)
    changeMotionDraft({ position: [time, 0, 0] })
    commitMotionPoint()
  }
  enterMotionCameraView(camera.id)
  const before = motionData(),
    segment = before.segments[0]!
  expect(editMotionPath(segment.id)).toBe(true)
  expect(useSceneAnimation.getState().cameraView).toBe(false)
  useScene.temporal.getState().clear()
  const nodes = useScene.getState().nodes
  const draft = reshapeMotionPath(before, segment.id, new Vector3(0, 3, 0), 'curve')
  previewPath(draft)
  expect(useScene.getState().nodes).toBe(nodes)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  expect(draft.segments[0]!.look).toBe(before.segments[0]!.look)
  expect(draft.points).toEqual(before.points)
  expect(draft.segments[1]).toEqual(before.segments[1])
  for (const [i, handle] of draft.segments[0]!.handles!.entries()) {
    expect(handle[0]).toBeCloseTo(i ? -1 : 1, 8)
    expect(handle.slice(1)).toEqual([4, 0])
  }
  useSceneAnimation.setState({ sceneDraft: null })
  expect(motionData()).toEqual(before)
  expect(commitPath(draft)).toBe(true)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(motionData()).toEqual(before)
  useScene.temporal.getState().redo()
  expect(motionData()).toEqual(draft)
  const single = reshapeMotionPath(draft, segment.id, new Vector3(0, 0, 2), 0)
  expect(single.segments[0]!.handles![0].slice(1)).toEqual([4, 2])
  expect(single.segments[0]!.handles![1]).toEqual(draft.segments[0]!.handles![1])
  expect(single.points).toEqual(before.points)
  const manual = structuredClone(draft)
  manual.segments[0]!.look = 'free'
  expect(reshapeMotionPath(manual, segment.id, new Vector3(1, 0, 0), 0).segments[0]!.look).toBe(
    'free',
  )
  const targeted = structuredClone(before)
  targeted.segments[0]!.look = 'target'
  targeted.segments[0]!.target = {
    nodeId: null,
    localPoint: null,
    offset: [0, 0, 0],
    fallback: [0, 0, 0],
  }
  expect(reshapeMotionPath(targeted, segment.id, new Vector3(1, 0, 0), 0).segments[0]!.look).toBe(
    'target',
  )
  useScene.setState({ readOnly: true })
  expect(editMotionPath(segment.id)).toBe(false)
})

test('translation preserves every path type and its sampled camera positions, without moving look targets', () => {
  const points = [
    [3, 2, 0],
    [0, 2, 3],
    [-3, 2, 0],
  ].map((position, i) =>
    CameraMotionPoint.parse({
      time: i * 3,
      position,
      rotation: [0, 0, 0],
      verticalFov: 50,
      orthographicHeight: 10,
      orbitDistance: 5,
    }),
  )
  const delta = new Vector3(4, -1, 7)
  for (const path of ['line', 'smooth', 'bezier', 'orbit'] as const) {
    const data = {
      points,
      segments: points.slice(1).map((p, i) =>
        MotionSegment.parse({
          fromId: points[i]!.id,
          toId: p.id,
          path,
          rhythm: 'continuous',
          center: { fallback: [0, 2, 0] },
          target: { fallback: [1, 1, 1] },
          look: 'target',
          handles: [
            [0, 0, 2],
            [2, 0, 0],
          ],
        }),
      ),
    }
    const snapshot = structuredClone(data),
      moved = translateMotionPath(data, delta)
    const before = createTransformMotionEvaluator(data),
      after = createTransformMotionEvaluator(moved)
    for (let t = 0; t <= 6; t += 0.125) {
      const expected = new Vector3(...before.sample(t)!.position).add(delta)
      expect(new Vector3(...after.sample(t)!.position).distanceTo(expected)).toBeLessThan(1e-7)
    }
    expect(data).toEqual(snapshot)
    expect(moved.segments.map((s) => s.target)).toEqual(data.segments.map((s) => s.target))
    expect(moved.points.map((p) => [p.time, p.rotation])).toEqual(
      data.points.map((p) => [p.time, p.rotation]),
    )
    if (path !== 'orbit') expect(moved.segments).toEqual(data.segments)
  }
})

test('bound orbit centers translate between rotated and scaled parent/target frames without detaching', () => {
  const targetNode = SceneCameraNode.parse({}),
    parent = new Object3D(),
    target = new Object3D()
  parent.position.set(9, 2, -4)
  parent.rotation.set(0.2, 0.8, -0.1)
  parent.scale.set(2, 3, 0.5)
  target.position.set(-4, 8, 3)
  target.rotation.set(-0.3, -0.6, 0.4)
  target.scale.set(0.7, 2, 1.2)
  useScene.setState({ nodes: { [targetNode.id]: targetNode } })
  sceneRegistry.nodes.set(targetNode.id, target)
  const center = {
    nodeId: targetNode.id,
    localPoint: [1, 2, 3] as [number, number, number],
    offset: [0.5, 0, -1] as [number, number, number],
    fallback: [0, 2, 0] as [number, number, number],
  }
  const points = [
    [3, 2, 0],
    [0, 2, 3],
  ].map((position, i) =>
    CameraMotionPoint.parse({
      time: i * 4,
      position,
      rotation: [0, 0, 0],
      verticalFov: 50,
      orthographicHeight: 10,
      orbitDistance: 5,
    }),
  )
  const data = {
    points,
    segments: [
      MotionSegment.parse({ fromId: points[0]!.id, toId: points[1]!.id, path: 'orbit', center }),
    ],
  }
  const resolve = (anchor: typeof center) =>
    parent.worldToLocal(
      target.localToWorld(new Vector3(...anchor.localPoint).add(new Vector3(...anchor.offset))),
    )
  try {
    const delta = new Vector3(2, 1, -3),
      moved = translateMotionPath(data, delta, parent)
    expect(
      resolve(moved.segments[0]!.center as typeof center).distanceTo(resolve(center).add(delta)),
    ).toBeLessThan(1e-7)
    expect(moved.segments[0]!.center!.nodeId).toBe(targetNode.id)
    expect(moved.segments[0]!.center!.localPoint).toEqual(center.localPoint)
    const before = createTransformMotionEvaluator(data, (a) => resolve(a as typeof center))
    const after = createTransformMotionEvaluator(moved, (a) => resolve(a as typeof center))
    for (let t = 0; t <= 4; t += 0.1)
      expect(
        new Vector3(...after.sample(t)!.position).distanceTo(
          new Vector3(...before.sample(t)!.position).add(delta),
        ),
      ).toBeLessThan(1e-7)
    sceneRegistry.nodes.delete(targetNode.id)
    const missing = translateMotionPath(data, delta, parent)
    expect(missing.segments[0]!.center!.fallback).toEqual([2, 3, -3])
    expect(missing.segments[0]!.center!.nodeId).toBe(targetNode.id)
  } finally {
    sceneRegistry.nodes.delete(targetNode.id)
  }
})
