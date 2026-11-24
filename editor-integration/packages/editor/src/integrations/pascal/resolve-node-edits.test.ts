import { afterEach, beforeEach, expect, test } from 'bun:test'
import { BuildingNode, nodeRegistry, SiteNode, useScene, WallNode } from '@pascal-app/core'
import type { SceneEditOperation } from '../contracts/scene-edit'
import { resolveNodeEdits } from './resolve-node-edits'
import { SceneEditAdapter } from './scene-edit-adapter'

const saved = useScene.getState()
let adapter: SceneEditAdapter
let building: BuildingNode
let restoreRegistry: () => void
let oldRaf: typeof requestAnimationFrame
let oldCancelRaf: typeof cancelAnimationFrame

beforeEach(() => {
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  oldRaf = globalThis.requestAnimationFrame
  oldCancelRaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const site = SiteNode.parse({})
  building = BuildingNode.parse({ parentId: site.id })
  site.children = [building.id]
  useScene.getState().setScene({ [site.id]: site, [building.id]: building }, [site.id])
  useScene.setState({ readOnly: false })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  adapter = new SceneEditAdapter('id-map')
})

afterEach(() => {
  adapter.dispose()
  restoreRegistry()
  useScene.setState(saved)
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  globalThis.requestAnimationFrame = oldRaf
  globalThis.cancelAnimationFrame = oldCancelRaf
})

function room(): SceneEditOperation[] {
  return [
    { op: 'create', node: { type: 'door', id: '$door', parentId: '$wall', wallId: '$wall' } },
    { op: 'update', id: '$wall', data: { height: 3.2 } },
    {
      op: 'create',
      node: {
        type: 'wall',
        id: '$wall',
        parentId: '$level',
        children: ['$door'],
        start: [0, 0],
        end: [4, 0],
      },
    },
    {
      op: 'create',
      node: { type: 'level', id: '$level', parentId: building.id, children: ['$wall'] },
    },
  ]
}

test('forward temporary IDs bind the whole graph and remain stable through confirmation and undo/redo', () => {
  const before = adapter.read()
  const operations = room()
  const original = structuredClone(operations)
  const preview = adapter.prepare({ ...before, requestId: 'room', operations })
  const ids = preview.nodeIdMap
  expect(Object.isFrozen(ids)).toBe(true)
  expect(operations).toEqual(original)
  expect(adapter.read()).toEqual(before)
  expect(new Set(Object.values(ids)).size).toBe(3)
  expect(ids.$door).toMatch(/^door_/)
  expect(ids.$wall).toMatch(/^wall_/)
  expect(ids.$level).toMatch(/^level_/)
  const receipt = adapter.commit(preview)
  expect(receipt.nodeIdMap).toEqual(ids)
  expect(receipt.createdIds).toEqual([ids.$level!, ids.$wall!, ids.$door!])
  expect(useScene.getState().nodes[ids.$door!]!).toMatchObject({
    parentId: ids.$wall,
    wallId: ids.$wall,
  })
  expect(useScene.getState().nodes[ids.$wall!]!).toMatchObject({
    parentId: ids.$level,
    height: 3.2,
    children: [ids.$door],
  })
  const after = adapter.read().scene
  expect(useScene.temporal.getState().pastStates.length).toBe(1)
  expect(adapter.commit(preview)).toBe(receipt)
  useScene.temporal.getState().undo()
  expect(adapter.read().scene).toEqual(before.scene)
  useScene.temporal.getState().redo()
  expect(adapter.read().scene).toEqual(after)
})

test('known reference fields are remapped while names, assets, materials and metadata stay verbatim', () => {
  const preview = adapter.prepare({
    ...adapter.read(),
    requestId: 'literal-content',
    operations: [
      ...room(),
      {
        op: 'create',
        node: {
          type: 'item',
          id: '$item',
          parentId: '$level',
          name: '$wall',
          metadata: { parentId: '$wall', nodeId: '$door' },
          slots: { body: '$wall' },
          asset: {
            id: '$wall',
            category: '$door',
            name: '$level',
            src: '/fixture.glb',
            thumbnail: '',
          },
        },
      },
    ],
  })
  const id = preview.nodeIdMap.$item!
  adapter.commit(preview)
  expect(useScene.getState().nodes[id]).toMatchObject({
    name: '$wall',
    parentId: preview.nodeIdMap.$level,
    metadata: { parentId: '$wall', nodeId: '$door' },
    slots: { body: '$wall' },
    asset: { id: '$wall', category: '$door', name: '$level' },
  })
})

test('maps zone boundaries and unit membership without changing the existing building reference', () => {
  const preview = adapter.prepare({
    ...adapter.read(),
    requestId: 'zones',
    operations: [
      {
        op: 'create',
        node: { type: 'unit', id: '$unit', parentId: building.id, members: ['$zone'] },
      },
      {
        op: 'create',
        node: {
          type: 'zone',
          id: '$zone',
          parentId: '$level',
          name: '客厅',
          polygon: [
            [0, 0],
            [4, 0],
            [4, 4],
          ],
          boundaryWallIds: ['$wall'],
        },
      },
      ...room(),
    ],
  })
  adapter.commit(preview)
  expect(useScene.getState().nodes[preview.nodeIdMap.$unit!]).toMatchObject({
    parentId: building.id,
    members: [preview.nodeIdMap.$zone],
  })
  expect(useScene.getState().nodes[preview.nodeIdMap.$zone!]).toMatchObject({
    boundaryWallIds: [preview.nodeIdMap.$wall],
  })
})

test('maps nested associative measurement references without rewriting feature IDs', () => {
  const preview = adapter.prepare({
    ...adapter.read(),
    requestId: 'measurement',
    operations: [
      {
        op: 'create',
        node: {
          type: 'measurement',
          id: '$measure',
          parentId: '$level',
          measurement: {
            kind: 'distance',
            points: [
              {
                kind: 'feature',
                reference: { nodeId: '$wall', featureId: '$door', parameters: { label: '$wall' } },
                fallback: [0, 0, 0],
              },
              [4, 0, 0],
            ],
          },
        },
      },
      ...room(),
    ],
  })
  adapter.commit(preview)
  expect(useScene.getState().nodes[preview.nodeIdMap.$measure!]).toMatchObject({
    measurement: {
      points: [
        {
          kind: 'feature',
          reference: {
            nodeId: preview.nodeIdMap.$wall,
            featureId: '$door',
            parameters: { label: '$wall' },
          },
          fallback: [0, 0, 0],
        },
        [4, 0, 0],
      ],
    },
  })
})

test('schema IDs use rseg and sseg prefixes rather than guessing from node type strings', () => {
  const resolved = resolveNodeEdits(adapter.read().scene, [
    { op: 'create', node: { type: 'roof-segment', id: '$roofSegment' } },
    { op: 'create', node: { type: 'stair-segment', id: '$stairSegment' } },
  ])
  expect(resolved.nodeIdMap.$roofSegment).toMatch(/^rseg_/)
  expect(resolved.nodeIdMap.$stairSegment).toMatch(/^sseg_/)
  expect(useScene.temporal.getState().pastStates.length).toBe(0)
})

test('anonymous creates receive stable schema defaults, and parentId override resolves', () => {
  const preview = adapter.prepare({
    ...adapter.read(),
    requestId: 'anonymous',
    operations: [
      { op: 'create', node: { type: 'wall', start: [0, 0], end: [2, 0] }, parentId: '$level' },
      { op: 'create', node: { type: 'level', id: '$level', parentId: building.id } },
    ],
  })
  const wall = preview.changes.find((change) => change.after?.type === 'wall')!.after!
  expect(wall.id).toMatch(/^wall_/)
  adapter.commit(preview)
  expect(useScene.getState().nodes[wall.id]!.parentId).toBe(preview.nodeIdMap.$level!)
})

test('unknown temporary nested reference fails the whole batch without recording a request or history', () => {
  const before = adapter.read()
  const operations: SceneEditOperation[] = [
    ...room(),
    {
      op: 'create',
      node: {
        type: 'measurement',
        parentId: '$level',
        measurement: {
          kind: 'distance',
          points: [
            {
              kind: 'feature',
              reference: { nodeId: '$unknown', featureId: 'edge' },
              fallback: [0, 0, 0],
            },
            [1, 0, 0],
          ],
        },
      },
    },
  ]
  expect(() => adapter.prepare({ ...before, requestId: 'retry', operations })).toThrow(
    'INVALID_RELATION',
  )
  expect(adapter.read()).toEqual(before)
  expect(useScene.temporal.getState().pastStates.length).toBe(0)
  expect(() => adapter.prepare({ ...before, requestId: 'retry', operations: room() })).not.toThrow()
})

test('duplicate aliases, existing explicit IDs and malformed aliases reject before writes', () => {
  const before = adapter.read()
  for (const operations of [
    [...room(), { op: 'create', node: { type: 'wall', id: '$wall' } }],
    [{ op: 'create', node: building }],
    [{ op: 'create', node: { type: 'wall', id: '$' } }],
  ] as SceneEditOperation[][]) {
    expect(() => adapter.prepare({ ...before, requestId: 'invalid', operations })).toThrow()
    expect(adapter.read()).toEqual(before)
  }
})

test('schema-generated collision rejects instead of replacing a scene node', () => {
  const wall = WallNode.parse({ start: [0, 0], end: [4, 0] })
  nodeRegistry._register({
    kind: 'wall',
    category: 'structure',
    schemaVersion: 1,
    schema: WallNode.extend({ id: WallNode.shape.id.default(wall.id) }),
    defaults: () => ({}),
    capabilities: {},
  })
  expect(() =>
    resolveNodeEdits(adapter.read().scene, [
      { op: 'create', node: wall },
      { op: 'create', node: { type: 'wall', id: '$collision' } },
    ]),
  ).toThrow('ID_CONFLICT')
})

test('canceled IDs never enter the scene and alias scope does not leak into later requests', () => {
  const before = adapter.read()
  const first = adapter.prepare({ ...before, requestId: 'first', operations: room() })
  adapter.cancel(first)
  expect(adapter.read()).toEqual(before)
  const second = adapter.prepare({ ...adapter.read(), requestId: 'second', operations: room() })
  expect(second.nodeIdMap.$wall).not.toBe(first.nodeIdMap.$wall)
  expect(() => adapter.commit(first)).toThrow('INVALID_PREVIEW')
  adapter.commit(second)
  expect(useScene.getState().nodes[first.nodeIdMap.$wall!]).toBeUndefined()
  expect(useScene.temporal.getState().pastStates.length).toBe(1)
})

test('temporary delete after declaration folds to no-op with no leaked node or history', () => {
  const before = adapter.read()
  expect(() =>
    adapter.prepare({
      ...before,
      requestId: 'empty',
      operations: [...room(), { op: 'delete', id: '$level' }],
    }),
  ).toThrow('NO_CHANGES')
  expect(adapter.read()).toEqual(before)
  expect(useScene.temporal.getState().pastStates.length).toBe(0)
})

test('nested roof, hanger and opening references resolve but local feature identifiers do not', () => {
  const input: SceneEditOperation[] = [
    { op: 'create', node: { type: 'roof-segment', id: '$segment' } },
    {
      op: 'create',
      node: {
        type: 'roof',
        support: { kind: 'roof', roofSegmentId: '$segment', localPosition: [0, 0] },
      },
    },
    {
      op: 'create',
      node: {
        type: 'duct-segment',
        wallAttachment: { wallId: '$wall' },
        hangerOverrides: { anchor: { hostId: '$wall' } },
      },
    },
    {
      op: 'create',
      node: { type: 'slab', holeMetadata: [{ source: 'stair', stairId: '$stair' }] },
    },
    { op: 'create', node: { type: 'downspout', gutterId: '$gutter', outletId: '$wall' } },
    { op: 'create', node: { type: 'procedural-item', attachments: { $door: '$wall' } } },
    { op: 'create', node: { type: 'stair', id: '$stair' } },
    { op: 'create', node: { type: 'gutter', id: '$gutter' } },
    ...room(),
  ]
  const result = resolveNodeEdits(adapter.read().scene, input)
  const created = result.operations.flatMap((op) => (op.op === 'create' ? [op.node] : []))
  expect(created.find((node) => node.type === 'roof')).toMatchObject({
    support: { roofSegmentId: result.nodeIdMap.$segment },
  })
  expect(created.find((node) => node.type === 'duct-segment')).toMatchObject({
    wallAttachment: { wallId: result.nodeIdMap.$wall },
    hangerOverrides: { anchor: { hostId: result.nodeIdMap.$wall } },
  })
  expect(created.find((node) => node.type === 'slab')).toMatchObject({
    holeMetadata: [{ source: 'stair', stairId: result.nodeIdMap.$stair }],
  })
  expect(created.find((node) => node.type === 'downspout')).toMatchObject({
    gutterId: result.nodeIdMap.$gutter,
    outletId: '$wall',
  })
  expect(created.find((node) => node.type === 'procedural-item')).toMatchObject({
    attachments: { [result.nodeIdMap.$door!]: '$wall' },
  })
  expect(useScene.temporal.getState().pastStates.length).toBe(0)
})

test('malformed attachment arrays are rejected rather than silently turned into valid records', () => {
  expect(() =>
    resolveNodeEdits(adapter.read().scene, [
      { op: 'create', node: { type: 'procedural-item', attachments: [] } },
    ]),
  ).toThrow('INVALID_INPUT')
  expect(useScene.temporal.getState().pastStates.length).toBe(0)
})
