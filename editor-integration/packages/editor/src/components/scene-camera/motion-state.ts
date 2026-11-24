import {
  type AnyNodeId,
  CameraMotion,
  CameraMotionPoint,
  type CameraMotionPose,
  cameraMotionFromScene,
  cameraTracks,
  getEffectiveNode,
  type MotionTarget,
  objectTracks,
  SceneAnimation,
  type SceneCameraNode,
  sampleScenePlayback,
  sceneAnimationDuration,
  sceneMotionDuration,
  sceneRegistry,
  snapshotMotionProperties,
  updateSceneCameraMotion,
  useScene,
} from '@pascal-app/core'
import {
  blenderRigRequest,
  cameraMotionFrame,
  createCameraMotionEvaluator,
  moveCameraRig,
  sampleObjectMotion,
  solveCameraRig,
  sourceRigBoneHead,
  useViewer,
} from '@pascal-app/viewer'
import { Box3, Euler, Matrix4, type Object3D, Quaternion, Vector3 } from 'three'
import useEditor from '../../store/use-editor'
import { animationData, animationSite, commitSceneAnimation } from '../scene-animation/document'
import { recordTrackKey } from '../scene-animation/keyframes'
import { restoreAnimationSession, saveAnimationSession } from '../scene-animation/session'
import { initialSceneAnimationState, useSceneAnimation } from '../scene-animation/store'
import { useSidebarStore } from '../ui/primitives/sidebar'
import { cameraFocalLength, cameraFov, sceneCameraAspect } from './camera-math'
import {
  clearMotionProperties,
  commitExistingKey,
  discardMotionEdits,
  requestMotionTransition,
  useMotionEdits,
} from './motion-edit-session'
import { useObjectMotion } from './motion-object-store'
import { reconcilePaths } from './motion-path-data'
import { finishPathDrawing } from './motion-path-drawing'
import { sampleRigPropertyAnimation } from './rig-property-animation'
import { currentSceneCameraId } from './scene-camera-state'
import { useCameraStudio } from './store'
import { cameraFromViewport, currentViewportSource } from './viewport-source'

export function canPreviewMotion() {
  const state = useSceneAnimation.getState()
  return (
    state.open &&
    !state.exporting &&
    !state.draft &&
    !state.sceneDraft &&
    !state.pickingAnchor &&
    !state.pickingRigAim &&
    !useObjectMotion.getState().draft
  )
}
export function openMotionPreview() {
  if (!requestMotionTransition(openMotionPreview)) return
  useSceneAnimation.getState().finishCameraEdit?.(false)
  if (!canPreviewMotion()) return
  if (!outputMotionCamera()) {
    useSceneAnimation.setState({ message: 'camera-track-invalid' })
    return
  }
  useSceneAnimation.setState({ previewing: true, navigating: false })
}
export function closeMotionPreview() {
  useSceneAnimation.setState({ previewing: false, playing: false })
}
export function toggleMotionPlayback() {
  if (!requestMotionTransition(toggleMotionPlayback) || !finishPathDrawing()) return
  useSceneAnimation.getState().finishCameraEdit?.(false)
  const state = useSceneAnimation.getState()
  if (state.playing) {
    useSceneAnimation.setState({ playing: false })
    return
  }
  const [start, end] = motionPlaybackRange()
  if (!canPreviewMotion() || end <= start) return
  seekMotion(state.time >= end || state.time < start ? start : state.time)
  useSceneAnimation.setState({ playing: true })
}

export function motionCamera() {
  const id = useSceneAnimation.getState().cameraId
  const node = id ? useScene.getState().nodes[id] : undefined
  return node?.type === 'scene-camera' ? node : null
}

export function motionCameras() {
  return Object.values(useScene.getState().nodes).filter(
    (n): n is SceneCameraNode => n.type === 'scene-camera',
  )
}

export function motionData(node = motionCamera()): CameraMotion {
  return cameraMotionFromScene(animationData(), node?.id ?? '')
}

export function selectMotionCamera(id: string) {
  if (!requestMotionTransition(() => selectMotionCamera(id))) return
  useSceneAnimation.getState().finishCameraEdit?.(false)
  const state = useSceneAnimation.getState(),
    node = useScene.getState().nodes[id as AnyNodeId]
  if (
    state.draft ||
    state.exporting ||
    state.playing ||
    state.sceneDraft ||
    useObjectMotion.getState().draft ||
    node?.type !== 'scene-camera'
  )
    return
  useObjectMotion.setState({ nodeId: null })
  useCameraStudio.setState({ activeId: node.id })
  useSceneAnimation.setState({
    workspace: 'shot',
    shotId: animationData().shots.find((s) => s.cameraId === node.id)?.id ?? null,
    outputCameraId: node.id,
    cameraId: node.id,
    pointId: null,
    segmentId: null,
    navigating: false,
    pickingAnchor: null,
  })
  seekMotion(state.time)
}
export function observeMotionCamera(id: string | null) {
  if (!requestMotionTransition(() => observeMotionCamera(id))) return
  useSceneAnimation.getState().finishCameraEdit?.(false)
  const state = useSceneAnimation.getState()
  if (
    id &&
    !useObjectMotion.getState().nodeId &&
    !state.playing &&
    !state.exporting &&
    !state.previewing
  ) {
    selectMotionCamera(id)
    if (useSceneAnimation.getState().cameraId !== id) return
  }
  useSceneAnimation.setState({
    viewCameraId: id,
    cameraView: !!id,
    viewSceneCamera: false,
    outputMode: 'camera',
  })
}
export function observedMotionCamera() {
  const state = useSceneAnimation.getState()
  const id = state.viewSceneCamera ? currentSceneCameraId() : (state.viewCameraId ?? state.cameraId)
  return motionCameras().find((n) => n.id === id) ?? null
}
export function observeSceneCamera() {
  if (!requestMotionTransition(observeSceneCamera) || !currentSceneCameraId()) return
  useSceneAnimation.getState().finishCameraEdit?.(false)
  if (!useSceneAnimation.getState().open) openMotion()
  useSceneAnimation.setState({
    cameraView: true,
    viewSceneCamera: true,
    outputMode: 'scene',
    viewCameraId: null,
  })
}
export function enterMotionCameraView(id: string) {
  const current = useSceneAnimation.getState()
  if (current.cameraId === id && !current.playing && !current.exporting) {
    useSceneAnimation.setState({
      cameraView: true,
      viewCameraId: id,
      viewSceneCamera: false,
      outputMode: 'camera',
    })
    return
  }
  if (!requestMotionTransition(() => enterMotionCameraView(id))) return
  selectMotionCamera(id)
  const state = useSceneAnimation.getState()
  if (state.cameraId !== id || !canPreviewMotion() || state.playing) return
  useSceneAnimation.setState({
    cameraView: true,
    viewCameraId: id,
    viewSceneCamera: false,
    outputMode: 'camera',
  })
}
export function leaveMotionCameraView() {
  const state = useSceneAnimation.getState()
  if (state.exporting || state.playing) return
  state.finishCameraEdit?.(true)
  commitExistingKey()
  const pose = motionPreviewPose()
  useSceneAnimation.setState({
    cameraView: false,
    viewCameraId: null,
    pickingRigAim: false,
    ...(pose && state.readCameraEditPose?.() ? { draft: pose } : {}),
  })
}
export function motionCameraFrame(node: SceneCameraNode, pose: CameraMotionPose) {
  const frame = { ...cameraMotionFrame(node, pose), frameAspect: animationData().aspect }
  return { ...frame, focalLength: pose.rig ? frame.focalLength : cameraFocalLength(frame) }
}

export function outputMotionCamera(time = useSceneAnimation.getState().time) {
  const state = useSceneAnimation.getState()
  const id =
    state.outputMode === 'scene'
      ? currentSceneCameraId(time)
      : (state.outputCameraId ?? state.cameraId)
  const node = id ? useScene.getState().nodes[id as AnyNodeId] : undefined
  return node?.type === 'scene-camera' ? getEffectiveNode(node) : null
}
export function outputMotionPose(time = useSceneAnimation.getState().time) {
  const node = outputMotionCamera(time)
  if (!node) return null
  return node.id === useSceneAnimation.getState().cameraId &&
    Math.abs(time - useSceneAnimation.getState().time) < 1e-7
    ? motionPreviewPose()
    : cameraPoseAt(node, time)
}
export function solveMotionRig(
  pose: CameraMotionPose,
  node = motionCamera(),
  time = useSceneAnimation.getState().time,
) {
  if (!pose.rig || !node) return pose
  return solveCameraRig(
    pose,
    pose.rig,
    {
      aspect: animationData().aspect,
      projection: sampleRigPropertyAnimation(getEffectiveNode(node), time).projection,
      parentMatrix: motionCameraParentMatrix(node, time),
    },
    pose.rig.target ? resolveMotionTargetAt(pose.rig.target, node, time) : null,
    pose.rig.focus.kind === 'object'
      ? resolveMotionTargetAt(pose.rig.focus.target, node, time)
      : null,
  )
}
export function cameraPoseAt(node: SceneCameraNode, time: number) {
  const data = motionData(node)
  const pose =
    createCameraMotionEvaluator(
      data,
      (target) => resolveMotionTargetAt(target, node, time),
      !node.rig && !data.points.some((p) => p.rig),
    ).sample(time) ?? poseOf(getEffectiveNode(node))
  const animated = sampleRigPropertyAnimation({ ...getEffectiveNode(node), ...pose }, time)
  return solveMotionRig(poseOf(animated), animated, time)
}
export function poseOf(node: SceneCameraNode): CameraMotionPose {
  return {
    rig: node.rig,
    ...(node.lensShift ? { lensShift: node.lensShift } : {}),
    ...(node.viewCorrection ? { viewCorrection: node.viewCorrection } : {}),
    position: [...node.position],
    rotation: [...node.rotation],
    verticalFov: cameraFov(node),
    orthographicHeight: node.orthographicHeight,
    orbitDistance: node.orbitDistance,
  }
}
export function resolveMotionTarget(target: MotionTarget, node = motionCamera()): Vector3 {
  const focus = resolveMotionBoneTarget(target, node, null)
  if (focus) return focus
  const parent = node?.parentId ? sceneRegistry.nodes.get(node.parentId) : null
  const object =
    target.nodeId && useScene.getState().nodes[target.nodeId as SceneCameraNode['id']]
      ? sceneRegistry.nodes.get(target.nodeId)
      : null
  if (!object) return new Vector3(...target.fallback)
  object.updateWorldMatrix(true, true)
  const world = target.localPoint
    ? object.localToWorld(new Vector3(...target.localPoint))
    : (() => {
        const box = new Box3().setFromObject(object)
        return box.isEmpty() ? object.getWorldPosition(new Vector3()) : box.getCenter(new Vector3())
      })()
  object.worldToLocal(world).add(new Vector3(...target.offset))
  object.localToWorld(world)
  parent?.updateWorldMatrix(true, false)
  return parent ? parent.worldToLocal(world) : world
}
export function resolveMotionTargetAt(
  target: MotionTarget,
  node: SceneCameraNode,
  time: number,
): Vector3 {
  const focus = resolveMotionBoneTarget(target, node, time)
  if (focus) return focus
  const object = target.nodeId ? sceneRegistry.nodes.get(target.nodeId) : null
  if (!object || !useScene.getState().nodes[target.nodeId as AnyNodeId] || !target.localPoint)
    return resolveMotionTarget(target, node)
  const result = new Vector3(...target.localPoint)
    .add(new Vector3(...target.offset))
    .applyMatrix4(motionWorldMatrixAt(object, time))
  const parent = motionCameraParentMatrix(node, time)
  return parent ? result.applyMatrix4(parent.invert()) : result
}

function resolveMotionBoneTarget(
  target: MotionTarget,
  node: SceneCameraNode | null,
  time: number | null,
): Vector3 | null {
  const subtarget = 'subtarget' in target ? target.subtarget : undefined
  if (typeof subtarget !== 'string' || !target.nodeId) return null
  const stored = useScene.getState().nodes[target.nodeId as AnyNodeId]
  if (stored?.type !== 'scene-camera') return null
  const subject = getEffectiveNode(stored),
    state = useSceneAnimation.getState()
  let pose = poseOf(subject)
  if (time !== null) {
    const editing =
      !state.exporting &&
      !state.renderingFilm &&
      state.cameraId === subject.id &&
      Math.abs(state.time - time) < 1e-7
        ? (state.draft ?? state.readCameraEditPose?.())
        : null
    pose =
      editing ??
      createCameraMotionEvaluator(
        motionData(subject),
        (anchor) => resolveMotionTargetAt(anchor, subject, time),
        !subject.rig,
      ).sample(time) ??
      pose
    pose = poseOf(sampleRigPropertyAnimation({ ...subject, ...pose }, time))
  }
  if (!pose.rig?.native) return null
  const parent = time === null ? undefined : motionCameraParentMatrix(subject, time)
  const staticParent = subject.parentId ? sceneRegistry.nodes.get(subject.parentId) : null
  if (time === null) staticParent?.updateWorldMatrix(true, false)
  const point = sourceRigBoneHead(
    blenderRigRequest(
      pose.rig,
      {
        aspect: time === null ? sceneCameraAspect(subject) : animationData().aspect,
        projection:
          time === null ? subject.projection : sampleRigPropertyAnimation(subject, time).projection,
        parentMatrix: parent ?? staticParent?.matrixWorld,
      },
      pose,
      pose.rig.target
        ? time === null
          ? resolveMotionTarget(pose.rig.target, subject)
          : resolveMotionTargetAt(pose.rig.target, subject, time)
        : null,
    ),
    subtarget,
  )
  if (!point) return new Vector3(...target.fallback)
  if (!node?.parentId) return point
  if (time !== null) {
    const matrix = motionCameraParentMatrix(node, time)
    return matrix ? point.applyMatrix4(matrix.invert()) : point
  }
  const owner = sceneRegistry.nodes.get(node.parentId)
  owner?.updateWorldMatrix(true, false)
  return owner ? owner.worldToLocal(point) : point
}

export function motionCameraParentMatrix(node: SceneCameraNode, time: number) {
  const parent = node.parentId ? sceneRegistry.nodes.get(node.parentId) : null
  return parent ? motionWorldMatrixAt(parent, time) : undefined
}

function motionWorldMatrixAt(object: Object3D, time: number) {
  const tracks = new Map(
    objectTracks(animationData())
      .filter(
        (track) =>
          useScene.getState().nodes[track.nodeId as AnyNodeId]?.parentId === track.parentId,
      )
      .map((track) => [sceneRegistry.nodes.get(track.nodeId), track]),
  )
  const world = (entry: Object3D): Matrix4 => {
    const track = tracks.get(entry),
      pose = track ? sampleObjectMotion(track, time) : null
    const local = pose
      ? new Matrix4().compose(
          new Vector3(...pose.position),
          new Quaternion().setFromEuler(new Euler(...pose.rotation)),
          pose.scale ? new Vector3(...pose.scale) : entry.scale,
        )
      : new Matrix4().compose(entry.position, entry.quaternion, entry.scale)
    return entry.parent ? world(entry.parent).multiply(local) : local
  }
  return world(object)
}
export function motionPose(time = useSceneAnimation.getState().time) {
  const node = motionCamera()
  if (!node) return null
  return cameraPoseAt(node, time)
}
export function constrainedMotionSegments(pointId = useSceneAnimation.getState().pointId) {
  return motionData().segments.filter(
    (s) => s.look === 'target' && (s.fromId === pointId || s.toId === pointId),
  )
}
export function motionPreviewPose() {
  const state = useSceneAnimation.getState()
  const editingPose = state.readCameraEditPose?.()
  if (state.draft?.rig) return solveMotionRig(state.draft)
  if (!state.draft && editingPose) return editingPose
  if (!state.draft) return motionPose()
  if (!state.pointId || !constrainedMotionSegments().length) return state.draft
  const data = motionData()
  return createCameraMotionEvaluator(
    {
      ...data,
      points: data.points.map((point) =>
        point.id === state.pointId ? { ...point, ...state.draft! } : point,
      ),
    },
    resolveMotionTarget,
  ).sample(state.time)
}
export function freeMotionPointOrientation() {
  const state = useSceneAnimation.getState(),
    pose = motionPose(),
    data = motionData()
  if (!state.pointId || !pose || state.draft) return
  const ids = new Set(constrainedMotionSegments().map((s) => s.id))
  commitMotion({
    ...data,
    points: data.points.map((p) =>
      p.id === state.pointId ? { ...p, rotation: pose.rotation } : p,
    ),
    segments: data.segments.map((s) => (ids.has(s.id) ? { ...s, look: 'free' } : s)),
  })
}
let restorePresentation: (() => void) | null = null
export function openMotion(node?: SceneCameraNode) {
  if (useSceneAnimation.getState().open) {
    useSceneAnimation.setState({ timelineVisible: true })
    if (node) selectMotionCamera(node.id)
    return
  }
  if (useScene.getState().readOnly) return
  if (!requestMotionTransition(() => openMotion(node))) return
  endSceneAnimation(true)
  const site = animationSite()
  if (!site) {
    useSceneAnimation.setState({ message: 'missing-site' })
    return
  }
  if (!site.animation)
    useScene.getState().updateNode(site.id, {
      animation: SceneAnimation.parse({
        aspect: node ? sceneCameraAspect(node) : 16 / 9,
      }),
    })
  useEditor.getState().setTool(null)
  useEditor.getState().setMode('select')
  const viewer = useViewer.getState()
  const sidebar = useSidebarStore.getState().isCollapsed
  const saved = {
    levelMode: viewer.levelMode,
    wallMode: viewer.wallMode,
    selection: viewer.selection,
  }
  restorePresentation = () => {
    useViewer.setState(saved)
    useSidebarStore.getState().setIsCollapsed(sidebar)
  }
  useViewer.setState({ levelMode: 'stacked', wallMode: 'up' })
  viewer.setSelection({ selectedIds: [] })
  useCameraStudio.setState({
    activeId: node?.id ?? null,
    open: false,
    minimized: false,
    pickingFocus: false,
  })
  useSceneAnimation.setState({
    ...initialSceneAnimationState,
    open: true,
    timelineVisible: true,
    shotId:
      animationData().shots.find((s) => s.cameraId === node?.id)?.id ??
      animationData().shots[0]?.id ??
      null,
    cameraId: (node?.id ?? animationData().shots[0]?.cameraId ?? null) as
      | SceneCameraNode['id']
      | null,
    outputCameraId: node?.id ?? motionCameras()[0]?.id ?? null,
    pointId:
      cameraTracks(animationData()).find((t) => t.nodeId === node?.id)?.points[0]?.id ?? null,
  })
  if (!node) restoreAnimationSession(site.id, animationData())
  sampleScenePlayback(useSceneAnimation.getState().time)
}
export function hideSceneTimeline() {
  const state = useSceneAnimation.getState()
  if (state.exporting) return
  state.finishCameraEdit?.(true)
  useSceneAnimation.setState({
    timelineVisible: false,
    pickingAnchor: null,
    pickingRigAim: false,
  })
}
export function endSceneAnimation(force = false) {
  if (!force && !requestMotionTransition(() => endSceneAnimation())) return
  if (useSceneAnimation.getState().open) saveAnimationSession(animationSite()?.id)
  if (force) discardMotionEdits()
  useSceneAnimation.getState().finishCameraEdit?.(false)
  useSceneAnimation.getState().cancelExport?.()
  const filmExportUrl = useSceneAnimation.getState().filmExportUrl
  if (filmExportUrl) URL.revokeObjectURL(filmExportUrl)
  try {
    sampleScenePlayback(null)
  } catch (error) {
    console.error('Scene animation restoration:', error)
  } finally {
    restorePresentation?.()
    restorePresentation = null
    useSceneAnimation.setState({ ...initialSceneAnimationState })
    useObjectMotion.setState({ nodeId: null, draft: null })
  }
}
export function seekMotion(time: number, pointId: string | null = null) {
  if (!requestMotionTransition(() => seekMotion(time, pointId))) return
  useSceneAnimation.getState().finishCameraEdit?.(false)
  if (
    useSceneAnimation.getState().draft ||
    useObjectMotion.getState().draft ||
    useSceneAnimation.getState().exporting
  )
    return
  if (!Number.isFinite(time)) return
  const data = motionData(),
    clampedTime = Math.max(0, Math.min(600, time))
  const atPoint = pointId
    ? data.points.find((p) => p.id === pointId)
    : data.points.find((p) => Math.abs(p.time - clampedTime) < 0.5 / data.fps)
  useSceneAnimation.setState({
    pickingRigAim: false,
    time: atPoint?.time ?? clampedTime,
    pointId: atPoint?.id ?? null,
    segmentId: null,
    playing: false,
    navigating: false,
    pickingAnchor: null,
    message: null,
  })
  sampleScenePlayback(useSceneAnimation.getState().time)
}
export function changeMotionDraft(patch: Partial<CameraMotionPose>, complete = true) {
  const state = useSceneAnimation.getState()
  if (
    state.exporting ||
    state.playing ||
    state.previewing ||
    state.pickingAnchor ||
    useScene.getState().readOnly ||
    state.lockedIds.includes(state.cameraId ?? '') ||
    useObjectMotion.getState().draft
  )
    return
  const pose = state.draft ?? motionPreviewPose()
  state.finishCameraEdit?.(false)
  if (!pose) return
  const rig = Object.hasOwn(patch, 'rig')
    ? patch.rig
    : pose.rig
      ? moveCameraRig(pose.rig, pose, patch)
      : pose.rig
  const next = solveMotionRig({ ...pose, ...patch, rig })
  useSceneAnimation.setState({ draft: next, message: null })
  if (complete) commitExistingKey()
}
export function canCaptureViewportKey() {
  const state = useSceneAnimation.getState(),
    object = useObjectMotion.getState()
  return (
    !!motionCamera() &&
    !useScene.getState().readOnly &&
    !state.playing &&
    !state.exporting &&
    !state.previewing &&
    !state.navigating &&
    !state.sceneDraft &&
    !state.pickingAnchor &&
    !state.pickingRigAim &&
    !object.nodeId &&
    !object.draft
  )
}
export function captureViewportKey() {
  if (!canCaptureViewportKey()) return false
  useSceneAnimation.getState().finishCameraEdit?.(true)
  const source = currentViewportSource(),
    node = motionCamera()
  if (!node || !source) return false
  const effective = getEffectiveNode(node)
  const parent = node.parentId ? sceneRegistry.nodes.get(node.parentId) : undefined
  parent?.updateWorldMatrix(true, false)
  const frame = {
    ...effective,
    ...cameraFromViewport(source, effective, parent?.matrixWorld, animationData().aspect),
    depthOfField: effective.depthOfField,
  }
  const data = motionData()
  const time = Math.round(useSceneAnimation.getState().time * data.fps) / data.fps
  const captured = useSceneAnimation.getState().cameraView
    ? (motionPreviewPose() ?? poseOf(frame))
    : {
        ...poseOf(frame),
        ...(useSceneAnimation.getState().draft
          ? {
              verticalFov: useSceneAnimation.getState().draft!.verticalFov,
              orthographicHeight: useSceneAnimation.getState().draft!.orthographicHeight,
            }
          : {}),
      }
  if (!saveMotionPoint(captured, frame, time, data)) return false
  useSceneAnimation.setState({ message: 'viewport-key-saved' })
  return true
}
export function commitMotion(data: CameraMotion) {
  const node = motionCamera()
  if (useScene.getState().readOnly || useSceneAnimation.getState().exporting) return false
  const previous = motionData(node)
  data = {
    ...data,
    points: data.points.map((p) => {
      const old = previous.points.find((k) => k.id === p.id)
      return old?.rig &&
        p.rig &&
        JSON.stringify(old.rig) === JSON.stringify(p.rig) &&
        p.position.some((v, i) => v !== old.position[i])
        ? { ...p, rig: moveCameraRig(p.rig, old, { position: p.position }) }
        : p
    }),
  }
  const result = CameraMotion.safeParse(data)
  if (!result.success) {
    useSceneAnimation.setState({
      message: data.points.length > 200 ? 'motion-limit' : 'invalid-time',
    })
    return false
  }
  if (
    !commitSceneAnimation(
      node
        ? updateSceneCameraMotion(animationData(), node, result.data)
        : {
            ...animationData(),
            duration: result.data.duration,
            fps: result.data.fps,
            resolution: result.data.resolution,
          },
    )
  )
    return false
  useSceneAnimation.setState({ sceneDraft: null, timelineMax: null, message: null })
  return true
}
export function reconcileMotion(
  points: CameraMotionPoint[],
  previous = motionData(),
): CameraMotion {
  return reconcilePaths(points, previous)
}

function parseMotionPoint(input: unknown) {
  const result = CameraMotionPoint.safeParse(input)
  if (result.success) return result.data
  useSceneAnimation.setState({ message: 'invalid-time' })
  return null
}
export function persistUnkeyedCamera() {
  const state = useSceneAnimation.getState(),
    node = motionCamera(),
    site = animationSite()
  if (
    !node ||
    !site ||
    motionData(node).points.length ||
    state.playing ||
    state.exporting ||
    useScene.getState().readOnly ||
    (useObjectMotion.getState().nodeId && !useMotionEdits.getState().cameraDirty)
  )
    return false
  const pose = motionPreviewPose()
  if (!pose) return false
  if (!pose.rig && !node.rig && !useMotionEdits.getState().cameraDirty) return false
  // Batch with the scene document to bypass property-draft interception; one gesture, one undo.
  useScene.getState().updateNodes([
    { id: site.id, data: { animation: site.animation } },
    {
      id: node.id,
      data: {
        ...pose,
      },
    },
  ])
  useSceneAnimation.setState({ draft: null })
  useMotionEdits.setState({ cameraDirty: false })
  sampleScenePlayback(state.time)
  return true
}
export function commitMotionPoint() {
  useSceneAnimation.getState().finishCameraEdit?.(true)
  const state = useSceneAnimation.getState(),
    data = motionData(),
    pose = motionPreviewPose()
  if (
    !pose ||
    state.playing ||
    state.exporting ||
    state.previewing ||
    (state.cameraId && state.lockedIds.includes(state.cameraId))
  )
    return
  if (useObjectMotion.getState().draft && !useMotionEdits.getState().cameraDirty) return
  const selected = useObjectMotion.getState().nodeId
    ? undefined
    : data.points.find((p) => p.id === state.pointId)
  const time = selected?.time ?? Math.round(state.time * data.fps) / data.fps
  saveMotionPoint(pose, getEffectiveNode(motionCamera()!), time, data)
}
function saveMotionPoint(
  pose: CameraMotionPose,
  frame: SceneCameraNode,
  time: number,
  data: CameraMotion,
) {
  const existing = data.points.find((p) => Math.abs(p.time - time) < 0.5 / data.fps)
  const values = snapshotMotionProperties(motionCameraFrame(frame, pose))
  const point = parseMotionPoint({
    ...existing,
    ...pose,
    values,
    channels: [
      ...new Set([
        // A recorded view authors its heading even when only its position changed.
        'rotation',
        ...(existing?.channels ?? []),
        ...Object.keys(useMotionEdits.getState().properties[frame.id] ?? {}),
      ]),
    ],
    removed: existing?.removed?.filter((key) => !(key in values)),
    time,
  })
  if (!point) return false
  const scene = animationData()
  const track = cameraTracks(scene).find((t) => t.nodeId === frame.id) ?? {
    kind: 'camera' as const,
    nodeId: frame.id,
    parentId: frame.parentId,
    points: [],
    segments: [],
  }
  if (
    !commitSceneAnimation(
      recordTrackKey(scene, track, point, snapshotMotionProperties(motionCamera()!)),
    )
  )
    return false
  useSceneAnimation.setState({
    draft: null,

    navigating: false,
    ...(!useObjectMotion.getState().nodeId ? { segmentId: null, pointId: point.id } : {}),
    time: point.time,
    message: !existing && time < (data.points.at(-1)?.time ?? 0) ? 'recalculated' : null,
  })
  clearMotionProperties(frame.id)
  useMotionEdits.setState({ cameraDirty: false })
  useSceneAnimation.getState().finishCameraEdit?.(false)
  sampleScenePlayback(point.time)
  return true
}
export function removeMotionPoint(id: string) {
  const data = motionData()
  if (
    !commitMotion(
      reconcileMotion(
        data.points.filter((p) => p.id !== id),
        data,
      ),
    )
  )
    return
  useSceneAnimation.setState({ pointId: null, draft: null, message: 'recalculated' })
  sampleScenePlayback(useSceneAnimation.getState().time)
}
export function duplicateMotionPoint(id: string) {
  const data = motionData(),
    index = data.points.findIndex((p) => p.id === id),
    point = data.points[index]
  if (!point) return
  const next = data.points[index + 1]
  const time = next
    ? Math.round(((point.time + next.time) * data.fps) / 2) / data.fps
    : point.time + 3
  const copy = parseMotionPoint({ ...point, id: undefined, time })
  if (!copy) return
  if (!commitMotion(reconcileMotion([...data.points, copy], data))) return
  seekMotion(copy.time, copy.id)
}
export function motionTarget(
  nodeId: string,
  localPoint: [number, number, number] | null = null,
): MotionTarget | null {
  const object = sceneRegistry.nodes.get(nodeId)
  if (!object) return null
  const anchor: MotionTarget = { nodeId, localPoint, offset: [0, 0, 0], fallback: [0, 0, 0] }
  anchor.fallback = resolveMotionTarget(anchor).toArray()
  return anchor
}
export function updateMotionAnchor(
  segmentId: string,
  field: 'target' | 'center',
  anchor: MotionTarget,
) {
  const state = useSceneAnimation.getState(),
    data = motionData()
  if (
    state.draft ||
    state.playing ||
    state.exporting ||
    !data.segments.some((s) => s.id === segmentId)
  )
    return false
  const target = { ...anchor, fallback: resolveMotionTarget(anchor).toArray() }
  const changed = commitMotion({
    ...data,
    segments: data.segments.map((s) =>
      s.id === segmentId
        ? {
            ...s,
            [field]: target,
            ...(field === 'target' ? { look: 'target' as const } : { path: 'orbit' as const }),
          }
        : s,
    ),
  })
  if (changed) useSceneAnimation.setState({ pickingAnchor: null, message: null })
  return changed
}
export function pickMotionAnchor(nodeId: string, worldPoint: [number, number, number]) {
  const picking = useSceneAnimation.getState().pickingAnchor,
    object = sceneRegistry.nodes.get(nodeId)
  if (!picking || !object) return false
  object.updateWorldMatrix(true, false)
  const anchor = motionTarget(nodeId, object.worldToLocal(new Vector3(...worldPoint)).toArray())
  return !!anchor && updateMotionAnchor(picking.segmentId, picking.field, anchor)
}
export function motionPreset(
  kind: 'push' | 'pull' | 'up' | 'down' | 'left' | 'right',
  distance: number,
  targetId?: string,
) {
  const data = motionData(),
    state = useSceneAnimation.getState(),
    pose = state.draft ?? motionPose()
  if (!pose || !data.points.length || state.draft) return
  const start = data.points.find((p) => p.id === state.pointId) ?? data.points.at(-1)!
  if (start !== data.points.at(-1)) {
    useSceneAnimation.setState({ message: 'preset-last' })
    return
  }
  const position = new Vector3(...start.position),
    q = new Quaternion().setFromEuler(new Euler(...start.rotation))
  const target = targetId ? motionTarget(targetId) : null
  const orbit = kind === 'left' || kind === 'right'
  if (orbit && !target) {
    useSceneAnimation.setState({ message: 'choose-target' })
    return
  }
  if (orbit) {
    const center = new Vector3(...target!.fallback)
    position
      .sub(center)
      .applyAxisAngle(new Vector3(0, 1, 0), ((kind === 'right' ? -1 : 1) * Math.PI) / 4)
      .add(center)
  } else if (kind === 'up' || kind === 'down') position.y += distance * (kind === 'up' ? 1 : -1)
  else position.add(new Vector3(0, 0, kind === 'push' ? -distance : distance).applyQuaternion(q))
  const point = parseMotionPoint({
    ...start,
    id: undefined,
    name: '',
    position: position.toArray(),
    time: start.time + 3,
  })
  if (!point) return
  const updated = reconcileMotion([...data.points, point], data)
  if (orbit)
    Object.assign(updated.segments.at(-1)!, {
      path: 'orbit',
      center: target,
      target,
      look: 'target',
      direction: kind,
    })
  if (commitMotion(updated)) seekMotion(point.time, point.id)
}

export function motionPlaybackRange(): [number, number] {
  const data = animationData(),
    state = useSceneAnimation.getState()
  if (state.previewing && state.outputMode === 'scene') return motionOutputRange()
  if (state.previewing && state.outputMode === 'camera' && state.outputCameraId)
    return (
      data.cameraRanges?.[state.outputCameraId] ??
      data.playbackRange ?? [0, sceneMotionDuration(motionData())]
    )
  return data.playbackRange ?? [0, sceneMotionDuration(motionData())]
}
export function motionOutputRange(): [number, number] {
  const data = animationData(),
    state = useSceneAnimation.getState()
  return (
    (state.outputMode === 'camera' && state.outputCameraId
      ? data.cameraRanges?.[state.outputCameraId]
      : undefined) ??
    data.playbackRange ?? [
      0,
      state.outputMode === 'scene'
        ? sceneAnimationDuration(data)
        : sceneMotionDuration(motionData()),
    ]
  )
}
