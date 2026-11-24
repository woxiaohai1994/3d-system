import {
  type CameraRig,
  type SceneCameraNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { cameraRigParentMatrix, OVERLAY_LAYER, useViewer } from '@pascal-app/viewer'
import { flushSync, useFrame, useThree } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import { Matrix4, Object3D, Vector3 } from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import useInteractionScope from '../../store/use-interaction-scope'
import { swallowNextClick } from '../editor/handles/use-handle-drag'
import { useSceneAnimation } from '../scene-animation/store'
import { bindCameraTransformPointer } from './camera-transform-pointer'
import { commitExistingKey } from './motion-edit-session'
import { motionCameraParentMatrix } from './motion-state'
import { createRigCameraTransform } from './rig-camera-transform'
import { bindRigKeyboard } from './rig-keyboard'
import { rigPose, rigSnapshot, updateRig, useRigEditor } from './rig-state'
import { rigViewfinderSurface } from './rig-viewfinder-surface'
import { useCameraStudio } from './store'

export function CameraRigObjectGizmo({ node }: { node: SceneCameraNode }) {
  const get = useThree((state) => state.get),
    camera = useThree((state) => state.camera)
  const { pivot, cursor } = useRigEditor()
  const mode = useCameraStudio((state) =>
    state.transformMode === 'scale' ? 'translate' : state.transformMode,
  )
  const space = useCameraStudio((state) => state.transformSpace)
  const viewfinderCanvas = useCameraStudio((state) => state.canvas)
  const tick = useRef<(() => void) | null>(null)
  const configureMode = useRef<((value: 'translate' | 'rotate' | 'scale') => void) | null>(null)
  const configureSpace = useRef<((value: 'world' | 'local') => void) | null>(null)
  useFrame(() => tick.current?.(), 7)
  useLayoutEffect(() => {
    const { scene, gl } = get(),
      proxy = new Object3D(),
      controls = new TransformControls(camera, gl.domElement)
    proxy.userData.rigObjectTransform = true
    scene.add(proxy)
    controls.attach(proxy)
    controls.setSize(0.85)
    const helper = controls.getHelper()
    helper.userData.cameraHelper = true
    helper.userData.rigObjectHelper = true
    helper.traverse((child) => {
      child.layers.set(OVERLAY_LAYER)
      child.userData.editorHandleHitArea = true
    })
    controls.getRaycaster().layers.set(OVERLAY_LAYER)
    scene.add(helper)
    let before: CameraRig | null = null,
      changed: CameraRig | null = null,
      context: ReturnType<typeof createRigCameraTransform> | null = null,
      draftBefore = useSceneAnimation.getState().draft,
      navEnabled = true,
      modal = false
    const start = new Object3D(),
      linear = new Matrix4()
    const sync = () => {
      if (before) return
      const currentNode = useScene.getState().nodes[node.id]
      if (currentNode?.type !== 'scene-camera') return
      const current = rigPose(currentNode).rig,
        data = rigSnapshot(currentNode)
      if (!current?.native || !data) return
      const animation = useSceneAnimation.getState()
      const parent =
        (animation.open
          ? motionCameraParentMatrix(currentNode, animation.time)
          : cameraRigParentMatrix(currentNode)) ?? new Matrix4()
      context = createRigCameraTransform(current, data, parent, pivot, new Vector3(...cursor))
      proxy.position.copy(context.center)
      proxy.quaternion.setFromRotationMatrix(context.axes).normalize()
      proxy.scale.set(1, 1, 1)
      proxy.updateMatrixWorld()
      const scope = useInteractionScope.getState().scope
      controls.enabled =
        context.editable &&
        (scope.kind === 'idle' ||
          (scope.kind === 'handle-drag' &&
            scope.nodeId === node.id &&
            scope.handle === 'camera-rig-object'))
    }
    const configure = (value: 'translate' | 'rotate' | 'scale') => {
      if (value === 'scale') return false
      if (!rigPose(node).rig?.native) return false
      controls.setMode(value)
      if (useCameraStudio.getState().transformMode !== value)
        useCameraStudio.setState({ transformMode: value })
      controls.showX = controls.showY = controls.showZ = true
      sync()
      get().invalidate()
      return !!context?.editable
    }
    const initialMode = useCameraStudio.getState().transformMode
    configure(initialMode === 'scale' ? 'translate' : initialMode)
    controls.setSpace(useCameraStudio.getState().transformSpace)
    tick.current = sync
    const begin = () => {
      if (before || !context?.editable) return
      const currentNode = useScene.getState().nodes[node.id]
      const current = currentNode?.type === 'scene-camera' ? rigPose(currentNode).rig : null
      if (!current?.native) return
      before = structuredClone(current)
      proxy.updateMatrixWorld(true)
      start.copy(proxy, false)
      draftBefore = useSceneAnimation.getState().draft
      const nav = get().controls as { enabled: boolean } | null
      navEnabled = nav?.enabled ?? true
      if (nav) nav.enabled = false
      useInteractionScope
        .getState()
        .begin({ kind: 'handle-drag', nodeId: node.id, handle: 'camera-rig-object' })
      useViewer.getState().setInputDragging(true)
    }
    const change = () => {
      if (!before || !context?.editable) return
      if (!modal) {
        proxy.updateMatrixWorld(true)
        linear
          .copy(proxy.matrixWorld)
          .multiply(start.matrixWorld.clone().invert())
          .setPosition(0, 0, 0)
      }
      changed = context.apply(
        controls.getMode(),
        proxy.position.clone().sub(start.position),
        modal ? keyboard.transformMatrix() : linear,
      )
      if (useSceneAnimation.getState().open) updateRig(node, changed, false)
      else useLiveNodeOverrides.getState().set(node.id, { rig: changed })
      get().invalidate()
    }
    const finish = (commit: boolean) => {
      if (!before) return
      const saved = changed,
        original = before
      before = changed = null
      const different =
        saved &&
        JSON.stringify(saved.native?.cameraOffsetMatrix) !==
          JSON.stringify(original.native?.cameraOffsetMatrix)
      if (useSceneAnimation.getState().open) {
        if (commit && different) commitExistingKey()
        else useSceneAnimation.setState({ draft: draftBefore })
      } else {
        const currentNode = useScene.getState().nodes[node.id]
        if (commit && different && currentNode?.type === 'scene-camera')
          flushSync(() => updateRig(currentNode, saved!))
        useLiveNodeOverrides.getState().clearFields(node.id, ['rig'])
      }
      const nav = get().controls as { enabled: boolean } | null
      if (nav) nav.enabled = navEnabled
      useInteractionScope
        .getState()
        .endIf(
          (scope) =>
            scope.kind === 'handle-drag' &&
            scope.nodeId === node.id &&
            scope.handle === 'camera-rig-object',
        )
      useViewer.getState().setInputDragging(false)
      if (modal) swallowNextClick(gl.domElement)
      sync()
      get().invalidate()
    }
    const cancel = () => {
      controls.reset()
      finish(false)
      controls.dragging = false
      controls.axis = null
    }
    const keyboard = bindRigKeyboard(
      controls,
      gl.domElement,
      configure,
      cancel,
      (gesture) => {
        modal = !!gesture
        useRigEditor.setState({ gesture })
        if (!gesture) controls.setSpace(useCameraStudio.getState().transformSpace)
      },
      () => context?.axes ?? new Matrix4(),
      (target) =>
        target === viewfinderCanvas && viewfinderCanvas
          ? rigViewfinderSurface(node, viewfinderCanvas, true)
          : { canvas: gl.domElement, camera, rect: () => gl.domElement.getBoundingClientRect() },
      undefined,
      () => context?.axes ?? new Matrix4(),
      undefined,
      true,
    )
    const syncInteraction = () => {
      const scope = useInteractionScope.getState().scope
      controls.enabled =
        !!context?.editable &&
        (scope.kind === 'idle' ||
          (scope.kind === 'handle-drag' &&
            scope.nodeId === node.id &&
            scope.handle === 'camera-rig-object'))
    }
    syncInteraction()
    const unbindInteraction = useInteractionScope.subscribe(syncInteraction)
    const unbindViewfinder = useCameraStudio.subscribe(keyboard.validateSurface)
    configureMode.current = (value) => {
      if (!before) configure(value)
    }
    configureSpace.current = (value) => {
      if (!before) controls.setSpace(value)
    }
    const redraw = () => get().invalidate()
    const release = () => finish(true)
    controls.addEventListener('mouseDown', begin)
    controls.addEventListener('objectChange', change)
    controls.addEventListener('mouseUp', release)
    controls.addEventListener('change', redraw)
    const unbindPointer = bindCameraTransformPointer(controls, gl.domElement, cancel)
    return () => {
      unbindPointer()
      unbindInteraction()
      unbindViewfinder()
      keyboard()
      cancel()
      tick.current = null
      configureMode.current = null
      configureSpace.current = null
      controls.detach()
      controls.dispose()
      scene.remove(helper)
      scene.remove(proxy)
    }
  }, [node, pivot, cursor, get, camera, viewfinderCanvas])
  useLayoutEffect(() => configureMode.current?.(mode), [mode])
  useLayoutEffect(() => configureSpace.current?.(space), [space])
  return null
}
