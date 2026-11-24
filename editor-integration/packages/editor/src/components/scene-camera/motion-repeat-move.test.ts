import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import {
  ColumnNode,
  SceneCameraNode,
  SiteNode,
  sampleScenePlayback,
  sceneRegistry,
  useLiveTransforms,
  usePlaybackTransforms,
  useScene,
} from '@pascal-app/core'
import { bindPlaybackTransforms } from '@pascal-app/viewer'
import { Object3D } from 'three'
import useEditor from '../../store/use-editor'
import useInteractionScope, { getMovingNode } from '../../store/use-interaction-scope'
import { bindObjectMotionSampler, selectMotionObject } from './motion-objects'
import { bindMotionDrafts } from './motion-properties'
import { endSceneAnimation, openMotion } from './motion-state'

let cleanup = () => {}
const originalRaf = globalThis.requestAnimationFrame
const originalCancel = globalThis.cancelAnimationFrame
beforeAll(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
})
afterAll(() => {
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancel
})
afterEach(() => {
  useInteractionScope.getState().end()
  useLiveTransforms.getState().clearAll()
  endSceneAnimation(true)
  cleanup()
  sceneRegistry.nodes.clear()
})

test('successive native moves start at the visible timeline draft and cancel back to it', () => {
  const camera = SceneCameraNode.parse({})
  const item = ColumnNode.parse({ position: [1, 0, 0] })
  const site = SiteNode.parse({ children: [camera.id, item.id] })
  useScene.setState({
    nodes: { [site.id]: site, [camera.id]: camera, [item.id]: item },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  const mesh = new Object3D()
  mesh.position.fromArray(item.position)
  sceneRegistry.nodes.set(item.id, mesh)
  const binding = bindPlaybackTransforms()
  const sampler = bindObjectMotionSampler()
  const drafts = bindMotionDrafts()
  cleanup = () => {
    drafts()
    sampler()
    binding.dispose()
  }
  openMotion(camera)
  selectMotionObject(item.id)
  useEditor.getState().setMovingNode(item)
  useScene.getState().updateNode(item.id, { position: [4, 0, 2] })
  useEditor.getState().setMovingNode(null)
  expect(mesh.position.toArray()).toEqual([4, 0, 2])
  expect(useScene.getState().nodes[item.id]).toEqual(item)

  useEditor.getState().setMovingNode(item)
  const second = getMovingNode()! as typeof item
  expect(second.position).toEqual([4, 0, 2])
  useLiveTransforms.getState().set(item.id, { position: [7, 0, 3], rotation: 0 })
  mesh.position.set(7, 0, 3)
  binding.sync()
  expect(mesh.position.toArray()).toEqual([7, 0, 3])
  useScene.getState().updateNode(item.id, { position: [7, 0, 3] })
  useLiveTransforms.getState().clear(item.id)
  useEditor.getState().setMovingNode(null)
  binding.sync()
  expect(mesh.position.toArray()).toEqual([7, 0, 3])

  useEditor.getState().setMovingNode(item)
  const third = getMovingNode()! as typeof item
  expect(third.position).toEqual([7, 0, 3])
  useScene.getState().updateNode(item.id, { position: third.position })
  useEditor.getState().setMovingNode(null)
  sampleScenePlayback(0)
  expect(mesh.position.toArray()).toEqual([7, 0, 3])
})

test('a sampled animation pose seeds a move without converting scalar rotation to an array', () => {
  const item = ColumnNode.parse({ position: [1, 0, 0], rotation: 0 })
  useScene.setState({ nodes: { [item.id]: item } })
  usePlaybackTransforms.setState({
    poses: new Map([[item.id, { position: [5, 0, 2], rotation: [0, 0.7, 0] }]]),
  })
  useEditor.getState().setMovingNode(item)
  const moving = getMovingNode()! as typeof item
  expect(moving.position).toEqual([5, 0, 2])
  expect(moving.rotation).toBe(0.7)
  expect(item.position).toEqual([1, 0, 0])
})

test('both viewport move scopes refresh stale node references after an ordinary commit', () => {
  const item = ColumnNode.parse({ position: [1, 0, 0] })
  usePlaybackTransforms.setState({ poses: new Map() })
  useScene.setState({ nodes: { [item.id]: item }, readOnly: false })
  for (const view of ['2d', '3d'] as const) {
    const latest = { ...item, position: [8, 0, 5] as [number, number, number] }
    useScene.setState({ nodes: { [item.id]: latest } })
    useInteractionScope
      .getState()
      .begin({ kind: 'moving', node: item, nodeId: item.id, nodeType: item.type, view })
    expect((getMovingNode() as typeof item).position).toEqual([8, 0, 5])
    useScene.setState({ nodes: { [item.id]: { ...latest, position: [9, 0, 6] } } })
    expect((getMovingNode() as typeof item).position).toEqual([8, 0, 5])
    useInteractionScope.getState().end()
  }
})
