import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { flushSync } from '@react-three/fiber'
import useInteractionScope from '../../store/use-interaction-scope'
import { useSceneAnimation } from '../scene-animation/store'
import {
  releaseBoxSelectPointer,
  suppressBoxSelectForPointer,
} from '../tools/select/box-select-state'
import { bindRigPickMotion, focusRigCanvas, rigPickNearest } from './rig-pointer'
import { type RigPointerContinuation, waitForRigPointerSelection } from './rig-pointer-selection'
import { rigSelectedControls, selectRigControl, useRigEditor } from './rig-state'
import { beginRigWidgetDrag } from './rig-widget-drag'

export type RigViewportPointerOptions = {
  canvas: HTMLCanvasElement
  cameraId: string
  getNames: () => readonly string[]
  enabled: () => boolean
  pick: (
    signal: AbortSignal,
    from: PointerEvent,
    selected: string[],
    nearest: boolean,
  ) => Promise<string | null>
  pixelRatio?: () => number
  onError?: (error: unknown) => void
}

const equalNames = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((value, i) => value === b[i])

export function createRigViewportPointer(options: RigViewportPointerOptions) {
  const { canvas, cameraId } = options
  let disposed = false,
    bound = false,
    ownsClick = false,
    cancelCurrent: (() => void) | null = null,
    unbindMotion: (() => void) | null = null
  const consume = (event: Event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const start = (from: PointerEvent) => {
    if (disposed || from.button !== 0 || !options.enabled()) return null
    consume(from)
    ownsClick = true
    if (useViewer.getState().inputDragging || useInteractionScope.getState().scope.kind !== 'idle')
      return null
    cancelCurrent?.()
    cancelCurrent = null
    if (from.ctrlKey || from.altKey || from.metaKey) return null
    const names = [...options.getNames()]
    if (!names.length) return null
    focusRigCanvas(canvas)
    suppressBoxSelectForPointer(from)
    const selectedIds = useViewer.getState().selection.selectedIds
    if (selectedIds.length !== 1 || selectedIds[0] !== cameraId)
      flushSync(() => useViewer.getState().setSelection({ selectedIds: [cameraId] }))
    const editor = useRigEditor.getState(),
      node = useScene.getState().nodes[cameraId as AnyNodeId],
      viewerSelection = [...useViewer.getState().selection.selectedIds],
      time = useSceneAnimation.getState().time,
      fallback = names.includes(editor.control)
        ? editor.control
        : names.includes('Camera')
          ? 'Camera'
          : names[0]!,
      selected = [...rigSelectedControls(cameraId, fallback, names)],
      nearest = rigPickNearest(canvas, from, options.pixelRatio?.()),
      wasDragging = useViewer.getState().inputDragging
    const cursor = [...editor.cursor]
    let cancelDrag: (() => void) | null = null,
      waitingClosed = false,
      unsubscribe = () => {}
    const valid = () => {
      const current = useRigEditor.getState()
      return (
        !disposed &&
        options.enabled() &&
        useInteractionScope.getState().scope.kind === 'idle' &&
        useScene.getState().nodes[cameraId as AnyNodeId] === node &&
        useSceneAnimation.getState().time === time &&
        equalNames(options.getNames(), names) &&
        equalNames(useViewer.getState().selection.selectedIds, viewerSelection) &&
        current.control === editor.control &&
        current.selectionCameraId === editor.selectionCameraId &&
        current.selectedControls === editor.selectedControls &&
        current.mode === editor.mode &&
        current.orbit === editor.orbit &&
        current.keepCameraLevel === editor.keepCameraLevel &&
        current.pivot === editor.pivot &&
        current.gesture === editor.gesture &&
        equalNames(current.cursor, cursor)
      )
    }
    const begin = (hit: string | null, continuation: RigPointerContinuation) => {
      if (!valid()) return
      if (hit && !names.includes(hit)) return
      if (hit) selectRigControl(cameraId, names, hit, false, true)
      const currentControl = useRigEditor.getState().control,
        active = names.includes(currentControl) ? currentControl : fallback
      const control =
        (hit || (!from.shiftKey && selected.length)) && names.includes(active) ? active : ''
      const provisional = useRigEditor.getState()
      const restoreShiftSelection = () => {
        const current = useRigEditor.getState()
        if (
          current.control !== provisional.control ||
          current.selectionCameraId !== provisional.selectionCameraId ||
          current.selectedControls !== provisional.selectedControls ||
          current.gesture !== editor.gesture ||
          useScene.getState().nodes[cameraId as AnyNodeId] !== node
        )
          return
        flushSync(() =>
          useRigEditor.setState({
            control: editor.control,
            selectionCameraId: editor.selectionCameraId,
            selectedControls: editor.selectedControls,
          }),
        )
      }
      cancelDrag = beginRigWidgetDrag(
        canvas,
        control,
        from,
        from.shiftKey
          ? hit
            ? () => {
                flushSync(() =>
                  useRigEditor.setState({
                    control: editor.control,
                    selectionCameraId: editor.selectionCameraId,
                    selectedControls: editor.selectedControls,
                  }),
                )
                selectRigControl(cameraId, names, hit, true)
              }
            : undefined
          : hit
            ? () => selectRigControl(cameraId, names, hit)
            : () =>
                flushSync(() =>
                  useRigEditor.setState({ selectionCameraId: cameraId, selectedControls: [] }),
                ),
        continuation,
        from.shiftKey && hit ? restoreShiftSelection : undefined,
      )
    }
    const waiting = waitForRigPointerSelection(from, {
      pick: (signal) => options.pick(signal, from, selected, nearest),
      onWaitingChange: (value) => {
        useViewer.getState().setInputDragging(value || wasDragging)
        if (!value) {
          waitingClosed = true
          unsubscribe()
          releaseBoxSelectPointer(from)
        }
      },
      onHit: (hit, continuation) => begin(hit, continuation),
      onMiss: (continuation) => begin(null, continuation),
      onError: options.onError ?? ((error) => console.error('相机控件拾取失败：', error)),
    })
    if (!waitingClosed) {
      const stopIfInvalid = () => {
        if (!valid()) waiting.cancel()
      }
      const releases = [
        useRigEditor.subscribe(stopIfInvalid),
        useViewer.subscribe(stopIfInvalid),
        useScene.subscribe(stopIfInvalid),
        useSceneAnimation.subscribe(stopIfInvalid),
        useInteractionScope.subscribe(stopIfInvalid),
      ]
      unsubscribe = () => {
        for (const release of releases) release()
      }
      stopIfInvalid()
    }
    const cancel = () => {
      waiting.cancel()
      unsubscribe()
      cancelDrag?.()
      if (cancelCurrent === cancel) cancelCurrent = null
    }
    cancelCurrent = cancel
    return cancel
  }
  const down = (event: PointerEvent) => {
    start(event)
  }
  const click = (event: MouseEvent) => {
    if (event.button !== 0 || (!ownsClick && !options.enabled())) return
    // Pose mode owns blank clicks too; a delayed browser click must never deselect the rig object.
    ownsClick = false
    consume(event)
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    cancelCurrent?.()
    unbindMotion?.()
    canvas.removeEventListener('pointerdown', down, true)
    canvas.removeEventListener('click', click, true)
  }
  return {
    start,
    bind({ pointerDown = true }: { pointerDown?: boolean } = {}) {
      if (!disposed && !bound) {
        bound = true
        unbindMotion = bindRigPickMotion(canvas)
        if (pointerDown) canvas.addEventListener('pointerdown', down, true)
        canvas.addEventListener('click', click, true)
      }
      return dispose
    },
    dispose,
  }
}
