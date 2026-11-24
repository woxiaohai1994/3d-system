import { afterEach, beforeEach, expect, test } from 'bun:test'
import { nodeRegistry, registerNode } from '../registry/registry'
import { ItemNode } from '../schema'
import { NODE_REFERENCE_PATHS_EXTENSION, remapRegisteredNodeReferences } from './node-references'

let restore: () => void
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
})
afterEach(() => restore())
function registerReferences(paths: unknown) {
  registerNode({
    kind: 'item',
    schemaVersion: 1,
    schema: ItemNode,
    category: 'furnish',
    defaults: () => ({}),
    capabilities: {},
    extensions: { [NODE_REFERENCE_PATHS_EXTENSION]: paths },
  })
}
test('declared nested references remap immutably without touching opaque strings or external IDs', () => {
  registerReferences([
    ['metadata', 'refs', '*', 'target'],
    ['metadata', 'optional', 'target'],
  ])
  const node = ItemNode.parse({
    name: 'item_old',
    metadata: {
      refs: [{ target: 'item_old', label: 'item_old' }, { target: 'item_external' }, null],
    },
    asset: { id: 'asset', name: 'asset', src: '/asset.glb', category: 'furniture', thumbnail: '' },
  })
  const baseline = JSON.stringify(node)
  const result = remapRegisteredNodeReferences(node, new Map([['item_old', 'item_new']]))
  expect(result.metadata).toEqual({
    refs: [{ target: 'item_new', label: 'item_old' }, { target: 'item_external' }, null],
  })
  expect(result.name).toBe('item_old')
  expect(JSON.stringify(node)).toBe(baseline)
})
for (const path of [
  ['id'],
  ['parentId'],
  ['children', '*'],
  ['*'],
  ['metadata', '__proto__', 'target'],
  [],
])
  test(`invalid reference declaration is rejected: ${JSON.stringify(path)}`, () => {
    registerReferences([path])
    expect(() => remapRegisteredNodeReferences({ type: 'item' } as never, new Map())).toThrow()
  })
test('unregistered node payload is preserved without guessing reference fields', () => {
  const node = { type: 'custom', name: 'old', target: 'old' } as never
  expect(remapRegisteredNodeReferences(node, new Map([['old', 'new']]))).toBe(node)
})
