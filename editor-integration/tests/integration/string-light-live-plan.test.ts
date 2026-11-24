import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  ItemNode,
  BuildingNode,
  LevelNode,
  RoofNode,
  nodeRegistry,
  registerNode,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
  type FloorplanGeometry,
} from '@pascal-app/core'
import { roofDefinition } from '../../packages/nodes/src/roof/definition'
import { itemDefinition } from '../../packages/nodes/src/item/definition'
import { act, create } from '@react-three/test-renderer'
import { createElement } from 'react'
import {
  buildFloorplanEntryGeometry,
  useFloorplanDependencyLiveInputs,
} from '../../packages/editor/src/components/editor-2d/renderers/floorplan-registry-layer'
import { stringLightDefinition } from '../../../string-lights-plugin/src/definition'
import { StringLightNode, LIGHT_KIND } from '../../../string-lights-plugin/src/schema'

const level = LevelNode.parse({ level: 0 })
const host = ItemNode.parse({
  parentId: level.id,
  asset: {
    id: 'live-plan-host',
    name: 'Column',
    category: 'furniture',
    thumbnail: '',
    src: '/column.glb',
  },
})
const light = StringLightNode.parse({
  parentId: level.id,
  curve: 'straight',
  points: [
    [1, 0, 0],
    [4, 0, 0],
  ],
  anchors: [{ index: 0, nodeId: host.id, localPosition: [1, 0, 0], referencePosition: [1, 0, 0] }],
})
const nodes = { [level.id]: level, [host.id]: host, [light.id]: light as never }
let restore: () => void
const transforms = useLiveTransforms.getState().transforms
const overrides = useLiveNodeOverrides.getState().overrides
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  if (!nodeRegistry.has('item')) registerNode(itemDefinition)
  if (!nodeRegistry.has(LIGHT_KIND)) registerNode(stringLightDefinition as never)
  useLiveTransforms.getState().clearAll()
  useLiveNodeOverrides.setState({ overrides: new Map() })
})
afterEach(() => {
  restore()
  useLiveTransforms.setState({ transforms })
  useLiveNodeOverrides.setState({ overrides })
})
function fixture() {
  const args: Parameters<typeof buildFloorplanEntryGeometry>[0] = {
    automaticDimensions: false,
    ctxOverrides: undefined,
    geometryCache: new Map(),
    highlighted: false,
    hovered: false,
    interactiveElevators: undefined,
    levelDataCache: new Map(),
    levelNodeIdsByType: new Map(),
    live: undefined,
    liveOverride: undefined,
    liveOverrides: new Map(),
    moving: false,
    node: light as never,
    nodeId: light.id as never,
    nodes,
    palette: undefined,
    selected: false,
    siblingEpoch: 0,
    unit: 'metric',
    metricNotation: 'meters',
    wallDimensionReference: 'finished-faces',
    visibilityRootId: level.id,
  }
  const draw = () =>
    buildFloorplanEntryGeometry({
      ...args,
      liveOverrides: useLiveNodeOverrides.getState().overrides,
    })!
  return { args, draw }
}
function cable(g: FloorplanGeometry | null): number[][] {
  if (g?.kind === 'polyline') return g.points.map((p) => [...p])
  if (g?.kind === 'group') {
    for (const child of g.children) {
      const found = cable(child)
      if (found.length) return found
    }
  }
  return []
}
test('cached 2D string follows every live host translation/rotation and cancels without a scene/history write', () => {
  const { draw } = fixture()
  const scene = useScene.getState().nodes
  const history = useScene.temporal.getState().pastStates
  const initial = draw()
  expect(cable(initial.base)[0]).toEqual([1, 0])
  expect(draw()).toBe(initial)
  useLiveTransforms.getState().set(host.id, { position: [2, 0, 0], rotation: Math.PI / 2 })
  const moved = draw()
  expect(moved).not.toBe(initial)
  expect(cable(moved.base)[0]![0]).toBeCloseTo(2)
  expect(cable(moved.base)[0]![1]).toBeCloseTo(-1)
  expect(cable(moved.base).at(-1)).toEqual([4, 0])
  expect(draw()).toBe(moved)
  useLiveTransforms.getState().set('unrelated', { position: [8, 0, 0], rotation: 0 })
  expect(draw()).toBe(moved)
  useLiveTransforms.getState().set(host.id, { position: [3, 0, 2], rotation: 0 })
  expect(cable(draw().base)[0]).toEqual([4, 2])
  useLiveTransforms.getState().clear(host.id)
  expect(cable(draw().base)).toEqual(cable(initial.base))
  expect(useScene.getState().nodes).toBe(scene)
  expect(useScene.temporal.getState().pastStates).toBe(history)
})
test('cached 2D string also follows rotation/position overrides and their cancellation', () => {
  const { draw } = fixture()
  const original = cable(draw().base)
  useLiveNodeOverrides.getState().set(host.id, { position: [2, 0, 0], rotation: [0, Math.PI, 0] })
  expect(cable(draw().base)[0]![0]).toBeCloseTo(1)
  expect(cable(draw().base)[0]![1]).toBeCloseTo(0)
  useLiveNodeOverrides.getState().set(host.id, { position: [4, 0, 2] })
  expect(cable(draw().base)[0]![0]).toBeCloseTo(3)
  expect(cable(draw().base)[0]![1]).toBeCloseTo(2)
  useLiveNodeOverrides.getState().clear(host.id)
  expect(cable(draw().base)).toEqual(original)
})

test('mounted floorplan dependency subscription redraws on live changes, skips unrelated models and freezes while hidden', async () => {
  const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true
  const { args } = fixture()
  let points: number[][] = [],
    renders = 0
  function Probe({ visible }: { visible: boolean }) {
    const dependencyLiveInputs = useFloorplanDependencyLiveInputs(args.node, args.nodes, visible)
    const entry = buildFloorplanEntryGeometry({
      ...args,
      dependencyLiveInputs,
      liveOverrides: useLiveNodeOverrides.getState().overrides,
    })!
    points = cable(entry.base)
    renders++
    return null
  }
  const renderer = await create(createElement(Probe, { visible: true }))
  try {
    expect(points[0]).toEqual([1, 0])
    await act(async () => {
      useLiveTransforms.getState().set(host.id, { position: [2, 0, 3], rotation: 0 })
    })
    expect(points[0]).toEqual([3, 3])
    const afterHost = renders
    await act(async () => {
      useLiveTransforms.getState().set('unrelated', { position: [8, 0, 0], rotation: 0 })
      useLiveNodeOverrides.getState().set('unrelated', { position: [8, 0, 0] })
    })
    expect(renders).toBe(afterHost)
    await act(async () => {
      useLiveTransforms.getState().clear(host.id)
    })
    expect(points[0]).toEqual([1, 0])
    await act(async () => {
      useLiveNodeOverrides.getState().set(host.id, { position: [5, 0, 1] })
    })
    expect(points[0]).toEqual([6, 1])
    await act(async () => {
      useLiveNodeOverrides.getState().clear(host.id)
    })
    expect(points[0]).toEqual([1, 0])
    await renderer.update(createElement(Probe, { visible: false }))
    const beforeHiddenMove = renders
    await act(async () => {
      useLiveTransforms.getState().set(host.id, { position: [4, 0, 2], rotation: 0 })
    })
    expect(renders).toBe(beforeHiddenMove)
    await renderer.update(createElement(Probe, { visible: true }))
    expect(points[0]).toEqual([5, 2])
  } finally {
    await renderer.unmount()
    actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct
  }
})

test('live parent movement carries a bound nested host exactly once', () => {
  const parent = ItemNode.parse({ ...host, id: undefined, position: [2, 0, 0] })
  const { args, draw } = fixture()
  args.node = {
    ...light,
    points: [
      [1, 0, 0],
      [9, 0, 0],
    ],
  } as never
  args.nodes = {
    ...nodes,
    [parent.id]: parent,
    [host.id]: { ...host, parentId: parent.id, position: [1, 0, 0] },
  }
  expect(cable(draw().base)[0]).toEqual([4, 0])
  useLiveTransforms.getState().set(parent.id, { position: [5, 0, 0], rotation: 0 })
  expect(cable(draw().base)[0]).toEqual([7, 0])
  useLiveTransforms.getState().clear(parent.id)
  expect(cable(draw().base)[0]).toEqual([4, 0])
})

test('generic positioned roof hosts also resolve live poses without a floor-placement capability', () => {
  if (!nodeRegistry.has('roof')) registerNode(roofDefinition)
  const roof = RoofNode.parse({ parentId: level.id, position: [0, 2, 0] })
  const { args, draw } = fixture()
  args.node = { ...light, anchors: [{ ...light.anchors[0]!, nodeId: roof.id }] } as never
  args.nodes = { ...nodes, [roof.id]: roof }
  const original = cable(draw().base)
  useLiveTransforms.getState().set(roof.id, { position: [2, 2, 0], rotation: Math.PI / 2 })
  expect(cable(draw().base)[0]![0]).toBeCloseTo(2)
  expect(cable(draw().base)[0]![1]).toBeCloseTo(-1)
  useLiveTransforms.getState().clear(roof.id)
  expect(cable(draw().base)).toEqual(original)
})

test('floorplan live poses remain level-local in an elevated rotated building', () => {
  const building = BuildingNode.parse({
    position: [8, 1, -4],
    rotation: [0.15, 0.6, -0.1],
    children: [level.id],
  })
  const { args, draw } = fixture()
  args.nodes = {
    ...nodes,
    [building.id]: building,
    [level.id]: { ...level, parentId: building.id, baseElevation: 3 },
  }
  const original = cable(draw().base)
  useLiveTransforms.getState().set(host.id, { position: [2, 0, 3], rotation: 0 })
  expect(cable(draw().base)[0]![0]).toBeCloseTo(3)
  expect(cable(draw().base)[0]![1]).toBeCloseTo(3)
  useLiveTransforms.getState().clear(host.id)
  expect(cable(draw().base)).toEqual(original)
})
