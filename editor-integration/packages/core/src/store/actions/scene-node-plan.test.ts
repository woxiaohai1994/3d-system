import { afterEach, beforeEach, expect, test } from 'bun:test'
import { nodeRegistry } from '../../registry/registry'
import { GutterNode } from '../../schema/nodes/gutter'
import { RoofNode } from '../../schema/nodes/roof'
import { RoofSegmentNode } from '../../schema/nodes/roof-segment'
import type { SceneSnapshot } from '../history-control'
import { subscribeSceneCommits } from '../history-control'
import useScene, { clearSceneHistory } from '../use-scene'
import { planSceneNodeChanges, type SceneNodeChanges } from './node-actions'

let saved: ReturnType<typeof useScene.getState>
let restore: () => void
let roof: RoofNode, segment: RoofSegmentNode
let raf: typeof requestAnimationFrame, cancelRaf: typeof cancelAnimationFrame
const snapshot = (): SceneSnapshot => {
  const { nodes, rootNodeIds, collections, materials, installedPlugins } = useScene.getState()
  return { nodes, rootNodeIds, collections, materials, installedPlugins }
}
beforeEach(() => {
  saved = useScene.getState()
  restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
  raf = globalThis.requestAnimationFrame
  cancelRaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  roof = RoofNode.parse({})
  segment = RoofSegmentNode.parse({ parentId: roof.id })
  roof.children = [segment.id]
  useScene.setState({
    nodes: { [roof.id]: roof, [segment.id]: segment },
    rootNodeIds: [roof.id],
    collections: {},
    materials: {},
    installedPlugins: [],
    readOnly: false,
    dirtyNodes: new Set(),
  })
  clearSceneHistory()
})
afterEach(async () => {
  await Promise.resolve()
  useScene.setState(saved)
  clearSceneHistory()
  restore()
  globalThis.requestAnimationFrame = raf
  globalThis.cancelAnimationFrame = cancelRaf
})
const changes = (): SceneNodeChanges => ({
  update: [{ id: segment.id, data: { metadata: { autoGutter: true } } }],
})
function freeze(value: unknown) {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value)) freeze(child)
  }
}

test('detached native planning preserves frozen input and publishes no scene, commit or history', () => {
  const before = snapshot()
  const input = structuredClone(before)
  freeze(input)
  const commits: unknown[] = []
  const off = subscribeSceneCommits((commit) => commits.push(commit))
  try {
    const plan = planSceneNodeChanges(input, changes())
    expect(input).toEqual(before)
    expect(snapshot()).toEqual(before)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(commits).toHaveLength(0)
    expect(plan.generatedIds).toHaveLength(6)
    expect(Object.values(plan.scene.nodes).filter((n) => n.type === 'gutter')).toHaveLength(2)
    expect(Object.values(plan.scene.nodes).filter((n) => n.type === 'downspout')).toHaveLength(2)
    const replay = planSceneNodeChanges(input, { ...changes(), generatedIds: plan.generatedIds })
    expect(replay.scene).toEqual(plan.scene)
    useScene.getState().applyNodeChanges({ ...changes(), generatedIds: plan.generatedIds })
    expect(snapshot()).toEqual({ ...before, ...plan.scene })
    expect(commits).toHaveLength(1)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(snapshot()).toEqual(before)
    useScene.temporal.getState().redo()
    expect(snapshot()).toEqual({ ...before, ...plan.scene })
  } finally {
    off()
  }
})

test.each([
  'missing',
  'extra',
  'duplicate',
  'wrong-prefix',
  'collision',
])('invalid %s generated IDs reject before publishing', (kind) => {
  const plan = planSceneNodeChanges(snapshot(), changes())
  const ids = [...plan.generatedIds]
  if (kind === 'missing') ids.pop()
  if (kind === 'extra') ids.push(ids[0]!)
  if (kind === 'duplicate') ids[1] = ids[0]!
  if (kind === 'wrong-prefix') ids[0] = segment.id
  if (kind === 'collision') {
    const gutter = GutterNode.parse({ id: ids[0], parentId: segment.id })
    useScene.getState().createNode(gutter)
  }
  clearSceneHistory()
  const before = snapshot()
  expect(() => useScene.getState().applyNodeChanges({ ...changes(), generatedIds: ids })).toThrow(
    'INVALID_DERIVED_IDS',
  )
  expect(snapshot()).toEqual(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})

test('manual mutation and detached planning agree on generated gutter and downspout geometry', () => {
  const plan = planSceneNodeChanges(snapshot(), changes())
  useScene.getState().updateNode(segment.id, { metadata: { autoGutter: true } })
  const geometry = (nodes: SceneSnapshot['nodes']) =>
    Object.values(nodes).flatMap((n) => {
      if (n.type === 'gutter')
        return [
          {
            type: n.type,
            position: n.position,
            rotation: n.rotation,
            length: n.length,
            outlets: n.outlets.map((o) => ({ offset: o.offset, diameter: o.diameter })),
          },
        ]
      if (n.type === 'downspout')
        return [{ type: n.type, length: n.length, diameter: n.diameter, lengthMode: n.lengthMode }]
      return []
    })
  expect(geometry(snapshot().nodes)).toEqual(geometry(plan.scene.nodes))
})
