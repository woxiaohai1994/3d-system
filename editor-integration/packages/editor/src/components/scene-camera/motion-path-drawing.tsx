import {
  type CameraMotionPoint,
  type CameraMotionPose,
  type SceneTrack,
  sceneRegistry,
  type TransformPose,
  upsertAnimationTrack,
  useScene,
} from '@pascal-app/core'
import { OVERLAY_LAYER } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { BufferGeometry, CubicBezierCurve3, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { LineBasicNodeMaterial } from 'three/webgpu'
import { create } from 'zustand'
import { useI18n } from '../../i18n'
import useInteractionScope from '../../store/use-interaction-scope'
import { swallowNextClick } from '../editor/handles/use-handle-drag'
import { animationData, commitSceneAnimation } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { requestMotionTransition } from './motion-edit-session'
import { useObjectMotion } from './motion-object-store'
import { objectPose } from './motion-objects'
import { commitPath, editingPathData, editingPathNode } from './motion-path-context'
import { leaveMotionCameraView, motionPreviewPose } from './motion-state'

import { createDrawnTrajectory, reshapeDrawnTrajectory } from './motion-trajectory'

type Point = [number, number, number]
export const usePathDrawing = create<{
  nodeId: string | null
  segmentId: string | null
  points: Point[]
  tangents: Point[]
  duration: number
  startTime: number
  savedShape: string | null
  originalTrack: SceneTrack | null
  pose: TransformPose | CameraMotionPose | CameraMotionPoint | null
  error: 'time' | 'overlap' | 'empty' | null
}>(() => ({
  nodeId: null,
  segmentId: null,
  points: [],
  tangents: [],
  duration: 5,
  startTime: 0,
  savedShape: null,
  originalTrack: null,
  pose: null,
  error: null,
}))

export function drawingCurves(points: Point[], tangents: Point[]): [Point, Point][] {
  return points.slice(1).map((p, i) => {
    const chord = new Vector3(...p).sub(new Vector3(...points[i]!)).divideScalar(3)
    const outgoing = new Vector3(...(tangents[i] ?? [0, 0, 0]))
    const incoming = new Vector3(...(tangents[i + 1] ?? [0, 0, 0]))
    return [
      (outgoing.lengthSq() > 1e-10 ? outgoing : chord).toArray(),
      (incoming.lengthSq() > 1e-10 ? incoming : chord).clone().negate().toArray(),
    ]
  })
}

export function startPathDrawing(duration: number) {
  if (!requestMotionTransition(() => startPathDrawing(duration))) return
  const node = editingPathNode(),
    id = useObjectMotion.getState().nodeId,
    pose = id ? objectPose(id) : motionPreviewPose()
  if (
    !node ||
    !pose ||
    usePathDrawing.getState().nodeId ||
    useSceneAnimation.getState().sceneDraft ||
    useSceneAnimation.getState().playing ||
    useSceneAnimation.getState().exporting ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    useScene.getState().readOnly ||
    useSceneAnimation.getState().lockedIds.includes(node.id)
  )
    return
  const originalTrack = structuredClone(
    animationData().tracks.find((t) => t.nodeId === node.id) ?? null,
  )
  const position = pose.position,
    keyedPose = pose,
    startTime = useSceneAnimation.getState().time,
    result = createDrawnTrajectory(
      editingPathData(),
      keyedPose,
      [position, position],
      startTime,
      duration,
      animationData().fps,
      !id,
      undefined,
      true,
    )
  if ('error' in result) {
    usePathDrawing.setState({ error: result.error })
    return
  }
  if (!commitPath(result.data)) return
  leaveMotionCameraView()
  useSceneAnimation.setState({ segmentId: result.segmentId, pointId: null })
  usePathDrawing.setState({
    nodeId: node.id,
    originalTrack,
    segmentId: result.segmentId,
    points: [position],
    tangents: [[0, 0, 0]],
    duration,
    startTime,
    savedShape: JSON.stringify([[position], [[0, 0, 0]]]),
    pose: keyedPose,
    error: null,
  })
}

export function savePathDrawing(
  points = usePathDrawing.getState().points,
  tangents = usePathDrawing.getState().tangents,
) {
  const drawing = usePathDrawing.getState(),
    state = useSceneAnimation.getState(),
    node = editingPathNode()
  if (
    !drawing.nodeId ||
    !drawing.segmentId ||
    node?.id !== drawing.nodeId ||
    !points.length ||
    useScene.getState().readOnly ||
    state.playing ||
    state.exporting ||
    state.sceneDraft ||
    state.lockedIds.includes(drawing.nodeId)
  )
    return false
  const shape = JSON.stringify([points, tangents])
  if (shape === drawing.savedShape) return true
  const route = points.length === 1 ? [points[0]!, points[0]!] : points
  const result = reshapeDrawnTrajectory(
    editingPathData(),
    drawing.segmentId,
    route,
    animationData().fps,
    node.type === 'scene-camera',
    points.length > 1 ? drawingCurves(points, tangents) : undefined,
    true,
  )
  if ('error' in result) {
    usePathDrawing.setState({ error: result.error })
    return false
  }
  if (!commitPath(result.data)) return false
  usePathDrawing.setState({ points, tangents, savedShape: shape, error: null })
  return true
}

export function finishPathDrawing() {
  if (!usePathDrawing.getState().nodeId) return true
  if (!savePathDrawing()) return false
  endPathDrawing()
  return true
}

export function cancelPathDrawing() {
  const drawing = usePathDrawing.getState()
  if (!drawing.nodeId) return true
  if (useScene.getState().readOnly || useSceneAnimation.getState().exporting) return false
  const scene = animationData()
  const restored = drawing.originalTrack
    ? upsertAnimationTrack(scene, drawing.originalTrack)
    : { ...scene, tracks: scene.tracks.filter((t) => t.nodeId !== drawing.nodeId) }
  if (!commitSceneAnimation(restored)) return false
  endPathDrawing()
  useSceneAnimation.setState({ segmentId: null, pointId: null })
  return true
}

export function endPathDrawing() {
  usePathDrawing.setState({
    nodeId: null,
    segmentId: null,
    points: [],
    tangents: [],
    pose: null,
    savedShape: null,
    originalTrack: null,
    error: null,
  })
}

export function MotionPathDrawing() {
  const get = useThree((s) => s.get),
    drawing = usePathDrawing(),
    state = useSceneAnimation(),
    objectId = useObjectMotion((s) => s.nodeId),
    zh = useI18n().locale === 'zh-CN',
    readOnly = useScene((s) => s.readOnly),
    nodes = useScene((s) => s.nodes)
  const drawingExists =
    !drawing.nodeId ||
    (drawing.nodeId in nodes &&
      animationData().tracks.some(
        (t) => t.nodeId === drawing.nodeId && t.segments?.some((s) => s.id === drawing.segmentId),
      ))
  const beginHandle = useRef<(e: PointerEvent, index: number, sign: number) => void>(() => {})
  useEffect(() => {
    if (
      state.cameraView ||
      state.playing ||
      state.exporting ||
      !state.open ||
      readOnly ||
      (drawing.nodeId &&
        (drawing.nodeId !== (objectId ?? state.cameraId) ||
          state.lockedIds.includes(drawing.nodeId) ||
          !drawingExists))
    )
      usePathDrawing.setState({ nodeId: null, points: [], tangents: [] })
  }, [
    state.open,
    state.cameraId,
    state.cameraView,
    state.playing,
    state.exporting,
    state.lockedIds,
    objectId,
    drawing.nodeId,
    readOnly,
    drawingExists,
  ])
  useEffect(() => {
    if (!drawing.nodeId) return
    const canvas = get().gl.domElement,
      style = document.createElement('style'),
      node = editingPathNode()!,
      parent = node.parentId ? sceneRegistry.nodes.get(node.parentId) : null
    style.textContent =
      'canvas[data-motion-path-drawing] {cursor:crosshair!important} canvas[data-motion-path-drawing="pan"] {cursor:grab!important}'
    canvas.setAttribute('data-motion-path-drawing', '')
    document.head.append(style)
    parent?.updateWorldMatrix(true, false)
    const origin = new Vector3(...usePathDrawing.getState().points[0]!),
      normal = new Vector3(0, 1, 0)
    if (parent) {
      parent.localToWorld(origin)
      normal.transformDirection(parent.matrixWorld)
    }
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, origin)
    const project = (e: PointerEvent) => {
      const box = canvas.getBoundingClientRect(),
        ray = new Raycaster()
      ray.setFromCamera(
        new Vector2(
          (2 * (e.clientX - box.left)) / box.width - 1,
          1 - (2 * (e.clientY - box.top)) / box.height,
        ),
        get().camera,
      )
      if (Math.abs(ray.ray.direction.dot(plane.normal)) < 0.001) return null
      const point = ray.ray.intersectPlane(plane, new Vector3())
      if (point) parent?.worldToLocal(point)
      return point
    }
    let space = false
    let finishDrag: ((cancel: boolean) => void) | null = null
    const begin = (e: PointerEvent, index?: number, sign = 1) => {
      if (
        e.button !== 0 ||
        space ||
        finishDrag ||
        useInteractionScope.getState().scope.kind !== 'idle'
      )
        return
      const point = project(e)
      if (!point) return
      const before = usePathDrawing.getState()
      if (
        index === undefined &&
        (before.points.length >= 200 ||
          point.distanceTo(new Vector3(...before.points.at(-1)!)) < 0.01)
      )
        return
      e.preventDefault()
      e.stopImmediatePropagation()
      swallowNextClick()
      const added = index === undefined
      const target = index ?? before.points.length
      if (added)
        usePathDrawing.setState({
          points: [...before.points, point.toArray()],
          tangents: [...before.tangents, [0, 0, 0]],
        })
      const controls = get().controls as unknown as {
        enabled: boolean
        finishPointerInput?: () => void
      } | null
      const enabled = controls?.enabled ?? true
      controls?.finishPointerInput?.()
      if (controls) controls.enabled = false
      useInteractionScope
        .getState()
        .begin({ kind: 'handle-drag', nodeId: node.id, handle: 'motion-drawing' })
      const move = (event: PointerEvent) => {
        if (event.pointerId !== e.pointerId) return
        if (event.pointerType !== 'touch' && !(event.buttons & 1)) {
          finish(false)
          return
        }
        event.stopImmediatePropagation()
        if (Math.hypot(event.clientX - e.clientX, event.clientY - e.clientY) < 3) return
        const position = project(event),
          current = usePathDrawing.getState()
        if (!position) return
        const tangent = position
          .sub(new Vector3(...current.points[target]!))
          .multiplyScalar(sign)
          .toArray()
        usePathDrawing.setState({
          tangents: current.tangents.map((t, i) => (i === target ? tangent : t)),
        })
      }
      const finish = (cancel: boolean) => {
        finishDrag = null
        window.removeEventListener('pointermove', move, true)
        window.removeEventListener('pointerup', up, true)
        window.removeEventListener('pointercancel', cancelPointer, true)
        if (cancel || !savePathDrawing())
          usePathDrawing.setState({ points: before.points, tangents: before.tangents })
        useInteractionScope
          .getState()
          .endIf(
            (s) =>
              s.kind === 'handle-drag' && s.nodeId === node.id && s.handle === 'motion-drawing',
          )
        if (controls) controls.enabled = enabled
        swallowNextClick()
      }
      const up = (event: PointerEvent) => {
        if (event.pointerId === e.pointerId) finish(false)
      }
      const cancelPointer = (event: PointerEvent) => {
        if (event.pointerId === e.pointerId) finish(true)
      }
      finishDrag = finish
      window.addEventListener('pointermove', move, true)
      window.addEventListener('pointerup', up, true)
      window.addEventListener('pointercancel', cancelPointer, true)
    }
    beginHandle.current = begin
    const down = (e: PointerEvent) => {
      if (e.target === canvas) begin(e)
    }
    const key = (e: KeyboardEvent) => {
      if (useSceneAnimation.getState().sceneDraft) return
      if (
        e.target instanceof Element &&
        e.target.closest('input, textarea, select, [contenteditable="true"], [role="menu"]')
      )
        return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (finishDrag) {
          e.preventDefault()
          e.stopImmediatePropagation()
          finishDrag(true)
        } else endPathDrawing()
        return
      }
      if (e.code === 'Space') {
        space = true
        canvas.setAttribute('data-motion-path-drawing', 'pan')
      }
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        e.stopImmediatePropagation()
        finishDrag?.(false)
        finishPathDrawing()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        finishDrag?.(true)
        cancelPathDrawing()
      }
    }
    const keyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        space = false
        canvas.setAttribute('data-motion-path-drawing', '')
      }
    }
    const blur = () => {
      space = false
      finishDrag?.(true)
      canvas.setAttribute('data-motion-path-drawing', '')
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('keyup', keyUp, true)
    window.addEventListener('blur', blur)
    return () => {
      finishDrag?.(true)
      beginHandle.current = () => {}
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('keyup', keyUp, true)
      window.removeEventListener('blur', blur)
      canvas.removeAttribute('data-motion-path-drawing')
      style.remove()
    }
  }, [drawing.nodeId, get])
  const node = editingPathNode(),
    parent = node?.parentId ? sceneRegistry.nodes.get(node.parentId) : null
  parent?.updateWorldMatrix(true, false)
  const world = useCallback((v: Vector3) => (parent ? parent.localToWorld(v) : v), [parent])
  const geometry = useMemo(() => {
    const vertices: Vector3[] = []
    const curves = drawingCurves(drawing.points, drawing.tangents)
    for (let i = 1; i < drawing.points.length; i++) {
      const a = new Vector3(...drawing.points[i - 1]!),
        b = new Vector3(...drawing.points[i]!),
        handles = curves[i - 1]!
      const samples = new CubicBezierCurve3(
        a,
        a.clone().add(new Vector3(...handles[0])),
        b.clone().add(new Vector3(...handles[1])),
        b,
      ).getPoints(32)
      samples.forEach((p, j) => {
        if (j) vertices.push(world(samples[j - 1]!.clone()), world(p.clone()))
      })
    }
    drawing.points.forEach((p, i) => {
      const a = new Vector3(...p),
        t = new Vector3(...(drawing.tangents[i] ?? [0, 0, 0]))
      vertices.push(world(a.clone().sub(t)), world(a.add(t)))
    })
    return new BufferGeometry().setFromPoints(vertices)
  }, [drawing.points, drawing.tangents, world])
  const material = useMemo(
    () => new LineBasicNodeMaterial({ color: '#fbbf24', depthTest: false }),
    [],
  )
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  if (!drawing.nodeId) return null
  return (
    <group userData={{ cameraHelper: true }}>
      <lineSegments
        geometry={geometry}
        material={material}
        layers={OVERLAY_LAYER}
        raycast={() => {}}
        dispose={null}
      />
      {drawing.points.map((p, i) => (
        <group key={i}>
          <Html position={world(new Vector3(...p))} center zIndexRange={[40, 30]}>
            <button
              type="button"
              aria-label={zh ? `路线锚点 ${i + 1}` : `Route anchor ${i + 1}`}
              title={zh ? '拖动拉出贝塞尔控制柄' : 'Drag to set Bézier handles'}
              className="h-4 w-4 cursor-crosshair rounded-full border-2 border-white bg-sky-600"
              onPointerDown={(e) => {
                e.stopPropagation()
                beginHandle.current(e.nativeEvent, i, 1)
              }}
            />
          </Html>
          {new Vector3(...(drawing.tangents[i] ?? [0, 0, 0])).lengthSq() > 0.0001 &&
            [-1, 1].map((sign) => (
              <Html
                key={sign}
                position={world(
                  new Vector3(...p).addScaledVector(new Vector3(...drawing.tangents[i]!), sign),
                )}
                center
                zIndexRange={[40, 30]}
              >
                <button
                  type="button"
                  aria-label={
                    zh
                      ? `路线控制柄 ${i + 1} ${sign < 0 ? '入' : '出'}`
                      : `Route handle ${i + 1} ${sign}`
                  }
                  className="h-3 w-3 cursor-move rounded-full border-2 border-amber-200 bg-amber-500"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    beginHandle.current(e.nativeEvent, i, sign)
                  }}
                />
              </Html>
            ))}
        </group>
      ))}
    </group>
  )
}
