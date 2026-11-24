'use client'

import {
  type AnyNodeId,
  sceneRegistry,
  useLiveNodeOverrides,
  useRegistryVersion,
  useScene,
} from '@pascal-app/core'
import { OVERLAY_LAYER, useViewer } from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Euler, Object3D, Quaternion } from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import useInteractionScope from '../../store/use-interaction-scope'
import { useSceneAnimation } from '../scene-animation/store'
import { bindCameraTransformPointer } from './camera-transform-pointer'
import { commitExistingKey } from './motion-edit-session'
import { useObjectMotion } from './motion-object-store'
import { changeMotionDraft, motionPreviewPose } from './motion-state'
import { localCameraPreviewPose } from './preview-navigation'
import { openCameraStudio, useCameraStudio } from './store'

/** Camera transforms are committed once on release; preview follows the live object. */
export function SceneCameraGizmo() {
  const { camera, gl, scene, invalidate, get } = useThree()
  const motionActive = useSceneAnimation((s) => !!s.cameraId)
  const motionId = useSceneAnimation((s) =>
    !s.cameraView &&
    !s.playing &&
    !s.exporting &&
    !s.previewing &&
    !s.segmentId &&
    !s.lockedIds.includes(s.cameraId ?? '')
      ? s.cameraId
      : null,
  )
  const objectId = useObjectMotion((s) => s.nodeId)
  const selectedId = useViewer((s) =>
    s.selection.selectedIds.length === 1 ? s.selection.selectedIds[0] : null,
  )
  const cameraId = useScene((s) =>
    !s.readOnly &&
    (motionActive
      ? motionId && !objectId
      : selectedId && s.nodes[selectedId as AnyNodeId]?.type === 'scene-camera')
      ? motionActive
        ? motionId
        : selectedId
      : null,
  )
  const rigToken = useSceneAnimation((s) => s.draft?.rig?.type ?? s.pointId)
  const savedRig = useScene((s) =>
    cameraId && s.nodes[cameraId as AnyNodeId]?.type === 'scene-camera'
      ? (s.nodes[cameraId as AnyNodeId] as import('@pascal-app/core').SceneCameraNode).rig
      : null,
  )
  const registryVersion = useRegistryVersion()
  const mode = useCameraStudio((s) => (s.transformMode === 'scale' ? 'translate' : s.transformMode))
  const space = useCameraStudio((s) => s.transformSpace)
  const frameRef = useRef<(() => void) | null>(null)
  useFrame(() => frameRef.current?.(), 1)
  const ref = useRef<TransformControls | null>(null)

  useEffect(() => {
    void registryVersion
    void rigToken
    void savedRig
    const source = cameraId ? sceneRegistry.nodes.get(cameraId) : null
    if (!source || !cameraId) return
    const rigNode = useScene.getState().nodes[cameraId as AnyNodeId]
    if (motionActive ? motionPreviewPose()?.rig : rigNode?.type === 'scene-camera' && rigNode.rig)
      return
    const object = motionActive ? new Object3D() : source
    if (motionActive) scene.add(object)
    const parent = source.parent
    const sync = () => {
      const pose = motionPreviewPose()
      if (!motionActive || !pose) return
      parent?.updateWorldMatrix(true, false)
      object.position.fromArray(pose.position)
      object.quaternion.setFromEuler(new Euler(...pose.rotation))
      if (parent) {
        parent.localToWorld(object.position)
        object.quaternion.premultiply(parent.getWorldQuaternion(new Quaternion()))
      }
      object.updateMatrixWorld()
    }
    sync()
    const control = new TransformControls(camera, gl.domElement)
    ref.current = control
    control.setMode(mode)
    control.setSpace(useCameraStudio.getState().transformSpace)
    control.setSize(0.85)
    control.attach(object)
    const helper = control.getHelper()
    helper.userData.cameraHelper = true
    helper.traverse((child) => {
      child.layers.set(OVERLAY_LAYER)
      child.userData.editorHandleHitArea = true
    })
    control.getRaycaster().layers.set(OVERLAY_LAYER)
    scene.add(helper)
    let original: {
      position: [number, number, number]
      rotation: [number, number, number]
    } | null = null
    const pose = () =>
      motionActive
        ? localCameraPreviewPose(object, parent?.matrixWorld)
        : {
            position: object.position.toArray() as [number, number, number],
            rotation: [object.rotation.x, object.rotation.y, object.rotation.z] as [
              number,
              number,
              number,
            ],
          }
    let previousDraft = useSceneAnimation.getState()
    let previousControlsEnabled = true
    const start = () => {
      const controls = get().controls as { enabled: boolean } | null
      if (controls) {
        previousControlsEnabled = controls.enabled
        controls.enabled = false
      }
      previousDraft = useSceneAnimation.getState()
      original = pose()
      useInteractionScope
        .getState()
        .begin({ kind: 'handle-drag', nodeId: cameraId as AnyNodeId, handle: 'camera-pose' })
      useViewer.getState().setInputDragging(true)
    }
    const change = () => {
      if (original) {
        if (motionActive) {
          const next = pose()
          changeMotionDraft(
            mode === 'translate' ? { position: next.position } : { rotation: next.rotation },
            false,
          )
        }
        if (!motionActive) useLiveNodeOverrides.getState().set(cameraId, pose())
      }
      invalidate()
    }
    const finish = (commit = true) => {
      if (!original) return
      const next = pose()
      const previous = original
      original = null
      if (motionActive) {
        if (commit) commitExistingKey()
        else
          useSceneAnimation.setState({
            draft: previousDraft.draft,
          })
        sync()
      } else if (
        commit &&
        [...next.position, ...next.rotation].some(
          (v, i) => Math.abs(v - [...previous.position, ...previous.rotation][i]!) > 1e-8,
        )
      ) {
        useScene.getState().updateNode(cameraId as AnyNodeId, next)
      } else {
        object.position.fromArray(previous.position)
        object.rotation.set(...previous.rotation)
      }
      if (!motionActive) useLiveNodeOverrides.getState().clear(cameraId)
      const controls = get().controls as { enabled: boolean } | null
      if (controls) controls.enabled = previousControlsEnabled
      useInteractionScope
        .getState()
        .endIf(
          (scope) =>
            scope.kind === 'handle-drag' &&
            scope.nodeId === cameraId &&
            scope.handle === 'camera-pose',
        )
      useViewer.getState().setInputDragging(false)
      invalidate()
    }
    frameRef.current = () => {
      if (!original) sync()
    }
    const redraw = () => invalidate()
    const release = () => finish()
    const cancel = () => {
      control.reset()
      finish(false)
      control.dragging = false
      control.axis = null
    }
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target?.closest('input, textarea, select, [contenteditable="true"]') ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return
      if (event.key === 'Escape' && original) {
        event.preventDefault()
        event.stopImmediatePropagation()
        cancel()
      } else if (!original && ['g', 'r'].includes(event.key.toLowerCase())) {
        event.preventDefault()
        event.stopImmediatePropagation()
        useCameraStudio.setState({
          transformMode: event.key.toLowerCase() === 'g' ? 'translate' : 'rotate',
        })
      }
    }
    control.addEventListener('mouseDown', start)
    control.addEventListener('objectChange', change)
    control.addEventListener('mouseUp', release)
    control.addEventListener('change', redraw)
    const unbindPointer = bindCameraTransformPointer(control, gl.domElement, cancel)
    window.addEventListener('keydown', keys, true)
    return () => {
      unbindPointer()
      cancel()
      control.removeEventListener('mouseDown', start)
      control.removeEventListener('objectChange', change)
      control.removeEventListener('mouseUp', release)
      control.removeEventListener('change', redraw)
      window.removeEventListener('keydown', keys, true)
      frameRef.current = null
      if (motionActive) scene.remove(object)
      control.detach()
      scene.remove(helper)
      control.dispose()
      ref.current = null
    }
  }, [
    cameraId,
    mode,
    registryVersion,
    camera,
    gl,
    scene,
    invalidate,
    get,
    motionActive,
    rigToken,
    savedRig,
  ])

  useEffect(() => {
    if (cameraId && !motionActive) openCameraStudio(cameraId)
  }, [cameraId, motionActive])
  useEffect(() => {
    ref.current?.setSpace(space)
  }, [space])
  return null
}
