import { expect, test } from 'bun:test'
import { CameraMotionPoint, MotionSegment } from '@pascal-app/core'
import { createTransformMotionEvaluator } from '@pascal-app/viewer'
import { Vector3 } from 'three'
import { reconcilePaths } from './motion-path-data'
import { drawingCurves } from './motion-path-drawing'
import { reshapePathNodeHandle } from './motion-path-edit'
import {
  convertPathToBezier,
  insertPathNode,
  removePathNode,
  setPathNodeSmooth,
} from './motion-path-nodes'

function fixture() {
  const points = [
    [0, 2, 0],
    [4, 2, 2],
    [6, 3, 5],
  ].map((position, i) =>
    CameraMotionPoint.parse({
      time: i * 4,
      position,
      rotation: [0, 0, 0],
      verticalFov: 50 + i * 10,
      orthographicHeight: 10,
      orbitDistance: 8,
    }),
  )
  return {
    points,
    segments: points
      .slice(1)
      .map((p, i) =>
        MotionSegment.parse({ fromId: points[i]!.id, toId: p.id, path: 'line', rhythm: 'linear' }),
      ),
  }
}
test('existing straight geometry is editable with Bezier handles without changing its shape', () => {
  const data = fixture(),
    next = convertPathToBezier(data, data.segments[0]!.id)
  expect(next.points).toEqual(data.points)
  expect(next.segments[1]).toEqual(data.segments[1])
  expect(next.segments[0]!.path).toBe('bezier')
  expect(next.segments[0]!.handles).toHaveLength(2)
  const a = createTransformMotionEvaluator(data),
    b = createTransformMotionEvaluator(next)
  for (let t = 0; t <= 8; t += 0.1)
    expect(
      new Vector3(...a.sample(t)!.position).distanceTo(new Vector3(...b.sample(t)!.position)),
    ).toBeLessThan(1e-7)
})
test('inserting a spatial node preserves every key, lens, easing and the exact curve', () => {
  const data = fixture()
  data.segments[0]!.path = 'bezier'
  data.segments[0]!.rhythm = 'ease'
  data.segments[0]!.handles = [
    [0, 3, 0],
    [-2, 1, 0],
  ]
  const added = insertPathNode(data, data.segments[0]!.id, 2, 24)!
  expect(added.data.points).toEqual(data.points)
  expect(added.data.points.filter((p) => p.id !== added.pointId)).toEqual(data.points)
  expect(added.data.segments[1]).toEqual(data.segments[1])
  const a = createTransformMotionEvaluator(data),
    b = createTransformMotionEvaluator(added.data)
  for (let t = 0; t <= 8; t += 0.125)
    expect(
      new Vector3(...a.sample(t)!.position).distanceTo(new Vector3(...b.sample(t)!.position)),
    ).toBeLessThan(1e-7)
  expect(added.data.segments[0]!.knots![0]!.id).toBe(added.pointId)
  expect(added.data.segments[0]!.fromId).toBe(data.points[0]!.id)
  expect(added.data.segments[0]!.toId).toBe(data.points[1]!.id)
  expect(added.data.segments[0]!.easing).toEqual(data.segments[0]!.easing)
})
test('delete reconnects neighboring curve nodes without changing key timing', () => {
  const data = fixture(),
    added = insertPathNode(data, data.segments[0]!.id, 2, 24)!
  const removed = removePathNode(added.data, added.pointId)!
  expect(removed.points).toEqual(data.points)
  expect(removed.segments).toHaveLength(2)
  expect(removed.segments[0]!.knots).toHaveLength(0)
})
test('smooth and corner nodes alter only adjoining handles and preserve time and position', () => {
  const data = fixture(),
    id = data.points[1]!.id,
    smooth = setPathNodeSmooth(data, id, true)
  expect(smooth.points).toEqual(data.points)
  const incoming = new Vector3(...smooth.segments[0]!.handles![1]),
    outgoing = new Vector3(...smooth.segments[1]!.handles![0])
  expect(incoming.clone().normalize().dot(outgoing.clone().normalize())).toBeCloseTo(-1)
  const corner = setPathNodeSmooth(smooth, id, false)
  expect(corner.segments[0]!.handles![1]).toEqual([0, 0, 0])
  expect(corner.segments[1]!.handles![0]).toEqual([0, 0, 0])
  expect(corner.segments[0]!.handles![0]).toEqual(smooth.segments[0]!.handles![0])
})
test('spatial nodes can be inserted even in a one-frame motion without adding time keys', () => {
  const data = fixture()
  data.points[1]!.time = 1 / 24
  const added = insertPathNode(data, data.segments[0]!.id, 1 / 48, 24)!
  expect(added.data.points).toEqual(data.points)
  expect(added.data.segments[0]!.knots![0]!.at).toBe(0.5)
})

test('new keyframe spans and click-drawn routes have Bezier handles by default', () => {
  const data = fixture()
  const next = reconcilePaths<typeof data>(data.points.slice(0, 2), {
    ...data,
    points: data.points.slice(0, 1),
    segments: [],
  })
  expect(next.segments[0]!.path).toBe('bezier')
  expect(next.segments[0]!.handles).toHaveLength(2)
  const handles = drawingCurves(
    [
      [0, 0, 0],
      [3, 0, 0],
    ],
    [
      [0, 0, 0],
      [0, 0, 0],
    ],
  )
  expect(handles).toEqual([
    [
      [1, 0, 0],
      [-1, -0, -0],
    ],
  ])
})

test('smooth handles stay tangent while Alt-style independent editing preserves the other side', () => {
  const data = fixture(),
    smooth = setPathNodeSmooth(data, data.points[1]!.id, true)
  const delta = new Vector3(0, 2, 1),
    segmentId = smooth.segments[1]!.id
  const linked = reshapePathNodeHandle(smooth, segmentId, delta, 0)
  const a = new Vector3(...linked.segments[0]!.handles![1]),
    b = new Vector3(...linked.segments[1]!.handles![0])
  expect(a.clone().normalize().dot(b.clone().normalize())).toBeCloseTo(-1)
  expect(a.length()).toBeCloseTo(new Vector3(...smooth.segments[0]!.handles![1]).length())
  const independent = reshapePathNodeHandle(smooth, segmentId, delta, 0, true)
  expect(independent.segments[0]).toEqual(smooth.segments[0])
  expect(independent.points).toEqual(data.points)
})

test('deleting an endpoint promotes the next curve node and preserves the motion duration', () => {
  const data = fixture()
  const added = insertPathNode(data, data.segments[0]!.id, 2, 24)!
  const knot = added.data.segments[0]!.knots![0]!
  const next = removePathNode(added.data, data.points[0]!.id)!
  expect(next.points[0]!.position).toEqual(knot.position)
  expect(next.points.map((p) => [p.id, p.time])).toEqual(data.points.map((p) => [p.id, p.time]))
  expect(next.segments[0]!.handles![0]).toEqual(knot.outgoing)
  expect(next.segments[0]!.knots).toEqual([])
  expect(next.segments[1]).toEqual(data.segments[1])
  const last = insertPathNode(data, data.segments[1]!.id, 6, 24)!
  const end = removePathNode(last.data, data.points[2]!.id)!
  expect(end.points[2]!.position).toEqual(last.data.segments[1]!.knots![0]!.position)
  expect(end.segments[1]!.handles![1]).toEqual(last.data.segments[1]!.knots![0]!.incoming)
})

test('deleting a shared endpoint joins the surviving Bezier nodes and retains their handles', () => {
  const data = fixture()
  const left = insertPathNode(data, data.segments[0]!.id, 2, 24)!
  const both = insertPathNode(left.data, data.segments[1]!.id, 6, 24)!
  const next = removePathNode(both.data, data.points[1]!.id)!
  expect(next.points).toEqual([data.points[0]!, data.points[2]!])
  expect(next.segments).toHaveLength(1)
  expect(next.segments[0]!.knots).toEqual([
    { ...both.data.segments[0]!.knots![0]!, at: 0.25 },
    { ...both.data.segments[1]!.knots![0]!, at: 0.75 },
  ])
  expect(next.segments[0]!.handles).toEqual([
    both.data.segments[0]!.handles![0],
    both.data.segments[1]!.handles![1],
  ])
  expect(next.segments[0]!.toId).toBe(data.points[2]!.id)
})

test('deleting endpoints down to the final node produces no dangling segments', () => {
  const data = fixture()
  const first = removePathNode(data, data.points[0]!.id)!
  expect(first.points).toEqual(data.points.slice(1))
  expect(first.segments).toEqual(data.segments.slice(1))
  const second = removePathNode(first, first.points[0]!.id)!
  expect(second.segments).toEqual([])
  const last = removePathNode(second, second.points[0]!.id)!
  expect(last).toEqual({ points: [], segments: [] })
})
