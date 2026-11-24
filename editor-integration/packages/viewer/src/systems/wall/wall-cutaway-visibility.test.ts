import { afterEach, beforeEach, expect, test } from 'bun:test'
import { DoorNode, emitter, sceneRegistry, useScene, WallNode, WindowNode } from '@pascal-app/core'
import { BoxGeometry, Group, Mesh, PerspectiveCamera, Vector3 } from 'three'
import { useNodeEvents } from '../../hooks/use-node-events'
import useViewer from '../../store/use-viewer'
import {
  isNodeHiddenByWallCutaway,
  isObjectHiddenByWallCutaway,
  subscribeWallCutawayChanges,
} from './wall-cutaway-visibility'
import { WallCutoutCache } from './wall-cutout-cache'

const sceneBefore = useScene.getState()
const viewerBefore = useViewer.getState()
let cache: WallCutoutCache
let camera: PerspectiveCamera

beforeEach(() => {
  sceneRegistry.clear()
  useScene.setState({ nodes: {}, materials: {} })
  useViewer.setState({ wallMode: 'cutaway', hoveredId: null, hoverHighlightMode: 'default' })
  cache = new WallCutoutCache()
  camera = new PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.set(2, 1.4, 10)
})

afterEach(() => {
  cache.dispose()
  sceneRegistry.clear()
  useScene.setState(sceneBefore)
  useViewer.setState(viewerBefore)
})

function fixture() {
  const wall = WallNode.parse({
    start: [0, 0],
    end: [4, 0],
    frontSide: 'exterior',
    backSide: 'interior',
  })
  const door = DoorNode.parse({ parentId: wall.id })
  const window = WindowNode.parse({ parentId: wall.id })
  wall.children = [door.id, window.id]
  const root = new Mesh(new BoxGeometry(4, 2.8, 0.2).translate(2, 1.4, 0))
  const content = new Group()
  content.userData.wallCutawayContent = true
  const doorRoot = new Mesh()
  const windowRoot = new Mesh()
  const trim = new Mesh()
  const hiddenVariant = new Mesh()
  hiddenVariant.visible = false
  doorRoot.add(hiddenVariant)
  content.add(doorRoot, windowRoot, trim)
  const collision = new Mesh()
  collision.visible = false
  root.add(collision, content)
  sceneRegistry.nodes.set(wall.id, root)
  sceneRegistry.byType.wall.add(wall.id)
  sceneRegistry.nodes.set(door.id, doorRoot)
  sceneRegistry.nodes.set(window.id, windowRoot)
  const nodes = { [wall.id]: wall, [door.id]: door, [window.id]: window }
  for (const [start, end] of [
    [
      [4, 0],
      [4, -4],
    ],
    [
      [4, -4],
      [0, -4],
    ],
    [
      [0, -4],
      [0, 0],
    ],
  ] as [number[], number[]][]) {
    const node = WallNode.parse({ start, end })
    const mesh = new Mesh(new BoxGeometry(4, 2.8, 0.2).translate(2, 1.4, 0))
    mesh.position.set(start[0]!, 0, start[1]!)
    mesh.rotation.y = -Math.atan2(end[1]! - start[1]!, end[0]! - start[0]!)
    sceneRegistry.nodes.set(node.id, mesh)
    sceneRegistry.byType.wall.add(node.id)
    nodes[node.id] = node
  }
  useScene.setState({ nodes })
  return { wall, door, window, root, content, doorRoot, windowRoot, trim, hiddenVariant, collision }
}

test('camera-facing cutaway hides the entire hosted group and restores original child visibility', () => {
  const f = fixture()
  const nodes = useScene.getState().nodes
  cache.update(camera, 1)
  expect(f.root.userData.wallHidden).toBe(true)
  expect(f.content.visible).toBe(false)
  for (const object of [f.doorRoot, f.windowRoot, f.trim, f.hiddenVariant])
    expect(isObjectHiddenByWallCutaway(object)).toBe(true)
  expect(isNodeHiddenByWallCutaway(f.door.id)).toBe(true)
  expect(isNodeHiddenByWallCutaway(f.window.id)).toBe(true)
  expect(isNodeHiddenByWallCutaway(f.wall.id)).toBe(false)
  expect(isObjectHiddenByWallCutaway(f.collision)).toBe(false)
  expect(isObjectHiddenByWallCutaway(new Mesh())).toBe(false)

  const rebuiltFrame = new Mesh()
  f.doorRoot.add(rebuiltFrame)
  expect(isObjectHiddenByWallCutaway(rebuiltFrame)).toBe(true)
  camera.rotation.y = Math.PI
  cache.update(camera, 2)
  expect(f.content.visible).toBe(true)
  expect(isNodeHiddenByWallCutaway(f.door.id)).toBe(false)
  expect(f.hiddenVariant.visible).toBe(false)
  expect(f.collision.visible).toBe(false)
  expect(useScene.getState().nodes).toBe(nodes)
})

test('mode changes restore hosted content while keeping down and translucent behavior', () => {
  const f = fixture()
  for (const mode of ['cutaway', 'up', 'cutaway', 'down', 'cutaway', 'translucent'] as const) {
    useViewer.setState({ wallMode: mode })
    cache.update(camera, 1)
    expect(f.content.visible).toBe(mode !== 'cutaway')
    expect(f.root.userData.wallCutawayHidden).toBe(mode === 'cutaway')
    expect(f.root.userData.wallHidden).toBe(mode === 'cutaway' || mode === 'down')
  }
})

test('replacing or disposing a wall releases the old presentation without changing scene data', () => {
  const f = fixture()
  cache.update(camera, 1)
  const replacement = new Mesh(f.root.geometry)
  replacement.rotation.y = Math.PI
  sceneRegistry.nodes.set(f.wall.id, replacement)
  cache.update(camera, 1.01)
  expect(f.content.visible).toBe(true)
  expect(f.root.userData.wallCutawayHidden).toBe(false)
  replacement.rotation.y = 0
  cache.rebuilt.add(f.wall.id)
  cache.update(camera, 2)
  expect(replacement.userData.wallCutawayHidden).toBe(true)
  cache.dispose()
  expect(replacement.userData.wallCutawayHidden).toBe(false)
  cache.update(camera, 2.01)
  expect(replacement.userData.wallCutawayHidden).toBe(true)
})

test('hidden door events cannot select or hover, but leave still clears previous hover', () => {
  const f = fixture()
  const events = useNodeEvents(f.door, 'door')
  const e = { button: 0, object: f.doorRoot, point: new Vector3(), stopPropagation() {} } as never
  const observed: string[] = []
  const click = () => observed.push('click')
  const enter = () => observed.push('enter')
  const leave = () => observed.push('leave')
  emitter.on('door:click', click)
  emitter.on('door:enter', enter)
  emitter.on('door:leave', leave)
  try {
    cache.update(camera, 1)
    events.onPointerUp(e)
    events.onPointerEnter(e)
    events.onPointerLeave(e)
    expect(observed).toEqual(['leave'])
    useViewer.setState({ wallMode: 'up' })
    cache.update(camera, 2)
    events.onPointerUp(e)
    events.onPointerEnter(e)
    expect(observed).toEqual(['leave', 'click', 'enter'])
  } finally {
    emitter.off('door:click', click)
    emitter.off('door:enter', enter)
    emitter.off('door:leave', leave)
  }
})

test('batch notifications fire on facing transitions before rendering, without geometry dirtiness', () => {
  const f = fixture()
  const observed: string[] = []
  const unsubscribe = subscribeWallCutawayChanges((id) => observed.push(id))
  const dirty = new Set(useScene.getState().dirtyNodes)
  try {
    cache.update(camera, 1)
    cache.update(camera, 2)
    camera.rotation.y = Math.PI
    cache.update(camera, 3)
    expect(observed).toEqual([f.wall.id, f.wall.id])
    expect(useScene.getState().dirtyNodes).toEqual(dirty)
  } finally {
    unsubscribe()
  }
})
