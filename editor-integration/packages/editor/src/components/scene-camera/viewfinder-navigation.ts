import {
  type AnyNodeId,
  type CameraMotionPose,
  getEffectiveNode,
  type SceneCameraNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { cameraRigParentMatrix, useViewer } from '@pascal-app/viewer'
import { flushSync } from '@react-three/fiber'
import { Matrix4 } from 'three'
import useInteractionScope from '../../store/use-interaction-scope'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { sceneCameraAspect } from './camera-math'
import { startCameraPointerDrag } from './camera-pointer-drag'
import { commitExistingKey } from './motion-edit-session'
import { useObjectMotion } from './motion-object-store'
import { changeMotionDraft, motionCameraParentMatrix } from './motion-state'
import type { RigDirectAction } from './rig-direct-drag'
import { rigIsPoseMode, rigPose, rigSnapshot, updateRig, useRigEditor } from './rig-state'
import { getRigViewfinderOverlay } from './rig-viewfinder-target'
import { createRigViewportPointer } from './rig-viewport-pointer'
import { useCameraStudio } from './store'
import { createFreeViewfinderEdit, createObjectViewfinderEdit } from './viewfinder-navigation-math'
import { viewportFrameRect } from './viewport-frame'

const nativePointers = new WeakMap<HTMLCanvasElement, () => void>()

export function canNavigateViewfinder(
  node: SceneCameraNode,
  canvas = useCameraStudio.getState().canvas,
) {
  return canShowRigViewfinder(node, canvas)
}

export function canShowRigViewfinder(
  node: SceneCameraNode,
  canvas = useCameraStudio.getState().canvas,
) {
  const state = useSceneAnimation.getState(),
    studio = useCameraStudio.getState()
  const ownsCanvas =
    !!canvas &&
    canvas === studio.canvas &&
    (studio.open && !state.open
      ? studio.activeId === node.id && !studio.minimized
      : studio.viewfinderId === node.id &&
        canvas === studio.viewfinderCanvas &&
        !studio.viewfinderCollapsed)
  return (
    ownsCanvas &&
    !useScene.getState().readOnly &&
    !state.playing &&
    !state.exporting &&
    !state.previewing &&
    !state.cameraView &&
    !state.pickingRigAim &&
    !state.pickingAnchor &&
    !useObjectMotion.getState().nodeId &&
    !state.lockedIds.includes(node.id) &&
    !studio.pickingFocus &&
    studio.ready &&
    !studio.error &&
    (!state.open || (state.workspace === 'shot' && state.cameraId === node.id))
  )
}

export function startViewfinderNavigation(
  node: SceneCameraNode,
  canvas: HTMLCanvasElement,
  event: PointerEvent,
) {
  if (rigPose(node).rig?.native && rigIsPoseMode(node.id)) {
    if (
      event.button !== 0 ||
      !canNavigateViewfinder(node, canvas) ||
      useInteractionScope.getState().scope.kind !== 'idle'
    )
      return null
    const rect = canvas.getBoundingClientRect()
    const frame = viewportFrameRect(canvas.width, canvas.height, rect.width, rect.height)
    const x = event.clientX - rect.left - frame.x,
      y = event.clientY - rect.top - frame.y
    if (frame.height <= 0 || x < 0 || y < 0 || x > frame.width || y > frame.height) return null
    nativePointers.get(canvas)?.()
    const currentNode = () => {
      const current = useScene.getState().nodes[node.id]
      return current?.type === 'scene-camera' ? current : null
    }
    const poseMode = rigIsPoseMode(node.id)
    const valid = () => {
      const current = currentNode()
      return (
        !!current &&
        !!rigPose(current)?.rig?.native &&
        rigIsPoseMode(node.id) === poseMode &&
        canNavigateViewfinder(current, canvas)
      )
    }
    const pick = getRigViewfinderOverlay(canvas, node.id)?.pick
    const pointer = createRigViewportPointer({
      canvas,
      cameraId: node.id,
      getNames: () => {
        const current = currentNode()
        return current ? (rigSnapshot(current)?.widgets.map((widget) => widget.name) ?? []) : []
      },
      enabled: valid,
      pixelRatio: () => canvas.height / frame.height,
      pick: (signal, _from, _selected, nearest) =>
        pick ? pick(x / frame.width, y / frame.height, nearest, signal) : Promise.resolve(null),
    })
    pointer.bind({ pointerDown: false })
    const cancel = pointer.start(event)
    if (!cancel) {
      pointer.dispose()
      return null
    }
    let closed = false
    const dispose = () => {
      if (closed) return
      closed = true
      for (const release of releases) release()
      pointer.dispose()
      if (nativePointers.get(canvas) === dispose) nativePointers.delete(canvas)
    }
    const stopIfInvalid = () => {
      if (!valid()) dispose()
    }
    const releases = [
      useSceneAnimation.subscribe(stopIfInvalid),
      useScene.subscribe(stopIfInvalid),
      useCameraStudio.subscribe(stopIfInvalid),
      useObjectMotion.subscribe(stopIfInvalid),
      useRigEditor.subscribe(stopIfInvalid),
    ]
    nativePointers.set(canvas, dispose)
    stopIfInvalid()
    return dispose
  }
  if (![0, 1, 2].includes(event.button)) return null
  const action = event.button === 2 ? 'orbit' : 'move'
  return startViewfinderEdit(node, canvas, event, action, (change, finish, height) =>
    startCameraPointerDrag(
      event,
      (dx, dy) => change(dx / height, dy / height),
      finish,
      action === 'orbit',
    ),
  )
}

function startViewfinderEdit(
  node: SceneCameraNode,
  canvas: HTMLCanvasElement,
  event: Pick<MouseEvent, 'clientX' | 'clientY'>,
  action: RigDirectAction,
  connect: (
    change: (dx: number, dy: number) => void,
    finish: (commit: boolean) => void,
    height: number,
  ) => () => void,
) {
  if (
    !canNavigateViewfinder(node, canvas) ||
    useCameraStudio.getState().canvas !== canvas ||
    useInteractionScope.getState().scope.kind !== 'idle'
  )
    return null
  const state = useSceneAnimation.getState(),
    timeline = state.open
  const pose = rigPose(node)
  const objectRig = !!pose.rig?.native
  if (pose.rig && (!objectRig || rigIsPoseMode(node.id))) return null
  const parent =
    (timeline ? motionCameraParentMatrix(node, state.time) : cameraRigParentMatrix(node)) ??
    new Matrix4()
  const aspect = timeline ? animationData().aspect : sceneCameraAspect(node)
  const effective = getEffectiveNode(node)
  const edit = objectRig
    ? createObjectViewfinderEdit(effective, pose, parent, aspect, action, rigSnapshot(node))
    : createFreeViewfinderEdit(effective, pose, parent, aspect, action)
  if (!edit) return null
  const rect = canvas.getBoundingClientRect(),
    frame = viewportFrameRect(canvas.width, canvas.height, rect.width, rect.height)
  const x = event.clientX - rect.left - frame.x,
    y = event.clientY - rect.top - frame.y
  if (frame.height <= 0 || x < 0 || y < 0 || x > frame.width || y > frame.height) return null
  const draftBefore = state.draft
  let patch: Partial<CameraMotionPose> | null = null
  let unsubscribe = () => {}
  useInteractionScope
    .getState()
    .begin({ kind: 'handle-drag', nodeId: node.id, handle: 'camera-viewfinder' })
  useViewer.getState().setInputDragging(true)
  const cancel = connect(
    (dx, dy) => {
      if (Math.abs(dx) + Math.abs(dy) < 1e-8 && !patch) return
      patch = edit(dx, dy)
      if (timeline) changeMotionDraft(patch, false)
      else useLiveNodeOverrides.getState().set(node.id, patch)
    },
    (commit) => {
      unsubscribe()
      const exists = useScene.getState().nodes[node.id as AnyNodeId]?.type === 'scene-camera'
      const changed =
        patch &&
        (!objectRig ||
          JSON.stringify(patch.rig?.native?.cameraOffsetMatrix) !==
            JSON.stringify(pose.rig?.native?.cameraOffsetMatrix))
      if (timeline) {
        if (commit && exists && changed) commitExistingKey()
        else if (
          useSceneAnimation.getState().cameraId === node.id &&
          useSceneAnimation.getState().time === state.time
        )
          useSceneAnimation.setState({ draft: draftBefore })
      } else if (patch) {
        if (commit && exists && changed) {
          flushSync(() => {
            if (objectRig) updateRig(node, patch!.rig ?? null)
            else useScene.getState().updateNode(node.id, patch!)
          })
        }
        useLiveNodeOverrides.getState().clearFields(node.id, Object.keys(patch))
      }
      useInteractionScope
        .getState()
        .endIf(
          (scope) =>
            scope.kind === 'handle-drag' &&
            scope.nodeId === node.id &&
            scope.handle === 'camera-viewfinder',
        )
      if (useInteractionScope.getState().scope.kind === 'idle')
        useViewer.getState().setInputDragging(false)
    },
    frame.height,
  )
  const stopIfInvalid = () => {
    const scope = useInteractionScope.getState().scope
    if (
      !canNavigateViewfinder(node, canvas) ||
      (objectRig && rigIsPoseMode(node.id)) ||
      useSceneAnimation.getState().time !== state.time ||
      !useScene.getState().nodes[node.id as AnyNodeId] ||
      scope.kind !== 'handle-drag' ||
      scope.nodeId !== node.id ||
      scope.handle !== 'camera-viewfinder'
    )
      cancel()
  }
  const releases = [
    useSceneAnimation.subscribe(stopIfInvalid),
    useScene.subscribe(stopIfInvalid),
    useCameraStudio.subscribe(stopIfInvalid),
    useObjectMotion.subscribe(stopIfInvalid),
    useInteractionScope.subscribe(stopIfInvalid),
    ...(objectRig ? [useRigEditor.subscribe(stopIfInvalid)] : []),
  ]
  unsubscribe = () => {
    for (const release of releases) release()
  }
  return cancel
}

export function bindViewfinderWheel(
  canvas: HTMLCanvasElement,
  getNode: () => SceneCameraNode | null,
) {
  let change: ((dx: number, dy: number) => void) | null = null
  let end: ((commit: boolean) => void) | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let total = 0
  const finish = (commit: boolean) => end?.(commit)
  const key = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      finish(true)
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.key === 'Escape') finish(false)
    if (event.key === 'Enter') finish(true)
  }
  const blur = () => finish(false)
  const pointer = () => finish(true)
  const wheel = (event: WheelEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!Number.isFinite(event.deltaY) || !event.deltaY) return
    const node = getNode()
    if (!node) return
    if (rigPose(node).rig?.native && rigIsPoseMode(node.id)) return
    if (!change) {
      const cancel = startViewfinderEdit(node, canvas, event, 'dolly', (move, complete) => {
        total = 0
        change = move
        end = (commit) => {
          end = null
          change = null
          if (timer !== null) clearTimeout(timer)
          timer = null
          window.removeEventListener('keydown', key, true)
          window.removeEventListener('blur', blur)
          window.removeEventListener('pointerdown', pointer, true)
          complete(commit)
        }
        window.addEventListener('keydown', key, true)
        window.addEventListener('blur', blur)
        window.addEventListener('pointerdown', pointer, true)
        return () => finish(false)
      })
      if (!cancel) return
    }
    const unit =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.getBoundingClientRect().height : 1
    total += Math.max(-160, Math.min(160, event.deltaY * unit)) * 0.001 * (event.shiftKey ? 0.1 : 1)
    change?.(0, total)
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => finish(true), 180)
  }
  // React wheel listeners are passive; the canvas needs to consume scrolling before the page/view does.
  canvas.addEventListener('wheel', wheel, { passive: false })
  return {
    finish,
    dispose: () => {
      finish(false)
      canvas.removeEventListener('wheel', wheel)
    },
  }
}
