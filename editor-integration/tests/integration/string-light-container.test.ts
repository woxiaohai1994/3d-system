import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  useScene,
} from '@pascal-app/core'
import { nodeSceneFrame, transformPoint } from '@pascal-app/core/procedural-items'
import { Group, Vector3 } from 'three'
import { stringLightDefinition } from '../../../string-lights-plugin/src/definition'
import { commitLight } from '../../../string-lights-plugin/src/commands'
import { type StringLightNode, type Vec3 } from '../../../string-lights-plugin/src/schema'
import {
  lightPlanDependencies,
  planLightContext,
  snapshotPlanLightSupports,
} from '../../../string-lights-plugin/src/plan-light'
import {
  moveLightSupport,
  resolveLightPoints,
} from '../../../string-lights-plugin/src/surface-anchors'

let restore: () => void, saved: ReturnType<typeof useScene.getState>
let raf: typeof requestAnimationFrame, caf: typeof cancelAnimationFrame
let building: ReturnType<typeof BuildingNode.parse>
let lower: ReturnType<typeof LevelNode.parse>, middle: typeof lower, upper: typeof lower
let host: ReturnType<typeof ItemNode.parse>, light: StringLightNode
beforeEach(() => {
  saved = useScene.getState()
  restore = nodeRegistry._snapshot()
  raf = globalThis.requestAnimationFrame
  caf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  if (!nodeRegistry.has(stringLightDefinition.kind)) registerNode(stringLightDefinition as never)
  building = BuildingNode.parse({ position: [8, 1, -4], rotation: [0.15, 0.6, -0.1] })
  lower = LevelNode.parse({ parentId: building.id, level: 0, baseElevation: 0.4, height: 3.2 })
  middle = LevelNode.parse({ parentId: building.id, level: 1, baseElevation: 0.1, height: 2.8 })
  upper = LevelNode.parse({ parentId: building.id, level: 2, baseElevation: 0.3, height: 3 })
  building.children = [lower.id, middle.id, upper.id]
  host = ItemNode.parse({
    parentId: lower.id,
    asset: { id: 'post', name: 'Post', src: '/post.glb', thumbnail: '', category: 'furniture' },
  })
  lower.children = [host.id]
  const nodes = Object.fromEntries([building, lower, middle, upper, host].map((n) => [n.id, n]))
  useScene.setState({ nodes, rootNodeIds: [building.id], readOnly: false })
  const points = [
    [0, 2, 0],
    [4, 2, 0],
    [5, 2, 0],
  ]
  light = commitLight(
    {
      points,
      anchors: points
        .slice(0, 2)
        .map((p, index) => ({ index, nodeId: host.id, localPosition: p, referencePosition: p })),
      spacing: 0.35,
      bulbSize: 0.045,
      colors: ['#ff0000', '#00ff00'],
    },
    lower.id,
  )
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
})
afterEach(() => {
  useScene.setState(saved)
  useScene.temporal.getState().clear()
  restore()
  globalThis.requestAnimationFrame = raf
  globalThis.cancelAnimationFrame = caf
})
const current = () => useScene.getState().nodes[light.id] as unknown as StringLightNode

function objects() {
  const nodes = useScene.getState().nodes
  const b = nodes[building.id] as typeof building
  const root = new Group()
  root.position.fromArray(b.position)
  root.rotation.set(...b.rotation)
  const objects = new Map<string, Group>([[building.id, root]])
  let height = 0
  for (const id of [lower.id, middle.id, upper.id]) {
    const node = nodes[id] as typeof lower
    height += node.baseElevation
    const group = new Group()
    group.position.y = height
    root.add(group)
    objects.set(id, group)
    height += node.height!
  }
  for (const node of [nodes[host.id] as typeof host, current()]) {
    const group = new Group()
    group.position.fromArray(node.position)
    group.rotation.set(...node.rotation)
    objects.get(node.parentId!)!.add(group)
    objects.set(node.id, group)
  }
  root.updateMatrixWorld(true)
  return objects
}
function rendered() {
  const node = current(),
    graph = useScene.getState().nodes,
    scene = objects()
  const object = scene.get(node.id)!
  const rendered = resolveLightPoints(node, object, (id) => scene.get(id))
  const plan = planLightContext(node, (id) => graph[id as AnyNodeId], graph).points!(node)
  rendered.forEach((p, i) =>
    expect(new Vector3(...p).distanceTo(new Vector3(...plan[i]!))).toBeLessThan(1e-7),
  )
  return rendered.map((p) => object.localToWorld(new Vector3(...p)))
}
function close(actual: Vector3[], expected: Vector3[]) {
  actual.forEach((p, i) => expect(p.distanceTo(expected[i]!)).toBeLessThan(1e-7))
}

test('shared scene frames include complete storey stacks and the building rotation', () => {
  const nodes = useScene.getState().nodes,
    scene = objects()
  expect(scene.get(upper.id)!.position.y).toBeCloseTo(6.8)
  for (const id of [lower.id, upper.id, host.id, light.id]) {
    const point: Vec3 = [0.3, 1.2, -0.5]
    const actual = transformPoint(nodeSceneFrame(id, nodes), point)
    expect(
      new Vector3(...actual).distanceTo(scene.get(id)!.localToWorld(new Vector3(...point))),
    ).toBeLessThan(1e-7)
  }
})

for (const atomic of [false, true])
  test(`changing a string container rebases its visible shape and binding in one ${atomic ? 'atomic' : 'native'} update`, () => {
    useScene.getState().updateNode(host.id, { position: [2, 0, 1], rotation: [0, 0.4, 0] })
    const before = rendered(),
      oldObjects = objects(),
      original = current()
    const local = before.map((p) => oldObjects.get(light.id)!.worldToLocal(p.clone()))
    useScene.temporal.getState().clear()
    const changes = [
      {
        id: light.id as AnyNodeId,
        data: { parentId: upper.id, position: [0.2, 0.1, 0] } as Partial<AnyNode>,
      },
    ]
    if (atomic) useScene.getState().applyNodeChanges({ update: changes })
    else useScene.getState().updateNodes(changes)
    const nextObjects = objects(),
      expected = local.map((p) => nextObjects.get(light.id)!.localToWorld(p.clone()))
    close(rendered(), expected)
    expect(current().anchors).toHaveLength(2)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    const moved = current()
    useScene.temporal.getState().undo()
    expect(current()).toEqual(original)
    close(rendered(), before)
    useScene.temporal.getState().redo()
    useScene.setState({ nodes: JSON.parse(JSON.stringify(useScene.getState().nodes)) })
    expect(current()).toEqual(moved)
    close(rendered(), expected)
    const hostLocal = expected.map((p) => nextObjects.get(host.id)!.worldToLocal(p.clone()))
    useScene.getState().updateNode(host.id, { rotation: [0, 0.8, 0] })
    const changed = objects()
    close(
      rendered(),
      expected.map((p, i) =>
        i < 2 ? changed.get(host.id)!.localToWorld(hostLocal[i]!.clone()) : p,
      ),
    )
    expect([current().spacing, current().bulbSize, current().colors]).toEqual([
      light.spacing,
      light.bulbSize,
      light.colors,
    ])
  })

test('moving only the host to another storey follows in plan and 3D, including intermediate storey edits', () => {
  const before = rendered()
  useScene.getState().updateNode(host.id, { parentId: upper.id })
  const scene = objects()
  close(
    rendered(),
    before.map((p, i) =>
      i < 2 ? scene.get(host.id)!.localToWorld(new Vector3(...light.points[i]!)) : p,
    ),
  )
  expect(lightPlanDependencies(current(), useScene.getState().nodes)).toContain(middle.id)
  useScene.getState().updateNode(middle.id, { height: 4 })
  const changed = objects(),
    expected = before.map((p, i) =>
      i < 2 ? changed.get(host.id)!.localToWorld(new Vector3(...light.points[i]!)) : p,
    )
  close(rendered(), expected)
  const graph = useScene.getState().nodes
  const snapshot = snapshotPlanLightSupports(current(), (id) => graph[id as AnyNodeId], graph)
  const points = planLightContext(snapshot, (id) => graph[id as AnyNodeId], graph).points!(snapshot)
  close(
    points.map((p) => changed.get(light.id)!.localToWorld(new Vector3(...p))),
    expected,
  )
})

test('an existing cross-storey anchor is captured and resolved consistently without mounted meshes', () => {
  useScene.getState().updateNode(host.id, { parentId: upper.id, rotation: [0, 0.4, 0] })
  const scene = objects(),
    object = scene.get(light.id)!,
    target = scene.get(host.id)!
  const point = target.localToWorld(new Vector3(0.2, 1, 0))
  const path = moveLightSupport(current(), object, 0, point, (id) => scene.get(id), host.id)
  useScene.getState().updateNode(light.id as AnyNodeId, path as Partial<AnyNode>)
  close([rendered()[0]!], [point])
  useScene.getState().updateNode(upper.id, { baseElevation: 0.9 })
  const changed = objects()
  close([rendered()[0]!], [changed.get(host.id)!.localToWorld(new Vector3(0.2, 1, 0))])
})
