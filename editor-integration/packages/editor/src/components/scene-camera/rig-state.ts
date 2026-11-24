import {
  type AnyNode,
  type AnyNodeId,
  type CameraMotionPose,
  CameraRig,
  getEffectiveNode,
  type SceneCameraNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  blenderRigRequest,
  cameraRigParentMatrix,
  createSourceCameraRig,
  detachSourceRigAim,
  evaluateSourceCameraRig,
  sceneCameraRigPose,
  solveCameraRig,
  useViewer,
} from '@pascal-app/viewer'
import { flushSync } from '@react-three/fiber'
import { Box3, Matrix4, Vector3 } from 'three'
import { create } from 'zustand'
import useEditor from '../../store/use-editor'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { cameraFocalLength, sceneCameraAspect } from './camera-math'
import {
  changeMotionDraft,
  leaveMotionCameraView,
  motionCameraParentMatrix,
  motionPreviewPose,
  motionTarget,
  resolveMotionTarget,
  resolveMotionTargetAt,
} from './motion-state'
import { followRigCameraControls, rigControlBasis } from './rig-control-follow'
import { sourcePosePick } from './rig-pose-selection-source'
import { sourcePoseCursorToSelected } from './rig-transform-pivot-source'

export const rigChannels = { translate: 'location', rotate: 'rotation', scale: 'scale' } as const
export type RigControl = string
export const useRigEditor = create<{
  aimCameraId: SceneCameraNode['id'] | null
  aimPickMode: 'point' | 'surface'
  control: RigControl
  selectionCameraId: string | null
  selectedControls: string[] | null
  poseCameraId: string | null
  frameRequest: number
  mode: 'translate' | 'rotate' | 'scale'
  orbit: boolean
  gesture: import('./rig-keyboard').RigGesture | null
  pivot: string
  cursor: [number, number, number]
  keepCameraLevel: boolean
}>(() => ({
  aimCameraId: null,
  aimPickMode: 'point',
  control: 'Camera',
  selectionCameraId: null,
  selectedControls: null,
  poseCameraId: null,
  frameRequest: 0,
  mode: 'translate',
  orbit: false,
  gesture: null,
  pivot: 'MEDIAN_POINT',
  cursor: [0, 0, 0],
  keepCameraLevel: true,
}))

export function rigSelectedControls(
  cameraId: string,
  fallback = useRigEditor.getState().control,
  available?: string[],
) {
  const state = useRigEditor.getState()
  const selected =
    state.selectionCameraId === cameraId && state.selectedControls
      ? state.selectedControls
      : [fallback]
  if (!available || !selected.length) return selected
  const valid = selected.filter((name) => available.includes(name))
  return valid.length ? valid : [fallback]
}

export function rigIsPoseMode(cameraId: string) {
  return useRigEditor.getState().poseCameraId === cameraId
}

export function exitCameraRig(node: SceneCameraNode) {
  if (!rigIsPoseMode(node.id)) return
  flushSync(() => useRigEditor.setState({ poseCameraId: null }))
}

export function selectRigControl(
  cameraId: string,
  names: string[],
  hit: string,
  toggle = false,
  passthrough = false,
) {
  const state = useRigEditor.getState()
  const next = sourcePosePick(
    names,
    rigSelectedControls(cameraId, names.includes(state.control) ? state.control : 'Camera', names),
    state.control,
    hit,
    toggle,
    passthrough,
  )
  flushSync(() => {
    useRigEditor.setState({
      control: next.active,
      selectionCameraId: cameraId,
      selectedControls: next.selected,
      poseCameraId: cameraId,
    })
  })
}

export function snapRigCursorToSelected(node: SceneCameraNode) {
  const editor = useRigEditor.getState(),
    rig = rigPose(node).rig
  if (rig?.native && !rigIsPoseMode(node.id)) {
    const data = rigSnapshot(node)
    if (!data) return
    const world = new Matrix4()
      .fromArray(rig.native.placement)
      .multiply(new Matrix4().fromArray(data.cameraMatrix))
    const state = useSceneAnimation.getState()
    const parent = state.open
      ? motionCameraParentMatrix(node, state.time)
      : cameraRigParentMatrix(node)
    if (parent) world.premultiply(parent)
    useRigEditor.setState({ cursor: new Vector3().setFromMatrixPosition(world).toArray() })
    return
  }
  const data = rigSnapshot(node)
  const names = rigSelectedControls(
    node.id,
    data?.widgets.some((w) => w.name === editor.control) ? editor.control : 'Camera',
    data?.widgets.map((w) => w.name),
  )
  const widgets = data?.widgets.filter((w) => names.includes(w.name))
  if (!rig?.native || !widgets?.length) return
  const parent = node.parentId ? sceneRegistry.nodes.get(node.parentId) : null
  parent?.updateWorldMatrix(true, false)
  const world = new Matrix4().fromArray(rig.native.placement)
  if (parent) world.premultiply(parent.matrixWorld)
  const heads = widgets.map((widget) =>
    new Vector3().setFromMatrixPosition(rigControlBasis(rig, data!, widget)).toArray(),
  )
  const cursor = sourcePoseCursorToSelected(heads, world, editor.pivot)
  if (cursor) useRigEditor.setState({ cursor })
}

export function canAimAtNode(node: AnyNode) {
  return !['site', 'building', 'level', 'scene-camera', 'spawn', 'guide'].includes(node.type)
}
export function rigPose(node: SceneCameraNode): CameraMotionPose {
  const state = useSceneAnimation.getState()
  return state.open && state.cameraId === node.id
    ? motionPreviewPose()!
    : sceneCameraRigPose(getEffectiveNode(node))
}
export function updateRig(node: SceneCameraNode, rig: CameraRig | null, complete = true) {
  const state = useSceneAnimation.getState()
  if (
    useScene.getState().readOnly ||
    state.playing ||
    state.exporting ||
    state.previewing ||
    state.lockedIds.includes(node.id)
  )
    return false
  if (rig && !CameraRig.safeParse(rig).success) return false
  if (state.open && state.cameraId === node.id) {
    changeMotionDraft({ rig }, complete)
  } else {
    const pose = rigPose(node)
    const solved = rig
      ? solveCameraRig(
          pose,
          rig,
          {
            aspect: sceneCameraAspect(node),
            projection: node.projection,
            parentMatrix: cameraRigParentMatrix(node),
          },
          rig.target ? resolveMotionTarget(rig.target, node) : null,
          rig.focus.kind === 'object' ? resolveMotionTarget(rig.focus.target, node) : null,
        )
      : pose
    const frame = { ...node, ...solved }
    useScene.getState().updateNode(node.id, {
      ...solved,
      rig,
      focalLength: solved.rigFocalLength ?? cameraFocalLength(frame),
    })
  }
  return true
}
export function changeRigType(node: SceneCameraNode, type: CameraRig['type'] | '') {
  const pose = rigPose(node)
  if (!pose) return
  const changed = updateRig(
    node,
    type
      ? createSourceCameraRig(
          type,
          pose,
          useSceneAnimation.getState().open ? animationData().aspect : sceneCameraAspect(node),
          node.projection,
          node.sensorWidth,
        )
      : null,
  )
  if (changed)
    useRigEditor.setState({
      control: 'Camera',
      selectedControls: null,
      selectionCameraId: node.id,
      poseCameraId: type ? node.id : null,
    })
}
export function setRigTarget(
  nodeId: string | null,
  localPoint?: [number, number, number],
  camera?: SceneCameraNode,
) {
  const state = useSceneAnimation.getState()
  const node = camera ?? useScene.getState().nodes[state.cameraId as AnyNodeId]
  if (node?.type !== 'scene-camera') return false
  const pose = rigPose(node)
  const rig = pose?.rig
  if (!nodeId) {
    if (!rig) return false
    const next =
      rig.native && rig.target
        ? detachSourceRigAim(rig, rigSnapshot(node)!)
        : {
            ...rig,
            target: null,
          }
    const changed = updateRig(node, next)
    if (changed) useSceneAnimation.setState({ pickingRigAim: false })
    return changed
  }
  const subject = useScene.getState().nodes[nodeId as AnyNodeId]
  if (!subject || !canAimAtNode(subject)) return false
  const object = sceneRegistry.nodes.get(nodeId)
  if (!object || nodeId === node.id) return false
  object.updateWorldMatrix(true, true)
  if (!localPoint) {
    const box = new Box3().setFromObject(object)
    localPoint = object
      .worldToLocal(
        box.isEmpty() ? object.getWorldPosition(new Vector3()) : box.getCenter(new Vector3()),
      )
      .toArray()
  }
  const target = motionTarget(nodeId, localPoint)
  if (!target) return false
  target.fallback = resolveMotionTarget(target, node).toArray()
  const changed = updateRig(node, {
    ...(rig?.native
      ? rig
      : createSourceCameraRig(
          'dolly',
          pose,
          state.open && state.cameraId === node.id
            ? animationData().aspect
            : sceneCameraAspect(node),
          node.projection,
          node.sensorWidth,
        )),
    target,
  })
  if (changed) useSceneAnimation.setState({ pickingRigAim: false })
  return changed
}

export function editCameraRig(node: SceneCameraNode) {
  const state = useSceneAnimation.getState()
  if (
    state.playing ||
    state.exporting ||
    state.previewing ||
    useScene.getState().readOnly ||
    state.lockedIds.includes(node.id)
  )
    return
  useEditor.getState().setTool(null)
  useEditor.getState().setMode('select')
  if (useEditor.getState().viewMode === '2d') useEditor.getState().setViewMode('3d')
  if (state.cameraView) leaveMotionCameraView()
  if (!rigPose(node)?.rig?.native) changeRigType(node, rigPose(node)?.rig?.type ?? 'dolly')
  if (!state.open) useViewer.getState().setSelection({ selectedIds: [node.id] })
  useRigEditor.setState((s) => ({ poseCameraId: node.id, frameRequest: s.frameRequest + 1 }))
}

export function rigSnapshot(node: SceneCameraNode, override?: CameraRig) {
  const pose = rigPose(node),
    rig = override ?? pose?.rig
  if (!rig?.native) return null
  const state = useSceneAnimation.getState()
  const resolve = (target: NonNullable<CameraRig['target']>) =>
    state.open ? resolveMotionTargetAt(target, node, state.time) : resolveMotionTarget(target, node)
  return followRigCameraControls(
    rig,
    evaluateSourceCameraRig(
      blenderRigRequest(
        rig,
        {
          aspect: useSceneAnimation.getState().open
            ? animationData().aspect
            : sceneCameraAspect(node),
          projection: getEffectiveNode(node).projection,
          parentMatrix: state.open
            ? motionCameraParentMatrix(node, state.time)
            : cameraRigParentMatrix(node),
        },
        pose,
        rig.target ? resolve(rig.target) : null,
        rig.focus.kind === 'object' ? resolve(rig.focus.target) : null,
      ),
    ),
  )
}
