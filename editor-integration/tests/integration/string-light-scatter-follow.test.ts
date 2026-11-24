import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  BuildingNode,
  ItemNode,
  LevelNode,
  cloneNodesInto,
  nodeRegistry,
  registerNode,
  useScene,
  useLiveNodeOverrides,
  type AnyNode,
  type AnyNodeId,
  sceneRegistry,
} from '@pascal-app/core'
import { nodeSceneFrame, transformPoint } from '@pascal-app/core/procedural-items'
import { Matrix4, Vector3 } from 'three'
import { stringLightDefinition } from '../../../string-lights-plugin/src/definition'
import { commitLight, updateLight } from '../../../string-lights-plugin/src/commands'
import { StringLightNode, isStringLight } from '../../../string-lights-plugin/src/schema'
import {
  planLightContext,
  lightPlanDependencies,
} from '../../../string-lights-plugin/src/plan-light'
import {
  liveLightContext,
  resolveLightNode,
} from '../../../string-lights-plugin/src/resolved-light'
import { makeLayout } from '../../../string-lights-plugin/src/layout'
import { buildLightGeometry } from '../../../string-lights-plugin/src/geometry'
import LightRenderer from '../../../string-lights-plugin/src/renderer'
import { act, create } from '@react-three/test-renderer'
import { createElement } from 'react'
import { treeDefinition } from '../../node_modules/@pascal-app/plugin-trees/src/definition'
import { TreeNode } from '../../node_modules/@pascal-app/plugin-trees/src/schema'

const saved = useScene.getState()
let restore: () => void, light: StringLightNode
let raf: typeof requestAnimationFrame, caf: typeof cancelAnimationFrame
const building = BuildingNode.parse({ position: [4, 0, -7], rotation: [0, 0.4, 0] })
const level = LevelNode.parse({ parentId: building.id, level: 1, baseElevation: 3 })
const host = ItemNode.parse({
  parentId: level.id,
  position: [2, 0, -1],
  rotation: [0, 0.3, 0],
  scale: [2, 1, 0.5],
  asset: { id: 'shrub', name: 'Shrub', src: '/shrub.glb', thumbnail: '', category: 'outdoor' },
})
building.children = [level.id]
level.children = [host.id]
beforeEach(() => {
  raf = globalThis.requestAnimationFrame
  caf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  restore = nodeRegistry._snapshot()
  if (!nodeRegistry.has(stringLightDefinition.kind)) registerNode(stringLightDefinition as never)
  useScene.setState({
    nodes: { [building.id]: building, [level.id]: level, [host.id]: host },
    rootNodeIds: [building.id],
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  light = commitLight(
    {
      mode: 'scatter',
      surfaceTargets: [host.id],
      position: [2, 0, -1],
      region: [2, 3, 2],
      count: 40,
      distribution: 'count',
      seed: 19,
      bulbSize: 0.02,
      colors: ['#ff0000', '#ffffff'],
      colorRule: 'sequence',
      effect: 'chase',
      spacing: 0.35,
    },
    level.id,
  )
  useScene.temporal.getState().clear()
})
afterEach(() => {
  useLiveNodeOverrides.getState().clearAll()
  useScene.setState(saved)
  useScene.temporal.getState().clear()
  restore()
  globalThis.requestAnimationFrame = raf
  globalThis.cancelAnimationFrame = caf
})
function current() {
  return useScene.getState().nodes[light.id] as unknown as StringLightNode
}
function resolved(
  node = current(),
  nodes: Readonly<Record<string, AnyNode>> = useScene.getState().nodes,
) {
  return resolveLightNode(
    node,
    planLightContext(node, (id) => nodes[id], nodes),
  ).node
}
function world(
  node = current(),
  nodes: Readonly<Record<string, AnyNode>> = useScene.getState().nodes,
) {
  const frame = nodeSceneFrame(node.id, nodes)
  return makeLayout(resolved(node, nodes)).bulbs.map(
    (bulb) => new Vector3(...transformPoint(frame, bulb.position)),
  )
}
function close(actual: Vector3[], expected: Vector3[]) {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((point, i) => expect(point.distanceTo(expected[i]!)).toBeLessThan(1e-6))
}

test('scatter follows transformed and nonuniformly scaled hosts with fixed bulb geometry, colors and one undo', () => {
  expect(light.scatterAttachment?.points).toHaveLength(4)
  const reference = makeLayout(light)
  const before = world()
  const originalFrame = nodeSceneFrame(host.id, useScene.getState().nodes)
  const inverse = new Matrix4()
    .makeBasis(
      ...(originalFrame.axes.map((axis) => new Vector3(...axis)) as [Vector3, Vector3, Vector3]),
    )
    .setPosition(new Vector3(...originalFrame.position))
    .invert()
  useScene
    .getState()
    .updateNode(host.id, { position: [3, 1, 2], rotation: [0.2, 1.1, 0], scale: [3, 2, 0.8] })
  const nodes = useScene.getState().nodes
  const changed = nodes[host.id] as typeof host
  const frame = nodeSceneFrame(host.id, nodes)
  const expected = before.map((world) => {
    const p = world
      .clone()
      .applyMatrix4(inverse)
      .divide(new Vector3(...host.scale))
      .multiply(new Vector3(...changed.scale))
    return new Vector3(...transformPoint(frame, p.toArray()))
  })
  close(world(), expected)
  expect(current()).toEqual(light)
  expect(makeLayout(resolved()).bulbs.map((bulb) => [bulb.color, bulb.scale, bulb.phase])).toEqual(
    reference.bulbs.map((bulb) => [bulb.color, bulb.scale, bulb.phase]),
  )
  const geometry = buildLightGeometry(resolved())
  try {
    expect(geometry.layout.cable).toEqual([])
    for (const batch of geometry.group.children) {
      const mesh = batch as import('three').InstancedMesh
      expect(mesh.count).toBe(40)
      for (let i = 0; i < mesh.count; i++) {
        const matrix = new Matrix4()
        mesh.getMatrixAt(i, matrix)
        expect(
          new Vector3().setFromMatrixScale(matrix).distanceTo(new Vector3(1, 1, 1)),
        ).toBeLessThan(1e-6)
      }
    }
  } finally {
    geometry.dispose()
  }
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  close(world(), before)
  useScene.temporal.getState().redo()
  useScene.setState({ nodes: JSON.parse(JSON.stringify(useScene.getState().nodes)) })
  close(world(), expected)
})

test('pure plan, live overrides and native whole-light moves resolve the same attached bulbs', () => {
  expect(lightPlanDependencies(light, useScene.getState().nodes)).toContain(host.id)
  useScene.getState().updateNode(host.id, { position: [3, 1, 2] })
  const before = world()
  const old = current()
  updateLight(light.id, { position: [2.2, 0.1, -1] })
  const parent = nodeSceneFrame(level.id, useScene.getState().nodes)
  const origin = new Vector3(...transformPoint(parent, [0, 0, 0]))
  const offset = new Vector3(...transformPoint(parent, [0.2, 0.1, 0])).sub(origin)
  close(
    world(),
    before.map((p) => p.clone().add(offset)),
  )
  expect(current().scatterAttachment).not.toEqual(old.scatterAttachment)
  const node = current()
  expect(resolveLightNode(node, liveLightContext()).node.scatterFrame).toEqual(
    resolved(node).scatterFrame,
  )
  const plan = stringLightDefinition.floorplan!(node, {
    resolve: (id: string) => useScene.getState().nodes[id as AnyNodeId],
    sceneNodes: useScene.getState().nodes,
  } as never) as { children: Array<{ cx: number; cy: number }> }
  const bulbs = makeLayout(resolved(node)).bulbs
  plan.children.forEach((circle, i) =>
    expect([circle.cx, circle.cy]).toEqual([bulbs[i]!.position[0], bulbs[i]!.position[2]]),
  )
  updateLight(light.id, { colors: ['#00ff00'] })
  expect(current().scatterAttachment).toEqual(node.scatterAttachment)
  expect(current().scatterFrame).toEqual(node.scatterFrame)
})

test('copy remaps point-set hosts, isolates copies, and cross-container single copies freeze the visible cloud', () => {
  useScene.getState().updateNode(host.id, { position: [6, 0, 2] })
  const before = useScene.getState().nodes
  const copies = cloneNodesInto(Object.values(before), { rootId: building.id }).nodes
  const copy = copies.find(isStringLight)!
  const copiedHost = copies.find((node) => node.type === 'item')!
  expect(copy.scatterAttachment!.nodeId).toBe(copiedHost.id)
  expect(
    copy.scatterAttachment!.points.every((point) => point.attachment!.nodeId === copiedHost.id),
  ).toBe(true)
  const combined = { ...before, ...Object.fromEntries(copies.map((node) => [node.id, node])) }
  close(world(copy, combined), world())
  combined[copiedHost.id] = { ...copiedHost, position: [10, 0, 2] } as AnyNode
  expect(world(copy, combined)[0]!.distanceTo(world()[0]!)).toBeCloseTo(4)
  close(world(light, combined), world())
  const upper = LevelNode.parse({ level: 2 })
  const isolated = cloneNodesInto(
    [light as unknown as AnyNode],
    { rootId: light.id as never, parentId: upper.id },
    before,
  ).nodes.find(isStringLight)!
  expect(isolated.scatterAttachment).toBeNull()
  expect(isolated.scatterFrame).toEqual(resolved().scatterFrame)
  expect(isolated.surfaceTargets).toEqual([])
})

test('regenerating distribution retains its attached frame; old scenes and missing hosts remain readable', () => {
  const binding = current().scatterAttachment
  updateLight(light.id, { count: 60, seed: 23 })
  expect(current().scatterAttachment).toEqual(binding)
  expect(makeLayout(resolved()).bulbs).toHaveLength(60)
  const node = current()
  const nodes = { ...useScene.getState().nodes }
  delete nodes[host.id]
  const lost = resolveLightNode(
    node,
    planLightContext(node, (id) => nodes[id as AnyNodeId], nodes),
  )
  expect(lost.warning).toContain('缺失')
  expect(lost.node.scatterFrame).toEqual(node.scatterFrame)
  const { scatterAttachment, scatterFrame, ...legacy } = light
  expect(StringLightNode.parse(legacy).scatterAttachment).toBeNull()
  expect(StringLightNode.parse(legacy).scatterFrame).toBeNull()
})

test('the actual renderer follows preview frames, cancels cleanly, and agrees with committed distribution edits', async () => {
  const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const savedAct = globals.IS_REACT_ACT_ENVIRONMENT
  globals.IS_REACT_ACT_ENVIRONMENT = true
  const objects = new Map(sceneRegistry.nodes)
  const parent = nodeSceneFrame(level.id, useScene.getState().nodes)
  const matrix = new Matrix4()
    .makeBasis(...(parent.axes.map((p) => new Vector3(...p)) as [Vector3, Vector3, Vector3]))
    .setPosition(new Vector3(...parent.position))
  function Probe() {
    const node = useScene((s) => s.nodes[light.id]) as unknown as StringLightNode
    return createElement(
      'group',
      { matrixAutoUpdate: false, matrix },
      createElement(LightRenderer, { node }),
    )
  }
  const renderer = await create(createElement(Probe))
  const bulbs = () => {
    const result: Vector3[] = []
    renderer.scene.instance.updateMatrixWorld(true)
    renderer.scene.instance.traverse((object) => {
      const mesh = object as import('three').InstancedMesh
      if (!mesh.isInstancedMesh || !mesh.geometry.hasAttribute('lightEmission')) return
      for (let i = 0; i < mesh.count; i++) {
        const at = new Matrix4()
        mesh.getMatrixAt(i, at)
        result.push(new Vector3().setFromMatrixPosition(at).applyMatrix4(mesh.matrixWorld))
      }
    })
    return result
  }
  const advance = () =>
    act(async () => {
      await renderer.advanceFrames(3, 1 / 60)
    })
  try {
    await advance()
    const initial = bulbs()
    close(initial, world())
    for (const entries of [
      [[host.id, { position: [3, 0, -1] }]],
      [[light.id, { position: [3, 0, -1] }]],
      [
        [host.id, { position: [3, 0, -1] }],
        [light.id, { position: [3, 0, -1] }],
      ],
    ] as Array<Array<[string, Record<string, unknown>]>>) {
      await act(async () => {
        useLiveNodeOverrides.getState().setMany(entries)
      })
      await advance()
      const offset = new Vector3(...transformPoint(parent, [1, 0, 0])).sub(
        new Vector3(...parent.position),
      )
      close(
        bulbs(),
        initial.map((p) => p.clone().add(offset)),
      )
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      await act(async () => {
        useLiveNodeOverrides.getState().clearAll()
      })
      await advance()
      close(bulbs(), initial)
    }
    await act(async () => {
      useScene.getState().updateNode(host.id, { position: [6, 1, 2], scale: [3, 2, 1] })
    })
    await advance()
    close(bulbs(), world())
    await act(async () => {
      useLiveNodeOverrides.getState().set(light.id, { region: [3, 4, 3], count: 65 })
    })
    await advance()
    const preview = bulbs()
    expect(preview).toHaveLength(65)
    await act(async () => {
      updateLight(light.id, { region: [3, 4, 3], count: 65 })
      useLiveNodeOverrides.getState().clearAll()
    })
    await advance()
    close(bulbs(), preview)
    close(bulbs(), world())
  } finally {
    await renderer.unmount()
    globals.IS_REACT_ACT_ENVIRONMENT = savedAct
    sceneRegistry.nodes.clear()
    objects.forEach((object, id) => sceneRegistry.nodes.set(id, object))
  }
})

test('built-in tree height changes reuse its public attachment provider for the complete scatter region', () => {
  if (!nodeRegistry.has('trees:tree')) registerNode(treeDefinition as never)
  const tree = TreeNode.parse({ parentId: level.id, height: 3, position: [0, 0, 0] })
  useScene.getState().createNode(tree as never, level.id)
  const cloud = commitLight(
    {
      mode: 'scatter',
      surfaceTargets: [tree.id],
      region: [2, 3, 2],
      count: 20,
      distribution: 'count',
    },
    level.id,
  )
  const before = makeLayout(resolved(cloud)).bulbs
  expect(cloud.scatterAttachment?.points.every((p) => p.attachment?.kind === 'trees%3Atree')).toBe(
    true,
  )
  useScene.getState().updateNode(tree.id as never, { height: 6 } as never)
  const after = makeLayout(resolved(cloud)).bulbs
  close(
    after.map((b) => new Vector3(...b.position)),
    before.map((b) => new Vector3(...b.position).multiplyScalar(2)),
  )
  expect(resolved(cloud).bulbSize).toBe(cloud.bulbSize)
})
