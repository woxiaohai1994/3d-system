import { afterEach, beforeEach, expect, test } from 'bun:test'
import { ItemNode, LevelNode, nodeRegistry, registerNode, useScene } from '@pascal-app/core'
import { Group, Vector3 } from 'three'
import { stringLightDefinition } from '../../../string-lights-plugin/src/definition'
import { commitLight, updateLight } from '../../../string-lights-plugin/src/commands'
import { LIGHT_KIND, type StringLightNode } from '../../../string-lights-plugin/src/schema'
import { planLightContext } from '../../../string-lights-plugin/src/plan-light'
import { resolveLightPoints } from '../../../string-lights-plugin/src/surface-anchors'

const saved = useScene.getState()
const level = LevelNode.parse({ level: 0 })
const host = ItemNode.parse({
  parentId: level.id,
  asset: { id: 'post', name: 'Post', src: '/post.glb', thumbnail: '', category: 'furniture' },
})
let restore: () => void, light: StringLightNode
let raf: typeof requestAnimationFrame, caf: typeof cancelAnimationFrame
beforeEach(() => {
  raf = globalThis.requestAnimationFrame
  caf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  restore = nodeRegistry._snapshot()
  if (!nodeRegistry.has(LIGHT_KIND)) registerNode(stringLightDefinition as never)
  useScene.setState({
    nodes: { [level.id]: level, [host.id]: host },
    rootNodeIds: [level.id],
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  const points = [
    [1, 2, 0],
    [2, 2, 0],
    [5, 2, 0],
  ]
  light = commitLight(
    {
      points,
      anchors: points.slice(0, 2).map((p, index) => ({
        index,
        nodeId: host.id,
        localPosition: p,
        referencePosition: p,
      })),
      bulbSize: 0.05,
      spacing: 0.3,
      colors: ['#ff0000', '#00ff00'],
    },
    level.id,
  )
  useScene.temporal.getState().clear()
})
afterEach(() => {
  useScene.temporal.getState().clear()
  useScene.setState(saved)
  restore()
  globalThis.requestAnimationFrame = raf
  globalThis.cancelAnimationFrame = caf
})
function current() {
  return useScene.getState().nodes[light.id] as unknown as StringLightNode
}
function hostObject() {
  const node = useScene.getState().nodes[host.id] as typeof host
  if (!node) return undefined
  const object = new Group()
  object.position.fromArray(node.position)
  object.rotation.fromArray([...node.rotation, 'XYZ'])
  object.updateMatrixWorld(true)
  return object
}
function rendered() {
  const node = current(),
    object = new Group(),
    model = hostObject()
  object.position.fromArray(node.position)
  object.rotation.fromArray([...node.rotation, 'XYZ'])
  const points = resolveLightPoints(node, object, (id) => (id === host.id ? model : undefined))
  const nodes = useScene.getState().nodes
  const plan = planLightContext(node, (id) => nodes[id as keyof typeof nodes]).points!(node)
  points.forEach((p, i) =>
    expect(new Vector3(...p).distanceTo(new Vector3(...plan[i]!))).toBeLessThan(1e-7),
  )
  return points.map((p) => object.localToWorld(new Vector3(...p)))
}
function close(actual: Vector3[], expected: Vector3[]) {
  actual.forEach((p, i) => expect(p.distanceTo(expected[i]!)).toBeLessThan(1e-7))
}

test('native whole-string move after host rotation rebases offsets, then follows further rotation with one undo and JSON reload', () => {
  useScene.getState().updateNode(host.id, { position: [2, 0, 1], rotation: [0, 0.6, 0] })
  const before = rendered(),
    beforeMove = current()
  useScene.temporal.getState().clear()
  useScene.getState().updateNode(light.id as never, { position: [0.12, -0.08, 0.2] } as never)
  const shifted = before.map((p) => p.clone().add(new Vector3(0.12, -0.08, 0.2)))
  close(rendered(), shifted)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  const bound = current(),
    local = shifted.map((p) => hostObject()!.worldToLocal(p.clone()))
  useScene.temporal.getState().undo()
  expect(current()).toEqual(beforeMove)
  close(rendered(), before)
  useScene.temporal.getState().redo()
  expect(current()).toEqual(bound)
  useScene.setState({ nodes: JSON.parse(JSON.stringify(useScene.getState().nodes)) })
  useScene.getState().updateNode(host.id, { rotation: [0, 1.1, 0] })
  const expected = local.map((p, i) =>
    i < 2 ? hostObject()!.localToWorld(p.clone()) : shifted[i]!,
  )
  close(rendered(), expected)
  expect([current().bulbSize, current().spacing, current().colors]).toEqual([
    light.bulbSize,
    light.spacing,
    light.colors,
  ])
  // Another move uses the CURRENT rotated pose, not the original attachment frame.
  updateLight(light.id, { position: [0.17, -0.08, 0.2] })
  close(
    rendered(),
    expected.map((p) => p.clone().add(new Vector3(0.05, 0, 0))),
  )
})

for (const atomic of [false, true])
  test(`moving host and string in one ${atomic ? 'atomic' : 'native'} batch does not double translation`, () => {
    const before = rendered()
    const updates = [
      { id: light.id, data: { position: [3, 0, 2] } },
      { id: host.id, data: { position: [3, 0, 2] } },
    ] as never
    if (atomic) useScene.getState().applyNodeChanges({ update: updates })
    else useScene.getState().updateNodes(updates)
    close(
      rendered(),
      before.map((p) => p.clone().add(new Vector3(3, 0, 2))),
    )
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.getState().updateNode(host.id, { rotation: [0, Math.PI / 2, 0] })
    close(
      rendered(),
      before.map((p, i) =>
        i < 2 ? hostObject()!.localToWorld(p.clone()) : p.clone().add(new Vector3(3, 0, 2)),
      ),
    )
  })

test('explicit path edits and missing hosts are preserved; material-only edits do not rebase attachments', () => {
  const anchors = current().anchors
  useScene.getState().updateNode(light.id as never, { brightness: 2 } as never)
  expect(current().anchors).toEqual(anchors)
  const points = [
    [7, 2, 0],
    [8, 2, 0],
    [9, 2, 0],
  ]
  useScene
    .getState()
    .updateNode(light.id as never, { position: [1, 0, 0], points, anchors: [] } as never)
  expect(current().points).toEqual(points as never)
  expect(current().anchors).toEqual([])
  useScene.temporal.getState().undo()
  useScene.getState().deleteNode(host.id)
  const before = rendered()
  useScene.getState().updateNode(light.id as never, { position: [1, 0, 0] } as never)
  close(
    rendered(),
    before.map((p) => p.clone().add(new Vector3(1, 0, 0))),
  )
})
