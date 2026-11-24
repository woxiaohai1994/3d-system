import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  BuildingNode,
  LevelNode,
  WallNode,
  ItemNode,
  nodeRegistry,
  registerNode,
  useScene,
  sceneRegistry,
  useLiveNodeOverrides,
  movingAlignmentAnchors,
  nodeAlignmentAnchors,
} from '@pascal-app/core'
import {
  useEditor,
  useInteractionScope,
  useAlignmentGuides,
  resolveAlignmentForActiveBuilding,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { stringLightDefinition } from '../../../string-lights-plugin/src/definition'
import {
  snapLightWorldPoint,
  clearLightSnapFeedback,
} from '../../../string-lights-plugin/src/snapping'
import { StringLightNode, LIGHT_KIND } from '../../../string-lights-plugin/src/schema'
import { pointAffordance } from '../../../string-lights-plugin/src/floorplan'
import { querySceneSurface } from '../../packages/editor/src/lib/scene-surface-query'
import { Ray } from 'three'
import { floorplanAffordanceReshapeScope } from '../../packages/editor/src/components/editor-2d/renderers/floorplan-registry-layer'

const savedScene = useScene.getState(),
  savedEditor = useEditor.getState(),
  savedViewer = useViewer.getState()
const savedScope = useInteractionScope.getState().scope
const savedRegistry = new Map(sceneRegistry.nodes)
let restore: () => void
let building: ReturnType<typeof BuildingNode.parse>, level: ReturnType<typeof LevelNode.parse>
let wall: ReturnType<typeof WallNode.parse>
let parent: Group
let oldRaf: typeof requestAnimationFrame, oldCaf: typeof cancelAnimationFrame
function mode(value: 'lines' | 'grid' | 'off') {
  useEditor.setState({ snappingModeByContext: { item: value, polygon: value, wall: value } })
}
beforeEach(() => {
  oldRaf = globalThis.requestAnimationFrame
  oldCaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  restore = nodeRegistry._snapshot()
  if (!nodeRegistry.has(LIGHT_KIND)) registerNode(stringLightDefinition as never)
  building = BuildingNode.parse({ position: [0, 0, 0] })
  level = LevelNode.parse({ level: 0, parentId: building.id })
  wall = WallNode.parse({ parentId: level.id, start: [2, 1], end: [2, 5], thickness: 0.2 })
  useScene.setState({
    nodes: { [building.id]: building, [level.id]: level, [wall.id]: wall },
    readOnly: false,
  })
  useViewer.setState({
    selection: { buildingId: building.id, levelId: level.id, zoneId: null, selectedIds: [] },
  })
  useEditor.setState({ magneticSnap: true, gridSnapStep: 0.5 })
  mode('lines')
  useInteractionScope.getState().begin({ kind: 'drafting', tool: LIGHT_KIND })
  sceneRegistry.nodes.clear()
  parent = new Group()
  sceneRegistry.nodes.set(level.id, parent)
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
})
afterEach(() => {
  clearLightSnapFeedback()
  useLiveNodeOverrides.getState().clearAll()
  useScene.temporal.getState().clear()
  useScene.setState(savedScene)
  useEditor.setState(savedEditor)
  useViewer.setState(savedViewer)
  useInteractionScope.setState({ scope: savedScope })
  sceneRegistry.nodes.clear()
  savedRegistry.forEach((v, k) => sceneRegistry.nodes.set(k, v))
  restore()
  globalThis.requestAnimationFrame = oldRaf
  globalThis.cancelAnimationFrame = oldCaf
})

test('host lines mode pulls onto wall face in 2D and 3D; grid/off keep passive native guides', () => {
  const raw = new Vector3(2.13, 3, 3)
  for (const view of ['2d', '3d'] as const) {
    mode('lines')
    const result = snapLightWorldPoint(raw, { view, levelId: level.id })
    expect(result.point.x).toBeCloseTo(2.1)
    expect(result.point.y).toBe(3)
    expect(useAlignmentGuides.getState().guides.length).toBeGreaterThan(0)
    mode('off')
    expect(snapLightWorldPoint(raw, { view, levelId: level.id }).point.toArray()).toEqual(
      raw.toArray(),
    )
    expect(useAlignmentGuides.getState().guides.length).toBeGreaterThan(0)
    mode('grid')
    expect(snapLightWorldPoint(raw, { view, levelId: level.id }).point.toArray()).toEqual([2, 3, 3])
    const free = snapLightWorldPoint(raw, { view, levelId: level.id, bypass: true })
    expect(free.point.toArray()).toEqual(raw.toArray())
    expect(useAlignmentGuides.getState().guides).toHaveLength(0)
  }
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})

test('rotated translated building uses native world guides and the visible grid frame', () => {
  building = { ...building, position: [7, 0, -3], rotation: [0, Math.PI / 3, 0] }
  useScene.setState({ nodes: { ...useScene.getState().nodes, [building.id]: building } })
  parent.position.fromArray(building.position)
  parent.rotation.y = building.rotation[1]
  parent.updateMatrixWorld(true)
  const target = parent.localToWorld(new Vector3(2.1, 0, 1))
  const raw = target.clone().add(new Vector3(0.03, 2, 1.7))
  const snapped = snapLightWorldPoint(raw, { view: '3d', levelId: level.id }).point
  expect(snapped.x).toBeCloseTo(target.x)
  expect(useAlignmentGuides.getState().guides.some((g) => Math.abs(g.to.x - target.x) < 1e-6)).toBe(
    true,
  )
  mode('grid')
  const grid = snapLightWorldPoint(raw, { view: '3d', levelId: level.id }).point
  expect(grid.x / 0.5).toBeCloseTo(Math.round(raw.x / 0.5))
  expect(grid.z / 0.5).toBeCloseTo(Math.round(raw.z / 0.5))
  const plan = snapLightWorldPoint(raw, { view: '2d', levelId: level.id }).point
  // The plan grid origin follows the building, while its visible axes stay unrotated.
  expect((plan.x - 7) / 0.5).toBeCloseTo(Math.round((raw.x - 7) / 0.5))
  expect((plan.z + 3) / 0.5).toBeCloseTo(Math.round((raw.z + 3) / 0.5))
})

test('exclude self and other floors; previous supports can be alignment references', () => {
  const light = StringLightNode.parse({ parentId: level.id, position: [10, 0, 10] })
  const upper = LevelNode.parse({ level: 1, parentId: building.id })
  const upperWall = WallNode.parse({ parentId: upper.id, start: [10, 9], end: [10, 12] })
  useScene.setState({
    nodes: {
      ...useScene.getState().nodes,
      [light.id]: light as never,
      [upper.id]: upper,
      [upperWall.id]: upperWall,
    },
  })
  const raw = new Vector3(10.03, 2, 10.03)
  expect(
    snapLightWorldPoint(raw, {
      view: '3d',
      levelId: level.id,
      excludeId: light.id,
    }).point.toArray(),
  ).toEqual(raw.toArray())
  const reference = snapLightWorldPoint(raw, {
    view: '3d',
    levelId: level.id,
    excludeId: light.id,
    referencePoints: [[10, 2, 4]],
  })
  expect(reference.point.x).toBeCloseTo(10)
})

test('surface alignment stays on same model; excessive grid displacement falls back to actual hit', () => {
  const host = ItemNode.parse({
    parentId: level.id,
    asset: { id: 'test', name: 'test', src: '/test.glb', thumbnail: '', category: 'furniture' },
  })
  useScene.setState({ nodes: { ...useScene.getState().nodes, [host.id]: host } })
  const geometry = new BoxGeometry(4, 0.2, 4),
    material = new MeshBasicMaterial()
  const mesh = new Mesh(geometry, material)
  mesh.position.set(2, 2, 3)
  parent.add(mesh)
  sceneRegistry.nodes.set(host.id, mesh)
  parent.updateMatrixWorld(true)
  const hit = querySceneSurface(new Ray(new Vector3(2.13, 5, 3), new Vector3(0, -1, 0)), {
    targetIds: [host.id],
  })!
  const result = snapLightWorldPoint(new Vector3(...hit.point), {
    view: '3d',
    levelId: level.id,
    surface: hit,
  })
  expect(result.surface?.targetId).toBe(host.id)
  expect(result.point.x).toBeCloseTo(2.1)
  expect(result.point.y).toBeCloseTo(2.1)
  mode('grid')
  useEditor.setState({ gridSnapStep: 10 })
  const rejected = snapLightWorldPoint(new Vector3(...hit.point), {
    view: '3d',
    levelId: level.id,
    surface: hit,
  })
  expect(rejected.point.toArray()).toEqual(hit.point)
  expect(useAlignmentGuides.getState().guides).toHaveLength(0)
  geometry.dispose()
  material.dispose()
})

test('light footprint registers with shared moving and candidate anchor APIs, including offset rotation', () => {
  const light = StringLightNode.parse({
    parentId: level.id,
    position: [4, 0, 4],
    rotation: [0, Math.PI / 2, 0],
    points: [
      [1, 2, 0],
      [3, 2, 0],
    ],
    curve: 'straight',
  })
  useScene.setState({ nodes: { ...useScene.getState().nodes, [light.id]: light as never } })
  const nodes = useScene.getState().nodes
  const anchors = nodeAlignmentAnchors(light as never, nodes)
  expect(anchors.length).toBeGreaterThan(1)
  const moved = movingAlignmentAnchors(light as never, nodes, 5, 6)
  moved.forEach((a, i) => {
    expect(a.x - anchors[i]!.x).toBeCloseTo(1)
    expect(a.z - anchors[i]!.z).toBeCloseTo(2)
  })
  const reference = { ...anchors[0]!, nodeId: 'other', x: anchors[0]!.x + 0.03, z: 20 }
  expect(
    resolveAlignmentForActiveBuilding({ moving: anchors, candidates: [reference], threshold: 0.08 })
      .snap?.dx,
  ).toBeCloseTo(0.03)
})

test('2D support drag publishes guides and live preview, commits once, undo restores original', () => {
  const light = StringLightNode.parse({
    parentId: level.id,
    points: [
      [1, 2, 3],
      [4, 2, 3],
    ],
    curve: 'straight',
  })
  useScene.setState({ nodes: { ...useScene.getState().nodes, [light.id]: light as never } })
  const object = new Group()
  parent.add(object)
  sceneRegistry.nodes.set(light.id, object)
  parent.updateMatrixWorld(true)
  useScene.temporal.getState().clear()
  const geometry = stringLightDefinition.floorplan!(light, {
    resolve: (id) => useScene.getState().nodes[id],
    parent: level,
    children: [],
    siblings: [],
    viewState: { selected: true },
  } as never)
  if (geometry?.kind !== 'group') throw new Error('Expected light geometry')
  const handle = geometry.children.find((child) => child.kind === 'endpoint-handle')
  if (handle?.kind !== 'endpoint-handle') throw new Error('Expected support handle')
  const scope = floorplanAffordanceReshapeScope(handle.affordance!, light.id, handle.payload)
  expect(scope).toMatchObject({
    kind: 'reshaping',
    reshape: 'control-point',
    nodeId: light.id,
    index: 0,
  })
  useInteractionScope.getState().begin(scope!)
  const session = pointAffordance.start({
    node: light,
    payload: { index: 0 },
    initialPlanPoint: [1, 3],
    gridSnapStep: 0.5,
    nodes: useScene.getState().nodes,
  })
  session.apply({
    planPoint: [2.13, 3],
    modifiers: { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false },
  })
  const patch = useLiveNodeOverrides.getState().get(light.id) as { points: number[][] }
  expect(patch.points[0]![0]).toBeCloseTo(2.1)
  expect(useAlignmentGuides.getState().guides.length).toBeGreaterThan(0)
  expect(useScene.getState().nodes[light.id]).toEqual(light as never)
  session.commit!()
  expect(useAlignmentGuides.getState().guides).toHaveLength(0)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[light.id]).toEqual(light as never)
})

test('mounted drawing tool uses the same snapped point for preview and commit, clearing guides on end', async () => {
  const { create, act } = await import('@react-three/test-renderer')
  const { createElement } = await import('react')
  const { emitter } = await import('@pascal-app/core')
  const { default: LightTool } = await import('../../../string-lights-plugin/src/tool')
  const { useLightDraft } = await import('../../../string-lights-plugin/src/store')
  const { LightSettings } = await import('../../../string-lights-plugin/src/schema')
  const originalDraft = useLightDraft.getState()
  const originalWindow = globalThis.window
  const originalAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT
  if (!globalThis.window) globalThis.window = new EventTarget() as never
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  useLightDraft.setState({
    settings: LightSettings.parse({ surfaceSnap: false }),
    points: [],
    anchors: [],
    nodeId: null,
    elevation: 2.5,
    guideOnly: false,
  })
  let renderer: Awaited<ReturnType<typeof create>> | undefined
  let stamp = 1
  const event = (position: [number, number, number]) =>
    ({
      position,
      localPosition: position,
      nativeEvent: { timeStamp: stamp++, detail: 1, altKey: false, target: null },
    }) as never
  try {
    renderer = await create(createElement(LightTool))
    await act(async () => {
      emitter.emit('grid:move', event([2.13, 0, 3]))
    })
    expect(useAlignmentGuides.getState().guides.length).toBeGreaterThan(0)
    await act(async () => {
      emitter.emit('grid:click', event([2.13, 0, 3]))
    })
    expect(useLightDraft.getState().points[0]![0]).toBeCloseTo(2.1)
    expect(useAlignmentGuides.getState().guides).toHaveLength(0)
    await act(async () => {
      emitter.emit('grid:move', event([2.13, 0, 7]))
    })
    expect(useAlignmentGuides.getState().guides.length).toBeGreaterThan(0)
    await act(async () => {
      emitter.emit('grid:click', event([2.13, 0, 7]))
    })
    const id = useLightDraft.getState().nodeId!
    const saved = useScene.getState().nodes[id as never] as unknown as { points: number[][] }
    expect(saved.points[1]![0]).toBeCloseTo(2.1)
    expect(saved.points[1]![1]).toBeCloseTo(2.5)
    await act(async () => {
      emitter.emit('grid:move', event([2.13, 0, 8]))
    })
    expect(useAlignmentGuides.getState().guides.length).toBeGreaterThan(0)
    await act(async () => {
      useLightDraft.getState().finish?.()
    })
    expect(useAlignmentGuides.getState().guides).toHaveLength(0)
    expect(
      (useScene.getState().nodes[id as never] as unknown as { points: number[][] }).points,
    ).toHaveLength(2)
  } finally {
    await renderer?.unmount()
    useLightDraft.setState(originalDraft)
    globalThis.window = originalWindow
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = originalAct
  }
})

test('2D support grid snap respects building transforms without mounted 3D objects', () => {
  building = { ...building, position: [7, 0, -3], rotation: [0, Math.PI / 3, 0] }
  const light = StringLightNode.parse({
    parentId: level.id,
    position: [2, 0, 1],
    rotation: [0, 0.4, 0],
    points: [
      [0, 2, 0],
      [2, 2, 0],
    ],
  })
  useScene.setState({
    nodes: { ...useScene.getState().nodes, [building.id]: building, [light.id]: light as never },
  })
  sceneRegistry.nodes.clear()
  mode('grid')
  useInteractionScope
    .getState()
    .begin(floorplanAffordanceReshapeScope('move-control-point', light.id, { index: 0 })!)
  const session = pointAffordance.start({
    node: light,
    payload: { index: 0 },
    nodes: useScene.getState().nodes,
    initialPlanPoint: [2, 1],
    gridSnapStep: 0.5,
  })
  session.apply({
    planPoint: [2.13, 1.17],
    modifiers: { altKey: false, shiftKey: false, ctrlKey: false, metaKey: false },
  })
  const patch = useLiveNodeOverrides.getState().get(light.id) as {
    points: [number, number, number][]
  }
  const { nodeSceneFrame, transformPoint } = require('@pascal-app/core/procedural-items')
  const frame = nodeSceneFrame(light.id, useScene.getState().nodes)
  const world = transformPoint(frame, patch.points[0]) as number[]
  expect((world[0]! - 7) / 0.5).toBeCloseTo(Math.round((world[0]! - 7) / 0.5))
  expect((world[2]! + 3) / 0.5).toBeCloseTo(Math.round((world[2]! + 3) / 0.5))
  expect(patch.points[0]![1]).toBeCloseTo(2)
})
