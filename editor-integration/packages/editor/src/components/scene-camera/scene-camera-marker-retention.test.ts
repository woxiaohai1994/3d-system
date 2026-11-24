import { afterEach, beforeEach, expect, test } from 'bun:test'
import { SceneAnimation, SceneCameraNode, SiteNode, useScene } from '@pascal-app/core'
import fixtures from '../../../../../vendor/blender-scene-camera/retention-fixtures.json'
import { animationData, commitSceneAnimation } from '../scene-animation/document'
import { initialSceneAnimationState, useSceneAnimation } from '../scene-animation/store'
import {
  endSceneAnimation,
  motionCamera,
  observedMotionCamera,
  observeSceneCamera,
  openMotion,
  outputMotionCamera,
  seekMotion,
} from './motion-state'
import { rigSceneOperator } from './rig-scene-operators'
import { changeRigType } from './rig-state'
import { currentSceneCameraId } from './scene-camera-state'

let sceneBefore: ReturnType<typeof useScene.getState>
let animationBefore: ReturnType<typeof useSceneAnimation.getState>
let temporalBefore: ReturnType<typeof useScene.temporal.getState>
let requestFrameBefore: typeof globalThis.requestAnimationFrame
let cancelFrameBefore: typeof globalThis.cancelAnimationFrame

beforeEach(() => {
  sceneBefore = useScene.getState()
  animationBefore = useSceneAnimation.getState()
  temporalBefore = useScene.temporal.getState()
  requestFrameBefore = globalThis.requestAnimationFrame
  cancelFrameBefore = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  useSceneAnimation.setState({ ...initialSceneAnimationState })
})

afterEach(() => {
  endSceneAnimation(true)
  useScene.setState(sceneBefore, true)
  useScene.temporal.setState(temporalBefore, true)
  useSceneAnimation.setState(animationBefore, true)
  globalThis.requestAnimationFrame = requestFrameBefore
  globalThis.cancelAnimationFrame = cancelFrameBefore
})

test.each([
  'delete',
  'unbind',
] as const)('%s of the last valid marker retains the scene camera selected by native Blender update', (operation) => {
  const native = fixtures.cases.find((entry) => entry.id === `${operation}-last-valid-from-A`)!
  expect(native.states.map((state) => state.sceneCamera)).toEqual(['B', 'B', 'B', 'B'])
  expect(native.states.at(-1)!.selectedMarkerCamera).toBeNull()

  const site = SiteNode.parse({ animation: SceneAnimation.parse({}) })
  const a = SceneCameraNode.parse({ parentId: site.id, name: 'A' })
  const b = SceneCameraNode.parse({ parentId: site.id, name: 'B' })
  site.children = [a.id, b.id]
  useScene.setState({
    nodes: { [site.id]: site, [a.id]: a, [b.id]: b },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  openMotion(a)
  changeRigType(a, 'dolly')
  const rigA = motionCamera()!
  openMotion(b)
  changeRigType(b, 'crane')
  const rigB = motionCamera()!
  expect(rigSceneOperator(rigA, 'set_scene_camera').run()).toBe(true)
  seekMotion(2)
  expect(rigSceneOperator(rigB, 'add_marker_bind').run()).toBe(true)
  observeSceneCamera()
  seekMotion(2.5)
  expect(currentSceneCameraId()).toBe(b.id)
  expect(observedMotionCamera()!.id).toBe(b.id)
  expect(outputMotionCamera()!.id).toBe(b.id)
  expect(motionCamera()!.id).toBe(b.id)

  const data = animationData()
  const marker = data.cameraMarkers![0]!
  expect(
    commitSceneAnimation({
      ...data,
      cameraMarkers: operation === 'delete' ? [] : [{ ...marker, cameraId: null }],
    }),
  ).toBe(true)

  expect(currentSceneCameraId()).toBe(b.id)
  expect(observedMotionCamera()!.id).toBe(b.id)
  expect(outputMotionCamera()!.id).toBe(b.id)
  expect(useSceneAnimation.getState().time).toBe(2.5)
  expect(motionCamera()!.id).toBe(b.id)
  seekMotion(3)
  expect(currentSceneCameraId()).toBe(b.id)
  useScene.temporal.getState().undo()
  expect(animationData().cameraMarkers).toEqual([marker])
  expect(currentSceneCameraId()).toBe(b.id)
})
