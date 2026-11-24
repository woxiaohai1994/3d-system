import type { MotionSegment } from '@pascal-app/core'
import type { MotionPathData } from '@pascal-app/viewer'
import { Vector3 } from 'three'

type Point = [number, number, number]
export function curveNodes(data: MotionPathData, segmentId: string) {
  const s = data.segments.find((s) => s.id === segmentId)!
  const a = data.points.find((p) => p.id === s.fromId)!,
    b = data.points.find((p) => p.id === s.toId)!
  const tangent = new Vector3(...b.position).sub(new Vector3(...a.position)).divideScalar(3)
  return [
    {
      id: a.id,
      at: 0,
      position: a.position,
      incoming: [0, 0, 0] as Point,
      outgoing: s.handles?.[0] ?? tangent.toArray(),
    },
    ...(s.path === 'bezier' ? (s.knots ?? []) : []),
    {
      id: b.id,
      at: 1,
      position: b.position,
      incoming: s.handles?.[1] ?? tangent.negate().toArray(),
      outgoing: [0, 0, 0] as Point,
    },
  ]
}
export function withCurveNodes<T extends MotionPathData>(
  data: T,
  segmentId: string,
  nodes: ReturnType<typeof curveNodes>,
): T {
  return {
    ...data,
    segments: data.segments.map((s) =>
      s.id === segmentId
        ? {
            ...s,
            path: 'bezier',
            handles: [nodes[0]!.outgoing, nodes.at(-1)!.incoming],
            knots: nodes.slice(1, -1),
          }
        : s,
    ),
  }
}
export function moveCurveNode<T extends MotionPathData>(data: T, id: string, delta: Vector3): T {
  const move = (position: Point) => new Vector3(...position).add(delta).toArray()
  return {
    ...data,
    points: data.points.map((p) => (p.id === id ? { ...p, position: move(p.position) } : p)),
    segments: data.segments.map((s) => ({
      ...s,
      knots: s.knots?.map((k) => (k.id === id ? { ...k, position: move(k.position) } : k)),
    })),
  }
}
export function splitCurveNode<T extends MotionPathData>(
  data: T,
  segmentId: string,
  at: number,
  id: `path-node_${string}`,
  limit = 200,
) {
  const nodes = curveNodes(data, segmentId)
  if (
    nodes.length >= limit ||
    at <= 1e-7 ||
    at >= 1 - 1e-7 ||
    nodes.some((k) => Math.abs(k.at - at) < 1e-7)
  )
    return null
  const index = nodes.findIndex((k) => k.at > at),
    a = nodes[index - 1]!,
    b = nodes[index]!
  const t = (at - a.at) / (b.at - a.at)
  const p = new Vector3(...a.position),
    q = new Vector3(...b.position)
  const c = p.clone().add(new Vector3(...a.outgoing)),
    d = q.clone().add(new Vector3(...b.incoming))
  const ac = p.clone().lerp(c, t),
    cd = c.clone().lerp(d, t),
    db = d.clone().lerp(q, t)
  const left = ac.clone().lerp(cd, t),
    right = cd.lerp(db, t),
    middle = left.clone().lerp(right, t)
  nodes[index - 1] = { ...a, outgoing: ac.sub(p).toArray() }
  nodes[index] = { ...b, incoming: db.sub(q).toArray() }
  nodes.splice(index, 0, {
    id,
    at,
    position: middle.toArray(),
    incoming: left.sub(middle).toArray(),
    outgoing: right.sub(middle).toArray(),
  })
  return { data: withCurveNodes(data, segmentId, nodes), pointId: id }
}

export function drawnCurve(
  positions: Point[],
  curves?: Point[][],
): Pick<MotionSegment, 'handles' | 'knots'> {
  const handles = positions.slice(1).map(
    (p, i) =>
      curves?.[i] ?? [
        new Vector3(...p)
          .sub(new Vector3(...positions[i]!))
          .divideScalar(3)
          .toArray(),
        new Vector3(...positions[i]!)
          .sub(new Vector3(...p))
          .divideScalar(3)
          .toArray(),
      ],
  )
  return {
    handles: [handles[0]![0]!, handles.at(-1)![1]!],
    knots: positions.slice(1, -1).map((position, i) => ({
      id: `path-node_${crypto.randomUUID()}`,
      at: (i + 1) / (positions.length - 1),
      position,
      incoming: handles[i]![1]!,
      outgoing: handles[i + 1]![0]!,
    })),
  }
}

export function sliceCurve(data: MotionPathData, segmentId: string, from: number, to: number) {
  let result = data
  for (const at of [from, to]) {
    if (
      at > 1e-7 &&
      at < 1 - 1e-7 &&
      !curveNodes(result, segmentId).some((k) => Math.abs(k.at - at) < 1e-7)
    )
      result =
        splitCurveNode(result, segmentId, at, `path-node_${crypto.randomUUID()}`, 202)?.data ??
        result
  }
  const nodes = curveNodes(result, segmentId).filter(
    (k) => k.at >= from - 1e-7 && k.at <= to + 1e-7,
  )
  return {
    handles: [nodes[0]!.outgoing, nodes.at(-1)!.incoming] as [Point, Point],
    knots: nodes.slice(1, -1).map((k) => ({ ...k, at: (k.at - from) / (to - from) })),
  }
}
