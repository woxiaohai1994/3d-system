import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  ItemNode,
  LevelNode,
  cloneNodesInto,
  createSceneApi,
  nodeRegistry,
  registerNode,
  useScene,
} from '@pascal-app/core'
import { cloneLevelSubtree, cloneSceneGraph } from '@pascal-app/core/clone-scene-graph'
import { useViewer } from '@pascal-app/viewer'
import {
  duplicateNodesToLevel,
  copySelectedNodesToEditorClipboard,
  pasteSystemEditorClipboardToLevel,
  pasteEditorClipboardToLevel,
} from '../../packages/editor/src/lib/scene-clipboard'
import { stringLightDefinition } from '../../../string-lights-plugin/src/definition'
import { commitLight } from '../../../string-lights-plugin/src/commands'
import { commitBlend } from '../../../string-lights-plugin/src/blend-commands'
import { type StringLightNode, isStringLight } from '../../../string-lights-plugin/src/schema'
import { planLightContext } from '../../../string-lights-plugin/src/plan-light'
import { resolveLightNode } from '../../../string-lights-plugin/src/resolved-light'
import { resolveLightPoints } from '../../../string-lights-plugin/src/surface-anchors'
import { Group, Vector3 } from 'three'

let restore: () => void,
  saved: ReturnType<typeof useScene.getState>,
  viewer: ReturnType<typeof useViewer.getState>
let raf: typeof requestAnimationFrame, caf: typeof cancelAnimationFrame
let level: ReturnType<typeof LevelNode.parse>, host: ReturnType<typeof ItemNode.parse>
let a: StringLightNode, b: StringLightNode, blend: StringLightNode
beforeEach(() => {
  saved = useScene.getState()
  viewer = useViewer.getState()
  restore = nodeRegistry._snapshot()
  raf = globalThis.requestAnimationFrame
  caf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  if (!nodeRegistry.has(stringLightDefinition.kind)) registerNode(stringLightDefinition as never)
  level = LevelNode.parse({ level: 0 })
  host = ItemNode.parse({
    parentId: level.id,
    asset: { id: 'post', name: 'Post', src: '/post.glb', thumbnail: '', category: 'furniture' },
  })
  level.children = [host.id]
  useScene.setState({
    nodes: { [level.id]: level, [host.id]: host },
    rootNodeIds: [level.id],
    readOnly: false,
  })
  const points = [
    [0, 2, 0],
    [4, 2, 0],
  ]
  a = commitLight(
    {
      points,
      anchors: points.map((p, index) => ({
        index,
        nodeId: host.id,
        localPosition: p,
        referencePosition: p,
      })),
      surfaceTargets: [host.id],
      spacing: 0.35,
      bulbSize: 0.045,
    },
    level.id,
    host.id,
  )
  b = commitLight({ points, position: [0, 0, 4] }, level.id, 'B')
  blend = commitBlend(a.id, b.id, 1, false)[0]!
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
})
afterEach(() => {
  useScene.setState(saved)
  useScene.temporal.getState().clear()
  useViewer.setState(viewer)
  restore()
  globalThis.requestAnimationFrame = raf
  globalThis.cancelAnimationFrame = caf
})

for (const flow of ['scene', 'level', 'subtree', 'clipboard'] as const)
  test(`${flow} cloning remaps light supports and blend boundaries to independent copies`, () => {
    const before = useScene.getState().nodes,
      serialized = JSON.stringify(before)
    let copies: AnyNode[]
    if (flow === 'scene')
      copies = Object.values(cloneSceneGraph({ nodes: before, rootNodeIds: [level.id] }).nodes)
    else if (flow === 'level') copies = cloneLevelSubtree(before, level.id).clonedNodes
    else if (flow === 'subtree')
      copies = cloneNodesInto(Object.values(before), { rootId: level.id }).nodes
    else {
      const result = duplicateNodesToLevel(
        [host.id, a.id, b.id, blend.id] as AnyNodeId[],
        level.id,
      )!
      expect(result.skippedIds).toEqual([])
      copies = Object.values(useScene.getState().nodes).filter((n) => !before[n.id])
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      useScene.temporal.getState().undo()
      expect(useScene.getState().nodes).toEqual(before)
      useScene.temporal.getState().redo()
    }
    expect(JSON.stringify(before)).toBe(serialized)
    const copiedHost = copies.find((n) => n.type === 'item')!
    const lights = copies.filter(isStringLight)
    const copiedA = lights.find((n) => n.name === host.id)!,
      copiedB = lights.find((n) => n.name === 'B')!,
      copiedBlend = lights.find((n) => n.blend)!
    expect(copiedA.anchors.map((p) => p.nodeId)).toEqual([copiedHost.id, copiedHost.id])
    expect(copiedA.anchors.map((p) => p.attachment?.nodeId)).toEqual([copiedHost.id, copiedHost.id])
    expect(copiedA.surfaceTargets).toEqual([copiedHost.id])
    expect(copiedBlend.surfaceTargets).toEqual([copiedHost.id])
    expect(copiedA.name).toBe(host.id)
    expect(copiedA.spacing).toBe(a.spacing)
    expect(copiedA.bulbSize).toBe(a.bulbSize)
    expect(copiedBlend.blend).toEqual({ ...blend.blend!, fromId: copiedA.id, toId: copiedB.id })
    const nodes = JSON.parse(
      JSON.stringify({ ...before, ...Object.fromEntries(copies.map((n) => [n.id, n])) }),
    ) as Record<string, AnyNode>
    nodes[copiedHost.id] = { ...copiedHost, position: [2, 0, 0] } as AnyNode
    const resolve = (light: StringLightNode) =>
      resolveLightNode(
        light,
        planLightContext(light, (id) => nodes[id]),
      )
    expect(resolve(copiedA).node.points).toEqual([
      [2, 2, 0],
      [6, 2, 0],
    ])
    expect(resolve(a).node.points).toEqual([
      [0, 2, 0],
      [4, 2, 0],
    ])
    expect(resolve(copiedBlend).warning).toBeUndefined()
    expect(resolve(copiedBlend).node.points).toEqual([
      [1, 2, 2],
      [5, 2, 2],
    ])
    expect(resolve(blend).node.points).toEqual([
      [0, 2, 2],
      [4, 2, 2],
    ])
  })

test('copying only a light on the same level preserves its external host binding', () => {
  const result = duplicateNodesToLevel([a.id] as AnyNodeId[], level.id)!
  const copy = useScene.getState().nodes[result.pastedIds[0]!] as unknown as StringLightNode
  expect(copy.anchors).toEqual(a.anchors)
  expect(copy.surfaceTargets).toEqual([host.id])
  useScene.getState().updateNode(host.id, { position: [1, 0, 0] })
  const nodes = useScene.getState().nodes
  expect(planLightContext(copy, (id) => nodes[id as AnyNodeId]).points!(copy)).toEqual([
    [1, 2, 0],
    [5, 2, 0],
  ])
})

test('system clipboard accepts registered plugin schemas and rejects malformed plugin data', async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  let text = ''
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        text = value
      },
      readText: async () => text,
    },
  })
  try {
    expect(copySelectedNodesToEditorClipboard([host.id, a.id] as AnyNodeId[])).toBe(true)
    const result = await pasteSystemEditorClipboardToLevel(level.id)
    expect(result?.skippedIds).toEqual([])
    expect(result?.pastedIds).toHaveLength(2)
    const copies = result!.pastedIds.map((id) => useScene.getState().nodes[id]!)
    const copiedLight = copies.find(isStringLight)!
    expect(copiedLight.anchors[0]?.nodeId).toBe(copies.find((n) => n.type === 'item')!.id)
    const before = useScene.getState().nodes
    const envelope = JSON.parse(text)
    envelope.payload.nodes.find((n: AnyNode) => isStringLight(n)).bulbSize = 'invalid'
    text = JSON.stringify(envelope)
    expect(await pasteSystemEditorClipboardToLevel(level.id)).toBeNull()
    expect(useScene.getState().nodes).toBe(before)
  } finally {
    if (previous) Object.defineProperty(navigator, 'clipboard', previous)
    else Reflect.deleteProperty(navigator, 'clipboard')
  }
})

test('cross-level paste freezes the copy-time shape and detaches hosts that were not copied', () => {
  const upper = LevelNode.parse({ level: 1, baseElevation: 3 })
  useScene.getState().createNode(upper)
  useScene.getState().updateNode(host.id, { position: [2, 0, 0] })
  copySelectedNodesToEditorClipboard([a.id] as AnyNodeId[])
  useScene.getState().updateNode(host.id, { position: [9, 0, 0] })
  useScene.temporal.getState().clear()
  const before = useScene.getState().nodes
  const result = pasteEditorClipboardToLevel(upper.id)!
  const copy = useScene.getState().nodes[result.pastedIds[0]!] as unknown as StringLightNode
  expect(copy.anchors).toEqual([])
  expect(copy.surfaceTargets).toEqual([])
  expect(copy.points).toEqual([
    [2, 2, 0],
    [6, 2, 0],
  ])
  expect(copy.parentId).toBe(upper.id)
  expect([copy.spacing, copy.bulbSize, copy.colors]).toEqual([a.spacing, a.bulbSize, a.colors])
  const object = new Group(),
    parent = new Group()
  parent.position.y = 3
  parent.add(object)
  const points = resolveLightPoints(copy, object, () => undefined)
  expect(points).toEqual(copy.points)
  expect(object.localToWorld(new Vector3(...points[0]!)).toArray()).toEqual([2, 5, 0])
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(before)
  useScene.temporal.getState().redo()
  expect(JSON.parse(JSON.stringify(useScene.getState().nodes[copy.id as AnyNodeId]))).toEqual(copy)
})

test('cross-level clipboard keeps copied supports and freezes a blend copied without its boundaries', () => {
  const upper = LevelNode.parse({ level: 1 })
  useScene.getState().createNode(upper)
  useScene.getState().updateNode(host.id, { position: [2, 0, 0] })
  const result = duplicateNodesToLevel([host.id, a.id, b.id, blend.id] as AnyNodeId[], upper.id)!
  const nodes = useScene.getState().nodes
  const copies = result.pastedIds.map((id) => nodes[id]!)
  const copyHost = copies.find((n) => n.type === 'item')!
  const copyA = copies.find(
    (n) => isStringLight(n) && n.name === host.id,
  ) as unknown as StringLightNode
  const copyBlend = copies.find((n) => isStringLight(n) && n.blend) as unknown as StringLightNode
  expect(copyA.anchors.every((p) => p.nodeId === copyHost.id)).toBe(true)
  expect(copyA.surfaceTargets).toEqual([copyHost.id])
  expect(copyBlend.surfaceTargets).toEqual([copyHost.id])
  expect(planLightContext(copyA, (id) => nodes[id as AnyNodeId]).points!(copyA)).toEqual([
    [2, 2, 0],
    [6, 2, 0],
  ])
  expect(
    resolveLightNode(
      copyBlend,
      planLightContext(copyBlend, (id) => nodes[id as AnyNodeId]),
    ).node.points,
  ).toEqual([
    [1, 2, 2],
    [5, 2, 2],
  ])
  const isolated = duplicateNodesToLevel([blend.id] as AnyNodeId[], upper.id)!
  const detached = useScene.getState().nodes[isolated.pastedIds[0]!] as unknown as StringLightNode
  expect(detached.blend).toBeNull()
  expect(detached.surfaceTargets).toEqual([])
  expect(detached.points).toEqual([
    [1, 2, 2],
    [5, 2, 2],
  ])
})

test('scene API subtree cloning snapshots external host movement before changing containers', () => {
  const upper = LevelNode.parse({ level: 1 })
  useScene.getState().createNode(upper)
  useScene.getState().updateNode(host.id, { position: [3, 0, 0] })
  const id = createSceneApi(useScene).cloneNodesInto([a as unknown as AnyNode], {
    rootId: a.id as AnyNodeId,
    parentId: upper.id,
  })!
  const copy = useScene.getState().nodes[id] as unknown as StringLightNode
  expect(copy.anchors).toEqual([])
  expect(copy.points).toEqual([
    [3, 2, 0],
    [7, 2, 0],
  ])
})

test('cross-level partial copies keep only the interaction targets copied with the light', () => {
  const upper = LevelNode.parse({ level: 1 })
  useScene.getState().createNode(upper)
  const external = ItemNode.parse({ ...host, id: 'item_external-surface', position: [8, 0, 0] })
  useScene.getState().createNode(external)
  useScene
    .getState()
    .updateNode(a.id as AnyNodeId, { surfaceTargets: [host.id, external.id] } as never)
  const result = duplicateNodesToLevel([host.id, a.id] as AnyNodeId[], upper.id)!
  const copies = result.pastedIds.map((id) => useScene.getState().nodes[id]!)
  const copiedHost = copies.find((node) => node.type === 'item')!
  const copiedLight = copies.find(isStringLight)!
  expect(copiedLight.surfaceTargets).toEqual([copiedHost.id])
  expect(
    (useScene.getState().nodes[a.id as AnyNodeId] as unknown as StringLightNode).surfaceTargets,
  ).toEqual([host.id, external.id])
})
