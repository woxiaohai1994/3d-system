import { sampleScenePlayback, sceneRegistry, useScene } from '@pascal-app/core'
import {
  createTransformMotionEvaluator,
  type MotionPathData,
  OVERLAY_LAYER,
  useViewer,
} from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferGeometry, LineSegments, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { LineBasicNodeMaterial } from 'three/webgpu'
import { useI18n } from '../../i18n'
import useInteractionScope from '../../store/use-interaction-scope'
import { swallowNextClick } from '../editor/handles/use-handle-drag'
import { useSceneAnimation } from '../scene-animation/store'
import { curveNodes, moveCurveNode } from './motion-curve'
import { commitPath, editingPathData, editingPathNode, previewPath } from './motion-path-context'
import {
  editMotionPath,
  pathHandles,
  reshapeMotionPath,
  reshapePathNodeHandle,
  translateMotionPath,
} from './motion-path-edit'
import { addPathNode, deletePathNode, selectPathNode } from './motion-path-nodes'
import { previewCameraPathLocation } from './motion-path-preview'

export function MotionPath(props: { points: Vector3[]; segmentId: string; selected: boolean }) {
  const data = editingPathData(),
    node = editingPathNode()
  const index = data.segments.findIndex((s) => s.id === props.segmentId)
  if (index < 0) return null
  const segment = data.segments[index]!
  if (segment.path !== 'bezier') return <MotionPathSpan {...props} span={0} />
  const nodes = curveNodes(data, segment.id),
    evaluator = createTransformMotionEvaluator(data)
  const parent = node?.parentId ? sceneRegistry.nodes.get(node.parentId) : null
  parent?.updateWorldMatrix(true, false)
  return (
    <>
      {nodes.slice(1).map((end, span) => {
        const begin = nodes[span]!
        const points = Array.from({ length: 65 }, (_, i) => {
          const p = evaluator.positionAt(index, begin.at + ((end.at - begin.at) * i) / 64)
          return parent ? parent.localToWorld(p) : p
        })
        return <MotionPathSpan key={begin.id} {...props} points={points} span={span} />
      })}
    </>
  )
}

function MotionPathSpan({
  points,
  segmentId,
  selected,
  span,
}: {
  points: Vector3[]
  segmentId: string
  selected: boolean
  span: number
}) {
  const get = useThree((s) => s.get)
  const zh = useI18n().locale === 'zh-CN'
  const state = useSceneAnimation()
  const cancelRef = useRef<(() => void) | null>(null)
  useEffect(() => () => cancelRef.current?.(), [])
  const geometry = useMemo(
    () =>
      new BufferGeometry().setFromPoints(points.flatMap((p, i) => (i ? [points[i - 1]!, p] : []))),
    [points],
  )
  const material = useMemo(
    () => new LineBasicNodeMaterial({ color: selected ? '#fbbf24' : '#38bdf8', depthTest: false }),
    [selected],
  )
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  const start = (
    event: PointerEvent,
    hit: Vector3,
    handle: 0 | 1 | 'curve' | 'start' | 'end' | 'all',
  ) => {
    if (
      event.button !== 0 ||
      useInteractionScope.getState().scope.kind !== 'idle' ||
      !editMotionPath(segmentId)
    )
      return
    event.preventDefault()
    event.stopPropagation()
    const original = editingPathData(),
      node = editingPathNode()!
    useSceneAnimation.setState({ pathSelected: handle === 'all' || handle === 'curve' })
    const activeNodes = curveNodes(original, segmentId)
    if (handle === 'start' || handle === 'end' || typeof handle === 'number')
      useSceneAnimation.setState({
        pointId: activeNodes[span + (handle === 'start' || handle === 0 ? 0 : 1)]!.id,
      })
    if (handle === 'start' || handle === 'end')
      previewCameraPathLocation(segmentId, activeNodes[span + (handle === 'start' ? 0 : 1)]!.at)
    else if (handle !== 'all')
      previewCameraPathLocation(segmentId, (activeNodes[span]!.at + activeNodes[span + 1]!.at) / 2)
    const { camera, gl, controls } = get()
    if (handle === 'all' || handle === 'curve') {
      gl.domElement.tabIndex = 0
      gl.domElement.focus({ preventScroll: true })
    }
    const control = controls as unknown as {
      enabled: boolean
      finishPointerInput?: () => void
    } | null
    const wasEnabled = control?.enabled ?? true
    control?.finishPointerInput?.()
    if (control) control.enabled = false
    const parent = node.parentId ? sceneRegistry.nodes.get(node.parentId) : null
    parent?.updateWorldMatrix(true, false)
    const inverse = parent?.matrixWorld.clone().invert()
    const local = (v: Vector3) => (inverse ? v.applyMatrix4(inverse) : v)
    const plane = new Plane().setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(new Vector3()),
      hit,
    )
    const ray = new Raycaster(),
      pointer = new Vector2()
    const project = (x: number, y: number) => {
      const box = gl.domElement.getBoundingClientRect()
      pointer.set(((x - box.left) / box.width) * 2 - 1, (-(y - box.top) / box.height) * 2 + 1)
      ray.setFromCamera(pointer, camera)
      const v = ray.ray.intersectPlane(plane, new Vector3())
      return v ? local(v) : null
    }
    const origin = project(event.clientX, event.clientY)
    if (!origin) {
      if (control) control.enabled = wasEnabled
      return
    }
    useInteractionScope
      .getState()
      .begin({ kind: 'handle-drag', nodeId: node.id, handle: 'camera-motion-path' })
    useViewer.getState().setInputDragging(true)
    let draft: MotionPathData | null = null
    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return
      if (e.pointerType !== 'touch' && !(e.buttons & 1)) {
        finish(false)
        return
      }
      const current = project(e.clientX, e.clientY)
      if (!current || Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY) < 3) return
      const delta = current.sub(origin)
      const nodes = curveNodes(original, segmentId)
      draft =
        typeof handle === 'number'
          ? reshapePathNodeHandle(original, segmentId, delta, handle, e.altKey, span)
          : handle === 'curve'
            ? reshapeMotionPath(original, segmentId, delta, handle, span)
            : handle === 'all'
              ? translateMotionPath(original, delta, parent ?? null)
              : moveCurveNode(original, nodes[span + (handle === 'start' ? 0 : 1)]!.id, delta)
      previewPath(draft)
      sampleScenePlayback(useSceneAnimation.getState().time)
    }
    const finish = (cancel: boolean) => {
      cancelRef.current = null
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', cancelled, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', blur)
      useSceneAnimation.setState({ sceneDraft: null })
      if (!cancel && draft) commitPath(draft)
      else sampleScenePlayback(useSceneAnimation.getState().time)
      useInteractionScope
        .getState()
        .endIf(
          (s) =>
            s.kind === 'handle-drag' && s.nodeId === node.id && s.handle === 'camera-motion-path',
        )
      useViewer.getState().setInputDragging(false)
      if (control) control.enabled = wasEnabled
      swallowNextClick()
    }
    const up = (e: PointerEvent) => {
      if (e.pointerId === event.pointerId) finish(false)
    }
    const cancelled = (e: PointerEvent) => {
      if (e.pointerId === event.pointerId) finish(true)
    }
    const blur = () => finish(true)
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z')) {
        e.preventDefault()
        e.stopImmediatePropagation()
        finish(true)
      }
    }
    cancelRef.current = blur
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', cancelled, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', blur)
  }
  const data = editingPathData(),
    node = editingPathNode()
  const segment = data.segments.find((s) => s.id === segmentId)!
  const handles = pathHandles(data, segmentId, span)
  const segmentIndex = data.segments.findIndex((s) => s.id === segmentId)
  const nodes = curveNodes(data, segmentId),
    fromId = nodes[span]!.id,
    toId = nodes[span + 1]!.id
  const nodeSelected = state.pointId === fromId || state.pointId === toId
  const showHandles = nodeSelected || selected
  const parent = node?.parentId ? sceneRegistry.nodes.get(node.parentId) : null
  parent?.updateWorldMatrix(true, false)
  const handlePoints = handles.map((h, i) => {
    const vector = parent
      ? parent.localToWorld(h.clone()).sub(parent.localToWorld(new Vector3()))
      : h.clone()
    return vector.add(points[i === 0 ? 0 : 64]!)
  })
  const blocked =
    useScene.getState().readOnly ||
    useSceneAnimation.getState().playing ||
    useSceneAnimation.getState().exporting ||
    !!useSceneAnimation.getState().pickingAnchor ||
    useSceneAnimation.getState().lockedIds.includes(node?.id ?? '')
  return (
    <group userData={{ cameraHelper: true }}>
      <lineSegments
        geometry={geometry}
        material={material}
        layers={OVERLAY_LAYER}
        dispose={null}
        userData={{ motionPath: segmentId }}
        raycast={function (this: LineSegments, raycaster, intersections) {
          const previous = raycaster.params.Line.threshold
          raycaster.params.Line.threshold =
            7 / get().viewport.getCurrentViewport(get().camera, points[32]!).factor
          try {
            const first = intersections.length
            LineSegments.prototype.raycast.call(this, raycaster, intersections)
            // The path is drawn above scene surfaces, so its hit target must be above them too.
            for (let i = first; i < intersections.length; i++) intersections[i]!.distance = 0
          } finally {
            raycaster.params.Line.threshold = previous
          }
        }}
        onPointerDown={(e) => {
          if (!blocked && e.button === 0) {
            e.stopPropagation()
            start(e.nativeEvent, e.point, 'all')
          }
        }}
        onDoubleClick={(e) => {
          if (blocked) return
          e.stopPropagation()
          let nearest = 0,
            distance = Infinity
          points.forEach((p, i) => {
            const d = p.distanceToSquared(e.point)
            if (d < distance) {
              nearest = i
              distance = d
            }
          })
          addPathNode(
            segmentId,
            nodes[span]!.at +
              ((nodes[span + 1]!.at - nodes[span]!.at) * nearest) / (points.length - 1),
          )
        }}
      />
      {!blocked &&
        ([0, 64] as const).map((index, i) => {
          if (i === 1 && (span !== nodes.length - 2 || segmentIndex !== data.segments.length - 1))
            return null
          const pointId = i === 0 ? fromId : toId
          const ordinal = span + i + 1
          return (
            <Html key={pointId} position={points[index]} center zIndexRange={[45, 40]}>
              <button
                type="button"
                data-path-node={pointId}
                aria-label={zh ? `轨迹节点 ${ordinal}` : `Path node ${ordinal}`}
                title={
                  zh ? '拖动移动节点；按删除键删除节点' : 'Drag to move; Delete removes this node'
                }
                aria-pressed={state.pointId === pointId}
                className={`h-4 w-4 cursor-move rounded-full border-2 border-white focus-visible:outline-2 focus-visible:outline-sky-400 ${state.pointId === pointId ? 'bg-amber-500' : 'bg-sky-600'}`}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  e.currentTarget.focus()
                  start(e.nativeEvent, points[index]!, i === 0 ? 'start' : 'end')
                }}
                onClick={(e) => {
                  if (e.detail === 0) selectPathNode(pointId, segmentId)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault()
                    e.stopPropagation()
                    deletePathNode(pointId)
                  }
                }}
              />
            </Html>
          )
        })}
      {showHandles && !blocked && (
        <>
          {segment.path === 'bezier' &&
            handlePoints.map(
              (position, i) =>
                state.pointId === (i === 0 ? fromId : toId) && (
                  <group key={i}>
                    <HandleLine from={points[i === 0 ? 0 : 64]!} to={position} />
                    <Html position={position} center zIndexRange={[40, 30]}>
                      <button
                        type="button"
                        data-path-node={i === 0 ? fromId : toId}
                        aria-label={
                          zh
                            ? `节点 ${span + i + 1} ${i === 0 ? '出' : '入'}控制柄`
                            : `Node ${span + i + 1} ${i === 0 ? 'out' : 'in'} handle`
                        }
                        title={
                          zh ? '拖动手柄调整路径；按退出键取消' : 'Drag to reshape; Esc cancels'
                        }
                        className="h-3 w-3 cursor-move rounded-full border-2 border-amber-200 bg-amber-500"
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          start(e.nativeEvent, position, i as 0 | 1)
                        }}
                      />
                    </Html>
                  </group>
                ),
            )}
          {selected && !state.pointId && (
            <Html position={points[32]} center zIndexRange={[40, 30]}>
              <button
                type="button"
                data-motion-path={segmentId}
                aria-label={zh ? '拖动路径' : 'Drag path'}
                title={
                  zh
                    ? '拖动调整曲线；按删除键删除整条路径；按退出键取消拖动'
                    : 'Drag to bend; Delete removes the whole path; Esc cancels drag'
                }
                className="h-4 w-4 cursor-move rotate-45 border-2 border-sky-100 bg-sky-500"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  start(e.nativeEvent, points[32]!, 'curve')
                }}
              />
            </Html>
          )}
        </>
      )}
    </group>
  )
}

function HandleLine({ from, to }: { from: Vector3; to: Vector3 }) {
  const geometry = useMemo(() => new BufferGeometry().setFromPoints([from, to]), [from, to])
  const material = useMemo(
    () =>
      new LineBasicNodeMaterial({
        color: '#fbbf24',
        depthTest: false,
        transparent: true,
        opacity: 0.6,
      }),
    [],
  )
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  return (
    <lineSegments
      geometry={geometry}
      material={material}
      layers={OVERLAY_LAYER}
      raycast={() => {}}
      dispose={null}
    />
  )
}

export function SinglePathNode({ pointId, position }: { pointId: string; position: Vector3 }) {
  const state = useSceneAnimation()
  const zh = useI18n().locale === 'zh-CN'
  const node = editingPathNode()
  if (
    useScene.getState().readOnly ||
    state.playing ||
    state.exporting ||
    state.lockedIds.includes(node?.id ?? '')
  )
    return null
  return (
    <Html position={position} center zIndexRange={[45, 40]}>
      <button
        type="button"
        data-path-node={pointId}
        aria-label={zh ? '轨迹节点 1' : 'Path node 1'}
        title={zh ? '按删除键删除节点' : 'Delete removes this node'}
        aria-pressed={state.pointId === pointId}
        className={`h-4 w-4 rounded-full border-2 border-white ${state.pointId === pointId ? 'bg-amber-500' : 'bg-sky-600'}`}
        onPointerDown={(e) => {
          e.stopPropagation()
          e.currentTarget.focus()
          selectPathNode(pointId)
        }}
        onClick={() => selectPathNode(pointId)}
        onKeyDown={(e) => {
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault()
            e.stopPropagation()
            deletePathNode(pointId)
          }
        }}
      />
    </Html>
  )
}
