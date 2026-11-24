'use client'
import {
  FilmShot,
  removeFilmShot,
  type SceneCameraNode,
  sampleScenePlayback,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Camera, Film, Folder, Plus, Trash2 } from 'lucide-react'
import { useEffect } from 'react'
import { addSceneCamera } from '../scene-camera/actions'
import { DeleteCameraButton } from '../scene-camera/delete-camera-button'
import { requestMotionTransition } from '../scene-camera/motion-edit-session'
import { useObjectMotion } from '../scene-camera/motion-object-store'
import { seekMotion, selectMotionCamera } from '../scene-camera/motion-state'
import { animationData, animationSite, commitSceneAnimation } from './document'
import { saveAnimationSession } from './session'
import { useSceneAnimation } from './store'

export const filmButton =
  'inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded px-2 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40'
export const filmField =
  'h-8 min-w-0 rounded border border-border bg-background px-2 text-xs tabular-nums'
export function switchWorkspace(id: string) {
  if (!requestMotionTransition(() => switchWorkspace(id))) return
  const state = useSceneAnimation.getState()
  if (state.exporting || state.renderingFilm) return
  state.finishCameraEdit?.(false)
  const shot = animationData().shots.find((s) => s.id === id)
  const cameraId =
    shot?.cameraId &&
    useScene.getState().nodes[shot.cameraId as SceneCameraNode['id']]?.type === 'scene-camera'
      ? (shot.cameraId as SceneCameraNode['id'])
      : null
  useObjectMotion.setState({ nodeId: null, draft: null })
  useViewer.getState().setSelection({ selectedIds: [] })
  useSceneAnimation.setState({
    workspace: id === 'film' ? 'film' : 'shot',
    shotId: shot?.id ?? state.shotId,
    cameraId,
    outputCameraId: cameraId,
    playing: false,
    previewing: false,
    cameraView: false,
    viewCameraId: null,
    pointId: null,
    segmentId: null,
    message: null,
  })
  sampleScenePlayback(state.time)
}
export function openFilmSource(sourceId: string, localFrame = 0) {
  const data = animationData(),
    source = data.sources.find((s) => s.id === sourceId)
  if (!source) return
  const apply = () => {
    switchWorkspace(source.shotId)
    if (useSceneAnimation.getState().workspace === 'shot')
      seekMotion((source.start + localFrame) / data.fps)
  }
  if (requestMotionTransition(apply)) apply()
}
export function WorkspaceTabs() {
  const state = useSceneAnimation()
  const readOnly = useScene((s) => s.readOnly)
  const nodes = useScene((s) => s.nodes)
  const data = animationData(),
    shot = data.shots.find((s) => s.id === state.shotId)
  const camera = shot?.cameraId ? nodes[shot.cameraId as SceneCameraNode['id']] : null
  const emptyShots = data.shots.filter(
    (s) => !s.cameraId && !data.sources.some((source) => source.shotId === s.id),
  )
  const blocked = readOnly || state.exporting || state.renderingFilm
  const siteId = animationSite()?.id
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const save = () => saveAnimationSession(siteId)
    const unsubscribe = useSceneAnimation.subscribe((current, previous) => {
      if (
        ['workspace', 'shotId', 'time', 'filmFrame', 'filmClipId', 'filmTrackId'].some(
          (key) => current[key as keyof typeof current] !== previous[key as keyof typeof previous],
        )
      ) {
        clearTimeout(timer)
        timer = setTimeout(save, 150)
      }
    })
    window.addEventListener('beforeunload', save)
    return () => {
      clearTimeout(timer)
      save()
      unsubscribe()
      window.removeEventListener('beforeunload', save)
    }
  }, [siteId])
  useEffect(() => {
    if (state.workspace !== 'shot' || state.exporting || state.renderingFilm) return
    const active = shot ?? data.shots[0]
    const cameraId =
      active?.cameraId && nodes[active.cameraId as SceneCameraNode['id']]?.type === 'scene-camera'
        ? (active.cameraId as SceneCameraNode['id'])
        : null
    if (state.shotId !== (active?.id ?? null) || state.cameraId !== cameraId)
      useSceneAnimation.setState({
        shotId: active?.id ?? null,
        cameraId,
        outputCameraId: cameraId,
        pointId: null,
        segmentId: null,
      })
  }, [
    data,
    nodes,
    shot,
    state.workspace,
    state.shotId,
    state.cameraId,
    state.exporting,
    state.renderingFilm,
  ])
  const add = () => {
    const shot = FilmShot.parse({ name: `相机工作区 ${data.shots.length + 1}`, cameraId: null })
    if (commitSceneAnimation({ ...data, shots: [...data.shots, shot] })) switchWorkspace(shot.id)
  }
  const remove = () => {
    if (!shot) return
    const sources = new Set(data.sources.filter((s) => s.shotId === shot.id).map((s) => s.id))
    const count = data.sequence.tracks
      .flatMap((t) => t.clips)
      .filter((c) => sources.has(c.sourceId)).length
    if (
      !window.confirm(
        `删除「${shot.name}」及其相机？将删除 ${sources.size} 个来源及 ${count} 个成片片段，保留空隙。可以一次撤销。`,
      )
    )
      return
    const site = animationSite()
    if (!site) return
    useScene.getState().applyNodeChanges({
      delete: shot.cameraId ? [shot.cameraId as SceneCameraNode['id']] : [],
      update: [{ id: site.id, data: { animation: removeFilmShot(data, shot.id) } }],
    })
    switchWorkspace(animationData().shots[0]?.id ?? 'film')
  }
  const clearEmpty = () => {
    if (!window.confirm(`清理 ${emptyShots.length} 个空工作区？不会删除任何现存相机，可以撤销。`))
      return
    let next = animationData()
    for (const empty of emptyShots) next = removeFilmShot(next, empty.id)
    commitSceneAnimation(next)
  }
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
      <div
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        role="tablist"
        aria-label="动画工作区"
      >
        {data.shots.map((s) => {
          const exists =
            !!s.cameraId && nodes[s.cameraId as SceneCameraNode['id']]?.type === 'scene-camera'
          return (
            <button
              key={s.id}
              role="tab"
              aria-selected={state.workspace === 'shot' && state.shotId === s.id}
              className={`${filmButton} aria-selected:bg-accent aria-selected:text-primary`}
              disabled={blocked}
              onClick={() => switchWorkspace(s.id)}
            >
              {exists ? <Camera size={14} /> : <Folder size={14} />}
              {s.name}
              {!exists && (
                <span className="text-muted-foreground">{s.cameraId ? '相机已删除' : '空'}</span>
              )}
            </button>
          )
        })}
        <button
          className={filmButton}
          aria-label="新建相机工作区"
          disabled={blocked}
          onClick={() => {
            if (requestMotionTransition(add)) add()
          }}
        >
          <Plus size={15} />
        </button>
        <button
          role="tab"
          aria-selected={state.workspace === 'film'}
          className={`${filmButton} ml-2 aria-selected:bg-accent aria-selected:text-primary`}
          disabled={blocked}
          onClick={() => switchWorkspace('film')}
        >
          <Film size={14} />
          动画工作区
        </button>
      </div>
      {emptyShots.length > 0 && data.shots.length > 1 && (
        <button
          className={filmButton}
          disabled={blocked || state.playing}
          onClick={() => {
            if (requestMotionTransition(clearEmpty)) clearEmpty()
          }}
        >
          清理空工作区（{emptyShots.length}）
        </button>
      )}
      {state.workspace === 'shot' && shot && (
        <>
          <input
            aria-label="工作区名称"
            className={`${filmField} w-32`}
            key={shot.id + shot.name}
            defaultValue={shot.name}
            disabled={blocked}
            onBlur={(e) => {
              const name = e.target.value.trim()
              if (name && name !== shot.name)
                commitSceneAnimation({
                  ...animationData(),
                  shots: animationData().shots.map((s) => (s.id === shot.id ? { ...s, name } : s)),
                })
            }}
          />
          {!shot.cameraId && (
            <button
              className={filmButton}
              disabled={blocked}
              onClick={() => {
                const camera = addSceneCamera('相机')
                if (camera) selectMotionCamera(camera.id)
              }}
            >
              创建相机
            </button>
          )}
          {camera?.type === 'scene-camera' ? (
            <DeleteCameraButton id={camera.id} name={camera.name} showLabel />
          ) : (
            <button
              className={filmButton}
              aria-label="删除工作区"
              disabled={blocked}
              onClick={() => {
                if (requestMotionTransition(remove)) remove()
              }}
            >
              <Trash2 size={14} />
              删除工作区
            </button>
          )}
        </>
      )}
      <span className="hidden shrink-0 px-2 text-xs text-muted-foreground xl:block">
        世界与物品动画全局共享
      </span>
    </div>
  )
}
