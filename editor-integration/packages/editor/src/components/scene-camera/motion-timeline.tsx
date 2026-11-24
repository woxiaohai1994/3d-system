'use client'

import {
  type AnyNodeId,
  type CameraPropertyCurve,
  sampleScenePlayback,
  sceneAnimationDuration,
  useScene,
} from '@pascal-app/core'
import {
  Box,
  Camera,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  LockKeyhole,
  Maximize2,
  Minus,
  Plus,
  UnlockKeyhole,
} from 'lucide-react'
import {
  type PointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useI18n } from '../../i18n'
import { animationData, commitSceneAnimation } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import {
  animationTracks,
  copyKeys,
  deleteKeys,
  type KeyClipboard,
  type KeySelection,
  keyToken,
  pasteKeys,
  retimeKeys,
  selectedKeys,
} from '../scene-animation/timeline-edit'
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '../ui/primitives/dropdown-menu'
import { addSceneCamera } from './actions'
import { CameraNumber } from './inspector'
import { KeyframeContextMenu } from './keyframe-context-menu'
import { MotionEasingPreview, motionEasingPresets } from './motion-easing-controls'
import {
  currentObjectHasKey,
  recordCurrentKey,
  requestMotionTransition,
  selectMotionFrame,
} from './motion-edit-session'
import { useObjectMotion } from './motion-object-store'
import { selectMotionObject } from './motion-objects'
import { commitPath, editingPathData } from './motion-path-context'
import { objectPathData } from './motion-path-data'
import { usePathDrawing } from './motion-path-drawing'
import { editMotionPath } from './motion-path-edit'
import { MotionRangeHandles } from './motion-range-handles'
import {
  canCaptureViewportKey,
  captureViewportKey,
  enterMotionCameraView,
  motionPlaybackRange,
  observedMotionCamera,
  observeMotionCamera,
  seekMotion,
  selectMotionCamera,
  toggleMotionPlayback,
} from './motion-state'
import { removeAnimationTrack } from './remove-animation-track'
import { RigPropertyTimeline } from './rig-property-timeline'
import { SceneCameraMarkers } from './scene-camera-markers'
import { cameraTargetLabel } from './target-label'

const labelWidth = 184,
  inset = 16,
  rowHeight = 36
const button =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded px-2 hover:bg-accent focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-40'
export function MotionTimeline({
  onEditProperties,
  onEditPath,
  onCreateTrajectory,
  onEditOutput,
  onSelect,
  collapsed,
  transport,
  outputControls,
  contextControls,
  creationControls,
}: {
  onEditProperties: () => void
  onEditPath: (mode: 'easing') => void
  onCreateTrajectory: () => void
  onEditOutput: () => void
  onSelect: () => void
  collapsed: boolean
  transport: ReactNode
  outputControls: ReactNode
  contextControls: ReactNode
  creationControls: ReactNode
}) {
  const { locale } = useI18n(),
    zh = locale === 'zh-CN'
  const state = useSceneAnimation(),
    object = useObjectMotion(),
    nodes = useScene((s) => s.nodes),
    readOnly = useScene((s) => s.readOnly)
  const drawing = usePathDrawing((s) => s.nodeId)
  const data = animationData(),
    duration = sceneAnimationDuration(data)
  const blocked = state.playing || state.exporting || readOnly || !!state.pickingAnchor
  const viewport = useRef<HTMLDivElement>(null),
    ruler = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800),
    [zoom, setZoom] = useState(1)
  const zoomAnchor = useRef<{ time: number; offset: number } | null>(null)
  const [context, setContext] = useState<{
    x: number
    y: number
    nodeId: string
    time: number
    keys: KeySelection[]
    segmentId: string | null
  } | null>(null)
  const [selection, setSelection] = useState<KeySelection[]>([])
  const [multiSelect, setMultiSelect] = useState(false)
  const [retimeOpen, setRetimeOpen] = useState(false)
  const locked = state.lockedIds
  const setLocked = (lockedIds: string[]) => {
    const apply = () => useSceneAnimation.setState({ lockedIds })
    if (requestMotionTransition(apply)) apply()
  }
  const [filter, setFilter] = useState(false),
    [snap, setSnap] = useState(true),
    [snapTime, setSnapTime] = useState<number | null>(null)
  const [box, setBox] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null,
  )
  const clipboard = useRef<KeyClipboard | null>(null),
    [copied, setCopied] = useState(false)
  const stop = useRef<(() => void) | null>(null)
  const max =
    state.timelineMax ??
    Math.min(600, Math.max(1, duration * 1.1, (data.playbackRange?.[1] ?? 0) * 1.1))
  const scale = (Math.max(1, width - labelWidth - inset * 2) / max) * zoom
  const laneWidth = max * scale + inset * 2,
    x = (time: number) => inset + time * scale
  const range = motionPlaybackRange()
  const rangeShade = (
    <div className="pointer-events-none absolute inset-0 z-[3]" aria-hidden="true">
      <div
        data-testid="timeline-before-range"
        className="absolute inset-y-0 left-0 bg-black/50"
        style={{ width: x(range[0]) }}
      />
      <div
        data-testid="timeline-after-range"
        className="absolute inset-y-0 right-0 bg-black/50"
        style={{ left: x(range[1]) }}
      />
    </div>
  )
  const selectedId = object.nodeId ?? state.cameraId
  const viewedCameraId = state.cameraView ? observedMotionCamera()?.id : null
  const trackIds = new Set(data.tracks.map((t) => t.nodeId))
  const emptyIds = [
    ...(state.cameraId ? [state.cameraId] : []),
    ...(object.nodeId ? [object.nodeId] : []),
  ].filter((id) => !trackIds.has(id))
  const rows = [...data.tracks, ...emptyIds.map((nodeId) => ({ nodeId, points: [], segments: [] }))]
    .filter((track) => !!nodes[track.nodeId as AnyNodeId])
    .filter(
      (track) =>
        nodes[track.nodeId as AnyNodeId]?.type !== 'scene-camera' ||
        track.nodeId === state.cameraId,
    )
    .map((track) => {
      const node = nodes[track.nodeId as AnyNodeId]!
      return {
        id: track.nodeId,
        camera: node?.type === 'scene-camera',
        name: cameraTargetLabel(node, locale),
        points: track.points,
        propertyCurves:
          'propertyCurves' in track
            ? ((track.propertyCurves as CameraPropertyCurve[] | undefined) ?? [])
            : [],
        segments:
          track.segments ?? objectPathData({ ...track, parentId: node?.parentId ?? null }).segments,
      }
    })
    .filter((row) => !filter || row.id === selectedId)
  const keys = selectedKeys(data, selection),
    selectedTimes = keys.map((k) => k.point.time)
  const selectionDuration = selectedTimes.length
    ? Math.max(...selectedTimes) - Math.min(...selectedTimes)
    : 0
  const editableSelection = selection.filter((k) => !locked.includes(k.nodeId))
  const activeRow = rows.find((r) => r.id === selectedId)
  const activeTimes = [
    ...new Set([
      ...(activeRow?.points.map((point) => point.time) ?? []),
      ...(activeRow?.propertyCurves.flatMap((curve) =>
        curve.keys.map((key) => key.co[0] / data.fps),
      ) ?? []),
    ]),
  ].sort((a, b) => a - b)
  const majorStep =
    [1 / data.fps, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600].find(
      (step) => step * scale >= 65,
    ) ?? 600
  const ticks = Array.from({ length: Math.floor(max / majorStep) + 1 }, (_, i) => i * majorStep)
  const selectRow = (row: (typeof rows)[number], closeInspector = true) => {
    if (row.camera) selectMotionCamera(row.id)
    else selectMotionObject(row.id)
    if (closeInspector) onSelect()
    setRetimeOpen(false)
  }
  const contextRow = rows.find((r) => r.id === context?.nodeId)
  const contextSegment = contextRow?.segments.find((s) => s.id === context?.segmentId)
  const contextBlocked =
    blocked ||
    !!usePathDrawing.getState().nodeId ||
    !!(contextRow && locked.includes(contextRow.id))
  const withContextRow = (action: () => void, atTime = false) => {
    if (!contextRow || contextBlocked) return
    const time = atTime && context ? context.time : useSceneAnimation.getState().time
    if (!selectMotionFrame(contextRow.id, time)) return
    onSelect()
    setRetimeOpen(false)
    action()
  }
  const patchContextSegment = (patch: Partial<NonNullable<typeof contextSegment>>) =>
    withContextRow(() => {
      const path = editingPathData()
      if (!context?.segmentId) return
      commitPath({
        ...path,
        segments: path.segments.map((s) => (s.id === context.segmentId ? { ...s, ...patch } : s)),
      })
      editMotionPath(context.segmentId)
    })
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current
    if (!anchor || !viewport.current) return
    viewport.current.scrollLeft = labelWidth + inset + anchor.time * scale - anchor.offset
    zoomAnchor.current = null
  }, [scale])
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      const offset = event.clientX - element.getBoundingClientRect().left
      if (offset < labelWidth || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))
        return
      if (!event.deltaY) return
      event.preventDefault()
      event.stopPropagation()
      if (stop.current || useSceneAnimation.getState().timelineMax !== null) return
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1)
      const next = Math.max(
        1,
        Math.min(16, zoom * Math.exp(-Math.max(-240, Math.min(240, delta)) * 0.003)),
      )
      if (next === zoom) return
      zoomAnchor.current = {
        time: Math.max(0, (element.scrollLeft + offset - labelWidth - inset) / scale),
        offset,
      }
      setZoom(next)
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [zoom, scale])
  useEffect(() => () => stop.current?.(), [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.code !== 'Space' ||
        // Space-drag over the viewport keeps its normal pan gesture.
        event.target instanceof HTMLCanvasElement ||
        document.querySelector('canvas:hover') ||
        usePathDrawing.getState().nodeId ||
        !useSceneAnimation.getState().open ||
        useSceneAnimation.getState().previewing ||
        (event.target instanceof Element &&
          event.target.closest(
            'input,textarea,select,dialog,[contenteditable="true"],[role="menu"]',
          ))
      )
        return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!event.repeat) toggleMotionPlayback()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [])
  const copy = () => {
    clipboard.current = copyKeys(animationData(), editableSelection)
    setCopied(!!clipboard.current)
  }
  const paste = () => {
    if (!clipboard.current || blocked) return
    const apply = () => {
      try {
        const result = pasteKeys(
          animationData(),
          {
            ...clipboard.current!,
            tracks: clipboard.current!.tracks.filter((t) => {
              const node = useScene.getState().nodes[t.nodeId as AnyNodeId]
              return !locked.includes(t.nodeId) && node && node.parentId === t.parentId
            }),
          },
          useSceneAnimation.getState().time,
        )
        if (commitSceneAnimation(result.data)) setSelection(result.selection)
      } catch {
        useSceneAnimation.setState({ message: 'invalid-time' })
      }
    }
    if (requestMotionTransition(apply)) apply()
  }
  const remove = () => {
    const apply = () => {
      if (commitSceneAnimation(deleteKeys(animationData(), editableSelection))) setSelection([])
    }
    if (!blocked && editableSelection.length && requestMotionTransition(apply)) apply()
  }
  const createCamera = () => {
    const apply = () => {
      const camera = addSceneCamera(zh ? '相机' : 'Camera')
      if (camera) enterMotionCameraView(camera.id)
    }
    if (!blocked && requestMotionTransition(apply)) apply()
  }
  const listen = (
    event: PointerEvent,
    move: (e: globalThis.PointerEvent) => void,
    finish: (cancel: boolean) => void,
  ) => {
    stop.current?.()
    const id = event.pointerId
    const end = (cancelled: boolean) => {
      stop.current = null
      window.removeEventListener('pointermove', moving)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', escapeKey, true)
      finish(cancelled)
      setSnapTime(null)
      setBox(null)
    }
    const moving = (e: globalThis.PointerEvent) => {
      if (e.pointerId === id) move(e)
    }
    const up = (e: globalThis.PointerEvent) => {
      if (e.pointerId === id) end(false)
    }
    const cancel = () => end(true)
    const escapeKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        cancel()
      }
    }
    stop.current = cancel
    window.addEventListener('pointermove', moving)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', escapeKey, true)
  }
  const scrub = (event: PointerEvent<HTMLElement>) => {
    if (blocked || event.button !== 0 || !ruler.current) return
    event.preventDefault()
    event.stopPropagation()
    const timeAt = (clientX: number) =>
      Math.round(
        Math.max(
          0,
          Math.min(max, (clientX - ruler.current!.getBoundingClientRect().left - inset) / scale),
        ) * data.fps,
      ) / data.fps
    const time = timeAt(event.clientX)
    if (!requestMotionTransition(() => seekMotion(time))) return
    setSelection([])
    seekMotion(time)
    listen(
      event,
      (e) => seekMotion(timeAt(e.clientX)),
      () => {},
    )
  }
  const startKey = (
    event: PointerEvent<HTMLButtonElement>,
    row: (typeof rows)[number],
    point: { id: string; time: number },
  ) => {
    if (blocked || locked.includes(row.id) || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.focus()
    const target = { nodeId: row.id, keyId: point.id },
      token = keyToken(row.id, point.id)
    const included = selection.some((k) => keyToken(k.nodeId, k.keyId) === token)
    const segmentPair =
      selection.length === 2 &&
      row.segments.some(
        (s) =>
          s.id === state.segmentId &&
          selection.every(
            (k) => k.nodeId === row.id && (k.keyId === s.fromId || k.keyId === s.toId),
          ),
      )
    const multi = multiSelect || event.shiftKey || event.metaKey || event.ctrlKey
    const next = multi
      ? included
        ? selection.filter((k) => keyToken(k.nodeId, k.keyId) !== token)
        : [...selection, target]
      : included && !segmentPair
        ? selection
        : [target]
    const choose = () => {
      selectRow(row)
      seekMotion(point.time, row.camera ? point.id : null)
      setSelection(next)
      onSelect()
    }
    if (!requestMotionTransition(choose)) return
    choose()
    if (multi && included) return
    if (!included || segmentPair) {
      const start = event.clientX
      let dragged = false
      listen(
        event,
        (e) => {
          if (!dragged && Math.abs(e.clientX - start) < 4) return
          dragged = true
          setSelection([])
          const time =
            Math.round(
              Math.max(
                0,
                Math.min(
                  max,
                  (e.clientX - ruler.current!.getBoundingClientRect().left - inset) / scale,
                ),
              ) * data.fps,
            ) / data.fps
          seekMotion(time)
        },
        () => {},
      )
      return
    }
    const original = animationData(),
      previousTime = state.time,
      start = event.clientX
    const moving = next.filter((k) => !locked.includes(k.nodeId))
    const excluded = new Set(moving.map((k) => keyToken(k.nodeId, k.keyId)))
    const targets = [
      previousTime,
      0,
      ...animationTracks(original).flatMap((t) =>
        t.points.filter((p) => !excluded.has(keyToken(t.nodeId, p.id))).map((p) => p.time),
      ),
    ]
    let changed = false
    useSceneAnimation.setState({ timelineMax: max })
    listen(
      event,
      (e) => {
        if (!changed && Math.abs(e.clientX - start) < 3) return
        changed = true
        let time = Math.round((point.time + (e.clientX - start) / scale) * data.fps) / data.fps
        const targetTime =
          snap && !e.altKey
            ? targets
                .filter((t) => Math.abs(t - time) * scale <= 8)
                .sort((a, b) => Math.abs(a - time) - Math.abs(b - time))[0]
            : undefined
        if (targetTime !== undefined) time = targetTime
        const draft = retimeKeys(original, moving, time - point.time)
        const movedPoint = selectedKeys(draft, [target])[0]?.point
        const actual = movedPoint?.time ?? time
        setSnapTime(
          targetTime !== undefined && Math.abs(actual - targetTime) < 1e-7 ? actual : null,
        )
        useSceneAnimation.setState({ sceneDraft: draft, time: actual, segmentId: null })
        sampleScenePlayback(actual)
      },
      (cancel) => {
        const draft = useSceneAnimation.getState().sceneDraft
        useSceneAnimation.setState({ sceneDraft: null, timelineMax: null })
        if (!cancel && changed && draft) commitSceneAnimation(draft)
        else if (cancel) seekMotion(previousTime)
        else if (!changed && !multi) setSelection([target])
      },
    )
  }
  const marquee = (event: PointerEvent<HTMLDivElement>) => {
    if (!multiSelect && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      scrub(event)
      return
    }
    if (blocked || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    viewport.current?.focus()
    const left = event.clientX,
      top = event.clientY,
      previous = selection,
      additive = event.shiftKey || event.metaKey || event.ctrlKey,
      base = additive ? selection : []
    if (!additive) setSelection([])
    listen(
      event,
      (e) => {
        const r = {
          x: Math.min(left, e.clientX),
          y: Math.min(top, e.clientY),
          width: Math.abs(e.clientX - left),
          height: Math.abs(e.clientY - top),
        }
        setBox(r)
        const found = Array.from(
          viewport.current?.querySelectorAll<HTMLElement>('[data-motion-key]') ?? [],
        )
          .filter((el) => {
            const b = el.getBoundingClientRect()
            return (
              !locked.includes(el.dataset.nodeId!) &&
              b.right >= r.x &&
              b.left <= r.x + r.width &&
              b.bottom >= r.y &&
              b.top <= r.y + r.height
            )
          })
          .map((el) => ({ nodeId: el.dataset.nodeId!, keyId: el.dataset.motionKey! }))
        setSelection([
          ...base,
          ...found.filter(
            (k) => !base.some((p) => keyToken(p.nodeId, p.keyId) === keyToken(k.nodeId, k.keyId)),
          ),
        ])
      },
      (cancel) => {
        if (cancel) setSelection(previous)
      },
    )
  }
  return (
    <div
      className="flex min-h-44 min-w-0 flex-1 flex-col text-xs"
      onKeyDown={(e) => {
        if ((e.target as Element).closest('input,textarea,select,[role="menu"]') || blocked) return
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
          e.preventDefault()
          e.stopPropagation()
          setSelection(
            rows
              .filter((r) => !locked.includes(r.id))
              .flatMap((r) => r.points.map((p) => ({ nodeId: r.id, keyId: p.id }))),
          )
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          setSelection([])
        }
        if ((e.metaKey || e.ctrlKey) && ['c', 'v'].includes(e.key.toLowerCase())) {
          e.preventDefault()
          e.stopPropagation()
          if (e.key.toLowerCase() === 'c') copy()
          else paste()
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          e.stopPropagation()
          remove()
        }
      }}
    >
      <div
        role="toolbar"
        aria-label={zh ? '时间轴导航' : 'Timeline navigation'}
        className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5"
      >
        {transport}
        <button
          className={button}
          disabled={blocked}
          aria-label={zh ? '上一个关键帧' : 'Previous keyframe'}
          onClick={() =>
            seekMotion(
              [...activeTimes].reverse().find((time) => time < state.time - 0.5 / data.fps) ?? 0,
            )
          }
        >
          <ChevronLeft size={16} />
        </button>
        <button
          className={button}
          disabled={blocked}
          aria-label={zh ? '下一个关键帧' : 'Next keyframe'}
          onClick={() =>
            seekMotion(activeTimes.find((time) => time > state.time + 0.5 / data.fps) ?? duration)
          }
        >
          <ChevronRight size={16} />
        </button>
        <output
          className="px-2 tabular-nums text-muted-foreground"
          aria-label={zh ? '当前帧' : 'Current frame'}
        >
          {Math.round(state.time * data.fps)} {zh ? '帧' : 'fr'}
        </output>
        <button
          type="button"
          className={button}
          disabled={
            blocked || !!state.cameraId || state.previewing || !!state.sceneDraft || !!drawing
          }
          aria-label={zh ? '创建相机' : 'Create camera'}
          title={zh ? '以当前视图创建相机' : 'Create camera from view'}
          onClick={createCamera}
        >
          <Camera size={16} />
        </button>
        <button
          className={`${button} bg-primary text-primary-foreground hover:bg-primary/90`}
          disabled={blocked || !selectedId || locked.includes(selectedId)}
          onClick={recordCurrentKey}
        >
          {currentObjectHasKey()
            ? zh
              ? '更新关键帧'
              : 'Update keyframe'
            : zh
              ? '创建关键帧'
              : 'Create keyframe'}
        </button>
        {creationControls}
        <span className="flex-1" />
        {outputControls}
      </div>
      <div hidden={collapsed} className={collapsed ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
        <div
          role="toolbar"
          aria-label={zh ? '轨道与关键帧工具' : 'Track and keyframe tools'}
          className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap px-2 py-1"
        >
          {contextControls}
          <span className="ml-auto text-muted-foreground">
            {keys.length
              ? zh
                ? `已选 ${keys.length} 个关键帧`
                : `${keys.length} keys selected`
              : zh
                ? '右键打开更多操作'
                : 'Right-click for more actions'}
          </span>
          <button
            className={button}
            aria-label={zh ? '缩小时间轴' : 'Zoom out'}
            disabled={zoom <= 1}
            onClick={() => setZoom(Math.max(1, zoom / 2))}
          >
            <Minus size={14} />
          </button>
          <button
            className={button}
            aria-label={zh ? '放大时间轴' : 'Zoom in'}
            disabled={zoom >= 16}
            onClick={() => setZoom(Math.min(16, zoom * 2))}
          >
            <Plus size={14} />
          </button>
          <button
            className={button}
            aria-label={zh ? '适配全段' : 'Fit timeline'}
            onClick={() => {
              setZoom(1)
              if (viewport.current) viewport.current.scrollLeft = 0
            }}
          >
            <Maximize2 size={14} />
          </button>
          {retimeOpen && selectionDuration > 0 && (
            <>
              <CameraNumber
                label={zh ? '选段时长' : 'Selection duration'}
                value={selectionDuration}
                min={1 / data.fps}
                max={600}
                step={1 / data.fps}
                onChange={(v) => {
                  if (blocked) return
                  const apply = () =>
                    commitSceneAnimation(
                      retimeKeys(animationData(), editableSelection, 0, v / selectionDuration),
                    )
                  if (requestMotionTransition(apply)) apply()
                }}
              />
              <button className={button} onClick={() => setRetimeOpen(false)}>
                {zh ? '完成' : 'Done'}
              </button>
            </>
          )}
        </div>
        <div
          ref={viewport}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Timeline viewport receives keyboard shortcuts after marquee selection.
          tabIndex={0}
          onContextMenu={(event) => {
            const target = event.target as HTMLElement
            const underPlayhead = target.closest('[data-testid="timeline-playhead"]')
              ? Array.from(
                  viewport.current?.querySelectorAll<HTMLElement>(
                    '[data-motion-lane][data-motion-row]',
                  ) ?? [],
                ).find((lane) => {
                  const rect = lane.getBoundingClientRect()
                  return event.clientY >= rect.top && event.clientY < rect.bottom
                })
              : null
            const rowId =
              target.closest<HTMLElement>('[data-motion-row]')?.dataset.motionRow ??
              underPlayhead?.dataset.motionRow ??
              ''
            if (!ruler.current) return
            event.preventDefault()
            event.stopPropagation()
            const keyId = target.closest<HTMLElement>('[data-motion-key]')?.dataset.motionKey
            const segmentId =
              target.closest<HTMLElement>('[data-motion-segment]')?.dataset.motionSegment ?? null
            const point = rows.find((r) => r.id === rowId)?.points.find((p) => p.id === keyId)
            const time =
              point?.time ??
              (target.closest('[data-motion-lane]')
                ? Math.round(
                    Math.max(
                      0,
                      Math.min(
                        max,
                        (event.clientX - ruler.current.getBoundingClientRect().left - inset) /
                          scale,
                      ),
                    ) * data.fps,
                  ) / data.fps
                : state.time)
            const targetKeys = keyId
              ? selection.some((k) => k.nodeId === rowId && k.keyId === keyId)
                ? selection
                : [{ nodeId: rowId, keyId }]
              : []
            setSelection(targetKeys)
            setContext({
              x: event.clientX,
              y: event.clientY,
              nodeId: rowId,
              time,
              keys: targetKeys,
              segmentId,
            })
          }}
          role="group"
          aria-label={zh ? '关键帧轨道' : 'Keyframe tracks'}
          className="min-h-0 flex-1 overflow-auto overscroll-contain border-t border-border"
        >
          <div
            className="relative grid"
            style={{
              gridTemplateColumns: `${labelWidth}px ${laneWidth}px`,
              width: labelWidth + laneWidth,
            }}
          >
            <div className="sticky top-0 left-0 z-30 flex h-8 items-center border-r border-b border-border bg-background px-3 text-muted-foreground">
              {zh ? '对象' : 'Object'}
            </div>
            <div
              ref={ruler}
              role="slider"
              tabIndex={0}
              aria-label={zh ? '时间标尺' : 'Time ruler'}
              aria-valuemin={0}
              aria-valuemax={max}
              aria-valuenow={state.time}
              data-motion-lane="true"
              className="sticky top-0 z-20 h-8 touch-none cursor-col-resize border-b border-border bg-background tabular-nums text-muted-foreground"
              onPointerDown={scrub}
              onKeyDown={(e) => {
                if (blocked || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
                e.preventDefault()
                seekMotion(
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? duration
                      : state.time + (e.key === 'ArrowLeft' ? -1 : 1) / data.fps,
                )
              }}
            >
              {rangeShade}
              <MotionRangeHandles scale={scale} inset={inset} max={max} />
              {ticks.map((t) => (
                <span
                  key={t}
                  className="absolute inset-y-0 border-l border-border pt-1 pl-1"
                  style={{ left: x(t) }}
                >
                  {Number(t.toFixed(2))}
                  {zh ? '秒' : 's'}
                </span>
              ))}
            </div>
            <SceneCameraMarkers scale={scale} inset={inset} />
            {rows.map((row) => (
              <div className="contents" key={row.id}>
                <div
                  data-motion-row={row.id}
                  className={`sticky left-0 z-10 flex items-center gap-1 border-r border-b border-border px-2 ${row.id === selectedId ? 'bg-accent text-accent-foreground' : 'bg-background'}`}
                  style={{ height: rowHeight }}
                >
                  {row.camera ? <Camera size={14} /> : <Box size={14} />}
                  <button
                    className="h-8 min-w-0 flex-1 truncate text-left focus-visible:outline-2"
                    aria-label={`${zh ? '选择轨道' : 'Select track'} ${row.name}`}
                    aria-pressed={selectedId === row.id}
                    onClick={() => selectRow(row)}
                    disabled={blocked}
                  >
                    {row.name}
                  </button>
                  {row.camera && (
                    <button
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-muted text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 disabled:opacity-40 aria-pressed:border-sky-500 aria-pressed:bg-sky-600 aria-pressed:text-white aria-pressed:hover:bg-sky-700"
                      aria-label={`${zh ? '观看' : 'View'} ${row.name}`}
                      aria-pressed={viewedCameraId === row.id}
                      title={
                        viewedCameraId === row.id
                          ? zh
                            ? '相机视角已开启 · 点击返回自由视角'
                            : 'Camera view on · Click to return to free view'
                          : zh
                            ? '相机视角已关闭 · 点击开启'
                            : 'Camera view off · Click to enable'
                      }
                      disabled={blocked}
                      onClick={() => observeMotionCamera(viewedCameraId === row.id ? null : row.id)}
                    >
                      {viewedCameraId === row.id ? <Eye size={16} /> : <EyeOff size={16} />}
                    </button>
                  )}
                  <button
                    className={button}
                    aria-label={`${zh ? '锁定轨道' : 'Lock track'} ${row.name}`}
                    aria-pressed={locked.includes(row.id)}
                    onClick={() => {
                      setLocked(
                        locked.includes(row.id)
                          ? locked.filter((id) => id !== row.id)
                          : [...locked, row.id],
                      )
                      setSelection(selection.filter((k) => k.nodeId !== row.id))
                    }}
                  >
                    {locked.includes(row.id) ? (
                      <LockKeyhole size={12} />
                    ) : (
                      <UnlockKeyhole size={12} />
                    )}
                  </button>
                </div>
                <div
                  data-motion-row={row.id}
                  data-motion-lane="true"
                  className={`relative touch-none border-b border-border ${row.id === selectedId ? 'bg-accent/30' : 'bg-background'}`}
                  style={{ height: rowHeight }}
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) {
                      if (!blocked && e.button === 0) selectRow(row)
                      marquee(e)
                    }
                  }}
                >
                  {rangeShade}
                  {!row.points.length && !row.propertyCurves.length && (
                    <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-muted-foreground">
                      {zh ? '创建第一个关键帧，开始安排动作' : 'Create the first keyframe to begin'}
                    </span>
                  )}
                  {row.segments.map((segment, i) => {
                    const from = row.points[i],
                      to = row.points[i + 1]
                    if (!from || !to) return null
                    return (
                      <button
                        key={segment.id}
                        data-motion-segment={segment.id}
                        aria-label={`${zh ? '编辑路径' : 'Edit path'} ${String.fromCharCode(65 + i)} → ${String.fromCharCode(66 + i)}`}
                        title={
                          zh
                            ? '拖动预览时间；先选中关键帧，再拖动调整时间'
                            : 'Drag to preview; select a keyframe before dragging to retime'
                        }
                        disabled={blocked || locked.includes(row.id)}
                        className={`absolute top-2 h-5 cursor-col-resize touch-none overflow-hidden rounded-sm border px-1 text-[10px] hover:border-primary ${state.segmentId === segment.id ? 'border-primary bg-accent' : 'border-border bg-muted text-muted-foreground'}`}
                        style={{
                          left: x(from.time) + 7,
                          width: Math.max(8, x(to.time) - x(from.time) - 14),
                        }}
                        onPointerDown={scrub}
                        onClick={(e) => {
                          if (e.detail !== 0) return
                          const select = () => {
                            selectRow(row)
                            setSelection(
                              [segment.fromId, segment.toId].map((keyId) => ({
                                nodeId: row.id,
                                keyId,
                              })),
                            )
                            useSceneAnimation.setState({ segmentId: segment.id, pointId: null })
                          }
                          if (requestMotionTransition(select)) select()
                        }}
                      >
                        {x(to.time) - x(from.time) > 70
                          ? segment.rhythm === 'hold'
                            ? zh
                              ? '保持'
                              : 'Hold'
                            : zh
                              ? '路径'
                              : 'Path'
                          : null}
                      </button>
                    )
                  })}
                  {row.points.map((p, i) => {
                    const selected = selection.some((k) => k.nodeId === row.id && k.keyId === p.id)
                    const current =
                      row.id === selectedId && Math.abs(p.time - state.time) < 0.5 / data.fps
                    return (
                      <button
                        key={p.id}
                        data-motion-key={p.id}
                        data-node-id={row.id}
                        aria-label={`${row.name} ${p.time.toFixed(2)} ${zh ? '秒' : 's'}`}
                        title={`${row.name} · ${p.time.toFixed(2)} ${zh ? '秒' : 's'}`}
                        aria-pressed={selected}
                        disabled={blocked || locked.includes(row.id)}
                        className="absolute top-1/2 z-[2] flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center focus-visible:outline-2 disabled:opacity-40"
                        style={{ left: x(p.time) }}
                        onPointerDown={(e) => startKey(e, row, p)}
                        onClick={(e) => {
                          if (e.detail === 0) {
                            selectRow(row)
                            seekMotion(p.time, row.camera ? p.id : null)
                            setSelection([{ nodeId: row.id, keyId: p.id }])
                            onSelect()
                          }
                        }}
                      >
                        <span
                          className={`h-2.5 w-2.5 rotate-45 border ${selected ? 'border-sky-200 bg-sky-500 ring-2 ring-sky-500/30' : current ? 'border-primary bg-background' : 'border-muted-foreground bg-muted-foreground'}`}
                        />
                      </button>
                    )
                  })}
                </div>
                <RigPropertyTimeline
                  curves={row.propertyCurves}
                  fps={data.fps}
                  time={state.time}
                  x={x}
                  height={rowHeight}
                  blocked={blocked || locked.includes(row.id)}
                  zh={zh}
                  shade={rangeShade}
                  seek={(time) => {
                    setSelection([])
                    selectRow(row, false)
                    seekMotion(time)
                  }}
                />
              </div>
            ))}
            <div
              className="pointer-events-none absolute top-8 bottom-0"
              style={{ left: labelWidth, width: laneWidth }}
            >
              {ticks.map((t) => (
                <div
                  key={t}
                  className="absolute inset-y-0 border-l border-border/30"
                  style={{ left: x(t) }}
                />
              ))}
              {snapTime !== null && (
                <div
                  className="absolute inset-y-0 border-l border-dashed border-amber-400"
                  style={{ left: x(snapTime) }}
                />
              )}
              <button
                data-testid="timeline-playhead"
                aria-label={zh ? '拖动播放头预览' : 'Drag playhead to preview'}
                tabIndex={-1}
                className="pointer-events-auto absolute inset-y-0 z-[1] w-2 -translate-x-1/2 touch-none cursor-col-resize"
                style={{ left: x(state.time) }}
                onPointerDown={scrub}
              >
                <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-primary" />
              </button>
            </div>
          </div>
        </div>
      </div>
      <KeyframeContextMenu position={context} onClose={() => setContext(null)}>
        {context && (
          <>
            <DropdownMenuLabel>
              {contextRow
                ? `${contextRow.name} · ${context.time.toFixed(2)} ${zh ? '秒' : 's'}`
                : zh
                  ? '时间轴'
                  : 'Timeline'}
            </DropdownMenuLabel>
            {contextRow && (
              <>
                {contextSegment ? (
                  <>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger disabled={contextBlocked}>
                        {zh ? '缓动' : 'Easing'}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="z-[160]">
                        {motionEasingPresets.map((preset) => (
                          <DropdownMenuCheckboxItem
                            key={preset.en}
                            checked={
                              contextSegment.rhythm === 'linear'
                                ? preset.en === 'Linear'
                                : contextSegment.rhythm === 'ease' &&
                                  preset.curve.every((v, i) => v === contextSegment.easing[i])
                            }
                            onSelect={() =>
                              patchContextSegment({
                                rhythm: preset.en === 'Linear' ? 'linear' : 'ease',
                                easing: preset.curve,
                              })
                            }
                          >
                            <MotionEasingPreview curve={preset.curve} />
                            {zh ? preset.zh : preset.en}
                          </DropdownMenuCheckboxItem>
                        ))}
                        <DropdownMenuCheckboxItem
                          checked={contextSegment.rhythm === 'continuous'}
                          onSelect={() => patchContextSegment({ rhythm: 'continuous' })}
                        >
                          {zh ? '平滑衔接' : 'Smooth joins'}
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                          checked={contextSegment.rhythm === 'hold'}
                          onSelect={() => patchContextSegment({ rhythm: 'hold' })}
                        >
                          {zh ? '保持到下一帧' : 'Hold until next key'}
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() =>
                            withContextRow(() => {
                              if (editMotionPath(contextSegment.id)) onEditPath('easing')
                            })
                          }
                        >
                          {zh ? '自定义缓动曲线…' : 'Custom easing curve…'}
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </>
                ) : (
                  <>
                    <DropdownMenuItem
                      disabled={contextBlocked}
                      onSelect={() => withContextRow(recordCurrentKey, true)}
                    >
                      {contextRow.points.some(
                        (p) => Math.abs(p.time - context.time) < 0.5 / data.fps,
                      )
                        ? zh
                          ? '更新关键帧'
                          : 'Update keyframe'
                        : zh
                          ? '添加关键帧'
                          : 'Add keyframe'}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={contextBlocked}
                      onSelect={() => withContextRow(onCreateTrajectory, true)}
                    >
                      {zh ? '创建运动轨迹…' : 'Create motion path…'}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={contextBlocked}
                      onSelect={() => withContextRow(onEditProperties, true)}
                    >
                      {context.keys.length
                        ? zh
                          ? '编辑关键帧属性…'
                          : 'Edit keyframe properties…'
                        : zh
                          ? '动画属性…'
                          : 'Animation properties…'}
                    </DropdownMenuItem>
                  </>
                )}
                {context.keys.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem disabled={contextBlocked} onSelect={copy}>
                      {zh ? '复制关键帧' : 'Copy keys'}
                    </DropdownMenuItem>
                    {selectionDuration > 0 && (
                      <DropdownMenuItem
                        disabled={contextBlocked}
                        onSelect={() => setRetimeOpen(true)}
                      >
                        {zh ? '调整选段时长…' : 'Retime selected keys…'}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={contextBlocked || !editableSelection.length}
                      onSelect={remove}
                    >
                      {context.keys.length > 1
                        ? zh
                          ? '删除选中关键帧'
                          : 'Delete selected keys'
                        : zh
                          ? '删除关键帧'
                          : 'Delete keyframe'}
                    </DropdownMenuItem>
                  </>
                )}
                {copied && (
                  <DropdownMenuItem
                    disabled={blocked}
                    onSelect={() => {
                      const apply = () => {
                        seekMotion(context.time)
                        paste()
                      }
                      if (requestMotionTransition(apply)) apply()
                    }}
                  >
                    {zh ? '粘贴到此时间' : 'Paste at this time'}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={contextBlocked}
                  onSelect={() => {
                    const nodeId = contextRow.id
                    const removeTrack = () => {
                      if (!removeAnimationTrack(nodeId)) return
                      setSelection((keys) => keys.filter((key) => key.nodeId !== nodeId))
                      if (selectedId === nodeId) onSelect()
                    }
                    if (requestMotionTransition(removeTrack)) removeTrack()
                  }}
                >
                  {zh ? '删除轨道' : 'Delete track'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {!context.segmentId && !context.keys.length && (
                  <>
                    {contextRow.camera && (
                      <>
                        <DropdownMenuItem
                          disabled={contextBlocked}
                          onSelect={() => withContextRow(() => observeMotionCamera(contextRow.id))}
                        >
                          {zh ? '观看此相机' : 'View this camera'}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={contextBlocked}
                          onSelect={() =>
                            withContextRow(() => {
                              if (canCaptureViewportKey()) captureViewportKey()
                            }, true)
                          }
                        >
                          {zh ? '以画布视角记录关键帧' : 'Record key from viewport'}
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuCheckboxItem
                      checked={locked.includes(contextRow.id)}
                      disabled={blocked}
                      onSelect={() =>
                        setLocked(
                          locked.includes(contextRow.id)
                            ? locked.filter((id) => id !== contextRow.id)
                            : [...locked, contextRow.id],
                        )
                      }
                    >
                      {zh ? '锁定轨道' : 'Lock track'}
                    </DropdownMenuCheckboxItem>
                  </>
                )}
              </>
            )}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                {zh ? '时间轴设置' : 'Timeline settings'}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="z-[160]">
                <DropdownMenuCheckboxItem checked={filter} onSelect={() => setFilter(!filter)}>
                  {zh ? '仅显示当前对象' : 'Only selected object'}
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={snap} onSelect={() => setSnap(!snap)}>
                  {zh ? '时间吸附' : 'Snap time'}
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={multiSelect}
                  disabled={blocked}
                  onSelect={() => setMultiSelect(!multiSelect)}
                >
                  {zh ? '多选模式' : 'Multi-select mode'}
                </DropdownMenuCheckboxItem>
                <DropdownMenuItem
                  disabled={blocked}
                  onSelect={() =>
                    setSelection(
                      rows
                        .filter((r) => !locked.includes(r.id))
                        .flatMap((r) => r.points.map((p) => ({ nodeId: r.id, keyId: p.id }))),
                    )
                  }
                >
                  {zh ? '全选关键帧' : 'Select all keys'}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSelection([])}>
                  {zh ? '取消选择' : 'Clear selection'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={
                    blocked ||
                    !!state.cameraId ||
                    state.previewing ||
                    !!state.sceneDraft ||
                    !!drawing
                  }
                  onSelect={createCamera}
                >
                  {zh ? '以当前视图创建相机' : 'Create camera from view'}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => observeMotionCamera(null)}>
                  {zh ? '返回自由视角' : 'Return to free view'}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onEditOutput}>
                  {zh ? '输出与播放范围…' : 'Output and playback range…'}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </KeyframeContextMenu>
      {box && (
        <div
          className="pointer-events-none fixed z-[100] border border-primary bg-primary/10"
          style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
        />
      )}
    </div>
  )
}
