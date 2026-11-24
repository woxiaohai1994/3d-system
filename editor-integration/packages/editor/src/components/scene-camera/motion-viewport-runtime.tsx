import {
  type CameraMotionPose,
  cameraTracks,
  emitter,
  getEffectiveNode,
  sceneRegistry,
} from '@pascal-app/core'
import { blenderRigRequest, evaluateSourceCameraRig, useViewer } from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Euler, Matrix4, OrthographicCamera, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { type EditorCameraControls, hasCameraNavigationInput } from '../../lib/camera-navigation'
import useInteractionScope from '../../store/use-interaction-scope'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { applyCameraLensShift, cameraFov, sceneCameraWorldPose } from './camera-math'
import { hideSceneCameraHelpers } from './camera-visibility'
import { commitExistingKey, useMotionEdits } from './motion-edit-session'
import {
  cameraPoseAt,
  motionPose,
  motionPreviewPose,
  observedMotionCamera,
  resolveMotionTargetAt,
} from './motion-state'
import { localCameraPreviewPose, previewOrbitTarget } from './preview-navigation'
import { createRigCameraTransform } from './rig-camera-transform'

/** Use the actual editor viewport and its single controller. Navigation never writes keys. */
export function MotionViewportRuntime() {
  const get = useThree((s) => s.get)
  const visible = useSceneAnimation(
    (state) => state.cameraView && !state.previewing && !state.pickingAnchor,
  )
  const enabled = visible
  const restoreHelpers = useRef<(() => void) | null>(null)
  useFrame(() => {
    restoreHelpers.current?.()
    restoreHelpers.current = enabled ? hideSceneCameraHelpers(get().scene) : null
  }, 8)
  useEffect(() => () => restoreHelpers.current?.(), [])
  const tick = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!enabled) return
    const initial = get(),
      originalCamera = initial.camera
    if (
      !(originalCamera instanceof PerspectiveCamera || originalCamera instanceof OrthographicCamera)
    )
      return
    const originalControl = initial.controls as unknown as EditorCameraControls | null
    const restore = {
      position: originalCamera.position.clone(),
      target: originalControl?.getTarget(new Vector3(), false) ?? new Vector3(),
      zoom: originalCamera.zoom,
      fov: originalCamera instanceof PerspectiveCamera ? originalCamera.fov : null,
      projection: useViewer.getState().cameraMode,
    }
    emitter.emit('camera-controls:cancel-pose', undefined)
    let active = false,
      start: CameraMotionPose | null = null,
      livePose: CameraMotionPose | null = null,
      gestureAspect = 1,
      lastPose = '',
      lastLayout = '',
      renderedRotation: Quaternion | null = null,
      lastCamera: unknown = null,
      lastTime = useSceneAnimation.getState().time,
      lastCameraId = useSceneAnimation.getState().cameraId,
      lastNode = observedMotionCamera(),
      lastTrack = cameraTracks(animationData()).find((track) => track.nodeId === lastCameraId)
    let rigTransform: ReturnType<typeof createRigCameraTransform> | null = null
    const gestureRotation = new Quaternion()
    const parent = () => {
      const node = observedMotionCamera()
      return node?.parentId ? sceneRegistry.nodes.get(node.parentId) : null
    }
    const read = (): CameraMotionPose | null => {
      const { camera, controls, size } = get(),
        control = controls as unknown as EditorCameraControls | null
      const pose = start ?? livePose ?? motionPose()
      if (
        !control ||
        !pose ||
        !(camera instanceof PerspectiveCamera || camera instanceof OrthographicCamera)
      )
        return null
      const p = parent()
      p?.updateWorldMatrix(true, false)
      const crop = Math.min(1, size.width / size.height / gestureAspect)
      const next = {
        ...pose,
        ...localCameraPreviewPose(camera, p?.matrixWorld),
        orbitDistance: control.distance,
        verticalFov:
          camera instanceof PerspectiveCamera
            ? (2 * Math.atan(Math.tan((camera.getEffectiveFOV() * Math.PI) / 360) * crop) * 180) /
              Math.PI
            : pose.verticalFov,
        orthographicHeight:
          camera instanceof OrthographicCamera
            ? ((camera.top - camera.bottom) / camera.zoom) * crop
            : pose.orthographicHeight,
      }
      return {
        ...next,
        rig: rigTransform
          ? rigTransform.setWorldMatrix(
              rigTransform.world
                .clone()
                .premultiply(
                  new Matrix4().makeRotationFromQuaternion(
                    camera.quaternion.clone().multiply(gestureRotation.clone().invert()),
                  ),
                )
                .setPosition(camera.position),
            )
          : pose.rig,
      }
    }
    const finish = (keepView: boolean) => {
      if (active) {
        const control = get().controls as unknown as EditorCameraControls | null
        control?.finishPointerInput()
        control?.update(0)
        const pose = read()
        if (
          keepView &&
          pose &&
          start &&
          (new Vector3(...pose.position).distanceToSquared(new Vector3(...start.position)) >
            1e-16 ||
            new Quaternion()
              .setFromEuler(new Euler(...pose.rotation))
              .angleTo(new Quaternion().setFromEuler(new Euler(...start.rotation))) > 1e-7 ||
            Math.abs(pose.verticalFov - start.verticalFov) > 1e-8 ||
            Math.abs(pose.orthographicHeight - start.orthographicHeight) > 1e-8)
        )
          useMotionEdits.setState({ cameraDirty: true })
        livePose = keepView ? pose : null
      } else if (!keepView) livePose = null
      active = false
      start = null
      rigTransform = null
      lastPose = ''
      if (useSceneAnimation.getState().cameraViewMoving)
        useSceneAnimation.setState({ cameraViewMoving: false })
      if (keepView) queueMicrotask(commitExistingKey)
    }
    const begin = () => {
      const state = useSceneAnimation.getState()
      if (
        !state.cameraView ||
        useViewer.getState().inputDragging ||
        useInteractionScope.getState().scope.kind !== 'idle' ||
        observedMotionCamera()?.id !== state.cameraId ||
        active ||
        state.playing ||
        state.exporting ||
        state.previewing ||
        state.pickingRigAim
      )
        return
      gestureAspect = animationData().aspect
      start = read()
      const node = observedMotionCamera()
      if (start?.rig?.native && node) {
        const p = parent()
        p?.updateWorldMatrix(true, false)
        const snapshot = evaluateSourceCameraRig(
          blenderRigRequest(
            start.rig,
            { aspect: gestureAspect, projection: node.projection, parentMatrix: p?.matrixWorld },
            start,
            start.rig.target ? resolveMotionTargetAt(start.rig.target, node, state.time) : null,
          ),
        )
        // Viewport navigation edits the camera body, just like the viewfinder; moving rig bones
        // instead reapplies existing camera offsets and changes the composition on commit.
        rigTransform = createRigCameraTransform(start.rig, snapshot, p?.matrixWorld)
        gestureRotation.copy(get().camera.quaternion)
      }
      if (state.draft) {
        useSceneAnimation.setState({ draft: null })
        useMotionEdits.setState({ cameraDirty: true })
      }
      active = !!start
      livePose = start
      if (active) useSceneAnimation.setState({ cameraViewMoving: true })
    }
    const cancel = () => finish(false)
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && active) {
        e.preventDefault()
        e.stopImmediatePropagation()
        cancel()
      }
    }
    emitter.on('camera-controls:interaction-start', begin)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', key, true)
    // Keep both moving and settled unsaved views local, without pointer-rate store updates.
    useSceneAnimation.setState({
      finishCameraEdit: finish,
      readCameraEditPose: () => (active ? read() : livePose),
    })
    tick.current = () => {
      const state = useSceneAnimation.getState(),
        { camera, controls, size } = get(),
        control = controls as unknown as EditorCameraControls | null
      if (
        !control ||
        !(camera instanceof PerspectiveCamera || camera instanceof OrthographicCamera)
      )
        return
      const track = cameraTracks(animationData()).find((track) => track.nodeId === state.cameraId)
      // Parsing another object's key recreates this track without changing the camera.
      const trackChanged =
        track !== lastTrack && JSON.stringify(track) !== JSON.stringify(lastTrack)
      const layout = `${size.width}:${size.height}:${animationData().aspect}`
      const layoutChanged = layout !== lastLayout
      lastLayout = layout
      if (
        state.time !== lastTime ||
        state.cameraId !== lastCameraId ||
        trackChanged ||
        observedMotionCamera() !== lastNode ||
        state.playing ||
        state.exporting
      ) {
        if (active) finish(false)
        livePose = null
      }
      lastNode = observedMotionCamera()
      lastTime = state.time
      lastCameraId = state.cameraId
      lastTrack = track
      if (active) {
        livePose = read()
        if (!hasCameraNavigationInput(control) && !useViewer.getState().cameraDragging) finish(true)
        return
      }
      control.fly = true
      control.enabled =
        !state.playing &&
        !state.exporting &&
        !useViewer.getState().inputDragging &&
        useInteractionScope.getState().scope.kind === 'idle' &&
        observedMotionCamera()?.id === state.cameraId &&
        !state.lockedIds.includes(state.cameraId ?? '')
      // A settled composition stays where the user left it until saved or the timeline changes.
      if (livePose && !state.draft && !layoutChanged) {
        return
      }
      const base = observedMotionCamera(),
        node = base ? getEffectiveNode(base) : null,
        pose =
          base && base.id !== state.cameraId
            ? cameraPoseAt(base, state.time)
            : state.playing
              ? motionPose()
              : (livePose ?? motionPreviewPose())
      if (!node || !pose) return
      if (useViewer.getState().cameraMode !== node.projection) {
        useViewer.getState().setCameraMode(node.projection)
        lastCamera = null
        return
      }
      const p = node.parentId ? sceneRegistry.nodes.get(node.parentId) : null
      p?.updateWorldMatrix(true, false)
      const token = JSON.stringify([
        node.id,
        state.time,
        pose,
        size.width,
        size.height,
        animationData().aspect,
        node.near,
        node.far,
        p?.matrixWorld.elements,
      ])
      if (token === lastPose && camera === lastCamera) {
        if (renderedRotation) {
          camera.quaternion.copy(renderedRotation)
          camera.updateMatrixWorld()
        }
        return
      }
      lastPose = token
      lastCamera = camera
      emitter.emit('camera-controls:cancel-pose', undefined)
      const { position, quaternion, viewCorrection } = sceneCameraWorldPose(pose, p?.matrixWorld)
      let center = previewOrbitTarget({ position, quaternion }, pose.orbitDistance)
      if (pose.rig?.target) {
        center = resolveMotionTargetAt(pose.rig.target, node, state.time)
        if (p) center.applyMatrix4(p.matrixWorld)
      } else if (pose.rig?.native) {
        const snapshot = evaluateSourceCameraRig(
          blenderRigRequest(
            pose.rig,
            {
              aspect: animationData().aspect,
              projection: node.projection,
              parentMatrix: p?.matrixWorld,
            },
            pose,
          ),
        )
        const aim = snapshot.widgets.find((widget) => widget.name === 'Aim')
        if (aim) {
          center = new Vector3().setFromMatrixPosition(
            (p?.matrixWorld.clone() ?? new Matrix4())
              .multiply(new Matrix4().fromArray(pose.rig.native.placement))
              .multiply(new Matrix4().fromArray(aim.boneMatrix)),
          )
        }
      }
      control.setRotationPivot(center)
      const viewTarget = previewOrbitTarget({ position, quaternion }, pose.orbitDistance)
      const crop = Math.min(1, size.width / size.height / animationData().aspect)
      camera.near = node.near
      camera.far = node.far
      if (camera instanceof PerspectiveCamera) {
        const verticalFov = cameraFov({ ...node, ...pose, frameAspect: animationData().aspect })
        camera.fov = (2 * Math.atan(Math.tan((verticalFov * Math.PI) / 360) / crop) * 180) / Math.PI
        camera.zoom = 1
      } else
        void control.zoomTo(((camera.top - camera.bottom) * crop) / pose.orthographicHeight, false)
      camera.updateProjectionMatrix()
      applyCameraLensShift(
        camera,
        pose.lensShift
          ? [
              (pose.lensShift[0] * animationData().aspect * crop) / (size.width / size.height),
              pose.lensShift[1] * crop,
            ]
          : undefined,
        viewCorrection,
      )
      void control.setLookAt(...position.toArray(), ...viewTarget.toArray(), false)
      control.update(0)
      camera.quaternion.copy(quaternion)
      camera.updateMatrixWorld()
      renderedRotation = quaternion
    }
    return () => {
      tick.current = null
      const current = read()
      if (!useSceneAnimation.getState().cameraView && current && livePose)
        useSceneAnimation.setState({ draft: current })
      cancel()
      emitter.off('camera-controls:interaction-start', begin)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', key, true)
      if (useSceneAnimation.getState().finishCameraEdit === finish)
        useSceneAnimation.setState({ finishCameraEdit: null, readCameraEditPose: null })
      const control = get().controls as unknown as EditorCameraControls | null
      if (control) {
        control.enabled = true
        control.fly = false
        control.setRotationPivot(null)
        control.setOrbitCenter(null)
      }
      emitter.emit('camera-controls:apply-pose', {
        position: restore.position.toArray(),
        target: restore.target.toArray(),
        projection: restore.projection,
        ...(restore.fov !== null
          ? { fov: restore.fov }
          : { viewWidth: ((originalCamera as OrthographicCamera).right * 2) / restore.zoom }),
      })
    }
  }, [enabled, get])
  // Parent/object playback transforms settle at 6; camera world poses must read them afterwards.
  useFrame(() => tick.current?.(), 7)
  return null
}
