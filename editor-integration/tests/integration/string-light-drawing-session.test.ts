import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  BuildingNode,
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Ray, Vector3 } from 'three'
import { stringLightDefinition } from '../../../string-lights-plugin/src/definition'
import { appendLightPoint } from '../../../string-lights-plugin/src/drafting'
import {
  beginLightDrawing,
  finishLightDrawing,
} from '../../../string-lights-plugin/src/drawing-session'
import { LightSettings, type StringLightNode } from '../../../string-lights-plugin/src/schema'
import { useLightDraft } from '../../../string-lights-plugin/src/store'
import { lightSurfaceScope } from '../../../string-lights-plugin/src/surface-scope'
import { querySceneSurface } from '../../packages/editor/src/lib/scene-surface-query'

const savedScene = useScene.getState(),
  savedViewer = useViewer.getState(),
  savedEditor = useEditor.getState(),
  savedDraft = useLightDraft.getState()
const registry = new Map(sceneRegistry.nodes)
const building = BuildingNode.parse({})
const lower = LevelNode.parse({ level: 0, parentId: building.id })
const upper = LevelNode.parse({ level: 1, parentId: building.id })
const asset = {
  id: 'fixture',
  name: 'Fixture',
  src: '/fixture.glb',
  thumbnail: '',
  category: 'furniture',
}
const eave = ItemNode.parse({ parentId: upper.id, name: 'Upper eave', asset })
const fence = ItemNode.parse({ parentId: lower.id, name: 'Fence', asset })
let restore: () => void, raf: typeof requestAnimationFrame, caf: typeof cancelAnimationFrame
beforeEach(() => {
  raf = globalThis.requestAnimationFrame
  caf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  restore = nodeRegistry._snapshot()
  registerNode(stringLightDefinition as never)
  useScene.setState({
    nodes: Object.fromEntries([building, lower, upper, eave, fence].map((n) => [n.id, n])),
    rootNodeIds: [building.id],
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  useViewer
    .getState()
    .setSelection({ buildingId: building.id, levelId: lower.id, selectedIds: [eave.id] })
  useLightDraft.setState({
    settings: LightSettings.parse({}),
    points: [],
    anchors: [],
    nodeId: null,
    guideOnly: false,
    feedback: null,
  })
  sceneRegistry.nodes.clear()
  const root = new Group(),
    roof = new Mesh(new BoxGeometry(4, 0.2, 1), new MeshBasicMaterial()),
    rail = new Mesh(new BoxGeometry(4, 0.2, 0.15), new MeshBasicMaterial())
  roof.position.set(0, 5, -2)
  rail.position.set(0, 1.2, 3)
  sceneRegistry.nodes.set(lower.id, root)
  sceneRegistry.nodes.set(eave.id, roof)
  sceneRegistry.nodes.set(fence.id, rail)
})
afterEach(() => {
  useScene.temporal.getState().clear()
  useScene.setState(savedScene)
  useViewer.setState(savedViewer)
  useEditor.setState(savedEditor)
  useLightDraft.setState(savedDraft)
  sceneRegistry.nodes.clear()
  registry.forEach((o, id) => {
    sceneRegistry.nodes.set(id, o)
  })
  restore()
  globalThis.requestAnimationFrame = raf
  globalThis.cancelAnimationFrame = caf
})

test('preselecting a house does not restrict ordinary drawing; two different-level surfaces remain eligible', () => {
  beginLightDrawing()
  expect(useLightDraft.getState().settings.surfaceTargets).toEqual([])
  expect(useLightDraft.getState().guideOnly).toBe(false)
  const scope = lightSurfaceScope(useLightDraft.getState().settings)
  const a = querySceneSurface(new Ray(new Vector3(0, 10, -2), new Vector3(0, -1, 0)), scope)!
  const b = querySceneSurface(new Ray(new Vector3(0, 10, 3), new Vector3(0, -1, 0)), scope)!
  expect(a.targetId).toBe(eave.id)
  expect(b.targetId).toBe(fence.id)
  appendLightPoint(
    a.point,
    [{ index: 0, nodeId: a.targetId, localPosition: a.localPoint, referencePosition: a.point }],
    lower.id,
  )
  appendLightPoint(
    b.point,
    [
      ...useLightDraft.getState().anchors,
      { index: 1, nodeId: b.targetId, localPosition: b.localPoint, referencePosition: b.point },
    ],
    lower.id,
  )
  const id = useLightDraft.getState().nodeId!
  finishLightDrawing()
  const node = useScene.getState().nodes[id as never] as unknown as StringLightNode
  expect(node.anchors.map((a) => a.nodeId)).toEqual([eave.id, fence.id])
  expect(node.points[0]![1]).toBeCloseTo(5.1)
  expect(node.points[1]![1]).toBeCloseTo(1.3)
  expect(useViewer.getState().selection.selectedIds).toEqual([id])
  expect(useEditor.getState().tool).toBeNull()
  expect(useLightDraft.getState().points).toEqual([])
})

test('explicit target restriction stays explicit, and a later ordinary drawing leaves guided-only scope', () => {
  useLightDraft.setState({
    settings: LightSettings.parse({ surfaceSnap: false, surfaceTargets: [fence.id] }),
  })
  beginLightDrawing()
  expect(useLightDraft.getState().settings.surfaceSnap).toBe(false)
  expect(useLightDraft.getState().settings.surfaceTargets).toEqual([fence.id])
  beginLightDrawing([eave.id])
  expect(useLightDraft.getState().guideOnly).toBe(true)
  expect(useLightDraft.getState().settings.surfaceTargets).toEqual([eave.id])
  beginLightDrawing()
  expect(useLightDraft.getState().settings.surfaceTargets).toEqual([])
})

test('a first-point draft has a visible plan marker and does not commit a scene object', () => {
  beginLightDrawing()
  const before = Object.keys(useScene.getState().nodes).length
  appendLightPoint([1, 3, 2], [], lower.id)
  expect(Object.keys(useScene.getState().nodes)).toHaveLength(before)
  const node = stringLightDefinition.schema.parse({
    ...LightSettings.parse({}),
    parentId: lower.id,
    points: [
      [1, 3, 2],
      [1, 3, 2],
    ],
    metadata: { lightDraft: true },
  })
  const plan = stringLightDefinition.floorplan!(node, {
    resolve: () => undefined,
    children: [],
    siblings: [],
  } as never)
  expect(plan?.kind).toBe('group')
  if (plan?.kind === 'group')
    expect(
      plan.children.some((c) => c.kind === 'circle' && c.cx === 1 && c.cy === 2 && c.r === 0.09),
    ).toBe(true)
  finishLightDrawing()
  expect(Object.keys(useScene.getState().nodes)).toHaveLength(before)
})
