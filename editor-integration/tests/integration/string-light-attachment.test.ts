import { wallDefinition } from '../../packages/nodes/src/wall/definition'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  capturePointAttachment,
  resolvePointAttachment,
  ItemNode,
  RoofNode,
  RoofSegmentNode,
  FenceNode,
  WallNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  useScene,
  useLiveNodeOverrides,
  sceneRegistry,
} from '@pascal-app/core'
import { Group, Vector3 } from 'three'
import { roofSegmentDefinition } from '../../packages/nodes/src/roof-segment/definition'
import { fenceDefinition } from '../../packages/nodes/src/fence/definition'
import { getRoofTopSurfaceY } from '../../packages/nodes/src/shared/roof-surface'
import { stringLightDefinition } from '../../../string-lights-plugin/src/definition'
import { commitLight } from '../../../string-lights-plugin/src/commands'
import {
  resolveLightPoints,
  snapshotLightSupports,
} from '../../../string-lights-plugin/src/surface-anchors'
import {
  planLightContext,
  lightPlanDependencies,
} from '../../../string-lights-plugin/src/plan-light'
import { StringLightNode } from '../../../string-lights-plugin/src/schema'
const saved = useScene.getState(),
  objects = new Map(sceneRegistry.nodes)
let restore: () => void
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  for (const def of [roofSegmentDefinition, fenceDefinition, wallDefinition, stringLightDefinition])
    if (!nodeRegistry.has(def.kind)) registerNode(def as never)
  useScene.setState({ nodes: {}, rootNodeIds: [], readOnly: false })
  sceneRegistry.nodes.clear()
})
afterEach(() => {
  useLiveNodeOverrides.getState().clearAll()
  useScene.setState(saved)
  sceneRegistry.nodes.clear()
  objects.forEach((v, k) => sceneRegistry.nodes.set(k, v))
  restore()
})
const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6))
test('roof attachment follows pitch, width, depth, eave and thickness using existing roof surfaces', () => {
  for (const roofType of ['gable', 'hip', 'shed', 'gambrel', 'mansard', 'dutch'] as const) {
    const segment = RoofSegmentNode.parse({ roofType, width: 6, depth: 4, pitch: 30 })
    const p: [number, number, number] = [1, getRoofTopSurfaceY(1, 1, segment) + 0.05, 1]
    const binding = capturePointAttachment(segment, p, { [segment.id]: segment })!
    near(resolvePointAttachment(binding, { [segment.id]: segment })!, p)
    const next = { ...segment, pitch: 55, width: 8, depth: 5, overhang: 0.5, deckThickness: 0.2 }
    const moved = resolvePointAttachment(JSON.parse(JSON.stringify(binding)), {
      [segment.id]: next,
    })!
    expect(moved[0]).toBeGreaterThan(p[0])
    expect(moved[2]).toBeGreaterThan(p[2])
    expect(moved[1] - getRoofTopSurfaceY(moved[0], moved[2], next)).toBeCloseTo(0.05, 6)
    near(resolvePointAttachment(binding, { [segment.id]: segment })!, p)
    expect(resolvePointAttachment(binding, {})).toBeNull()
  }
})
test('fence points follow moved endpoints, height, thickness, arc and spline with no root transform', () => {
  const fence = FenceNode.parse({ start: [0, 0], end: [4, 0], height: 2, thickness: 0.1 })
  const p: [number, number, number] = [2, 1.5, 0.1]
  const binding = capturePointAttachment(fence, p, { [fence.id]: fence })!
  near(resolvePointAttachment(binding, { [fence.id]: fence })!, p)
  const moved = {
    ...fence,
    start: [2, 1] as [number, number],
    end: [8, 1] as [number, number],
    height: 3,
    thickness: 0.2,
    supportOffset: 0.4,
  }
  near(resolvePointAttachment(binding, { [fence.id]: moved })!, [5, 2.65, 1.15])
  for (const next of [
    { ...moved, curveOffset: 1 },
    {
      ...moved,
      path: [
        [2, 1],
        [4, 3],
        [8, 1],
      ] as [number, number][],
    },
  ]) {
    const actual = resolvePointAttachment(binding, { [fence.id]: next })!
    expect(actual.every(Number.isFinite)).toBe(true)
    expect(Math.abs(actual[2] - 1.15)).toBeGreaterThan(0.1)
  }
})
test('imported item attachments follow anisotropic scale, reject replaced assets, preserve input', () => {
  const item = ItemNode.parse({
    asset: { id: 'test', src: '/tree.glb', name: 'tree', category: 'vegetation', thumbnail: '' },
    scale: [1, 2, 1],
  })
  const p: [number, number, number] = [0.2, 3, 0.4]
  const b = capturePointAttachment(item, p, { [item.id]: item })!
  near(resolvePointAttachment(b, { [item.id]: { ...item, scale: [2, 3, 0.5] } })!, [0.4, 4.5, 0.2])
  expect(
    resolvePointAttachment(b, {
      [item.id]: { ...item, asset: { ...item.asset, src: '/other.glb' } },
    }),
  ).toBeNull()
  expect(p).toEqual([0.2, 3, 0.4])
})
test('compound roof capture persists child identity; 2D and 3D resolve identical geometry, overrides and rebasing', () => {
  const level = LevelNode.parse({ level: 0 }),
    roof = RoofNode.parse({ parentId: level.id, position: [1, 2, 0] })
  const seg = RoofSegmentNode.parse({ parentId: roof.id, width: 6, depth: 4, pitch: 30 })
  roof.children = [seg.id]
  const nodes = { [level.id]: level, [roof.id]: roof, [seg.id]: seg }
  useScene.setState({ nodes, rootNodeIds: [level.id] })
  const parent = new Group(),
    host = new Group(),
    child = new Group(),
    object = new Group()
  host.position.fromArray(roof.position)
  parent.add(host, object)
  host.add(child)
  sceneRegistry.nodes.set(level.id, parent)
  sceneRegistry.nodes.set(roof.id, host)
  sceneRegistry.nodes.set(seg.id, child)
  parent.updateWorldMatrix(true, true)
  const points: [number, number, number][] = [
    [-1, getRoofTopSurfaceY(-1, 1, seg) + 0.05, 1],
    [1, getRoofTopSurfaceY(1, 1, seg) + 0.05, 1],
  ].map((p) => host.localToWorld(new Vector3(...p)).toArray())
  const light = commitLight(
    {
      points,
      curve: 'straight',
      spacing: 0.3,
      bulbSize: 0.05,
      colors: ['#ff0000', '#ffffff'],
      anchors: points.map((p, index) => ({
        index,
        nodeId: roof.id,
        localPosition: host.worldToLocal(new Vector3(...p)).toArray(),
        referencePosition: p,
      })),
    },
    level.id,
  )
  sceneRegistry.nodes.set(light.id, object)
  const stored = StringLightNode.parse(JSON.parse(JSON.stringify(light)))
  expect(stored.anchors.every((a) => a.attachment?.nodeId === seg.id)).toBe(true)
  expect(lightPlanDependencies(stored, useScene.getState().nodes)).toContain(seg.id)
  useLiveNodeOverrides.getState().set(seg.id, { pitch: 55, width: 8 })
  const effective = { ...useScene.getState().nodes, [seg.id]: { ...seg, pitch: 55, width: 8 } }
  const a = resolveLightPoints(stored, object, (id) => sceneRegistry.nodes.get(id))
  const b = planLightContext(stored, (id) => effective[id as keyof typeof effective]).points!(
    stored,
  )
  a.forEach((p, i) => near(p, b[i]!))
  expect(a[0]![1]).toBeGreaterThan(points[0]![1])
  useLiveNodeOverrides.getState().clear(seg.id)
  const original = resolveLightPoints(stored, object, (id) => sceneRegistry.nodes.get(id))
  original.forEach((p, i) => near(p, points[i]!))
  useScene.setState({ nodes: effective })
  const snapshot = snapshotLightSupports(stored, object, (id) => sceneRegistry.nodes.get(id))
  const rebased = { ...stored, ...snapshot }
  resolveLightPoints(rebased, object, (id) => sceneRegistry.nodes.get(id)).forEach((p, i) =>
    near(p, a[i]!),
  )
  expect([rebased.spacing, rebased.bulbSize, rebased.colors]).toEqual([
    0.3,
    0.05,
    ['#ff0000', '#ffffff'],
  ])
})

test('wall attachment follows length, height, thickness and curved surface in wall local frame', () => {
  const level = LevelNode.parse({ level: 0, height: 3 })
  const wall = WallNode.parse({
    parentId: level.id,
    start: [2, 1],
    end: [6, 1],
    height: 3,
    thickness: 0.2,
  })
  const nodes = { [level.id]: level, [wall.id]: wall }
  const binding = capturePointAttachment(wall, [2, 2, 0.15], nodes)!
  near(resolvePointAttachment(binding, nodes)!, [2, 2, 0.15])
  const next = { ...wall, end: [10, 1] as [number, number], height: 4, thickness: 0.4 }
  near(resolvePointAttachment(binding, { ...nodes, [wall.id]: next })!, [4, 8 / 3, 0.25])
  const bent = resolvePointAttachment(binding, {
    ...nodes,
    [wall.id]: { ...next, curveOffset: 1 },
  })!
  expect(Math.abs(bent[2] - 0.25)).toBeGreaterThan(0.5)
})

test('roof fascia preserves edge setback on resizing and rejects topology replacement', () => {
  const roof = RoofSegmentNode.parse({ width: 6, depth: 4, pitch: 30 })
  const p: [number, number, number] = [3.25, getRoofTopSurfaceY(3.25, 1, roof) - 0.2, 1]
  const binding = capturePointAttachment(roof, p, { [roof.id]: roof })!
  near(resolvePointAttachment(binding, { [roof.id]: roof })!, p)
  const moved = resolvePointAttachment(binding, { [roof.id]: { ...roof, width: 8 } })!
  expect(moved[0] - p[0]).toBeCloseTo(1, 6)
  expect(resolvePointAttachment(binding, { [roof.id]: { ...roof, roofType: 'hip' } })).toBeNull()
  expect(
    resolvePointAttachment(binding, { [roof.id]: { ...roof, trim: { ...roof.trim, left: 0.3 } } }),
  ).toBeNull()
})
