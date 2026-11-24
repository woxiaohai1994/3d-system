import {
  type AnyNodeId,
  cameraTracks,
  sampleScenePlayback,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  bindPlaybackTransforms,
  bindScenePlaybackShaderTime,
  createCameraMotionEvaluator,
  useViewer,
} from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'
import { runRedo, runUndo } from '../../lib/history'
import useInteractionScope from '../../store/use-interaction-scope'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { useMotionAnchorPicker } from './motion-anchor-picker'
import { MotionCameraMarker } from './motion-camera-marker'
import { clearMotionProperties, hasMotionEdits, useMotionEdits } from './motion-edit-session'
import { MotionObjectPath } from './motion-object-path'
import { useObjectMotion } from './motion-object-store'
import { bindObjectMotionSampler, canAnimateObject, selectMotionObject } from './motion-objects'
import { MotionPath, SinglePathNode } from './motion-path'
import { usePathDrawing } from './motion-path-drawing'
import { deletePathSelection } from './motion-path-nodes'
import { bindMotionDrafts } from './motion-properties'
import {
  cameraPoseAt,
  endSceneAnimation,
  motionData,
  motionPlaybackRange,
  resolveMotionTarget,
  selectMotionCamera,
} from './motion-state'
import { useCameraStudio } from './store'
import { bindRigPropertyEdits } from './rig-property-animation'

export function CameraMotionRuntime() {
  useMotionAnchorPicker()
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const state = useSceneAnimation.getState()
      if (!state.open || state.workspace === 'film' || usePathDrawing.getState().nodeId) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (
          !(e.target instanceof Element) ||
          e.target.closest(
            'input,textarea,select,[contenteditable="true"],[role="menu"],[role="dialog"]',
          ) ||
          state.playing ||
          state.exporting ||
          state.sceneDraft ||
          hasMotionEdits() ||
          useInteractionScope.getState().scope.kind !== 'idle'
        )
          return
        e.preventDefault()
        e.stopImmediatePropagation()
        if (e.shiftKey) runRedo()
        else runUndo()
        return
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (
        !(e.target instanceof Element) ||
        !e.target.closest('canvas,[data-path-node],[data-motion-path]')
      )
        return
      if (!state.pointId && !(state.segmentId && state.pathSelected)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (!e.repeat) deletePathSelection()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [])
  const objectBinding = useRef<ReturnType<typeof bindPlaybackTransforms> | null>(null)
  useEffect(() => {
    const binding = bindPlaybackTransforms()
    objectBinding.current = binding
    const release = bindObjectMotionSampler()
    const releaseDrafts = bindMotionDrafts()
    const releaseRigEdits = bindRigPropertyEdits()
    return () => {
      releaseRigEdits()
      releaseDrafts()
      release()
      binding.dispose()
      objectBinding.current = null
    }
  }, [])
  useFrame(() => objectBinding.current?.sync(), 6)
  useEffect(
    () =>
      useViewer.subscribe((next, previous) => {
        if (next.selection.selectedIds === previous.selection.selectedIds) return
        const state = useSceneAnimation.getState(),
          id = next.selection.selectedIds.length === 1 ? next.selection.selectedIds[0] : null
        if (
          !id ||
          !state.open ||
          state.workspace === 'film' ||
          state.playing ||
          state.exporting ||
          state.previewing ||
          state.pickingRigAim ||
          state.pickingAnchor ||
          useCameraStudio.getState().pickingFocus
        )
          return
        const node = useScene.getState().nodes[id as AnyNodeId]
        if (
          node?.type === 'scene-camera' &&
          (state.cameraId !== id || useObjectMotion.getState().nodeId)
        )
          selectMotionCamera(id)
        else if (canAnimateObject(node) && useObjectMotion.getState().nodeId !== id)
          selectMotionObject(id)
      }),
    [],
  )
  const state = useSceneAnimation()
  const drawing = usePathDrawing((s) => s.nodeId)
  const activeId = useCameraStudio((s) => s.activeId)
  const node = useScene((s) => (state.cameraId ? s.nodes[state.cameraId] : null))
  const previous = useRef<number | null>(null)
  useEffect(() => () => endSceneAnimation(true), [])
  useEffect(() => {
    if (state.open) return bindScenePlaybackShaderTime()
  }, [state.open])
  useEffect(() => {
    if (state.cameraId && !node) {
      state.finishCameraEdit?.(false)
      clearMotionProperties(state.cameraId)
      useMotionEdits.setState({ cameraDirty: false })
      useSceneAnimation.setState({
        playing: false,
        draft: null,

        pickingRigAim: false,
        pickingAnchor: null,
        pointId: null,
        segmentId: null,
        sceneDraft: null,
      })
      useSceneAnimation.setState({
        cameraId: null,
        outputCameraId: null,
        cameraView: false,
        viewCameraId: null,
      })
    }
  }, [state.cameraId, node, state.finishCameraEdit])
  useFrame(() => {
    const current = useSceneAnimation.getState(),
      now = performance.now()
    if (!current.playing || current.exporting || current.workspace === 'film') {
      previous.current = null
      return
    }
    const [start, duration] = motionPlaybackRange()
    const time = Math.min(
      duration,
      current.time + (previous.current === null ? 0 : (now - previous.current) / 1000),
    )
    previous.current = now
    const nextTime = time >= duration && current.loop ? start : time
    sampleScenePlayback(nextTime)
    useSceneAnimation.setState({ time: nextTime, playing: current.loop || time < duration })
  }, -100)
  if (!state.open || state.workspace === 'film' || state.exporting || state.previewing || drawing)
    return null
  if (state.cameraView || node?.type !== 'scene-camera') return <MotionObjectPath />
  const data = motionData(node)
  if (!data?.points.length)
    return (
      <>
        <MotionCameraMarker />
        <MotionObjectPath />
      </>
    )
  const positionalFollow =
    data.points.some((p) => p.rig) ||
    cameraTracks(animationData()).find((t) => t.nodeId === node.id)?.follow
  const evaluator = positionalFollow ? null : createCameraMotionEvaluator(data, resolveMotionTarget)
  const parent = node.parentId ? sceneRegistry.nodes.get(node.parentId) : null
  parent?.updateWorldMatrix(true, false)
  const world = (position: [number, number, number]) => {
    const vector = new Vector3(...position)
    return parent ? parent.localToWorld(vector) : vector
  }
  return (
    <group userData={{ cameraHelper: true }}>
      <MotionCameraMarker />
      <MotionObjectPath />
      {!useObjectMotion.getState().nodeId && data.points.length === 1 && (
        <SinglePathNode pointId={data.points[0]!.id} position={world(data.points[0]!.position)} />
      )}
      {!useObjectMotion.getState().nodeId &&
        data.segments.map((segment, index) => {
          const a = data.points[index]!,
            b = data.points[index + 1]!
          const points = Array.from({ length: 65 }, (_, n) =>
            world(
              (
                evaluator?.sample(a.time + ((b.time - a.time) * n) / 64) ??
                cameraPoseAt(node, a.time + ((b.time - a.time) * n) / 64)
              ).position,
            ),
          )
          return (
            <MotionPath
              key={segment.id}
              segmentId={segment.id}
              points={points}
              selected={!!state.segmentId && (state.pathSelected || state.segmentId === segment.id)}
            />
          )
        })}
    </group>
  )
}
