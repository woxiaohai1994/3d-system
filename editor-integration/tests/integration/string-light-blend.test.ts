import { afterEach, beforeEach, expect, test } from 'bun:test'
import { type AnyNodeId, LevelNode, nodeRegistry, registerNode, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { stringLightDefinition } from '../../../string-lights-plugin/src/definition'
import { commitLight, updateLight } from '../../../string-lights-plugin/src/commands'
import { commitBlend, createBlendNodes, detachBlend } from '../../../string-lights-plugin/src/blend-commands'
import { liveLightContext, resolveLightNode } from '../../../string-lights-plugin/src/resolved-light'
import { LIGHT_KIND, type StringLightNode } from '../../../string-lights-plugin/src/schema'
import { stringLightsAI } from '../../../string-lights-plugin/src/ai'

const saved = useScene.getState()
const level = LevelNode.parse({ level: 0 })
let a: StringLightNode, b: StringLightNode, restore: () => void
let raf: typeof requestAnimationFrame, cancelRaf: typeof cancelAnimationFrame
const get = (id: string) => useScene.getState().nodes[id as AnyNodeId] as unknown as StringLightNode
const resolve = (id: string) => resolveLightNode(get(id), liveLightContext()).node
beforeEach(() => {
  raf = globalThis.requestAnimationFrame; cancelRaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0; globalThis.cancelAnimationFrame = () => {}
  restore = nodeRegistry._snapshot()
  if (!nodeRegistry.has(LIGHT_KIND)) registerNode(stringLightDefinition as never)
  useScene.setState({ nodes: { [level.id]: level }, rootNodeIds: [level.id], readOnly: false })
  useScene.temporal.getState().resume()
  a = commitLight({ points: [[0, 2, 0], [4, 2, 0]], sag: 0.2, bulbSize: 0.045, spacing: 0.35, colors: ['#ffffff', '#ff0000'] }, level.id, 'A')
  b = commitLight({ points: [[0, 4, 0], [4, 4, 0]], position: [0, 0, 4], sag: 0.6 }, level.id, 'B')
  useScene.temporal.getState().clear()
})
afterEach(() => {
  for (const id of Object.keys(useScene.getState().nodes)) useLiveNodeOverrides.getState().clear(id)
  useScene.temporal.getState().resume(); useScene.temporal.getState().clear()
  useScene.setState(saved); restore()
  globalThis.requestAnimationFrame = raf; globalThis.cancelAnimationFrame = cancelRaf
})

test('blend preview is read-only and batch creation is one undo with fixed product settings', () => {
  const preview = createBlendNodes(a.id, b.id, 3, false, liveLightContext())
  expect(Object.keys(useScene.getState().nodes)).toHaveLength(3)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  expect(preview[1]!.points).toEqual([[0, 3, 2], [4, 3, 2]])
  const generated = commitBlend(a.id, b.id, 3, false)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  for (const n of generated) expect([n.bulbSize, n.spacing, n.colors, n.seed]).toEqual([a.bulbSize, a.spacing, a.colors, a.seed])
  useScene.temporal.getState().undo()
  expect(Object.keys(useScene.getState().nodes)).toHaveLength(3)
  useScene.temporal.getState().redo()
  expect(get(generated[1]!.id)).toEqual(generated[1]!)
})

test('boundary edits and previews follow without changing product facts; local sag and detachment remain editable', () => {
  const n = commitBlend(a.id, b.id, 1, false)[0]!
  useLiveNodeOverrides.getState().set(b.id, { position: [0, 0, 8], sag: 1 })
  expect(resolve(n.id).points[0]).toEqual([0, 3, 4])
  expect(resolve(n.id).sag).toBeCloseTo(0.6)
  useLiveNodeOverrides.getState().clear(b.id)
  updateLight(b.id, { position: [0, 0, 6], sag: 1 })
  updateLight(n.id, { spanSag: [0.3] })
  expect(get(n.id).blend?.followSag).toBe(false)
  expect(resolve(n.id).spanSag).toEqual([0.3])
  updateLight(b.id, { sag: 2 })
  expect(resolve(n.id).spanSag).toEqual([0.3])
  updateLight(n.id, { blend: { ...n.blend!, followSag: true } })
  const current = resolve(n.id)
  const detached = updateLight(n.id, { points: [[0, 5, 3], current.points[1]!], anchors: [] })
  expect(detached.blend).toBeNull()
  expect(detached.sag).toBeCloseTo(1.1)
  updateLight(b.id, { position: [0, 0, 10] })
  expect(resolve(n.id).points).toEqual(detached.points)
})

test('deleting a source freezes current intermediate paths in the same undo transaction', () => {
  const n = commitBlend(a.id, b.id, 1, false)[0]!
  updateLight(b.id, { position: [0, 0, 8], sag: 1 })
  const current = resolve(n.id)
  useScene.temporal.getState().clear()
  useScene.getState().deleteNodes([a.id as AnyNodeId])
  expect(get(n.id).blend).toBeNull()
  expect(get(n.id).points).toEqual(current.points)
  expect(get(n.id).sag).toEqual(current.sag)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(get(n.id).blend).toEqual(n.blend)
  expect(get(a.id)).toBeDefined()
  detachBlend(get(n.id))
  expect(resolve(n.id).points).toEqual(current.points)
})

test('incompatible references, cycles, count limits and read-only edits reject without partial mutations', () => {
  expect(() => commitBlend(a.id, a.id, 2, false)).toThrow()
  expect(() => commitBlend(a.id, b.id, 31, false)).toThrow()
  const n = commitBlend(a.id, b.id, 1, false)[0]!
  const before = useScene.getState().nodes
  expect(() => updateLight(a.id, { mode: 'scatter' })).toThrow()
  expect(() => updateLight(a.id, { closed: true })).toThrow()
  expect(() => updateLight(a.id, { blend: { ...n.blend!, fromId: n.id } })).toThrow()
  expect(useScene.getState().nodes).toBe(before)
  useScene.setState({ readOnly: true })
  expect(() => commitBlend(a.id, b.id, 1, false)).toThrow()
})

test('AI stages blend nodes without mutating and carries detach semantics into its update patch', () => {
  const context = { nodes: useScene.getState().nodes, levelId: level.id, selectedIds: [] }
  const ops = stringLightsAI.prepare('blend', { fromId: a.id, toId: b.id, count: 2 }, context)
  expect(ops).toHaveLength(2)
  expect(ops.every((op) => op.op === 'create')).toBe(true)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  const n = commitBlend(a.id, b.id, 1, false)[0]!
  updateLight(b.id, { position: [0, 0, 8], sag: 1 })
  const updated = stringLightsAI.prepare('update', { nodeId: n.id, points: [[0, 3, 4], [5, 3, 4]] }, { ...context, nodes: useScene.getState().nodes })
  expect(updated[0]).toMatchObject({ op: 'update', data: { blend: null } })
  if (updated[0]?.op === 'update') expect((updated[0].data as { sag: number }).sag).toBeCloseTo(0.6)
})
