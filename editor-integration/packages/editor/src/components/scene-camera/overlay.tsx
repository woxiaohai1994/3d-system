'use client'

import { type SceneCameraNode, useScene } from '@pascal-app/core'
import { Camera, Maximize2, Minimize2, Minus, Plus, Settings2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import {
  addSceneCamera,
  alignCameraToView,
  selectCameraTransform,
  viewThroughCamera,
} from './actions'
import { sceneCameraAspect } from './camera-math'
import { cameraPreviewErrorText } from './camera-preview-error'
import { CameraViewfinder } from './camera-viewfinder'
import { CameraTab } from './delete-camera-button'
import { downloadCameraBlob } from './download'
import { CameraProperties, cameraButtonClass } from './inspector'
import { useCameraText } from './messages'
import { CameraMotionPanel } from './motion-panel'
import { endSceneAnimation, observedMotionCamera } from './motion-state'
import { ObjectKeyframeContextMenu } from './object-keyframe-context-menu'
import { QuickCameraLens } from './quick-lens'
import { RigAimControls } from './rig-aim-controls'
import { RigFrame } from './rig-frame'
import { CameraRigToolbar } from './rig-toolbar'
import { RigViewfinderOverlay } from './rig-viewfinder-overlay'
import { useCameraStudio } from './store'
import { useFloatingCameraPanel } from './use-floating-camera-panel'
import { ViewfinderHelpDisclosure } from './viewfinder-help'
import {
  bindViewfinderWheel,
  canNavigateViewfinder,
  startViewfinderNavigation,
} from './viewfinder-navigation'
import { viewportFrameRect } from './viewport-frame'
import { cameraFromViewport, currentViewportSource } from './viewport-source'

export function SceneCameraOverlay({ projectId }: { projectId?: string | null }) {
  return (
    <>
      <ObjectKeyframeContextMenu />
      <CameraRigToolbar />
      <CameraViewfinder />
      <SceneAnimationOverlay />
      <SceneCameraPhotoOverlay projectId={projectId} />
    </>
  )
}
function SceneAnimationOverlay() {
  const state = useSceneAnimation()
  const nodes = useScene((s) => s.nodes)
  const node = state.cameraId ? nodes[state.cameraId] : undefined
  const cameraView =
    state.cameraView && state.workspace === 'shot' && !state.exporting && !state.previewing
  const observed = cameraView ? observedMotionCamera() : null
  return state.open ? (
    <>
      {observed && <RigFrame node={observed} aspect={animationData().aspect} />}
      <div hidden={!state.timelineVisible}>
        <CameraMotionPanel node={node?.type === 'scene-camera' ? node : undefined} />
      </div>
    </>
  ) : null
}
function SceneCameraPhotoOverlay({ projectId }: { projectId?: string | null }) {
  const t = useCameraText()
  const { locale } = useI18n()
  const motionOpen = useSceneAnimation((s) => s.open)
  const studio = useCameraStudio()
  const floating = useFloatingCameraPanel(studio.open && !motionOpen)
  const nodes = useScene((s) => s.nodes)
  const cameras = Object.values(nodes).filter(
    (node): node is SceneCameraNode => node.type === 'scene-camera',
  )
  const camera = cameras.find((node) => node.id === studio.activeId) ?? cameras[0]
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [photo, setPhoto] = useState<{ url: string; name: string } | null>(null)
  const photoUrl = useRef<string | null>(null)
  const mounted = useRef(true)
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const wheel = useRef<ReturnType<typeof bindViewfinderWheel> | null>(null)
  const cancelDrag = useRef<(() => void) | null>(null)
  const setCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return
    useCameraStudio.setState({ canvas, ready: false })
    const binding = bindViewfinderWheel(canvas, () => cameraRef.current ?? null)
    wheel.current = binding
    return () => {
      binding.dispose()
      cancelDrag.current?.()
      cancelDrag.current = null
      if (wheel.current === binding) wheel.current = null
      if (useCameraStudio.getState().canvas === canvas)
        useCameraStudio.setState({ canvas: null, ready: false })
    }
  }, [])
  useEffect(() => {
    mounted.current = true
    useCameraStudio.setState({ projectId: projectId ?? null })
    return () => {
      endSceneAnimation(true)
      mounted.current = false
      if (photoUrl.current) URL.revokeObjectURL(photoUrl.current)
      useCameraStudio.setState({
        open: false,
        outputAspect: null,
        activeId: null,
        canvas: null,
        pickingFocus: false,
      })
    }
  }, [projectId])

  useEffect(() => {
    if (camera?.id !== studio.activeId) {
      useCameraStudio.setState({
        activeId: camera?.id ?? null,
        pickingFocus: false,
        ready: false,
      })
    }
  }, [camera?.id, studio.activeId])

  useEffect(() => {
    if (!studio.pickingFocus) return
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        useCameraStudio.setState({ pickingFocus: false })
      }
    }
    window.addEventListener('keydown', cancel, true)
    return () => window.removeEventListener('keydown', cancel, true)
  }, [studio.pickingFocus])

  const button = (active = false) =>
    `${cameraButtonClass} ${active ? 'bg-accent text-sky-300' : ''}`
  const selectedRatio = camera?.frameAspect != null ? 'viewport' : camera?.aspectRatio
  const chooseRatio = (ratio: 'viewport' | '16:9' | '4:3' | '1:1' | '9:16') => {
    if (!camera || useScene.getState().readOnly) return
    const source = currentViewportSource()
    if (ratio === 'viewport') {
      if (source)
        useScene
          .getState()
          .updateNode(camera.id, { frameAspect: cameraFromViewport(source, camera).frameAspect })
    } else
      useScene
        .getState()
        .updateNode(camera.id, { aspectRatio: ratio, frameAspect: null, verticalFov: null })
  }
  const takePhoto = async () => {
    if (!camera) return
    try {
      const blob = await studio.runtime?.takePhoto()
      if (!blob || !mounted.current) return
      const name = `${camera.name ?? t('Scene camera')}-${Date.now()}.png`
      downloadCameraBlob(blob, name)
      if (photoUrl.current) URL.revokeObjectURL(photoUrl.current)
      const url = URL.createObjectURL(blob)
      photoUrl.current = url
      setPhoto({ url, name })
    } catch {
      setMessage(t('Photo failed'))
    }
  }
  if (!studio.open || motionOpen) return null
  return (
    <section
      data-camera-rig-panel
      ref={floating.ref}
      aria-label={t('Live camera view')}
      className="pointer-events-auto absolute right-3 bottom-20 z-[60] flex flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-xl"
      style={{
        width: expanded ? 'min(560px, calc(100% - 24px))' : 'min(340px, calc(100% - 24px))',
        maxHeight: 'calc(100% - 100px)',
        ...floating.style,
      }}
    >
      <header className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <button
          type="button"
          {...floating.handle}
          aria-label={t('Drag to move panel')}
          title={t('Drag to move panel')}
          className="flex min-w-0 flex-1 touch-none cursor-move items-center gap-2 text-xs font-medium"
        >
          <Camera size={14} />
          <span>{t('Scene camera')}</span>
        </button>
        <button
          type="button"
          className="rounded p-1 hover:bg-accent"
          aria-label={t('Camera settings')}
          aria-expanded={settingsOpen}
          onClick={() => {
            setSettingsOpen(!settingsOpen)
            if (studio.minimized) useCameraStudio.setState({ minimized: false })
          }}
        >
          <Settings2 size={14} />
        </button>
        <button
          type="button"
          className="rounded p-1 hover:bg-accent"
          aria-label={studio.minimized ? t('Restore') : t('Minimize')}
          aria-expanded={!studio.minimized}
          onClick={() => useCameraStudio.setState({ minimized: !studio.minimized })}
        >
          {studio.minimized ? <Maximize2 size={14} /> : <Minus size={14} />}
        </button>
        <button
          type="button"
          className="rounded p-1 hover:bg-accent"
          aria-label={expanded ? t('Shrink') : t('Expand')}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button
          type="button"
          className="rounded p-1 hover:bg-accent disabled:opacity-40"
          aria-label={t('Close')}
          onClick={() => {
            useCameraStudio.setState({
              open: false,
              pickingFocus: false,
            })
          }}
        >
          <X size={14} />
        </button>
      </header>
      <div hidden={studio.minimized} className="min-h-0 overflow-y-auto">
        <div className="flex items-center gap-1 px-2 pt-2">
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {cameras.map((node) => (
              <CameraTab
                key={node.id}
                id={node.id}
                name={node.name ?? t('Scene camera')}
                selected={camera?.id === node.id}
                onSelect={() => {
                  useCameraStudio.setState({
                    activeId: node.id,
                    ready: false,
                    pickingFocus: false,
                  })
                  selectCameraTransform(node)
                }}
              />
            ))}
          </div>
          <button
            type="button"
            className={button()}
            title={t('Add camera from view')}
            aria-label={t('Add camera from view')}
            onClick={() => addSceneCamera(t('Scene camera'))}
          >
            <Plus size={14} />
          </button>
        </div>
        {camera ? (
          <>
            <div className="flex items-center gap-1 px-2 pt-2">
              <button
                type="button"
                className={button()}
                onClick={() => {
                  if (alignCameraToView(camera)) useCameraStudio.setState({ ready: false })
                }}
              >
                {t('Use current view')}
              </button>
              <button className={button()} onClick={() => viewThroughCamera(camera)}>
                {locale === 'zh-CN' ? '进入相机视角' : 'View through camera'}
              </button>
            </div>
            <div role="group" aria-label={t('Frame ratio')} className="flex gap-1 p-2">
              {(['viewport', '16:9', '4:3', '1:1', '9:16'] as const).map((ratio) => (
                <button
                  type="button"
                  key={ratio}
                  className={`${button(selectedRatio === ratio)} flex-1 px-1 py-1`}
                  aria-pressed={selectedRatio === ratio}
                  onClick={() => chooseRatio(ratio)}
                >
                  {ratio === 'viewport' ? t('Canvas ratio') : ratio}
                </button>
              ))}
            </div>
            <div
              className="relative w-full bg-black"
              style={{
                aspectRatio: sceneCameraAspect(camera),
                maxHeight: expanded ? '55vh' : '38vh',
              }}
            >
              <canvas
                ref={setCanvas}
                aria-label={t('Live camera view')}
                className={`absolute inset-0 block h-full w-full touch-none object-contain object-center ${studio.pickingFocus ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onPointerDown={(event) => {
                  if (!canNavigateViewfinder(camera, event.currentTarget)) return
                  event.preventDefault()
                  event.stopPropagation()
                  wheel.current?.finish(true)
                  cancelDrag.current = startViewfinderNavigation(
                    camera,
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
              {!studio.ready && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-white">
                  {studio.error ? t('Camera preview failed') : t('Preparing camera')}
                </div>
              )}
              {camera.rig && (
                <>
                  <RigViewfinderOverlay node={camera} />
                  <RigFrame node={camera} aspect={sceneCameraAspect(camera)} />
                </>
              )}
              {studio.pickingFocus && (
                <button
                  type="button"
                  className="absolute bottom-2 rounded bg-black/80 px-2 py-1 text-xs text-white"
                  onClick={() => useCameraStudio.setState({ pickingFocus: false })}
                >
                  {t('Click the subject in the live view')} · {t('Escape key')}
                </button>
              )}
            </div>
            <div className="px-2 py-1 text-xs text-muted-foreground">
              <ViewfinderHelpDisclosure node={camera} />
            </div>
            {!settingsOpen && (
              <>
                <QuickCameraLens key={camera.id} node={camera} />
                <div className="border-t border-border p-2">
                  <RigAimControls key={`aim-${camera.id}`} node={camera} />
                </div>
              </>
            )}
            <div className="flex items-center gap-2 p-2">
              <button
                type="button"
                disabled={!studio.ready}
                className={`${button()} flex flex-1 items-center justify-center gap-1.5`}
                onClick={takePhoto}
              >
                <Camera size={14} />
                {t('Take photo')}
              </button>
            </div>
            {settingsOpen && (
              <div className="border-t border-border">
                <div className="flex items-center gap-1 p-2">
                  {([720, 1080] as const).map((resolution) => (
                    <button
                      type="button"
                      key={resolution}
                      className={`${button(studio.resolution === resolution)} flex-1`}
                      aria-pressed={studio.resolution === resolution}
                      onClick={() => useCameraStudio.setState({ resolution, ready: false })}
                    >
                      {resolution}p
                    </button>
                  ))}
                </div>
                <CameraProperties context="photo" key={camera.id} node={camera} />
              </div>
            )}
            {(message || studio.error) && (
              <p role="alert" className="break-all px-2 pb-2 text-xs text-red-400">
                {message ?? cameraPreviewErrorText(studio.error!, locale === 'zh-CN')}
              </p>
            )}
          </>
        ) : (
          <div className="p-3">
            <button
              type="button"
              className={`${button()} w-full`}
              onClick={() => addSceneCamera(t('Scene camera'))}
            >
              {t('Add camera from view')}
            </button>
          </div>
        )}
        {photo && (
          <details className="border-t border-border p-2">
            <summary className="cursor-pointer text-xs">{t('Photo ready')}</summary>
            <img src={photo.url} alt={t('Photo ready')} className="my-2 w-full" />
            <a className={button()} href={photo.url} download={photo.name}>
              {t('Save photo')}
            </a>
          </details>
        )}
      </div>
    </section>
  )
}
