import { afterEach, beforeEach, expect, test } from 'bun:test'
import { z } from 'zod'
import { nodeRegistry, registerNode } from '../../registry/registry'
import { BaseNode, nodeType, objectId } from '../../schema/base'
import type { AnyNode } from '../../schema/types'
import { NODE_UPDATE_EXTENSION, type NodeUpdateReconciler } from '../../services/node-update'
import useScene from '../use-scene'

const schema = BaseNode.extend({
  id: objectId('reconciled'),
  type: nodeType('reconciled'),
  value: z.number(),
  derived: z.number().default(0),
}).meta({ strictMutations: true })
const first = schema.parse({ value: 1 }),
  second = schema.parse({ value: 2 })
let reconcile: NodeUpdateReconciler<z.infer<typeof schema>>
let restore: () => void, state: ReturnType<typeof useScene.getState>
let raf: typeof requestAnimationFrame, caf: typeof cancelAnimationFrame
beforeEach(() => {
  state = useScene.getState()
  restore = nodeRegistry._snapshot()
  raf = globalThis.requestAnimationFrame
  caf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  registerNode({
    kind: 'reconciled',
    schemaVersion: 1,
    schema,
    category: 'furnish',
    defaults: () => ({}),
    capabilities: {},
    extensions: {
      [NODE_UPDATE_EXTENSION]: (input: Parameters<typeof reconcile>[0]) => reconcile(input),
    },
  })
  useScene.setState({
    nodes: { [first.id]: first as unknown as AnyNode, [second.id]: second as unknown as AnyNode },
    rootNodeIds: [],
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
})
afterEach(() => {
  useScene.setState(state)
  useScene.temporal.getState().clear()
  restore()
  globalThis.requestAnimationFrame = raf
  globalThis.cancelAnimationFrame = caf
})

for (const atomic of [false, true]) {
  const write = (updates: unknown) =>
    atomic
      ? useScene.getState().applyNodeChanges({ update: updates as never })
      : useScene.getState().updateNodes(updates as never)
  test(`reconciliation sees final batch, keeps inputs immutable and stays in one history entry (${atomic})`, () => {
    let calls = 0
    const before = useScene.getState().nodes,
      serialized = JSON.stringify(before)
    reconcile = ({ nextNodes, next }) => {
      calls++
      const other = nextNodes[next.id === first.id ? second.id : first.id] as unknown as z.infer<
        typeof schema
      >
      return { derived: other.value }
    }
    write([
      { id: first.id, data: { value: 3 } },
      { id: first.id, data: { value: 4 } },
      { id: second.id, data: { value: 5 } },
    ])
    expect(calls).toBe(2)
    expect(JSON.stringify(before)).toBe(serialized)
    expect((useScene.getState().nodes[first.id as never] as any).derived).toBe(5)
    expect((useScene.getState().nodes[second.id as never] as any).derived).toBe(4)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(before)
    useScene.temporal.getState().redo()
    expect(calls).toBe(2)
  })
  test(`invalid derived fields or graph changes reject the entire batch (${atomic})`, () => {
    const before = useScene.getState().nodes
    for (const data of [{ parentId: second.id }, { value: 'bad' }]) {
      reconcile = () => data as never
      expect(() => write([{ id: first.id, data: { value: 3 } }])).toThrow()
      expect(useScene.getState().nodes).toBe(before)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    }
  })
}
