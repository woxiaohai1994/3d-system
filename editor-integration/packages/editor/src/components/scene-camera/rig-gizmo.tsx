import {
  type AnyNodeId,
  type CameraRig,
  emitter,
  type SceneCameraNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { cameraRigParentMatrix, detachSourceRigAim, useViewer } from '@pascal-app/viewer'
import { flushSync, useFrame, useThree } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Box3, Euler, type Group, Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import type { WebGPURenderer } from 'three/webgpu'
import useInteractionScope from '../../store/use-interaction-scope'
import { useSceneAnimation } from '../scene-animation/store'
import { createSceneCameraBodyVisibility } from './camera-visibility'
import { commitExistingKey } from './motion-edit-session'
import { useObjectMotion } from './motion-object-store'
import { motionCameraParentMatrix } from './motion-state'
import { createRigCameraDirection } from './rig-camera-direction'
import { rigCameraControlDelta, rigControlBasis } from './rig-control-follow'
import { rigDisplay } from './rig-display'
import { rigFrameArea, rigFramePose } from './rig-framing'
import { bindRigKeyboard } from './rig-keyboard'
import {
  rigObjectShortcutInPose,
  sourceRigClipboardAction,
  sourceRigKeyMode,
  sourceRigSelectionAction,
} from './rig-keymap'
import { RigLimits } from './rig-limits'
import { CameraRigObjectGizmo } from './rig-object-gizmo'
import { createRigOrbit } from './rig-orbit'
import { copyRigPose, pasteRigPose } from './rig-pose-clipboard'
import { sourcePoseSelectAll } from './rig-pose-selection-source'
import { rigSelectionMode, rigSelectionTransform } from './rig-selection-transform'
import {
  rigChannels,
  rigIsPoseMode,
  rigPose,
  rigSelectedControls,
  rigSnapshot,
  updateRig,
  useRigEditor,
} from './rig-state'
import { rigViewfinderSurface } from './rig-viewfinder-surface'
import { createRigViewportPointer } from './rig-viewport-pointer'
import { RigWidget } from './rig-widget'
import { registerRigWidgetDrag } from './rig-widget-drag'
import { pickDisplayedRigWidget } from './rig-widget-selection'
import { useCameraStudio } from './store'

function currentRigNode(node: SceneCameraNode) {
  const current = useScene.getState().nodes[node.id]
  return current?.type === 'scene-camera' ? current : null
}

export function CameraRigGizmo() {
  const get = useThree((s) => s.get),
    camera = useThree((s) => s.camera),
    animation = useSceneAnimation(),
    selected = useViewer((s) => s.selection.selectedIds),
    objectId = useObjectMotion((s) => s.nodeId),
    nodes = useScene((s) => s.nodes),
    readOnly = useScene((s) => s.readOnly)
  const viewfinderCanvas = useCameraStudio((s) => s.canvas)
  const id = animation.open ? animation.cameraId : selected.length === 1 ? selected[0] : null,
    node = id ? nodes[id as AnyNodeId] : null
  const pose = node?.type === 'scene-camera' ? rigPose(node) : null,
    rig = pose?.rig
  const {
      control,
      mode,
      frameRequest,
      pivot,
      cursor,
      poseCameraId,
      gesture,
      keepCameraLevel,
      orbit,
    } = useRigEditor(),
    snapshot = node?.type === 'scene-camera' ? rigSnapshot(node) : null
  const activeWidget =
    snapshot?.widgets.find((w) => w.name === control) ??
    snapshot?.widgets.find((w) => w.name === 'Camera')
  const selectedName = activeWidget?.name ?? 'Camera'
  const selectedNames =
    node?.type === 'scene-camera'
      ? rigSelectedControls(
          node.id,
          selectedName,
          snapshot?.widgets.map((w) => w.name),
        )
      : []
  const selectionKey = JSON.stringify(selectedNames)
  const selectedLocks = activeWidget?.locks
  const visible =
    node?.type === 'scene-camera' &&
    !!rig?.native &&
    !objectId &&
    !readOnly &&
    !animation.playing &&
    !animation.exporting &&
    !animation.previewing &&
    !animation.cameraView &&
    !animation.pickingRigAim &&
    !animation.lockedIds.includes(node.id)
  const enabled = visible && poseCameraId === node?.id
  const groups = useRef<Record<string, Group | null>>({}),
    tick = useRef<(() => void) | null>(null),
    framed = useRef(0)
  const bodyVisibility = useMemo(createSceneCameraBodyVisibility, [])
  useLayoutEffect(() => {
    if (!enabled || node?.type !== 'scene-camera') return
    bodyVisibility.sync(sceneRegistry.nodes.get(node.id))
    get().invalidate()
    return () => {
      bodyVisibility.restore()
      get().invalidate()
    }
  }, [enabled, node?.id, node?.type, bodyVisibility, get])
  useFrame(() => {
    if (enabled && node?.type === 'scene-camera')
      bodyVisibility.sync(sceneRegistry.nodes.get(node.id))
    tick.current?.()
    if (!visible || node?.type !== 'scene-camera') return
    if (!enabled) framed.current = frameRequest
    const currentNode = currentRigNode(node)
    if (!currentNode) return
    const current = rigPose(currentNode)?.rig,
      data = rigSnapshot(currentNode)
    // Undo can remove the rig before React releases this frame callback.
    if (!current?.native || !data) return
    const parent = currentNode.parentId ? sceneRegistry.nodes.get(currentNode.parentId) : null
    parent?.updateWorldMatrix(true, false)
    const placement = new Matrix4().fromArray(current.native!.placement)
    if (parent) placement.premultiply(parent.matrixWorld)
    const bounds = new Box3()
    for (const widget of data.widgets) {
      const m = placement.clone().multiply(new Matrix4().fromArray(widget.matrix)),
        group = groups.current[widget.name]
      if (group) {
        group.matrix.copy(m)
        group.matrixWorldNeedsUpdate = true
      }
      if (enabled && framed.current !== frameRequest)
        for (const vertex of widget.vertices)
          bounds.expandByPoint(new Vector3(...vertex).applyMatrix4(m))
    }
    if (enabled && framed.current !== frameRequest && !bounds.isEmpty()) {
      framed.current = frameRequest
      const { camera, size, gl } = get()
      const canvasRect = gl.domElement.getBoundingClientRect()
      const scaleX = size.width / canvasRect.width,
        scaleY = size.height / canvasRect.height,
        obstacles = [
          ...document.querySelectorAll('[data-camera-rig-panel], [data-rig-frame-obstacle]'),
        ].map((element) => {
          const rect = element.getBoundingClientRect()
          return {
            left: (rect.left - canvasRect.left) * scaleX,
            top: (rect.top - canvasRect.top) * scaleY,
            right: (rect.right - canvasRect.left) * scaleX,
            bottom: (rect.bottom - canvasRect.top) * scaleY,
          }
        }),
        area = rigFrameArea(size, obstacles),
        pose = area ? rigFramePose(bounds, camera, size, area) : null
      if (pose) emitter.emit('camera-controls:apply-pose', pose)
    }
  }, 7.1)
  useLayoutEffect(() => {
    if (!enabled || node?.type !== 'scene-camera') return
    const cameraId = node.id
    const { gl } = get()
    const canvas = gl.domElement
    const getNames = () => {
      const current = useScene.getState().nodes[cameraId]
      return current?.type === 'scene-camera'
        ? (rigSnapshot(current)?.widgets.map((widget) => widget.name) ?? [])
        : []
    }
    const pointer = createRigViewportPointer({
      canvas,
      cameraId,
      getNames,
      pixelRatio: () => gl.getPixelRatio(),
      enabled: () => {
        const scene = useScene.getState()
        const current = scene.nodes[cameraId]
        const animation = useSceneAnimation.getState()
        const selected = useViewer.getState().selection.selectedIds
        return (
          get().camera === camera &&
          current?.type === 'scene-camera' &&
          !!rigPose(current)?.rig?.native &&
          rigIsPoseMode(cameraId) &&
          !scene.readOnly &&
          !useObjectMotion.getState().nodeId &&
          (animation.open
            ? animation.cameraId === cameraId
            : selected.length === 1 && selected[0] === cameraId) &&
          !animation.playing &&
          !animation.exporting &&
          !animation.previewing &&
          !animation.cameraView &&
          !animation.pickingRigAim &&
          !animation.lockedIds.includes(cameraId)
        )
      },
      pick: (signal, from, selected, nearest) =>
        pickDisplayedRigWidget(
          gl as unknown as WebGPURenderer,
          canvas,
          cameraId,
          getNames(),
          selected,
          nearest,
          from,
          signal,
        ),
    })
    return pointer.bind()
  }, [enabled, get, node?.id, node?.type, camera])
  useLayoutEffect(() => {
    if (!enabled || node?.type !== 'scene-camera' || !selectedLocks) return
    const { scene, gl } = get(),
      proxy = new Object3D(),
      controls = new TransformControls(camera, gl.domElement)
    // Only source bone outlines own pointer hits; the detached helper supplies transform math.
    controls.disconnect()
    let prepare: (() => void) | undefined
    let requestedMode = mode
    const names = JSON.parse(selectionKey) as string[]
    const cameraDirectionSelection =
      names.length === 1 && (selectedName === 'Camera' || selectedName === 'Camera_Offset')
    const orbitSelection =
      orbit && names.length === 1 && ['Camera', 'Camera_Offset', 'Aim'].includes(selectedName)
    const channels = rigChannels
    const configure = (value: 'translate' | 'rotate' | 'scale') => {
      const currentNode = currentRigNode(node)
      if (!currentNode) return false
      const current = rigPose(currentNode)?.rig,
        data = rigSnapshot(currentNode)
      if (!names.length || !current?.native || !data) return false
      requestedMode = value
      value = rigSelectionMode(current, data, names, value, pivot)
      const locks =
        (cameraDirectionSelection || orbitSelection) && value === 'rotate'
          ? [false, false, false]
          : selectedLocks[channels[value]]
      controls.setMode(value)
      controls.showX = !locks[0]
      controls.showY = !locks[1]
      controls.showZ = !locks[2]
      prepare?.()
      get().invalidate()
      return true
    }
    configure(mode)
    controls.setSpace('local')
    scene.add(proxy)
    controls.attach(proxy)
    let before: CameraRig | null = null,
      changed: CameraRig | null = null,
      draftBefore = useSceneAnimation.getState().draft,
      navEnabled = true
    const edit = new Matrix4(),
      locationMatrix = new Matrix4(),
      armature = new Matrix4(),
      start = new Object3D()
    let selectionTransform: ReturnType<typeof rigSelectionTransform> | null = null,
      selectionRig: CameraRig | null = null,
      cameraDirection: ReturnType<typeof createRigCameraDirection> | null = null,
      orbitTransform: ReturnType<typeof createRigOrbit> | null = null
    const sync = () => {
      if (before) return
      const currentNode = currentRigNode(node)
      if (!currentNode) return
      const current = rigPose(currentNode)?.rig,
        data = rigSnapshot(currentNode)
      const widget = data?.widgets.find((w) => w.name === selectedName)
      if (!current?.native || !data || !widget || !current.native.bones[selectedName]) return
      if ((cameraDirectionSelection || orbitSelection) && controls.getMode() === 'rotate') {
        const animation = useSceneAnimation.getState()
        const parent = animation.open
          ? motionCameraParentMatrix(currentNode, animation.time)
          : cameraRigParentMatrix(currentNode)
        orbitTransform = orbitSelection
          ? createRigOrbit(
              current,
              data,
              parent ?? new Matrix4(),
              selectedName === 'Aim' ? 'aim-around-camera' : 'camera-around-aim',
              (value) => rigSnapshot(currentNode, value),
              keepCameraLevel,
            )
          : null
        cameraDirection = orbitTransform
          ? null
          : createRigCameraDirection(current, data, parent ?? new Matrix4())
        if (orbitTransform) {
          proxy.position.copy(orbitTransform.center)
          proxy.quaternion.copy(orbitTransform.quaternion)
        } else {
          proxy.position.setFromMatrixPosition(cameraDirection!.world)
          proxy.quaternion.copy(cameraDirection!.quaternion)
        }
        proxy.scale.set(1, 1, 1)
        proxy.updateMatrixWorld()
        selectionTransform = null
        selectionRig = current
        return
      }
      cameraDirection = null
      orbitTransform = null
      const value = (
        selectedName === 'Aim' && current.target ? detachSourceRigAim(current, data) : current
      ).native!.bones[selectedName]!
      const parent = currentNode.parentId ? sceneRegistry.nodes.get(currentNode.parentId) : null
      parent?.updateWorldMatrix(true, false)
      edit.fromArray(current.native!.placement).multiply(new Matrix4().fromArray(widget.editMatrix))
      locationMatrix
        .fromArray(current.native!.placement)
        .multiply(new Matrix4().fromArray(widget.locationMatrix))
      if (parent) {
        edit.premultiply(parent.matrixWorld)
        locationMatrix.premultiply(parent.matrixWorld)
      }
      armature.fromArray(current.native.placement)
      if (parent) armature.premultiply(parent.matrixWorld)
      const basis = new Matrix4().compose(
        new Vector3(...value.location),
        new Quaternion().setFromEuler(new Euler(...value.rotation, 'ZYX')),
        new Vector3(...value.scale),
      )
      edit.clone().multiply(basis).decompose(proxy.position, proxy.quaternion, proxy.scale)
      proxy.position.copy(new Vector3(...value.location).applyMatrix4(locationMatrix))
      const follow = rigCameraControlDelta(current, data)
      if (
        follow &&
        armature.determinant() !== 0 &&
        (selectedName === 'Camera' || selectedName === 'Camera_Offset')
      ) {
        armature
          .clone()
          .multiply(follow)
          .multiply(armature.clone().invert())
          .multiply(new Matrix4().compose(proxy.position, proxy.quaternion, proxy.scale))
          .decompose(proxy.position, proxy.quaternion, proxy.scale)
      }
      if (pivot === 'CURSOR' && controls.getMode() !== 'translate') proxy.position.fromArray(cursor)
      proxy.quaternion.normalize()
      selectionRig =
        names.includes('Aim') && current.target ? detachSourceRigAim(current, data) : current
      selectionTransform =
        names.length > 0
          ? rigSelectionTransform(
              selectionRig,
              data,
              names,
              selectedName,
              controls.getMode(),
              pivot,
              new Vector3(...cursor),
              armature,
              (value) => rigSnapshot(currentNode, value),
              requestedMode,
            )
          : null
      if (selectionTransform) proxy.position.copy(selectionTransform.center)
      proxy.updateMatrixWorld()
    }
    sync()
    prepare = sync
    tick.current = sync
    const begin = () => {
      if (before || cameraDirection?.editable === false || orbitTransform?.editable === false)
        return
      const currentNode = currentRigNode(node)
      if (!currentNode) return
      const current = rigPose(currentNode)?.rig
      if (!current?.native) return
      before = structuredClone(current)
      start.copy(proxy, false)
      draftBefore = useSceneAnimation.getState().draft
      const nav = get().controls as { enabled: boolean } | null
      navEnabled = nav?.enabled ?? true
      if (nav) nav.enabled = false
      useInteractionScope
        .getState()
        .begin({ kind: 'handle-drag', nodeId: node.id, handle: 'camera-rig' })
      useViewer.getState().setInputDragging(true)
    }
    const change = () => {
      if (!before || (!selectionTransform && !cameraDirection && !orbitTransform)) return
      proxy.updateMatrixWorld()
      const delta = proxy.position.clone().sub(start.position),
        matrix = unbindKeyboard.transformMatrix(),
        orbitMoved = !!orbitTransform && unbindKeyboard.rotationMoved(),
        directionAngles =
          cameraDirection && keepCameraLevel
            ? new Euler().setFromQuaternion(proxy.quaternion, 'YXZ')
            : null,
        unchanged =
          controls.getMode() === 'translate'
            ? delta.equals(new Vector3())
            : matrix.equals(new Matrix4())
      changed =
        unchanged && !orbitMoved
          ? before
          : orbitTransform
            ? orbitTransform.applyQuaternion(proxy.quaternion, orbitMoved)
            : cameraDirection
              ? directionAngles
                ? cameraDirection.setRotation([directionAngles.x, directionAngles.y, 0])
                : cameraDirection.setQuaternion(proxy.quaternion)
              : selectionTransform!.apply(
                  delta,
                  matrix,
                  unbindKeyboard.rotationInput(),
                  changed ?? before,
                  unbindKeyboard.constraintInput(),
                )
      const aim = changed.native?.bones.Aim,
        originalAim = before.native?.bones.Aim,
        resolvedAim = selectionRig?.native?.bones.Aim
      // Resolve the bound point for transform math, but detach it only when its
      // location actually changes. Rotation channels and locked moves still follow it.
      if (
        before.target &&
        selectionRig !== null &&
        !selectionRig.target &&
        aim &&
        originalAim &&
        resolvedAim &&
        aim.location.every((value, i) => value === resolvedAim.location[i])
      )
        changed = {
          ...changed,
          target: before.target,
          native: {
            ...changed.native!,
            bones: {
              ...changed.native!.bones,
              Aim: { ...aim, location: originalAim.location },
            },
          },
        }
      if (useSceneAnimation.getState().open) updateRig(node, changed, false)
      else useLiveNodeOverrides.getState().set(node.id, { rig: changed })
      get().invalidate()
    }
    const finish = (commit: boolean) => {
      if (!before) return
      const saved = changed,
        modified = saved !== null && JSON.stringify(saved) !== JSON.stringify(before)
      before = null
      changed = null
      if (useSceneAnimation.getState().open) {
        if (commit && modified) commitExistingKey()
        else useSceneAnimation.setState({ draft: draftBefore })
      } else {
        const currentNode = currentRigNode(node)
        // Keep the preview until both committed data and the canvas agree on the endpoint.
        if (commit && modified && saved && currentNode)
          flushSync(() => updateRig(currentNode, saved))
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
            scope.handle === 'camera-rig',
        )
      useViewer.getState().setInputDragging(false)
      sync()
      get().invalidate()
    }
    const release = () => finish(true),
      cancel = () => {
        controls.reset()
        finish(false)
        controls.dragging = false
      }
    const displayedBasis = () => {
      const currentNode = currentRigNode(node)
      if (!currentNode) return new Matrix4()
      const current = rigPose(currentNode).rig!,
        snapshot = rigSnapshot(currentNode)!,
        widget = snapshot.widgets.find((w) => w.name === selectedName)!,
        basis = new Matrix4()
          .fromArray(current.native!.placement)
          .multiply(rigControlBasis(current, snapshot, widget)),
        parent = currentNode.parentId ? sceneRegistry.nodes.get(currentNode.parentId) : null
      parent?.updateWorldMatrix(true, false)
      if (parent) basis.premultiply(parent.matrixWorld)
      return basis
    }
    const unbindKeyboard = bindRigKeyboard(
      controls,
      gl.domElement,
      configure,
      cancel,
      (gesture) => {
        useRigEditor.setState({ gesture })
      },
      displayedBasis,
      (target) =>
        target === viewfinderCanvas && viewfinderCanvas
          ? rigViewfinderSurface(node, viewfinderCanvas)
          : { canvas: gl.domElement, camera, rect: () => gl.domElement.getBoundingClientRect() },
      undefined,
      () =>
        orbitTransform
          ? new Matrix4().makeRotationFromQuaternion(orbitTransform.quaternion)
          : cameraDirection
            ? new Matrix4().makeRotationFromQuaternion(cameraDirection.quaternion)
            : (selectionTransform?.localOrientation() ?? null),
      () =>
        orbitTransform
          ? { kind: 'orbit', quaternionForDrag: orbitTransform.quaternionForDrag }
          : cameraDirection
            ? {
                kind: 'direction',
                quaternionForDrag: (dx, dy, snapRadians) =>
                  cameraDirection!.quaternionForDrag(dx, dy, snapRadians, keepCameraLevel),
              }
            : null,
      true,
    )
    const unbindViewfinderValidity = useCameraStudio.subscribe(unbindKeyboard.validateSurface)
    const syncInteraction = () => {
      const scope = useInteractionScope.getState().scope
      controls.enabled =
        names.length > 0 &&
        cameraDirection?.editable !== false &&
        orbitTransform?.editable !== false &&
        (scope.kind === 'idle' ||
          (scope.kind === 'handle-drag' &&
            scope.nodeId === node.id &&
            scope.handle === 'camera-rig'))
    }
    syncInteraction()
    const unbindInteraction = useInteractionScope.subscribe(syncInteraction)
    controls.addEventListener('mouseDown', begin)
    controls.addEventListener('objectChange', change)
    controls.addEventListener('mouseUp', release)
    const unbindWidgetDrag = registerRigWidgetDrag(gl.domElement, {
      control: selectedName,
      mode: () => controls.getMode(),
      start: unbindKeyboard.startDrag,
    })
    const unbindViewfinderDrag = viewfinderCanvas
      ? registerRigWidgetDrag(viewfinderCanvas, {
          control: selectedName,
          mode: () => controls.getMode(),
          start: unbindKeyboard.startDrag,
        })
      : undefined
    const poseKeys = (event: KeyboardEvent) => {
      if (
        useViewer.getState().inputDragging ||
        useInteractionScope.getState().scope.kind !== 'idle'
      )
        return
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          'input, textarea, select, [contenteditable="true"], [role="dialog"][aria-modal="true"]',
        )
      )
        return
      if (rigObjectShortcutInPose(event)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        const action = sourceRigClipboardAction(event)
        if (action === 'copy') copyRigPose(node, names)
        else if (action) pasteRigPose(node, action === 'paste-flipped')
        return
      }
      const action = sourceRigSelectionAction(event)
      if (
        !names.length &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        sourceRigKeyMode(event.key)
      ) {
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      if (!action) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const widgets = rigSnapshot(node)?.widgets.map((w) => w.name) ?? []
      flushSync(() => {
        useRigEditor.setState({
          selectionCameraId: node.id,
          selectedControls: sourcePoseSelectAll(widgets, names, action),
        })
      })
    }
    window.addEventListener('keydown', poseKeys, true)
    window.addEventListener('pointerup', release)
    window.addEventListener('blur', cancel)
    gl.domElement.addEventListener('pointercancel', cancel)
    return () => {
      unbindWidgetDrag()
      unbindViewfinderDrag?.()
      unbindViewfinderValidity()
      window.removeEventListener('keydown', poseKeys, true)
      unbindInteraction()
      unbindKeyboard()
      cancel()
      tick.current = null
      window.removeEventListener('pointerup', release)
      window.removeEventListener('blur', cancel)
      gl.domElement.removeEventListener('pointercancel', cancel)
      controls.dispose()
      scene.remove(proxy)
    }
  }, [
    enabled,
    node,
    selectedName,
    selectionKey,
    mode,
    get,
    camera,
    selectedLocks,
    pivot,
    cursor,
    viewfinderCanvas,
    keepCameraLevel,
    orbit,
  ])
  if (!visible || !rig?.native || !snapshot) return null
  return (
    <group userData={{ cameraHelper: true }}>
      {!enabled && <CameraRigObjectGizmo node={node} />}
      {rigDisplay(node).limits && <RigLimits node={node} />}
      {snapshot.widgets.map((widget) => (
        <group
          key={widget.name}
          ref={(value) => {
            groups.current[widget.name] = value
          }}
          matrixAutoUpdate={false}
        >
          <RigWidget
            type={rig.type}
            widget={widget}
            active={enabled && selectedName === widget.name}
            selected={enabled && selectedNames.includes(widget.name)}
            objectMode={!enabled}
            objectMoving={!enabled && !!gesture}
            cameraId={node!.id}
            front={rig.showInFront}
            zoom={rig.dollyZoom}
          />
        </group>
      ))}
    </group>
  )
}
