import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Ray, Vector3 } from 'three'
import { querySceneSurface } from '../../packages/editor/src/lib/scene-surface-query'
import { stringLightDefinition } from '../../../string-lights-plugin/src/definition'
import { commitLight, updateLight } from '../../../string-lights-plugin/src/commands'
import { LIGHT_KIND, type StringLightNode } from '../../../string-lights-plugin/src/schema'
import {
  moveLightSupport,
  resolveLightPoints,
} from '../../../string-lights-plugin/src/surface-anchors'
import { pointAffordance } from '../../../string-lights-plugin/src/floorplan'
import { lightSurfaceScope } from '../../../string-lights-plugin/src/surface-scope'
import { prepareSupportBatch } from '../../../string-lights-plugin/src/support-edit'
import { removeSupport } from '../../../string-lights-plugin/src/support-operations'
import { planLightContext } from '../../../string-lights-plugin/src/plan-light'
import { resolveLightNode } from '../../../string-lights-plugin/src/resolved-light'

const saved = useScene.getState(),
  registered = new Map(sceneRegistry.nodes)
const level = LevelNode.parse({ level: 0 })
const host = ItemNode.parse({
  parentId: level.id,
  asset: {
    id: 'test',
    name: 'Test column',
    category: 'furniture',
    thumbnail: '',
    src: '/test.glb',
  },
})
let restore: () => void, light: StringLightNode, mesh: Mesh, object: Group
let raf: typeof requestAnimationFrame, cancelRaf: typeof cancelAnimationFrame
const lookup = (id: string) => sceneRegistry.nodes.get(id)
beforeEach(() => {
  raf = globalThis.requestAnimationFrame
  cancelRaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  restore = nodeRegistry._snapshot()
  if (!nodeRegistry.has(LIGHT_KIND)) registerNode(stringLightDefinition as never)
  sceneRegistry.nodes.clear()
  useScene.setState({
    nodes: { [level.id]: level, [host.id]: host },
    rootNodeIds: [level.id],
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial())
  object = new Group()
  sceneRegistry.nodes.set(host.id, mesh)
  light = commitLight(
    {
      points: [
        [1, 0, 0],
        [4, 0, 0],
      ],
      surfaceTargets: [host.id],
    },
    level.id,
  )
  sceneRegistry.nodes.set(light.id, object)
  const patch = moveLightSupport(light, object, 0, new Vector3(1, 0, 0), lookup, host.id)
  light = updateLight(light.id, patch)
  useScene.temporal.getState().clear()
})
afterEach(() => {
  useLiveNodeOverrides.getState().clear(light.id)
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  useScene.setState(saved)
  sceneRegistry.nodes.clear()
  registered.forEach((o, id) => sceneRegistry.nodes.set(id, o))
  restore()
  globalThis.requestAnimationFrame = raf
  globalThis.cancelAnimationFrame = cancelRaf
})

test('surface drag previews without history, commits one transaction and retains binding after reload/undo/redo', () => {
  const hit = querySceneSurface(
    new Ray(new Vector3(10, 0.3, 0.2), new Vector3(-1, 0, 0)),
    lightSurfaceScope(light, level.id),
  )!
  expect(hit.targetId).toBe(host.id)
  const patch = moveLightSupport(light, object, 0, new Vector3(...hit.point), lookup, hit.targetId)
  useLiveNodeOverrides.getState().set(light.id, patch)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  expect(useScene.getState().nodes[light.id]).toEqual(light as never)
  const next = updateLight(light.id, patch)
  useLiveNodeOverrides.getState().clear(light.id)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[light.id]).toEqual(light as never)
  useScene.temporal.getState().redo()
  const loaded = JSON.parse(JSON.stringify(useScene.getState().nodes[light.id])) as StringLightNode
  expect(loaded).toEqual(next)
  mesh.position.x = 2
  expect(resolveLightPoints(loaded, object, lookup)[0]).toEqual([3, 0.3, 0.2])
})

test('2D retains the original surface nearby, previews the moved host position and detaches on Alt', () => {
  mesh.position.x = 2
  const drag = pointAffordance.start({
    node: light,
    payload: { index: 0 },
    initialPlanPoint: [3, 0],
    gridSnapStep: 0,
  } as Parameters<typeof pointAffordance.start>[0])
  drag.apply({ planPoint: [3, 0.2], modifiers: { altKey: false } } as Parameters<
    typeof drag.apply
  >[0])
  expect(useLiveNodeOverrides.getState().get(light.id)).toMatchObject({
    points: [
      [3, 0, 0.2],
      [4, 0, 0],
    ],
    anchors: [{ nodeId: host.id }],
  })
  drag.commit()
  const next = useScene.getState().nodes[light.id] as unknown as StringLightNode
  expect(resolveLightPoints(next, object, lookup)[0]).toEqual([3, 0, 0.2])
  const free = pointAffordance.start({
    node: next,
    payload: { index: 0 },
    initialPlanPoint: [3, 0.2],
    gridSnapStep: 0,
  } as Parameters<typeof pointAffordance.start>[0])
  free.apply({ planPoint: [3, 0.3], modifiers: { altKey: true } } as Parameters<
    typeof free.apply
  >[0])
  free.commit()
  expect(useScene.getState().nodes[light.id]).toMatchObject({ anchors: [] })
})

test('floorplan renderer follows committed host poses and undo without a mounted 3D scene', () => {
  sceneRegistry.nodes.clear()
  light = updateLight(light.id, { curve: 'straight' })
  const draw = () =>
    stringLightDefinition.floorplan!(light, {
      resolve: (id) => useScene.getState().nodes[id] as never,
      parent: level,
      children: [],
      siblings: [],
    })
  const points = () => {
    const geometry = draw()
    if (geometry?.kind !== 'group') throw new Error('Expected floorplan group')
    const cable = geometry.children.find((child) => child.kind === 'polyline')
    if (cable?.kind !== 'polyline') throw new Error('Expected cable polyline')
    return cable.points
  }
  const original = points()
  useScene.temporal.getState().clear()
  useScene.getState().updateNode(host.id, { position: [2, 0, 0], rotation: [0, Math.PI / 2, 0] })
  const saved = useScene.getState().nodes
  const moved = points()
  expect(moved[0]?.[0]).toBeCloseTo(2, 8)
  expect(moved[0]?.[1]).toBeCloseTo(-1, 8)
  expect(moved.at(-1)).toEqual(original.at(-1))
  expect(stringLightDefinition.floorplanDependencies!(light, saved)).toContain(host.id)
  expect(useScene.getState().nodes).toBe(saved)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(points()).toEqual(original)
})

test('lamp groups cannot become each other’s surface targets', () => {
  const second = commitLight({}, level.id)
  sceneRegistry.nodes.set(second.id, new Mesh(new BoxGeometry(10, 10, 10), new MeshBasicMaterial()))
  const hit = querySceneSurface(
    new Ray(new Vector3(10, 0, 0), new Vector3(-1, 0, 0)),
    lightSurfaceScope({ surfaceTargets: [] }, level.id),
  )!
  expect(hit.targetId).toBe(host.id)
})

test('2D-only support editing rebases untouched anchors and commits one undo step after host movement', () => {
  sceneRegistry.nodes.clear()
  useScene.getState().updateNode(host.id, { position: [2, 0, 0], rotation: [0, Math.PI / 2, 0] })
  useScene.temporal.getState().clear()
  const drag = pointAffordance.start({
    node: light,
    payload: { index: 1 },
    initialPlanPoint: [4, 0],
    gridSnapStep: 0,
  } as Parameters<typeof pointAffordance.start>[0])
  drag.apply({ planPoint: [4, 0.5], modifiers: { altKey: true } } as Parameters<
    typeof drag.apply
  >[0])
  const preview = useLiveNodeOverrides.getState().get(light.id) as Partial<StringLightNode>
  expect(preview.points![0]![0]).toBeCloseTo(2)
  expect(preview.points![0]![2]).toBeCloseTo(-1)
  expect(preview.points![1]).toEqual([4, 0, 0.5])
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  drag.commit()
  const next = useScene.getState().nodes[light.id] as unknown as StringLightNode
  const draw = (n: StringLightNode) =>
    resolveLightNode(
      n,
      planLightContext(n, (id) => useScene.getState().nodes[id as never]),
    ).node
  expect(draw(next).points).toEqual(next.points)
  expect(next.anchors).toHaveLength(1)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[light.id]).toEqual(light as never)
  useScene.temporal.getState().redo()
  useScene.getState().updateNode(host.id, { position: [3, 0, 0] })
  expect(draw(next).points[0]![0]).toBeCloseTo(3)
  expect(draw(next).points[1]).toEqual([4, 0, 0.5])
})

test('2D-only batch insertion uses the visible path and preserves bindings through JSON reload', () => {
  sceneRegistry.nodes.clear()
  useScene.getState().updateNode(host.id, { position: [2, 2, 0] })
  useScene.temporal.getState().clear()
  const result = prepareSupportBatch(light, { mode: 'count', count: 1 })
  expect(result.patch.points).toEqual([
    [3, 2, 0],
    [3.5, 1, 0],
    [4, 0, 0],
  ])
  const next = updateLight(light.id, result.patch)
  const loaded = JSON.parse(JSON.stringify(next)) as StringLightNode
  const points = resolveLightNode(
    loaded,
    planLightContext(loaded, (id) => useScene.getState().nodes[id as never]),
  ).node.points
  expect(points).toEqual(next.points)
  expect([next.bulbSize, next.spacing, next.colors]).toEqual([
    light.bulbSize,
    light.spacing,
    light.colors,
  ])
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[light.id]).toEqual(light as never)
})

test('batch supports snapshot moved hosts, preview without history and preserve product settings through undo/reload', () => {
  mesh.position.y = 2
  const result = prepareSupportBatch(light, { mode: 'count', count: 3 })
  expect(result.patch.points[0]).toEqual([1, 2, 0])
  expect(result.patch.points[2]).toEqual([2.5, 1, 0])
  useLiveNodeOverrides.getState().set(light.id, result.patch)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  useLiveNodeOverrides.getState().clear(light.id)
  expect(useScene.getState().nodes[light.id]).toEqual(light as never)
  const next = updateLight(light.id, result.patch)
  expect(next.points).toHaveLength(5)
  expect([next.spacing, next.bulbSize, next.colors]).toEqual([
    light.spacing,
    light.bulbSize,
    light.colors,
  ])
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  const loaded = JSON.parse(JSON.stringify(next)) as StringLightNode
  expect(resolveLightPoints(loaded, object, lookup)).toEqual(next.points)
  mesh.position.y += 1
  expect(resolveLightPoints(loaded, object, lookup)[0]).toEqual([1, 3, 0])
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[light.id]).toEqual(light as never)
  useScene.temporal.getState().redo()
  expect(useScene.getState().nodes[light.id]).toEqual(next as never)
})

test('new supports bind only to the chosen surface within range and survive neighbouring removal', () => {
  light = updateLight(light.id, {
    points: [
      [1, -0.8, 0],
      [1, 0.8, 0],
    ],
    anchors: [],
  })
  const result = prepareSupportBatch(light, { mode: 'count', count: 3 }, 0.15)
  expect(result.attached).toBe(3)
  const next = updateLight(light.id, result.patch)
  expect(next.anchors.map((a) => a.index)).toEqual([1, 2, 3])
  const removed = updateLight(next.id, removeSupport(next, 1))
  expect(removed.anchors.map((a) => a.index)).toEqual([1, 2])
  mesh.position.x += 2
  expect(resolveLightPoints(removed, object, lookup)[1]).toEqual([3, 0, 0])
  const distant = prepareSupportBatch(
    {
      ...light,
      points: [
        [4, 0, 0],
        [5, 0, 0],
      ],
    },
    { mode: 'count', count: 3 },
    0.1,
  )
  expect(distant.attached).toBe(0)
  expect(() =>
    prepareSupportBatch({ ...light, surfaceTargets: [] }, { mode: 'count', count: 1 }, 0.1),
  ).toThrow()
})
