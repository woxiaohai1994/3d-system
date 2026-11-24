import { afterEach, beforeEach, expect, test } from 'bun:test'
import { LevelNode, SlabNode, WallNode } from '../../schema'
import useLiveNodeOverrides from '../../store/use-live-node-overrides'
import useScene from '../../store/use-scene'
import { createSnapshotSlabQueries } from './snapshot-slab-queries'
import { SpatialGridManager } from './spatial-grid-manager'

const level = LevelNode.parse({})
const low = SlabNode.parse({
  parentId: level.id,
  polygon: [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ],
  elevation: -0.3,
  holes: [
    [
      [1, 1],
      [2, 1],
      [2, 2],
      [1, 2],
    ],
  ],
})
const high = SlabNode.parse({
  parentId: level.id,
  polygon: [
    [3, 0],
    [6, 0],
    [6, 4],
    [3, 4],
  ],
  elevation: 0.8,
})
const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [4, 0], thickness: 0.3 })
const nodes = Object.fromEntries([level, low, high, wall].map((n) => [n.id, n]))
let saved: ReturnType<typeof useScene.getState>
let oldRaf: typeof requestAnimationFrame
let oldCancelRaf: typeof cancelAnimationFrame
beforeEach(() => {
  saved = useScene.getState()
  oldRaf = globalThis.requestAnimationFrame
  oldCancelRaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  useScene.setState({ nodes, rootNodeIds: [level.id] })
})
afterEach(() => {
  useLiveNodeOverrides.getState().clearAll()
  useScene.setState(saved)
  useScene.temporal.getState().clear()
  globalThis.requestAnimationFrame = oldRaf
  globalThis.cancelAnimationFrame = oldCancelRaf
})

test('snapshot support matches the native spatial index at overlaps, holes, edges, recesses, rotations and caps', () => {
  const live = new SpatialGridManager()
  for (const node of Object.values(nodes)) live.handleNodeCreated(node, level.id)
  const candidate = createSnapshotSlabQueries(nodes)
  for (const [x, z] of [
    [0.1, 0.1],
    [1.5, 1.5],
    [2.8, 2],
    [3.5, 2],
    [5.9, 3.9],
    [10, 10],
  ]) {
    const position: [number, number, number] = [x!, 0, z!]
    for (const yaw of [0, Math.PI / 4, Math.PI / 2])
      for (const cap of [undefined, -0.4, 0, 0.8]) {
        const dimensions: [number, number, number] = [1, 1, 0.5],
          rotation: [number, number, number] = [0, yaw, 0]
        expect(
          candidate.getSlabSupportForItem(level.id, position, dimensions, rotation, cap),
        ).toEqual(live.getSlabSupportForItem(level.id, position, dimensions, rotation, cap))
        for (const slab of [low, high])
          expect(
            candidate.getHostSlabElevationForFootprint(
              level.id,
              slab.id,
              position,
              dimensions,
              rotation,
            ),
          ).toEqual(
            live.getHostSlabElevationForFootprint(
              level.id,
              slab.id,
              position,
              dimensions,
              rotation,
            ),
          )
      }
  }
})

test('snapshot queries ignore live node overrides and a different live scene', () => {
  const query = createSnapshotSlabQueries(nodes)
  useScene.setState({ nodes: {} })
  useLiveNodeOverrides.getState().set(high.id, { elevation: 20 })
  expect(query.getSlabSupportForItem(level.id, [5, 0, 2], [0.5, 1, 0.5], [0, 0, 0])).toEqual({
    slabId: high.id,
    elevation: 0.8,
  })
  expect(
    query.getHostSlabElevationForFootprint(
      level.id,
      low.id,
      [1.5, 0, 1.5],
      [0.2, 1, 0.2],
      [0, 0, 0],
    ),
  ).toBeNull()
})
