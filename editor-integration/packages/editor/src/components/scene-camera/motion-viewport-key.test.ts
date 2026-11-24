import { afterEach, expect, test } from 'bun:test'
import { objectTracks, SceneCameraNode, SiteNode, sceneRegistry, useScene } from '@pascal-app/core'
import { solveCameraRig } from '@pascal-app/viewer'
import { Group, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { useObjectMotion } from './motion-object-store'
import {
  captureViewportKey,
  commitMotionPoint,
  endSceneAnimation,
  motionData,
  openMotion,
  seekMotion,
} from './motion-state'
import { createSourceRigCamera } from './rig-create-source'
import { registerViewportSource } from './viewport-source'

const raf = globalThis.requestAnimationFrame,
  cancel = globalThis.cancelAnimationFrame
let release: (() => void) | undefined
afterEach(() => {
  endSceneAnimation(true)
  release?.()
  sceneRegistry.nodes.clear()
  globalThis.requestAnimationFrame = raf
  globalThis.cancelAnimationFrame = cancel
})
function setup(source = new PerspectiveCamera(50, 4 / 3)) {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const site = SiteNode.parse({})
  const a = SceneCameraNode.parse({ parentId: site.id, depthOfField: true })
  const b = SceneCameraNode.parse({})
  useScene.setState({
    nodes: { [site.id]: site, [a.id]: a, [b.id]: b },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  openMotion(a)
  source.position.set(8, 4, 12)
  const target = new Vector3(0, 1, 0)
  source.lookAt(target)
  release = registerViewportSource(() => ({ camera: source, target }))
  useScene.temporal.getState().clear()
  return { a, b, source, target }
}
test('manual viewport capture inserts at the playhead, replaces only that key, and undoes atomically', () => {
  const { a, b, source } = setup()
  commitMotionPoint()
  seekMotion(4)
  commitMotionPoint()
  const before = animationData()
  const originals = motionData().points
  seekMotion(2)
  // A previously selected ID must never redirect an explicit viewport capture to another time.
  useSceneAnimation.setState({ pointId: originals[0]!.id })
  useScene.temporal.getState().clear()
  expect(captureViewportKey()).toBe(true)
  expect(motionData().points).toHaveLength(3)
  const captured = motionData().points[1]!
  expect(captured.time).toBe(2)
  expect(captured.position).toEqual(source.position.toArray())
  expect(captured.verticalFov).toBeCloseTo(
    (2 * Math.atan(Math.tan((25 * Math.PI) / 180) * 0.75) * 180) / Math.PI,
    8,
  )
  expect(captured.values?.depthOfField).toBe(true)
  expect(captured.values?.frameAspect).toBeCloseTo(16 / 9, 8)
  expect(useSceneAnimation.getState().cameraView).toBe(false)
  expect(useSceneAnimation.getState().draft).toBeNull()
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(animationData()).toEqual(before)
  useScene.temporal.getState().redo()
  source.position.set(2, 3, 8)
  expect(captureViewportKey()).toBe(true)
  expect(motionData().points).toHaveLength(3)
  expect(motionData().points[1]!.id).toBe(captured.id)
  expect(motionData().points[1]!.position).toEqual([2, 3, 8])
  expect(motionData().points.filter((p) => p.time !== 2)).toEqual(originals)
  expect(useScene.getState().nodes[a.id]).toEqual(a)
  expect(useScene.getState().nodes[b.id]).toEqual(b)
  expect(Object.keys(useScene.getState().nodes)).toHaveLength(3)
  expect(objectTracks(animationData())).toEqual(objectTracks(before))
})
test('capture transforms the world view into parent-local pose and retains orthographic zoom', () => {
  const { a, target } = setup()
  const parent = new Group()
  parent.position.set(5, 2, -8)
  parent.rotation.y = 0.7
  sceneRegistry.nodes.set(a.parentId!, parent)
  const source = new OrthographicCamera(-8, 8, 6, -6, 0.2, 3000)
  source.zoom = 2
  source.position.set(10, 7, 15)
  source.lookAt(target)
  source.updateProjectionMatrix()
  release?.()
  release = registerViewportSource(() => ({ camera: source, target }))
  seekMotion(3)
  expect(captureViewportKey()).toBe(true)
  const point = motionData().points[0]!
  expect(motionData().points).toHaveLength(1)
  expect(point.time).toBe(3)
  expect(
    parent.localToWorld(new Vector3(...point.position)).distanceTo(source.position),
  ).toBeLessThan(1e-7)
  expect(point.values?.projection).toBe('orthographic')
  expect(point.orthographicHeight).toBeCloseTo(4.5, 8)
  expect(point.values?.near).toBe(0.2)
  expect(point.values?.far).toBe(3000)
})
test('capture cannot overwrite pending edits or write during playback', () => {
  setup()
  const nodes = useScene.getState().nodes
  for (const field of ['playing', 'exporting', 'previewing', 'navigating'] as const) {
    useSceneAnimation.setState({ [field]: true })
    expect(captureViewportKey()).toBe(false)
    useSceneAnimation.setState({ [field]: false })
  }
  useSceneAnimation.setState({ sceneDraft: animationData() })
  expect(captureViewportKey()).toBe(false)
  useSceneAnimation.setState({ sceneDraft: null })
  useScene.setState({ readOnly: true })
  expect(captureViewportKey()).toBe(false)
  useScene.setState({ readOnly: false })
  useObjectMotion.setState({ nodeId: 'another-object' })
  expect(captureViewportKey()).toBe(false)
  useObjectMotion.setState({ nodeId: null })
  release?.()
  expect(captureViewportKey()).toBe(false)
  expect(useScene.getState().nodes).toBe(nodes)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})

test('capture is available in an activated camera without changing activation', () => {
  setup()
  useSceneAnimation.setState({ cameraView: true })
  seekMotion(2)
  expect(captureViewportKey()).toBe(true)
  expect(useSceneAnimation.getState().cameraView).toBe(true)
  expect(motionData().points.map((p) => p.time)).toEqual([2])
})

test('viewport key capture stores a matching rig bone pose rather than stale rig data', () => {
  const { a, source } = setup()
  const rig = createSourceRigCamera('dolly', [0, 0, 0]).rig
  useScene.getState().updateNode(a.id, { rig })
  useScene.temporal.getState().clear()
  expect(captureViewportKey()).toBe(true)
  const point = motionData().points[0]!
  const pose = solveCameraRig(point, point.rig!, {
    aspect: animationData().aspect,
    projection: 'perspective',
  })
  expect(new Vector3(...pose.position).distanceTo(source.position)).toBeLessThan(1e-7)
  expect(pose.verticalFov).toBeCloseTo(point.verticalFov, 8)
  expect(point.rig!.type).toBe('dolly')
  expect(point.rig!.native!.cameraOffsetMatrix).toBeUndefined()
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(motionData().points).toHaveLength(0)
})
