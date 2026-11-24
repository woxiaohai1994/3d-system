'use client'
import {
  addFilmClip,
  addFilmTransition,
  deleteFilmClip,
  duplicateFilmClip,
  FilmTrack,
  FilmTransition,
  filmCatalog,
  filmClipDuration,
  filmClipEnd,
  filmClipSourceFrame,
  filmClipUnavailable,
  filmDuration,
  moveFilmClip,
  type SceneAnimation,
  setFilmClipSpeed,
  splitFilmClip,
  trimFilmClip,
  useScene,
} from '@pascal-app/core'
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  LockKeyhole,
  Pause,
  Play,
  Plus,
  Scissors,
  UnlockKeyhole,
} from 'lucide-react'
import { type PointerEvent, useEffect, useRef, useState } from 'react'
import { runRedo, runUndo } from '../../lib/history'
import { hideSceneTimeline } from '../scene-camera/motion-state'
import { animationData, commitSceneAnimation } from './document'
import { exportFilm } from './film-export'
import { useSceneAnimation } from './store'
import { filmButton as button, filmField as field, openFilmSource } from './workspaces'

export function FilmEditor() {
  const state = useSceneAnimation(),
    readOnly = useScene((s) => s.readOnly)
  useScene((s) => s.nodes)
  const data = animationData(),
    total = filmDuration(data.sequence),
    catalog = filmCatalog(data)
  const [showSources, setShowSources] = useState(false),
    [showSettings, setShowSettings] = useState(false)
  const [sourceId, setSourceId] = useState(''),
    [zoom, setZoom] = useState(1),
    [ripple, setRipple] = useState(false)
  const [speed, setSpeed] = useState('100'),
    [reverse, setReverse] = useState(false),
    [shift, setShift] = useState(false)
  const [transitionFrames, setTransitionFrames] = useState<number>(data.fps),
    [repeatEdges, setRepeatEdges] = useState(false)
  const [drag, setDrag] = useState<{
    id: string
    start: number
    edge?: 'in' | 'out'
    frame: number
  } | null>(null)
  useEffect(() => setTransitionFrames(data.fps), [data.fps])
  const cancelDrag = useRef<(() => void) | null>(null)
  const blocked = state.exporting || state.playing || readOnly
  const track =
    data.sequence.tracks.find((t) => t.id === state.filmTrackId) ?? data.sequence.tracks[0]
  const selectedTrack = data.sequence.tracks.find((t) =>
    t.clips.some((c) => c.id === state.filmClipId),
  )
  const clip = selectedTrack?.clips.find((c) => c.id === state.filmClipId)
  const source = data.sources.find((s) => s.id === clip?.sourceId)
  const selectedSource = catalog.find((s) => s.id === sourceId) ?? catalog[0]
  const pixels = zoom * 2,
    max = Math.max(data.fps * 10, total + data.fps * 3)
  const rulerStep = data.fps * Math.max(2, Math.ceil(max / data.fps / 500))
  const execute = (edit: (data: SceneAnimation) => SceneAnimation) => {
    if (blocked) return
    try {
      commitSceneAnimation(edit(animationData()))
    } catch (error) {
      useSceneAnimation.setState({
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  useEffect(() => {
    setSpeed(String((clip?.rate ?? 1) * 100))
    setReverse(clip?.reverse ?? false)
  }, [clip?.rate, clip?.reverse])
  useEffect(() => () => cancelDrag.current?.(), [])
  const seek = (frame: number) => {
    if (!state.exporting)
      useSceneAnimation.setState({ filmFrame: Math.max(0, Math.round(frame)), playing: false })
  }
  const play = () =>
    useSceneAnimation.setState({
      playing: !state.playing,
      filmFrame: state.filmFrame >= total - 1 ? 0 : state.filmFrame,
    })
  const patchTrack = (id: string, patch: Partial<FilmTrack>) =>
    execute((d) => ({
      ...d,
      sequence: { tracks: d.sequence.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) },
    }))
  const reorder = (id: string, delta: number) =>
    execute((d) => {
      const tracks = [...d.sequence.tracks],
        i = tracks.findIndex((t) => t.id === id),
        other = i + delta
      if (other >= 0 && other < tracks.length) {
        if (tracks[i]!.locked || tracks[other]!.locked)
          throw new Error('请先解锁需要调整顺序的轨道')
        ;[tracks[i], tracks[other]] = [tracks[other]!, tracks[i]!]
      }
      return { ...d, sequence: { tracks } }
    })
  const addTrack = () =>
    execute((d) => {
      const track = FilmTrack.parse({ name: `视频 ${d.sequence.tracks.length + 1}` })
      useSceneAnimation.setState({ filmTrackId: track.id })
      return { ...d, sequence: { tracks: [...d.sequence.tracks, track] } }
    })
  const add = (
    mode: 'insert' | 'overwrite',
    id = selectedSource?.id,
    at = state.filmFrame,
    trackId = track?.id,
  ) => {
    if (!id) return
    execute((d) => {
      if (!trackId) {
        const t = FilmTrack.parse({ name: '视频 1' })
        trackId = t.id
        d = { ...d, sequence: { tracks: [t] } }
        useSceneAnimation.setState({ filmTrackId: t.id })
      }
      return addFilmClip(d, trackId!, id, at, mode)
    })
  }
  const startDrag = (e: PointerEvent, id: string, edge?: 'in' | 'out') => {
    if (blocked || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const original = animationData(),
      owner = original.sequence.tracks.find((t) => t.clips.some((c) => c.id === id))!,
      c = owner.clips.find((c) => c.id === id)!
    useSceneAnimation.setState({ filmClipId: id, filmTrackId: owner.id })
    if (owner.locked) return
    const x = e.clientX,
      initial = edge === 'out' ? filmClipEnd(c) : c.start
    let frame = initial,
      target = owner.id
    const move = (event: globalThis.PointerEvent) => {
      frame = Math.max(0, initial + Math.round((event.clientX - x) / pixels))
      const row = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>('[data-film-lane]')
      if (!edge && row?.dataset.filmLane) target = row.dataset.filmLane as typeof target
      setDrag({ id, start: c.start, edge, frame })
    }
    const end = (cancel = false) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancelFn)
      window.removeEventListener('blur', cancelFn)
      window.removeEventListener('keydown', key, true)
      setDrag(null)
      cancelDrag.current = null
      if (!cancel && (frame !== initial || target !== owner.id))
        execute(() =>
          edge
            ? trimFilmClip(original, id, edge, frame, ripple)
            : moveFilmClip(original, id, target, frame),
        )
    }
    const up = () => end(),
      cancelFn = () => end(true),
      key = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          end(true)
        }
      }
    cancelDrag.current = cancelFn
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancelFn)
    window.addEventListener('blur', cancelFn)
    window.addEventListener('keydown', key, true)
  }
  const transition = (kind: FilmTransition['kind']) => {
    if (!clip || !selectedTrack) return
    execute((d) =>
      addFilmTransition(
        d,
        selectedTrack.id,
        FilmTransition.parse({
          kind,
          clipId: clip.id,
          nextClipId:
            kind === 'dissolve'
              ? (selectedTrack.clips.find((c) => c.start === filmClipEnd(clip))?.id ?? null)
              : null,
          frames: transitionFrames,
          repeatEdges,
        }),
      ),
    )
  }
  return (
    <div
      className="flex min-h-0 flex-1 flex-col text-xs"
      onKeyDown={(e) => {
        if ((e.target as Element).closest('input,select,textarea')) return
        if (e.code === 'Space') {
          e.preventDefault()
          if (!blocked || state.playing) play()
        }
        if (blocked) return
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
          e.preventDefault()
          e.stopPropagation()
          e.shiftKey ? runRedo() : runUndo()
        }
        if (clip && ['Delete', 'Backspace'].includes(e.key)) {
          e.preventDefault()
          execute((d) => deleteFilmClip(d, clip.id, e.shiftKey))
        }
      }}
    >
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-border px-2 py-1 md:flex-wrap md:overflow-visible">
        <button
          className={button}
          aria-label={state.playing ? '暂停成片' : '播放成片'}
          disabled={state.exporting || !total}
          onClick={play}
        >
          {state.playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <label className="flex items-center gap-1">
          成片帧
          <input
            aria-label="成片帧"
            className={`${field} w-24`}
            type="number"
            min={0}
            step={1}
            value={state.filmFrame}
            onChange={(e) => seek(Number(e.target.value))}
          />
        </label>
        <span className="px-2 tabular-nums text-muted-foreground">
          {(total / data.fps).toFixed(2)} 秒 · {data.fps} 帧/秒
        </span>
        <button className={button} disabled={blocked} onClick={addTrack}>
          <Plus size={14} />
          视频轨道
        </button>
        <button
          className={button}
          disabled={blocked || !clip}
          onClick={() => clip && execute((d) => splitFilmClip(d, clip.id, state.filmFrame))}
        >
          <Scissors size={14} />
          拆分
        </button>
        <button
          className={button}
          disabled={blocked || !clip}
          onClick={() => clip && execute((d) => duplicateFilmClip(d, clip.id))}
        >
          复制
        </button>
        <button
          className={button}
          disabled={blocked || !clip}
          onClick={() => clip && execute((d) => deleteFilmClip(d, clip.id))}
        >
          删除
        </button>
        <button
          className={button}
          disabled={blocked || !clip}
          onClick={() => clip && execute((d) => deleteFilmClip(d, clip.id, true))}
        >
          波纹删除
        </button>
        <label className="flex items-center gap-1 px-2">
          <input type="checkbox" checked={ripple} onChange={(e) => setRipple(e.target.checked)} />
          波纹修剪
        </label>
        <label className="flex items-center gap-1">
          缩放
          <input
            aria-label="成片时间轴缩放"
            className="w-20"
            type="range"
            min={0.25}
            max={4}
            step={0.25}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        <span className="flex-1" />
        <select
          aria-label="项目帧率"
          className={field}
          disabled={blocked}
          value={data.fps}
          onChange={(e) => execute((d) => ({ ...d, fps: Number(e.target.value) as 24 | 30 }))}
        >
          <option value={24}>24 帧/秒</option>
          <option value={30}>30 帧/秒</option>
        </select>
        <select
          aria-label="成片分辨率"
          className={field}
          disabled={blocked}
          value={data.resolution}
          onChange={(e) =>
            execute((d) => ({ ...d, resolution: Number(e.target.value) as 720 | 1080 }))
          }
        >
          <option value={720}>720p</option>
          <option value={1080}>1080p</option>
        </select>
        <button
          className={`${button} bg-primary text-primary-foreground hover:bg-primary/90`}
          disabled={!total}
          onClick={() => (state.exporting ? state.cancelExport?.() : void exportFilm())}
        >
          {state.exporting ? `取消 ${Math.round(state.progress * 100)}%` : '导出成片 MP4'}
        </button>
        {state.filmExportUrl && !state.exporting && (
          <a className={button} href={state.filmExportUrl} download="film.mp4">
            下载已导出视频
          </a>
        )}
        <button className={button} disabled={state.exporting} onClick={hideSceneTimeline}>
          收起
        </button>
      </div>
      <div className="flex shrink-0 gap-1 border-b border-border px-2 md:hidden">
        <button
          className={button}
          aria-expanded={showSources}
          onClick={() => {
            setShowSources(!showSources)
            setShowSettings(false)
          }}
        >
          相机素材
        </button>
        <button
          className={button}
          disabled={!clip}
          aria-expanded={showSettings}
          onClick={() => {
            setShowSettings(!showSettings)
            setShowSources(false)
          }}
        >
          片段设置
        </button>
        <span className="self-center text-muted-foreground">工具栏可横向滚动</span>
      </div>
      <div className="relative flex min-h-0 flex-1">
        <aside
          className={`${showSources ? 'flex' : 'hidden'} absolute inset-y-0 left-0 z-30 w-48 shrink-0 flex-col border-r border-border bg-background md:static md:flex`}
          aria-label="相机素材目录"
        >
          <header className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
            <strong>相机素材</strong>
            <span className="text-muted-foreground">{catalog.length} 段</span>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {catalog.length ? (
              catalog.map((s) => (
                <button
                  key={s.id}
                  draggable={!blocked}
                  onDragStart={(e) => e.dataTransfer.setData('application/x-film-source', s.id)}
                  className={`mb-1 w-full rounded border px-2 py-2 text-left hover:bg-accent ${selectedSource?.id === s.id ? 'border-primary bg-accent' : 'border-transparent'}`}
                  aria-pressed={selectedSource?.id === s.id}
                  onClick={() => setSourceId(s.id)}
                  onDoubleClick={() => openFilmSource(s.id)}
                >
                  <span className="block truncate font-medium">{s.name}</span>
                  <span className="block pt-1 tabular-nums text-muted-foreground">
                    {(s.start / data.fps).toFixed(2)}–{(s.end / data.fps).toFixed(2)} 秒
                  </span>
                </button>
              ))
            ) : (
              <p className="p-3 leading-relaxed text-muted-foreground">
                在相机工作区创建两个关键帧后，这里会自动生成素材。
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-1 border-t border-border p-1">
            <button
              className={button}
              disabled={blocked || !selectedSource}
              onClick={() => add('insert')}
            >
              插入
            </button>
            <button
              className={button}
              disabled={blocked || !selectedSource}
              onClick={() => add('overwrite')}
            >
              覆盖
            </button>
          </div>
        </aside>
        <div
          className="min-h-40 min-w-0 flex-1 overflow-auto"
          role="group"
          aria-label="成片多轨时间轴"
        >
          <div style={{ width: Math.max(600, max * pixels + 168) }}>
            <div className="sticky top-0 z-20 flex h-8 border-b border-border bg-background">
              <div className="sticky left-0 z-30 w-40 shrink-0 bg-background px-3 py-2 text-muted-foreground">
                上层画面优先
              </div>
              <div
                className="relative flex-1 cursor-col-resize"
                onPointerDown={(e) =>
                  seek((e.clientX - e.currentTarget.getBoundingClientRect().left) / pixels)
                }
              >
                {Array.from({ length: Math.ceil(max / rulerStep) }, (_, i) => (
                  <span
                    key={i}
                    className="absolute inset-y-0 border-l border-border pl-1 pt-1 tabular-nums text-muted-foreground"
                    style={{ left: i * rulerStep * pixels }}
                  >
                    {(i * rulerStep) / data.fps}秒
                  </span>
                ))}
              </div>
            </div>
            {[...data.sequence.tracks].reverse().map((t) => (
              <div key={t.id} className="flex h-16 border-b border-border">
                <div
                  className={`sticky left-0 z-10 flex w-40 shrink-0 flex-col justify-center border-r border-border px-2 ${track?.id === t.id ? 'bg-accent' : 'bg-background'}`}
                >
                  <button
                    className="truncate text-left font-medium"
                    onClick={() => useSceneAnimation.setState({ filmTrackId: t.id })}
                  >
                    {t.name}
                  </button>
                  <div className="flex items-center">
                    <button
                      className={button}
                      aria-label={`${t.name} 显示`}
                      aria-pressed={t.visible}
                      disabled={blocked}
                      onClick={() => patchTrack(t.id, { visible: !t.visible })}
                    >
                      {t.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                    <button
                      className={button}
                      aria-label={`${t.name} 编辑锁定`}
                      aria-pressed={t.locked}
                      disabled={blocked}
                      onClick={() => patchTrack(t.id, { locked: !t.locked })}
                    >
                      {t.locked ? <LockKeyhole size={12} /> : <UnlockKeyhole size={12} />}
                    </button>
                    <button
                      className={`${button} px-1 aria-pressed:text-primary`}
                      aria-label={`${t.name} 同步锁定`}
                      aria-pressed={t.syncLocked}
                      disabled={blocked || t.locked}
                      onClick={() => patchTrack(t.id, { syncLocked: !t.syncLocked })}
                    >
                      同步
                    </button>
                    <button
                      className={`${button} px-1`}
                      aria-label={`${t.name} 上移`}
                      disabled={blocked || t.locked}
                      onClick={() => reorder(t.id, 1)}
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button
                      className={`${button} px-1`}
                      aria-label={`${t.name} 下移`}
                      disabled={blocked || t.locked}
                      onClick={() => reorder(t.id, -1)}
                    >
                      <ArrowDown size={12} />
                    </button>
                  </div>
                </div>
                <div
                  className={`relative flex-1 ${!t.visible ? 'opacity-45' : ''}`}
                  data-film-lane={t.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    const id = e.dataTransfer.getData('application/x-film-source')
                    if (id)
                      add(
                        'overwrite',
                        id,
                        Math.max(
                          0,
                          Math.round(
                            (e.clientX - e.currentTarget.getBoundingClientRect().left) / pixels,
                          ),
                        ),
                        t.id,
                      )
                  }}
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) {
                      seek((e.clientX - e.currentTarget.getBoundingClientRect().left) / pixels)
                      useSceneAnimation.setState({ filmTrackId: t.id, filmClipId: null })
                    }
                  }}
                >
                  {t.clips.map((c) => {
                    const source = data.sources.find((s) => s.id === c.sourceId),
                      unavailable = filmClipUnavailable(c, source)
                    const moved = drag?.id === c.id ? drag : null,
                      left = moved && !moved.edge ? moved.frame : c.start
                    return (
                      <div
                        key={c.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`片段 ${source?.name ?? c.id}`}
                        aria-pressed={clip?.id === c.id}
                        data-film-clip={c.id}
                        className={`absolute top-2 h-11 overflow-hidden rounded border bg-sky-950 px-3 py-1 text-sky-100 touch-none ${clip?.id === c.id ? 'border-sky-300 ring-1 ring-sky-300' : 'border-sky-700'} ${unavailable ? 'border-amber-400' : ''}`}
                        style={{
                          left: left * pixels,
                          width: Math.max(10, filmClipDuration(c) * pixels),
                        }}
                        onPointerDown={(e) => startDrag(e, c.id)}
                        onClick={() =>
                          useSceneAnimation.setState({ filmClipId: c.id, filmTrackId: t.id })
                        }
                        onDoubleClick={() =>
                          openFilmSource(
                            c.sourceId,
                            filmClipSourceFrame(
                              c,
                              Math.max(c.start, Math.min(filmClipEnd(c) - 1, state.filmFrame)),
                            ),
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') openFilmSource(c.sourceId, c.in)
                          if (e.code === 'Space') {
                            e.preventDefault()
                            e.stopPropagation()
                            useSceneAnimation.setState({ filmClipId: c.id, filmTrackId: t.id })
                          }
                        }}
                      >
                        <span className="block truncate">{source?.name ?? '来源缺失'}</span>
                        <span className="block truncate text-[10px]">
                          {c.reverse ? '倒放 · ' : ''}
                          {c.rate !== 1 ? `${Math.round(c.rate * 100)}% · ` : ''}
                          {unavailable
                            ? '范围不足 · 黑场'
                            : `${(filmClipDuration(c) / data.fps).toFixed(2)} 秒`}
                        </span>
                        <button
                          aria-label="修剪入点"
                          className="absolute inset-y-0 left-0 w-2 cursor-col-resize bg-white/10 hover:bg-white/30"
                          onPointerDown={(e) => startDrag(e, c.id, 'in')}
                        />
                        <button
                          aria-label="修剪出点"
                          className="absolute inset-y-0 right-0 w-2 cursor-col-resize bg-white/10 hover:bg-white/30"
                          onPointerDown={(e) => startDrag(e, c.id, 'out')}
                        />
                      </div>
                    )
                  })}
                  {t.transitions.map((tr) => {
                    const c = t.clips.find((c) => c.id === tr.clipId)!
                    const at =
                      tr.kind === 'fade-in'
                        ? c.start
                        : filmClipEnd(c) -
                          (tr.kind === 'dissolve' ? Math.floor(tr.frames / 2) : tr.frames)
                    return (
                      <button
                        key={tr.id}
                        title="点击移除转场"
                        className="absolute bottom-0 z-[2] h-4 truncate border border-amber-500 bg-amber-950 px-1 text-[10px] text-amber-200"
                        style={{ left: at * pixels, width: tr.frames * pixels }}
                        disabled={blocked || t.locked}
                        onClick={() =>
                          patchTrack(t.id, {
                            transitions: t.transitions.filter((x) => x.id !== tr.id),
                          })
                        }
                      >
                        {tr.kind === 'dissolve' ? '叠化' : tr.kind === 'fade-in' ? '淡入' : '淡出'}
                        {tr.repeatEdges ? ' · 重复帧' : ''}
                      </button>
                    )
                  })}
                  <div
                    className="pointer-events-none absolute inset-y-0 z-[3] w-px bg-primary"
                    style={{ left: state.filmFrame * pixels }}
                  />
                  {drag && (
                    <div
                      className="pointer-events-none absolute inset-y-0 z-[4] border-l border-dashed border-amber-400"
                      style={{ left: drag.frame * pixels }}
                    />
                  )}
                </div>
              </div>
            ))}
            {!data.sequence.tracks.length && (
              <div className="p-6 text-muted-foreground">
                选择左侧相机素材，点击插入，开始编排成片。
              </div>
            )}
          </div>
        </div>
        {clip && selectedTrack && (
          <aside
            className={`${showSettings ? 'block' : 'hidden'} absolute inset-y-0 right-0 z-30 w-56 shrink-0 space-y-3 overflow-y-auto border-l border-border bg-background p-3 md:static md:block`}
            aria-label="片段设置"
          >
            <strong className="block truncate">{source?.name}</strong>
            <fieldset className="space-y-2" disabled={blocked || selectedTrack.locked}>
              <FrameField
                label="成片起点"
                value={clip.start}
                onChange={(v) => execute((d) => moveFilmClip(d, clip.id, selectedTrack.id, v))}
              />
              <FrameField
                label="源入点"
                value={clip.in}
                onChange={(v) =>
                  execute((d) =>
                    trimFilmClip(
                      d,
                      clip.id,
                      clip.reverse ? 'out' : 'in',
                      clip.reverse
                        ? filmClipEnd(clip) + (clip.in - v) / clip.rate
                        : clip.start + (v - clip.in) / clip.rate,
                      ripple,
                    ),
                  )
                }
              />
              <FrameField
                label="源出点"
                value={clip.out}
                onChange={(v) =>
                  execute((d) =>
                    trimFilmClip(
                      d,
                      clip.id,
                      clip.reverse ? 'in' : 'out',
                      clip.reverse
                        ? clip.start + (clip.out - v) / clip.rate
                        : filmClipEnd(clip) + (v - clip.out) / clip.rate,
                      ripple,
                    ),
                  )
                }
              />
              <p className="text-muted-foreground">
                源入出点以素材内帧数保存；出点不包含在片段中。
              </p>
              <label className="flex items-center justify-between">
                速度 %
                <input
                  aria-label="片段速度百分比"
                  className={`${field} w-24`}
                  type="number"
                  min={1}
                  max={10000}
                  value={speed}
                  onChange={(e) => setSpeed(e.target.value)}
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={reverse}
                  onChange={(e) => setReverse(e.target.checked)}
                />
                倒放
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={shift}
                  onChange={(e) => setShift(e.target.checked)}
                />
                波纹移动后续片段
              </label>
              <button
                className={`${button} border border-border`}
                onClick={() =>
                  execute((d) => setFilmClipSpeed(d, clip.id, Number(speed) / 100, reverse, shift))
                }
              >
                应用速度
              </button>
              <div className="space-y-2 border-t border-border pt-3">
                <strong>转场</strong>
                <FrameField
                  label="转场帧数"
                  value={transitionFrames}
                  onChange={setTransitionFrames}
                />
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={repeatEdges}
                    onChange={(e) => setRepeatEdges(e.target.checked)}
                  />
                  余量不足时重复边界帧
                </label>
                <div className="flex flex-wrap gap-1">
                  {(['dissolve', 'fade-in', 'fade-out'] as const).map((kind, i) => (
                    <button
                      key={kind}
                      className={`${button} border border-border`}
                      onClick={() => transition(kind)}
                    >
                      {['叠化', '淡入', '淡出'][i]}
                    </button>
                  ))}
                </div>
              </div>
            </fieldset>
            <button className={button} onClick={() => openFilmSource(clip.sourceId, clip.in)}>
              打开源工作区
            </button>
          </aside>
        )}
      </div>
    </div>
  )
}
function FrameField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (n: number) => void
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      {label}
      <input
        key={value}
        aria-label={label}
        type="number"
        step={1}
        min={0}
        defaultValue={value}
        className={`${field} w-24`}
        onBlur={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n) && n !== value) onChange(Math.round(n))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
    </label>
  )
}
