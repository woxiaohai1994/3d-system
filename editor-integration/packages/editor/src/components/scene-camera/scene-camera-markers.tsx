import { type SceneAnimation, type SceneCameraMarker, useScene } from '@pascal-app/core'
import { type PointerEvent, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { animationData, commitSceneAnimation } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { DropdownMenuItem } from '../ui/primitives/dropdown-menu'
import { KeyframeContextMenu } from './keyframe-context-menu'
import { requestMotionTransition } from './motion-edit-session'
import { currentSceneCameraId } from './scene-camera-state'

export function SceneCameraMarkers({ scale, inset }: { scale: number; inset: number }) {
  const zh = useI18n().locale === 'zh-CN'
  const state = useSceneAnimation(),
    nodes = useScene((s) => s.nodes),
    readOnly = useScene((s) => s.readOnly)
  const data = animationData(),
    markers = data.cameraMarkers ?? []
  const [selected, setSelected] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [context, setContext] = useState<{ x: number; y: number } | null>(null)
  const stop = useRef<(() => void) | null>(null)
  const cancelRename = useRef(false)
  const renameInput = useRef<HTMLInputElement>(null)
  const blocked =
    readOnly ||
    state.playing ||
    state.exporting ||
    state.renderingFilm ||
    state.previewing ||
    !!state.sceneDraft
  useEffect(() => () => stop.current?.(), [])
  useEffect(() => {
    if (renaming) renameInput.current?.focus()
  }, [renaming])
  const edit = (change: (markers: SceneCameraMarker[]) => SceneCameraMarker[]) => {
    const apply = () => {
      const current = animationData()
      commitSceneAnimation({ ...current, cameraMarkers: change(current.cameraMarkers ?? []) })
      useSceneAnimation.setState({ sceneCameraOverride: null })
    }
    if (!blocked && requestMotionTransition(apply)) apply()
  }
  const remove = () => edit((items) => items.filter((m) => m.id !== selected))
  const drag = (event: PointerEvent<HTMLButtonElement>, marker: SceneCameraMarker) => {
    if (blocked || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    if (!requestMotionTransition(() => setSelected(marker.id))) return
    const current = useSceneAnimation.getState()
    if (
      useScene.getState().readOnly ||
      current.playing ||
      current.exporting ||
      current.renderingFilm ||
      current.previewing ||
      current.sceneDraft
    )
      return
    stop.current?.()
    event.currentTarget.focus()
    setSelected(marker.id)
    const initial = useSceneAnimation.getState(),
      authoredNodes = useScene.getState().nodes,
      original = animationData(),
      sceneCamera = currentSceneCameraId(),
      originalOverride = initial.sceneCameraOverride,
      start = event.clientX,
      pointer = event.pointerId,
      target = window
    let changed = false,
      ended = false,
      draft: SceneAnimation | null = null,
      override = originalOverride,
      unsubscribeScene = () => {},
      unsubscribeAnimation = () => {}
    const sameContext = () => {
      const state = useSceneAnimation.getState()
      return (
        useScene.getState().nodes === authoredNodes &&
        state.open === initial.open &&
        state.timelineVisible === initial.timelineVisible &&
        state.time === initial.time &&
        state.workspace === initial.workspace &&
        state.cameraId === initial.cameraId &&
        state.shotId === initial.shotId &&
        state.filmFrame === initial.filmFrame &&
        state.filmClipId === initial.filmClipId &&
        state.filmTrackId === initial.filmTrackId
      )
    }
    const available = () => {
      const state = useSceneAnimation.getState()
      return (
        !ended &&
        sameContext() &&
        !useScene.getState().readOnly &&
        !state.playing &&
        !state.exporting &&
        !state.renderingFilm &&
        !state.previewing &&
        state.sceneDraft === draft &&
        state.sceneCameraOverride === override
      )
    }
    const move = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointer || (Math.abs(e.clientX - start) < 3 && !changed)) return
      if (!available()) {
        finish(true)
        return
      }
      changed = true
      const frame = Math.max(
        -1048574,
        Math.min(1048574, marker.frame + Math.round(((e.clientX - start) / scale) * original.fps)),
      )
      draft = {
        ...original,
        activeCameraId: sceneCamera,
        cameraMarkers: original.cameraMarkers?.map((m) =>
          m.id === marker.id ? { ...m, frame } : m,
        ),
      }
      override = null
      useSceneAnimation.setState({
        sceneDraft: draft,
        sceneCameraOverride: override,
      })
    }
    const finish = (cancelled: boolean) => {
      if (ended) return
      const commit = !cancelled && changed && draft !== null && available()
      const state = useSceneAnimation.getState(),
        owned = draft !== null && state.sceneDraft === draft,
        restoreOverride =
          cancelled && owned && sameContext() && state.sceneCameraOverride === override
      ended = true
      unsubscribeScene()
      unsubscribeAnimation()
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', cancel)
      target.removeEventListener('blur', cancel)
      target.removeEventListener('keydown', key, true)
      if (stop.current === cancel) stop.current = null
      if (owned)
        useSceneAnimation.setState({
          sceneDraft: null,
          ...(restoreOverride ? { sceneCameraOverride: originalOverride } : {}),
        })
      if (commit) commitSceneAnimation(draft!)
    }
    const up = (e: globalThis.PointerEvent) => {
      if (e.pointerId === pointer) finish(false)
    }
    const cancel = () => finish(true)
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      cancel()
    }
    stop.current = cancel
    const revalidate = () => {
      if (!available()) finish(true)
    }
    unsubscribeScene = useScene.subscribe(revalidate)
    unsubscribeAnimation = useSceneAnimation.subscribe(revalidate)
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', cancel)
    target.addEventListener('blur', cancel)
    target.addEventListener('keydown', key, true)
  }
  if (!markers.length) return null
  return (
    <>
      <div className="sticky left-0 z-10 flex h-8 items-center border-r border-b border-border bg-background px-3 text-muted-foreground">
        {zh ? '相机标记' : 'Camera Markers'}
      </div>
      <div
        role="group"
        aria-label={zh ? '相机标记' : 'Camera Markers'}
        className="relative z-[4] h-8 overflow-hidden border-b border-border bg-background"
        onContextMenu={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if ((e.target as Element).closest('input')) {
            e.stopPropagation()
            return
          }
          if (blocked) return
          if (['Delete', 'Backspace', 'F2'].includes(e.key)) {
            e.preventDefault()
            e.stopPropagation()
            if (e.key === 'F2') setRenaming(selected)
            else remove()
          }
        }}
      >
        {markers.map((marker) => {
          const camera = marker.cameraId ? nodes[marker.cameraId as keyof typeof nodes] : null
          return renaming === marker.id ? (
            <input
              key={marker.id}
              ref={renameInput}
              aria-label={zh ? '标记名称' : 'Marker Name'}
              defaultValue={marker.name}
              onFocus={() => {
                cancelRename.current = false
              }}
              className="absolute top-1 z-20 w-36 border border-border bg-background px-1"
              style={{ left: Math.max(0, inset + (marker.frame / data.fps) * scale) }}
              onBlur={(e) => {
                const name = e.target.value
                setRenaming(null)
                if (cancelRename.current) return
                edit((items) => items.map((m) => (m.id === marker.id ? { ...m, name } : m)))
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') {
                  e.preventDefault()
                  cancelRename.current = true
                  e.currentTarget.blur()
                }
              }}
            />
          ) : (
            <button
              key={marker.id}
              type="button"
              data-camera-marker={marker.id}
              aria-label={`${marker.name} · ${marker.frame} · ${camera?.name ?? (zh ? '未绑定相机' : 'No Camera')}`}
              aria-pressed={selected === marker.id}
              title={`${marker.name} · ${marker.frame} ${zh ? '帧' : 'fr'} · ${camera?.name ?? (zh ? '未绑定相机' : 'No Camera')}`}
              disabled={readOnly || state.playing || state.exporting}
              className="absolute top-1 flex h-6 touch-none items-center gap-1 whitespace-nowrap text-muted-foreground aria-pressed:z-10 aria-pressed:text-amber-300"
              style={{ left: inset + (marker.frame / data.fps) * scale }}
              onPointerDown={(e) => drag(e, marker)}
              onClick={(e) => {
                if (e.detail === 0) setSelected(marker.id)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setSelected(marker.id)
                setContext({ x: e.clientX, y: e.clientY })
              }}
            >
              <span aria-hidden="true">▲</span>
              <span>{marker.name}</span>
            </button>
          )
        })}
      </div>
      <KeyframeContextMenu position={context} onClose={() => setContext(null)}>
        <DropdownMenuItem disabled={blocked} onSelect={() => setRenaming(selected)}>
          {zh ? '重命名标记' : 'Rename Marker'}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={blocked} onSelect={remove}>
          {zh ? '删除标记' : 'Delete Marker'}
        </DropdownMenuItem>
      </KeyframeContextMenu>
    </>
  )
}
