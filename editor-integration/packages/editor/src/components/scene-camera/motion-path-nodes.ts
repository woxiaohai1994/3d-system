import { sampleScenePlayback, useScene } from '@pascal-app/core'
import type { MotionPathData, MotionTargetResolver } from '@pascal-app/viewer'
import { Vector3 } from 'three'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { curveNodes, splitCurveNode, withCurveNodes } from './motion-curve'
import { commitPath, editingPathData, editingPathNode } from './motion-path-context'
import { convertPathToBezier } from './motion-path-data'
import { editMotionPath } from './motion-path-edit'
import { previewCameraPathLocation } from './motion-path-preview'
import { resolveMotionTarget } from './motion-state'

export function insertPathNode(
  data: MotionPathData,
  segmentId: string,
  time: number,
  _fps: number,
  _resolve?: MotionTargetResolver,
) {
  const i = data.segments.findIndex((s) => s.id === segmentId),
    a = data.points[i],
    b = data.points[i + 1]
  if (!a || !b) return null
  const converted = convertPathToBezier(data, segmentId)
  return splitCurveNode(
    converted,
    segmentId,
    Math.max(0.001, Math.min(0.999, (time - a.time) / (b.time - a.time))),
    `path-node_${crypto.randomUUID()}`,
  )
}

export function removePathNode(data: MotionPathData, pointId: string) {
  const segment = data.segments.find((s) => s.knots?.some((k) => k.id === pointId))
  if (segment)
    return withCurveNodes(
      data,
      segment.id,
      curveNodes(data, segment.id).filter((k) => k.id !== pointId),
    )
  const index = data.points.findIndex((p) => p.id === pointId)
  if (index < 0) return null
  const left = data.segments[index - 1],
    right = data.segments[index]
  const boundary = index === 0 ? right : index === data.points.length - 1 ? left : null
  if (boundary?.knots?.length) {
    const nodes = curveNodes(data, boundary.id)
    if (index === 0) nodes.shift()
    else nodes.pop()
    const from = nodes[0]!.at,
      length = nodes.at(-1)!.at - from
    const replacement = index === 0 ? nodes[0]! : nodes.at(-1)!
    nodes[index === 0 ? 0 : nodes.length - 1] = { ...replacement, id: pointId }
    const next = withCurveNodes(
      data,
      boundary.id,
      nodes.map((n) => ({ ...n, at: (n.at - from) / length })),
    )
    return {
      ...next,
      points: next.points.map((p) =>
        p.id === pointId ? { ...p, position: replacement.position } : p,
      ),
    }
  }
  const points = data.points.filter((p) => p.id !== pointId)
  if (!left || !right)
    return { ...data, points, segments: data.segments.filter((s) => s !== left && s !== right) }
  const a = data.points[index - 1]!,
    b = data.points[index]!,
    c = data.points[index + 1]!
  const fraction = (b.time - a.time) / (c.time - a.time)
  const before = curveNodes(convertPathToBezier(data, left.id), left.id)
  const after = curveNodes(convertPathToBezier(data, right.id), right.id)
  const nodes = [
    ...before.slice(0, -1).map((n) => ({ ...n, at: n.at * fraction })),
    ...after.slice(1).map((n) => ({ ...n, at: fraction + n.at * (1 - fraction) })),
  ]
  return withCurveNodes(
    {
      ...data,
      points,
      segments: data.segments.flatMap((s) =>
        s === right
          ? []
          : [
              s === left
                ? {
                    ...s,
                    toId: c.id,
                  }
                : s,
            ],
      ),
    },
    left.id,
    nodes,
  )
}

export function setPathNodeSmooth(data: MotionPathData, pointId: string, smooth: boolean) {
  let result = data
  const adjoining = data.segments.filter(
    (s) => s.fromId === pointId || s.toId === pointId || s.knots?.some((k) => k.id === pointId),
  )
  const vertices = adjoining.flatMap((s, i) => curveNodes(data, s.id).slice(i ? 1 : 0))
  const at = vertices.findIndex((k) => k.id === pointId)
  if (at < 0) return data
  const direction = new Vector3(...(vertices[at + 1]?.position ?? vertices[at]!.position))
    .sub(new Vector3(...(vertices[at - 1]?.position ?? vertices[at]!.position)))
    .normalize()
  for (const s of adjoining) {
    result = convertPathToBezier(result, s.id)
    const nodes = curveNodes(result, s.id),
      index = nodes.findIndex((k) => k.id === pointId)
    const node = nodes[index]!,
      p = new Vector3(...node.position)
    nodes[index] = {
      ...node,
      incoming: direction
        .clone()
        .multiplyScalar(
          smooth && nodes[index - 1]
            ? -p.distanceTo(new Vector3(...nodes[index - 1]!.position)) / 3
            : 0,
        )
        .toArray(),
      outgoing: direction
        .clone()
        .multiplyScalar(
          smooth && nodes[index + 1]
            ? p.distanceTo(new Vector3(...nodes[index + 1]!.position)) / 3
            : 0,
        )
        .toArray(),
    }
    result = withCurveNodes(result, s.id, nodes)
  }
  return result
}

export function selectPathNode(pointId: string, preferredSegment?: string) {
  const data = editingPathData(),
    segment =
      data.segments.find(
        (s) => s.id === preferredSegment && curveNodes(data, s.id).some((k) => k.id === pointId),
      ) ??
      data.segments.find((s) => curveNodes(data, s.id).some((k) => k.id === pointId)) ??
      data.segments.find((s) => s.toId === pointId)
  if (segment && editMotionPath(segment.id)) {
    useSceneAnimation.setState({ pointId })
    previewCameraPathLocation(
      segment.id,
      curveNodes(data, segment.id).find((k) => k.id === pointId)!.at,
    )
  } else if (!segment && editable()) {
    const point = data.points.find((p) => p.id === pointId)
    if (!point) return
    useSceneAnimation.setState({
      pointId,
      segmentId: null,
      pathSelected: false,
      ...(editingPathNode()?.type === 'scene-camera' ? { time: point.time } : {}),
    })
    sampleScenePlayback(useSceneAnimation.getState().time)
  }
}
function editable() {
  const state = useSceneAnimation.getState(),
    node = editingPathNode()
  return (
    node &&
    !useScene.getState().readOnly &&
    !state.playing &&
    !state.exporting &&
    !state.sceneDraft &&
    !state.pickingAnchor &&
    !state.lockedIds.includes(node.id)
  )
}
export function addPathNode(segmentId: string, fraction?: number) {
  if (!editable() || !editMotionPath(segmentId)) return
  const data = editingPathData(),
    index = data.segments.findIndex((s) => s.id === segmentId),
    a = data.points[index]!,
    b = data.points[index + 1]!
  const nodes = curveNodes(data, segmentId)
  const widest = nodes
    .slice(1)
    .map((n, i) => ({ from: nodes[i]!.at, to: n.at }))
    .sort((a, b) => b.to - b.from - (a.to - a.from))[0]!
  const at = fraction ?? (widest.from + widest.to) / 2
  const result = insertPathNode(
    data,
    segmentId,
    a.time + (b.time - a.time) * at,
    animationData().fps,
    resolveMotionTarget,
  )
  if (result && commitPath(result.data)) selectPathNode(result.pointId)
}
export function deletePathNode(pointId: string) {
  if (!editable()) return
  const data = editingPathData(),
    next = removePathNode(data, pointId)
  if (next && commitPath(next))
    useSceneAnimation.setState({ pointId: null, segmentId: null, pathSelected: false })
}

export { convertPathToBezier } from './motion-path-data'

export function deletePathSelection() {
  const state = useSceneAnimation.getState()
  if (state.pointId) {
    deletePathNode(state.pointId)
    return
  }
  if (!editable() || !state.segmentId || !state.pathSelected) return
  if (commitPath({ points: [], segments: [] }))
    useSceneAnimation.setState({ pointId: null, segmentId: null, pathSelected: false })
}
