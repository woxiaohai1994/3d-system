import { afterEach, expect, test } from 'bun:test'
import { ItemNode, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import {
  clearItemRotationPreview,
  commitItemRotation,
  initialItemRotation,
  rotationDegrees,
} from './item-rotation'

type RafFn = (callback: (time: number) => void) => number
;(globalThis as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
;(globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??= () => {}

const fixture = () =>
  ItemNode.parse({
    asset: {
      id: 'rotation-test',
      category: 'furniture',
      name: 'Sofa',
      thumbnail: '',
      src: '/sofa.glb',
    },
    rotation: [0.3, Math.PI / 2, 0.4],
    metadata: { initialRotation: [0, Math.PI / 2, 0] },
  })
const original = useScene.getState()
afterEach(() => {
  useLiveNodeOverrides.getState().clearAll()
  useScene.setState(original)
  useScene.temporal.getState().clear()
})

test('both endpoints remain stable, accumulated rotations wrap to equivalent angles', () => {
  expect(rotationDegrees(Math.PI)).toBe(180)
  expect(rotationDegrees(-Math.PI)).toBe(-180)
  expect(rotationDegrees(3 * Math.PI)).toBe(180)
  expect(rotationDegrees(-3 * Math.PI)).toBe(-180)
  expect(rotationDegrees((5 * Math.PI) / 2)).toBeCloseTo(90)
})

test('preview is shared but does not create history; commit is one undoable step', () => {
  const node = fixture()
  useScene.setState({ nodes: { [node.id]: node }, rootNodeIds: [node.id], readOnly: false })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  useLiveNodeOverrides.getState().set(node.id, { rotation: [1, 2, 0.4], position: [1, 2, 3] })
  expect(useScene.getState().nodes[node.id]).toEqual(node)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  commitItemRotation(node.id, [1, 2, 0.4])
  clearItemRotationPreview(node.id)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  expect(useLiveNodeOverrides.getState().get(node.id)).toEqual({ position: [1, 2, 3] })
  useScene.temporal.getState().undo()
  expect((useScene.getState().nodes[node.id] as ItemNode).rotation).toEqual(node.rotation)
  useScene.temporal.getState().redo()
  expect((useScene.getState().nodes[node.id] as ItemNode).rotation).toEqual([1, 2, 0.4])
})

test('reset preserves saved placement direction and old scenes use asset baseline', () => {
  const node = fixture()
  expect(initialItemRotation(node)).toEqual([0, Math.PI / 2, 0])
  expect(initialItemRotation({ ...node, metadata: {} })).toEqual([0, 0, 0])
})

test('read-only scenes and no-op changes do not add history', () => {
  const node = fixture()
  useScene.setState({ nodes: { [node.id]: node }, rootNodeIds: [node.id], readOnly: false })
  useScene.temporal.getState().clear()
  commitItemRotation(node.id, node.rotation)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  useScene.setState({ readOnly: true })
  commitItemRotation(node.id, [0, 0, 0])
  expect((useScene.getState().nodes[node.id] as ItemNode).rotation).toEqual(node.rotation)
})
