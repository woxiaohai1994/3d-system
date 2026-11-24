import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  BuildingNode,
  clearSceneHistory,
  createTerrainField,
  encodeTerrainField,
  getScaledDimensions,
  ItemNode,
  LevelNode,
  nodeRegistry,
  ShelfNode,
  SiteNode,
  SlabNode,
  useScene,
} from '@pascal-app/core'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import {
  metersToOpenPlanPoint,
  openPlanFurnitureLocalMatrix,
  openPlanPointToMeters,
} from '../openplan/coordinates'
import { affineMatrix, decomposePlacement, sceneCoordinateFrames } from './scene-coordinates'
import { SceneEditAdapter } from './scene-edit-adapter'

let saved: ReturnType<typeof useScene.getState>
let restore: () => void
let raf: typeof requestAnimationFrame
let cancelRaf: typeof cancelAnimationFrame
let adapter: SceneEditAdapter
let ground: LevelNode, upper: LevelNode, building: BuildingNode, item: ItemNode
const asset = {
  id: 'asymmetric',
  name: '方向家具',
  category: 'fixture',
  src: '/fixture.glb',
  thumbnail: '',
  dimensions: [2, 1, 0.5],
}
const pose = (
  position: [number, number, number],
  yaw = 0,
  scale: [number, number, number] = [1, 1, 1],
) =>
  new Matrix4().compose(
    new Vector3(...position),
    new Quaternion().setFromEuler(new Euler(0, yaw, 0)),
    new Vector3(...scale),
  ).elements

beforeEach(() => {
  saved = useScene.getState()
  restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
  nodeRegistry._register({
    kind: 'item',
    category: 'furnish',
    defaults: () => ({}),
    schemaVersion: 1,
    schema: ItemNode,
    capabilities: {
      floorPlaced: {
        footprint: (n) => ({
          dimensions: getScaledDimensions(n as ItemNode),
          rotation: (n as ItemNode).rotation,
        }),
        applies: (n) => !(n as ItemNode).asset.attachTo,
      },
    },
  })
  nodeRegistry._register({
    kind: 'shelf',
    category: 'furnish',
    defaults: () => ({}),
    schemaVersion: 1,
    schema: ShelfNode,
    capabilities: {
      floorPlaced: {
        footprint: (n) => {
          const s = n as ShelfNode
          return { dimensions: [s.width, s.height, s.depth], rotation: s.rotation }
        },
      },
    },
  })
  raf = globalThis.requestAnimationFrame
  cancelRaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const site = SiteNode.parse({})
  building = BuildingNode.parse({
    parentId: site.id,
    position: [10, 2, 20],
    rotation: [0, Math.PI / 2, 0],
  })
  ground = LevelNode.parse({ parentId: building.id, level: 0, height: 3, baseElevation: 0.5 })
  upper = LevelNode.parse({ parentId: building.id, level: 1, height: 4, baseElevation: 0.25 })
  item = ItemNode.parse({ parentId: upper.id, asset })
  site.children = [building.id]
  building.children = [ground.id, upper.id]
  upper.children = [item.id]
  useScene.setState({
    nodes: Object.fromEntries([site, building, ground, upper, item].map((n) => [n.id, n])),
    rootNodeIds: [site.id],
    collections: {},
    materials: {},
    installedPlugins: [],
    dirtyNodes: new Set(),
    readOnly: false,
  })
  clearSceneHistory()
  adapter = new SceneEditAdapter('coordinates')
})
afterEach(async () => {
  adapter.dispose()
  await Promise.resolve()
  useScene.setState(saved)
  clearSceneHistory()
  restore()
  globalThis.requestAnimationFrame = raf
  globalThis.cancelAnimationFrame = cancelRaf
})

function transform(matrix: number[], parentId?: LevelNode['id']) {
  return adapter.prepare({
    ...adapter.read(),
    requestId: crypto.randomUUID(),
    operations: [{ op: 'transform', id: item.id, matrix, ...(parentId ? { parentId } : {}) }],
  })
}
function close(actual: readonly number[], expected: readonly number[]) {
  expect(actual.length).toBe(expected.length)
  actual.forEach((n, i) => {
    expect(n).toBeCloseTo(expected[i]!, 8)
  })
}
function bodyWorld(id = item.id) {
  const scene = adapter.read().scene
  const node = scene.nodes[id] as ItemNode
  return sceneCoordinateFrames(scene)
    .frame(id)
    .scale(new Vector3(...node.scale))
}

test.each([
  0, 90, 180, -90,
])('OpenPlan %s degrees maps plan +X to the expected asymmetric marker direction in metres', (degrees) => {
  const expected: Record<number, number[]> = {
    0: [1, 0, 0],
    90: [0, 0, 1],
    180: [-1, 0, 0],
    '-90': [0, 0, -1],
  }
  const matrix = affineMatrix(
    openPlanFurnitureLocalMatrix(
      { position: { x: 100, y: 250 }, rotation: degrees, scale: { x: 1, y: 1, z: 1 } },
      { elevationMeters: 0.8, forwardCorrectionRadians: 0 },
    ),
  )
  close(new Vector3().applyMatrix4(matrix).toArray(), [1, 0.8, 2.5])
  close(new Vector3(1, 0, 0).transformDirection(matrix).toArray(), expected[degrees]!)
  expect(metersToOpenPlanPoint(openPlanPointToMeters({ x: -125, y: 275 }))).toEqual({
    x: -125,
    y: 275,
  })
})

test('catalog facing correction is separate from plan rotation and scale stays dimensionless', () => {
  const matrix = affineMatrix(
    openPlanFurnitureLocalMatrix(
      { position: { x: 100, y: 0 }, rotation: 90, scale: { x: -2, y: 3, z: 0.5 } },
      { elevationMeters: 1.2, forwardCorrectionRadians: Math.PI / 2 },
    ),
  )
  close(new Vector3(1, 0, 0).applyMatrix4(matrix).toArray(), [4, 1.2, 0])
  close(new Vector3(0, 1, 0).applyMatrix4(matrix).toArray(), [1, 1.7, 0])
  close(new Vector3(0, 0, 1).applyMatrix4(matrix).toArray(), [1, 1.2, -2])
})

test.each([
  { rotation: 0, offset: [-2, 0.5, -3] },
  { rotation: 90, offset: [3, 0.5, -2] },
  { rotation: 180, offset: [2, 0.5, 3] },
  { rotation: -90, offset: [-3, 0.5, 2] },
])('OpenPlan plan-axis mirrors and height magnitude match its renderer at $rotation degrees', ({
  rotation,
  offset,
}) => {
  const matrix = affineMatrix(
    openPlanFurnitureLocalMatrix(
      { position: { x: 100, y: 250 }, rotation, scale: { x: -2, y: -3, z: -0.5 } },
      { elevationMeters: 0.8, forwardCorrectionRadians: 0 },
    ),
  )
  close(new Vector3(1, 1, 1).applyMatrix4(matrix).toArray(), [
    1 + offset[0]!,
    0.8 + offset[1]!,
    2.5 + offset[2]!,
  ])
  close(new Vector3(0, 1, 0).applyMatrix4(matrix).toArray(), [1, 1.3, 2.5])
})

test('oblique catalog correction with unequal plan scale keeps its matrix and rejects unrepresentable shear', () => {
  const matrix = affineMatrix(
    openPlanFurnitureLocalMatrix(
      { position: { x: 100, y: 250 }, rotation: 0, scale: { x: 2, y: 3, z: 1 } },
      { elevationMeters: 0.8, forwardCorrectionRadians: Math.PI / 4 },
    ),
  )
  close(new Vector3(1, 0, 0).applyMatrix4(matrix).toArray(), [
    1 + Math.SQRT2,
    0.8,
    2.5 - 3 / Math.SQRT2,
  ])
  expect(() => decomposePlacement(matrix)).toThrow('SHEAR_TRANSFORM')
})

test('non-cardinal XYZ parent rotation and affine inverse roundoff preserve the target pose', () => {
  useScene.getState().updateNode(building.id, { rotation: [0.1, 0.7, -0.2] })
  const desired = new Matrix4().compose(
    new Vector3(12, 6.5, 16),
    new Quaternion().setFromEuler(new Euler(0.2, -0.3, 0.5)),
    new Vector3(2, 3, 0.5),
  ).elements
  adapter.commit(transform(desired))
  close(bodyWorld().elements, desired)
})

test('rotated building and additive storey heights apply once through preview, commit, undo and JSON reload', () => {
  const before = adapter.read().scene
  const desired = pose([12, 6.5, 16], Math.PI / 2)
  const preview = transform(desired)
  expect(adapter.read().scene).toEqual(before)
  const next = preview.changes.find((c) => c.id === item.id)!.after as ItemNode
  close(next.position, [4, 0.75, 2])
  close(next.rotation, [0, 0, 0])
  adapter.commit(preview)
  close(bodyWorld().elements, desired)
  const after = adapter.read().scene
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(adapter.read().scene).toEqual(before)
  useScene.temporal.getState().redo()
  close(bodyWorld().elements, desired)
  const savedScene = JSON.parse(JSON.stringify(after))
  useScene.getState().setScene(savedScene.nodes, savedScene.rootNodeIds, {
    collections: savedScene.collections,
    materials: savedScene.materials,
    installedPlugins: savedScene.installedPlugins,
  })
  close(bodyWorld().elements, desired)
})

test.each(
  (
    [
      [-2, 3, 0.5],
      [2, -3, 0.5],
      [2, 3, -0.5],
      [-2, -3, 0.5],
    ] as [number, number, number][]
  ).map((scale) => ({ scale })),
)('mirror/nonuniform scale %j survives the host and an identical world transform is a no-op', ({
  scale,
}) => {
  useScene.getState().updateNode(item.id, { scale })
  clearSceneHistory()
  const desired = pose([12, 6.5, 16], 0.3, scale)
  adapter.commit(transform(desired))
  close(bodyWorld().elements, desired)
  close((useScene.getState().nodes[item.id] as ItemNode).scale, scale)
  expect(() => transform(desired)).toThrow('NO_CHANGES')
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
})

test('cross-level moves update both parent lists and clear the prior slab host in one undo', () => {
  const slab = SlabNode.parse({
    parentId: upper.id,
    polygon: [
      [0, 0],
      [8, 0],
      [8, 8],
      [0, 8],
    ],
    elevation: 0.6,
  })
  useScene.getState().createNode(slab)
  useScene.getState().updateNode(item.id, { supportSlabId: slab.id })
  clearSceneHistory()
  const before = adapter.read().scene
  const desired = pose([12, 3.3, 16])
  adapter.commit(transform(desired, ground.id))
  const current = useScene.getState()
  expect((current.nodes[ground.id] as LevelNode).children).toContain(item.id)
  expect((current.nodes[upper.id] as LevelNode).children).not.toContain(item.id)
  expect((current.nodes[item.id] as ItemNode).supportSlabId).toBeUndefined()
  close(bodyWorld().elements, desired)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(adapter.read().scene).toEqual(before)
})

test('a slab created only in the candidate supplies lift without publishing to the live scene', () => {
  const desired = pose([12, 7.05, 16])
  const before = adapter.read().scene
  const preview = adapter.prepare({
    ...adapter.read(),
    requestId: 'candidate-slab',
    operations: [
      { op: 'transform', id: item.id, matrix: desired },
      {
        op: 'create',
        node: {
          id: '$slab',
          type: 'slab',
          parentId: upper.id,
          polygon: [
            [0, 0],
            [8, 0],
            [8, 8],
            [0, 8],
          ],
          elevation: 0.8,
        },
      },
    ],
  })
  expect(adapter.read().scene).toEqual(before)
  close((preview.changes.find((c) => c.id === item.id)!.after as ItemNode).position, [4, 0.5, 2])
  adapter.commit(preview)
  close(bodyWorld().elements, desired)
})

test('later operations see modified heights instead of a cached elevation from an earlier transform', () => {
  const preview = adapter.prepare({
    ...adapter.read(),
    requestId: 'height-sequence',
    operations: [
      { op: 'transform', id: item.id, matrix: pose([12, 6.5, 16]) },
      { op: 'update', id: ground.id, data: { height: 5 } },
      { op: 'transform', id: item.id, matrix: pose([12, 8.5, 16]) },
    ],
  })
  adapter.commit(preview)
  close((useScene.getState().nodes[item.id] as ItemNode).position, [4, 0.75, 2])
  close(bodyWorld().elements, pose([12, 8.5, 16]))
})

test('nested item child frame inherits parent placement and rotation but not body scale', () => {
  const child = ItemNode.parse({ parentId: item.id, asset, position: [1, 0.8, 0] })
  useScene.getState().updateNode(item.id, {
    position: [4, 0.5, 2],
    rotation: [0, Math.PI / 2, 0],
    scale: [3, 2, -1],
  })
  useScene.getState().createNode(child)
  const scene = adapter.read().scene
  close(
    new Vector3().applyMatrix4(sceneCoordinateFrames(scene).frame(child.id)).toArray(),
    [11, 7.05, 16],
  )
})

test('sloped terrain lift is subtracted from storage and restored in the world frame', () => {
  const field = createTerrainField({ origin: [0, 0], cols: 33, rows: 33, spacing: 1 })
  for (let row = 0; row < 33; row++)
    for (let col = 0; col < 33; col++) field.heights[row * 33 + col] = col * 10
  const site = Object.values(useScene.getState().nodes).find((n) => n.type === 'site')!
  useScene.getState().updateNode(site.id, { terrain: encodeTerrainField(field) } as never)
  useScene.getState().updateNode(building.id, { position: [10, 0, 20] })
  useScene.getState().updateNode(ground.id, { baseElevation: 0 })
  const desired = pose([12, 1.7, 16])
  adapter.commit(transform(desired, ground.id))
  close((useScene.getState().nodes[item.id] as ItemNode).position, [4, 0.5, 2])
  close(bodyWorld().elements, desired)
})

test.each([
  'shear',
  'singular',
  'perspective',
  'nonfinite',
  'unsupported-host',
])('%s rejects the whole batch without history or data changes', (kind) => {
  let matrix = pose([12, 6.5, 16])
  if (kind === 'shear') matrix[4] = 0.5
  if (kind === 'singular') matrix = pose([0, 0, 0], 0, [0, 1, 1])
  if (kind === 'perspective') matrix[3] = 0.2
  if (kind === 'nonfinite') matrix[12] = Infinity
  if (kind === 'unsupported-host')
    useScene.getState().updateNode(item.id, {
      asset: { ...(useScene.getState().nodes[item.id] as ItemNode).asset, attachTo: 'wall' },
    })
  clearSceneHistory()
  const before = adapter.read().scene
  expect(() =>
    adapter.prepare({
      ...adapter.read(),
      requestId: kind,
      operations: [
        { op: 'update', id: building.id, data: { name: '不应写入' } },
        { op: 'transform', id: item.id, matrix },
      ],
    }),
  ).toThrow()
  expect(adapter.read().scene).toEqual(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})

test('nonuniform parent-frame inverse that requires shear is rejected during decomposition', () => {
  const parent = new Matrix4().makeScale(2, 1, 1)
  const rotated = affineMatrix(pose([0, 0, 0], Math.PI / 4))
  expect(() => decomposePlacement(parent.invert().multiply(rotated))).toThrow('SHEAR_TRANSFORM')
})

test('new node and new target level aliases resolve before a cross-level transform', () => {
  const preview = adapter.prepare({
    ...adapter.read(),
    requestId: 'alias-move',
    operations: [
      { op: 'create', node: { type: 'item', id: '$item', parentId: ground.id, asset } },
      { op: 'transform', id: '$item', parentId: '$newLevel', matrix: pose([12, 10, 16]) },
      {
        op: 'create',
        node: { type: 'level', id: '$newLevel', parentId: building.id, level: 2, height: 3 },
      },
    ],
  })
  adapter.commit(preview)
  const node = useScene.getState().nodes[preview.nodeIdMap.$item!] as ItemNode
  expect(node.parentId).toBe(preview.nodeIdMap.$newLevel!)
  close(
    new Vector3()
      .applyMatrix4(sceneCoordinateFrames(adapter.read().scene).frame(node.id))
      .toArray(),
    [12, 10, 16],
  )
})

test('ambiguous duplicate storey ordinals reject the transform before any batch write', () => {
  const before = adapter.read().scene
  expect(() =>
    adapter.prepare({
      ...adapter.read(),
      requestId: 'duplicate-level',
      operations: [
        {
          op: 'create',
          node: { type: 'level', id: '$duplicate', parentId: building.id, level: 1, height: 3 },
        },
        { op: 'transform', id: item.id, matrix: pose([12, 6.5, 16]) },
      ],
    }),
  ).toThrow('INVALID_RELATION')
  expect(adapter.read().scene).toEqual(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})
