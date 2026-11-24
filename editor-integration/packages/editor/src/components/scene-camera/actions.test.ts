import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { SceneCameraNode, useScene } from '@pascal-app/core'
import { sceneCameraRigPose } from '@pascal-app/viewer'
import { PerspectiveCamera, Vector3 } from 'three'
import { addSceneCamera, alignCameraToView } from './actions'
import { createSourceRigCamera } from './rig-create-source'
import { useRigEditor } from './rig-state'
import { registerViewportSource } from './viewport-source'

let unregister: (() => void) | undefined
const originalRaf = globalThis.requestAnimationFrame
const originalCancelRaf = globalThis.cancelAnimationFrame
beforeAll(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
})
afterAll(() => {
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancelRaf
})
afterEach(() => {
  unregister?.()
})

test('snapshot captures the main viewport in a single undoable update', () => {
  const node = SceneCameraNode.parse({})
  useScene.setState({ nodes: { [node.id]: node }, rootNodeIds: [node.id], readOnly: false })
  useScene.temporal.getState().clear()
  useScene.temporal.getState().resume()
  const camera = new PerspectiveCamera(50, 1.7)
  camera.position.set(4, 8, 12)
  const target = new Vector3(0, 1, 0)
  camera.lookAt(target)
  unregister = registerViewportSource(() => ({ camera, target }))
  expect(alignCameraToView(node)).toBe(true)
  expect(useScene.temporal.getState().pastStates.length).toBe(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[node.id]).toEqual(node)
})

test('adding a camera always captures the current view and opens its view', () => {
  useScene.setState({ nodes: {}, rootNodeIds: [], readOnly: false })
  expect(addSceneCamera('相机')).toBeUndefined()
  const camera = new PerspectiveCamera(72, 1.9)
  camera.position.set(9, 7, 15)
  const target = new Vector3(2, 3, -4)
  camera.lookAt(target)
  unregister = registerViewportSource(() => ({ camera, target }))
  const node = addSceneCamera('相机')!
  expect(node.position).toEqual([9, 7, 15])
  expect(node.verticalFov).toBeCloseTo(72, 7)
  expect(node.frameAspect).toBe(1.9)
  expect(node.orbitDistance).toBeCloseTo(camera.position.distanceTo(target), 7)
})

test('using the current view rebuilds rig bones in one undo step and retains pose mode', () => {
  const node = createSourceRigCamera('crane', [0, 0, 0])
  useScene.setState({ nodes: { [node.id]: node }, rootNodeIds: [node.id], readOnly: false })
  useScene.temporal.getState().clear()
  useScene.temporal.getState().resume()
  useRigEditor.setState({ poseCameraId: node.id, control: 'Camera' })
  const camera = new PerspectiveCamera(50, 1.7)
  camera.position.set(4, 8, 12)
  const target = new Vector3(0, 1, 0)
  camera.lookAt(target)
  unregister = registerViewportSource(() => ({ camera, target }))
  expect(alignCameraToView(node)).toBe(true)
  const saved = useScene.getState().nodes[node.id] as SceneCameraNode
  const sampled = sceneCameraRigPose(saved)
  expect(new Vector3(...sampled.position).distanceTo(camera.position)).toBeLessThan(1e-7)
  expect(saved.rig!.native!.cameraOffsetMatrix).toBeUndefined()
  expect(useRigEditor.getState().poseCameraId).toBe(node.id)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[node.id]).toEqual(node)
  useScene.temporal.getState().redo()
  expect(useScene.getState().nodes[node.id]).toEqual(saved)
})
