import { afterEach, beforeEach, expect, test } from 'bun:test'
import { nodeRegistry, registerNode } from '../registry/registry'
import { ItemNode } from '../schema'
import {
  NODE_COPY_EXTENSION,
  type NodeCopyExtension,
  finalizeNodeCopy,
  snapshotNodeForCopy,
} from './node-copy'

let restore: () => void
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
})
afterEach(() => restore())

function registerCopy(extension: NodeCopyExtension) {
  registerNode({
    kind: 'item',
    schemaVersion: 1,
    schema: ItemNode,
    category: 'furnish',
    defaults: () => ({}),
    capabilities: {},
    extensions: { [NODE_COPY_EXTENSION]: extension },
  })
}

const item = () =>
  ItemNode.parse({
    asset: { id: 'asset', name: 'asset', src: '/asset.glb', category: 'furniture', thumbnail: '' },
  })

test('copy hooks materialize external dependencies without rewriting source or graph links', () => {
  const source = item(),
    host = { ...item(), name: 'Visible host' }
  const nodes = { [source.id]: source, [host.id]: host }
  const baseline = JSON.stringify(nodes)
  const clone = { ...source, id: 'item_copy' as typeof source.id }
  registerCopy({
    snapshot: (_, context) => ({ name: context[host.id]!.name }),
    finalize: (snapshot, copy, ids) => ({
      metadata: { copiedName: snapshot.name, copiedId: ids.get(source.id), cloneName: copy.name },
    }),
  })
  const snapshot = snapshotNodeForCopy(source, nodes)
  host.name = 'Changed after copy'
  const finalized = finalizeNodeCopy(snapshot, clone, new Map([[source.id, clone.id]]))
  expect(finalized.metadata).toEqual({
    copiedName: 'Visible host',
    copiedId: clone.id,
    cloneName: clone.name,
  })
  expect(finalized.id).toBe(clone.id)
  expect(finalized.parentId).toBe(clone.parentId)
  expect(clone.metadata).toEqual(source.metadata)
  host.name = 'Visible host'
  expect(JSON.stringify(nodes)).toBe(baseline)
})

for (const field of ['id', 'type', 'parentId', 'children']) {
  test(`copy hooks cannot replace graph field ${field}`, () => {
    const source = item()
    const patch = { [field]: null }
    registerCopy({ snapshot: () => patch, finalize: () => patch })
    expect(() => snapshotNodeForCopy(source, {})).toThrow('cannot change graph links')
    expect(() => finalizeNodeCopy(source, { ...source }, new Map())).toThrow(
      'cannot change graph links',
    )
  })
}

test('unregistered node copy is unchanged', () => {
  const source = item()
  expect(snapshotNodeForCopy(source, {})).toBe(source)
  expect(finalizeNodeCopy(source, source, new Map())).toBe(source)
})
