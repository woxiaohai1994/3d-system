'use client'

import { type AnyNodeId, type SceneCameraNode, useScene } from '@pascal-app/core'
import { Camera, Maximize2, Minimize2, Minus } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { sceneCameraAspect } from './camera-math'
import { useObjectMotion } from './motion-object-store'
import { RigAimControls } from './rig-aim-controls'
import { RigFrame } from './rig-frame'
import { rigPose, useRigEditor } from './rig-state'
import { RigViewfinderOverlay } from './rig-viewfinder-overlay'
import { useCameraStudio } from './store'
import { useFloatingCameraPanel } from './use-floating-camera-panel'
import { ViewfinderHelpDisclosure } from './viewfinder-help'
import {
  bindViewfinderWheel,
  canNavigateViewfinder,
  startViewfinderNavigation,
} from './viewfinder-navigation'
import { attachViewfinderCanvas } from './viewfinder-state'
import { viewportFrameRect } from './viewport-frame'

export function CameraViewfinder() {
  const animation = useSceneAnimation()
  const id = animation.cameraId
  const node = useScene((s) => (id ? s.nodes[id as AnyNodeId] : null))
  if (!animation.open) return null
  return <Viewfinder node={node?.type === 'scene-camera' ? node : null} />
}

export function Viewfinder({
  node,
  embedded = false,
  onExpandedChange,
}: {
  node: SceneCameraNode | null
  embedded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}) {
  const zh = useI18n().locale === 'zh-CN'
  const state = useSceneAnimation()
  const studio = useCameraStudio()
  const objectId = useObjectMotion((s) => s.nodeId)
  const poseCameraId = useRigEditor((s) => s.poseCameraId)
  const [expanded, setExpanded] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const nodeRef = useRef(node)
  nodeRef.current = node
  const wheel = useRef<ReturnType<typeof bindViewfinderWheel> | null>(null)
  const cancelDrag = useRef<(() => void) | null>(null)
  const readOnly = useScene((s) => s.readOnly)
  const rig = node ? rigPose(node)?.rig : null
  const rigLabel = rig
    ? (zh
        ? { dolly: '滑轨相机架', crane: '摇臂相机架', '2d': '平面相机架' }
        : { dolly: 'Dolly', crane: 'Crane', '2d': '2D rig' })[rig.type]
    : zh
      ? '自由相机'
      : 'Free camera'
  const navigationEnabled = !!node && !readOnly && canNavigateViewfinder(node)
  const visible =
    !!node &&
    (!state.open || state.workspace === 'shot') &&
    !state.previewing &&
    !state.cameraView &&
    !objectId
  const floating = useFloatingCameraPanel(visible && !embedded)
  const id = node?.id ?? null
  useEffect(
    () => () => {
      wheel.current?.finish(false)
      cancelDrag.current?.()
      cancelDrag.current = null
    },
    [id, visible, studio.viewfinderCollapsed, attempt],
  )
  const aspect = state.open ? animationData().aspect : node ? sceneCameraAspect(node) : 16 / 9
  const setCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return
    const detach = attachViewfinderCanvas(canvas)
    const binding = bindViewfinderWheel(canvas, () => nodeRef.current)
    wheel.current = binding
    return () => {
      binding.dispose()
      if (wheel.current === binding) wheel.current = null
      detach()
    }
  }, [])
  useLayoutEffect(() => {
    useCameraStudio.setState({ viewfinderId: id, viewfinderCollapsed: false, ready: false })
    return () => useCameraStudio.setState({ viewfinderId: null })
  }, [id])
  useLayoutEffect(() => {
    const parent = floating.ref.current?.offsetParent
    if (!visible || embedded || poseCameraId !== id || !(parent instanceof HTMLElement)) return
    let compact = false
    const fit = () => {
      const narrow = parent.clientWidth < 880
      if (narrow && !compact) useCameraStudio.setState({ viewfinderCollapsed: true })
      compact = narrow
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [embedded, floating.ref, id, poseCameraId, visible])
  const button =
    'flex min-h-8 min-w-8 items-center justify-center rounded px-2 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-sky-400'
  return (
    <section
      ref={floating.ref}
      data-camera-rig-panel
      aria-label={zh ? '相机实时取景' : 'Live camera viewfinder'}
      hidden={!visible}
      className={
        embedded
          ? 'shrink-0 overflow-hidden border-b border-border bg-background text-foreground'
          : 'pointer-events-auto absolute right-3 bottom-20 z-[60] overflow-hidden rounded-xl border border-border bg-background text-foreground'
      }
      style={
        embedded
          ? undefined
          : {
              width: expanded ? 'min(560px, calc(100% - 24px))' : 'min(340px, calc(100% - 24px))',
              ...floating.style,
            }
      }
    >
      <header className="flex items-center gap-1 border-b border-border px-2 py-1">
        {embedded ? (
          <span className="min-w-0 flex-1 px-2 text-xs text-muted-foreground">
            {zh ? '实时取景' : 'Live view'}
          </span>
        ) : (
          <button
            type="button"
            {...floating.handle}
            title={zh ? '拖动取景窗；方向键移动窗口' : 'Drag viewfinder; arrow keys move window'}
            aria-label={zh ? '移动取景窗' : 'Move viewfinder'}
            className={`${button} min-w-0 flex-1 touch-none cursor-move justify-start gap-2`}
          >
            <Camera size={14} className="shrink-0" />
            <span className="truncate">
              {zh ? '实时取景' : 'Live view'} · {node?.name}
            </span>
          </button>
        )}
        <button
          type="button"
          className={button}
          aria-label={
            studio.viewfinderCollapsed
              ? zh
                ? '展开取景窗'
                : 'Restore viewfinder'
              : zh
                ? '收起取景窗'
                : 'Collapse viewfinder'
          }
          aria-expanded={!studio.viewfinderCollapsed}
          onClick={() =>
            useCameraStudio.setState({ viewfinderCollapsed: !studio.viewfinderCollapsed })
          }
        >
          {studio.viewfinderCollapsed ? <Maximize2 size={14} /> : <Minus size={14} />}
        </button>
        <button
          type="button"
          className={button}
          aria-label={
            expanded
              ? zh
                ? '缩小取景窗'
                : 'Shrink viewfinder'
              : zh
                ? '放大取景窗'
                : 'Enlarge viewfinder'
          }
          aria-pressed={expanded}
          onClick={() => {
            setExpanded(!expanded)
            onExpandedChange?.(!expanded)
            useCameraStudio.setState({ viewfinderCollapsed: false })
          }}
        >
          {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </header>
      <div hidden={studio.viewfinderCollapsed}>
        <div
          className="relative w-full bg-black"
          style={{ aspectRatio: aspect, maxHeight: expanded ? '50vh' : '30vh' }}
        >
          <canvas
            key={attempt}
            ref={setCanvas}
            aria-label={zh ? '当前相机拍摄画面' : 'Current camera image'}
            className={`absolute inset-0 h-full w-full touch-none object-contain ${studio.pickingFocus ? 'cursor-crosshair' : navigationEnabled ? 'cursor-grab active:cursor-grabbing' : ''}`}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onPointerDown={(event) => {
              if (!node || !navigationEnabled) return
              event.preventDefault()
              event.stopPropagation()
              wheel.current?.finish(true)
              cancelDrag.current = startViewfinderNavigation(
                node,
                event.currentTarget,
                event.nativeEvent,
              )
            }}
            onClick={(event) => {
              if (!studio.pickingFocus) return
              const rect = event.currentTarget.getBoundingClientRect()
              const frame = viewportFrameRect(
                event.currentTarget.width,
                event.currentTarget.height,
                rect.width,
                rect.height,
              )
              const x = (event.clientX - rect.left - frame.x) / frame.width
              const y = (event.clientY - rect.top - frame.y) / frame.height
              if (x >= 0 && x <= 1 && y >= 0 && y <= 1) studio.runtime?.pickFocus(x, y)
            }}
          />
          {node && rig && (
            <>
              <RigViewfinderOverlay node={node} />
              <RigFrame node={node} aspect={aspect} />
            </>
          )}
          {(!studio.ready || studio.error) && (
            <div
              role="status"
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 p-3 text-center text-xs text-white"
            >
              <span>
                {studio.error
                  ? zh
                    ? '取景失败，请重试'
                    : 'Preview failed. Try again.'
                  : zh
                    ? '正在准备相机画面…'
                    : 'Preparing camera image…'}
              </span>
              {studio.error && (
                <button type="button" className={button} onClick={() => setAttempt(attempt + 1)}>
                  {zh ? '重试' : 'Retry'}
                </button>
              )}
            </div>
          )}
        </div>
        <div className="space-y-1 px-3 py-2 text-xs text-muted-foreground">
          {node && !embedded && <RigAimControls key={node.id} node={node} />}
          <p className="text-sky-300">{rigLabel}</p>
          {studio.pickingFocus ? (
            <p role="status">{zh ? '点击画面选择对焦位置' : 'Click the image to focus'}</p>
          ) : (
            <ViewfinderHelpDisclosure node={node} />
          )}
        </div>
      </div>
    </section>
  )
}
