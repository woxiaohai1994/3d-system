import { generateId } from '../schema/base'
import {
  FilmClip,
  type FilmTrack,
  type FilmTransition,
  filmClipDuration,
  filmClipEnd,
} from '../schema/film'
import { SceneAnimation } from '../schema/scene-animation'
import { filmClipUnavailable, filmTransitionNeedsHandles } from './film-resolver'
import { reconcileFilmSources } from './film-sources'

export class FilmEditError extends Error {}
const fail = (message: string): never => {
  throw new FilmEditError(message)
}
function editable(track: FilmTrack) {
  if (track.locked) fail(`${track.name} 已锁定，请先解锁`)
}
function locate(animation: SceneAnimation, id: string) {
  for (const track of animation.sequence.tracks) {
    const clip = track.clips.find((c) => c.id === id)
    if (clip) {
      editable(track)
      return { track, clip }
    }
  }
  return fail('素材片段不存在')
}
function finish(animation: SceneAnimation): SceneAnimation {
  for (const track of animation.sequence.tracks) {
    track.clips.sort((a, b) => a.start - b.start)
    track.transitions = track.transitions.filter((t) => {
      const a = track.clips.find((c) => c.id === t.clipId)
      const b = track.clips.find((c) => c.id === t.nextClipId)
      if (!a || (t.kind === 'dissolve' && (!b || filmClipEnd(a) !== b.start))) return false
      return true
    })
  }
  const parsed = SceneAnimation.safeParse(reconcileFilmSources(animation))
  if (!parsed.success) return fail(parsed.error.issues.map((i) => i.message).join('；'))
  return parsed.data
}
function copy(animation: SceneAnimation) {
  return structuredClone(animation)
}
export function sliceFilmClip(clip: FilmClip, start: number, end: number, id = clip.id): FilmClip {
  const a = clip.phase + (start - clip.start) * clip.rate
  const b = clip.phase + (end - clip.start) * clip.rate
  const advance = Math.floor(a + 1e-7),
    phase = Math.max(0, a - advance)
  return {
    ...clip,
    id,
    start,
    phase,
    duration: end - start,
    in: clip.reverse ? Math.max(clip.in, clip.out - Math.ceil(b - 1e-7)) : clip.in + advance,
    out: clip.reverse ? clip.out - advance : Math.min(clip.out, clip.in + Math.ceil(b - 1e-7)),
  }
}
function overwrite(track: FilmTrack, start: number, end: number) {
  track.clips = track.clips.flatMap((clip) => {
    if (clip.start >= end || filmClipEnd(clip) <= start) return [clip]
    const result: FilmClip[] = []
    if (clip.start < start) result.push(sliceFilmClip(clip, clip.start, start))
    if (filmClipEnd(clip) > end)
      result.push(sliceFilmClip(clip, end, filmClipEnd(clip), generateId('clip')))
    return result
  })
}
function requireSource(animation: SceneAnimation, clip: FilmClip) {
  if (
    filmClipUnavailable(
      clip,
      animation.sources.find((s) => s.id === clip.sourceId),
    )
  )
    fail('源素材范围不足，请先调整入出点')
}
function ripple(
  animation: SceneAnimation,
  point: number,
  delta: number,
  owner: string,
  exclude: Set<string>,
  splitCrossing: boolean,
) {
  if (!delta) return
  for (const track of animation.sequence.tracks) {
    if (track.id !== owner && !track.syncLocked) continue
    const affected = track.clips.some(
      (c) => !exclude.has(c.id) && filmClipEnd(c) > Math.min(point, point + delta),
    )
    if (affected) editable(track)
    track.clips = track.clips.flatMap((clip) => {
      if (exclude.has(clip.id) || filmClipEnd(clip) <= Math.min(point, point + delta)) return [clip]
      if (clip.start >= point) {
        const next = { ...clip, start: clip.start + delta }
        if (next.start < 0) fail('波纹编辑超出时间轴起点')
        return [next]
      }
      if (!splitCrossing) fail(`${track.name} 有片段跨越删除范围，无法收紧；可使用普通删除`)
      const end = filmClipEnd(clip)
      const cut = Math.min(point, end)
      const result: FilmClip[] = []
      if (delta > 0) {
        const left = sliceFilmClip(clip, clip.start, cut)
        if (clip.reverse) left.in -= Math.round(delta * clip.rate)
        else left.out += Math.round(delta * clip.rate)
        left.duration = cut - clip.start + delta
        requireSource(animation, left)
        result.push(left)
      } else if (clip.start < point + delta) {
        result.push(sliceFilmClip(clip, clip.start, Math.min(end, point + delta)))
      }
      if (end > point) {
        const right = sliceFilmClip(clip, point, end, generateId('clip'))
        result.push({ ...right, start: point + delta })
      }
      return result
    })
  }
}
export function addFilmClip(
  animation: SceneAnimation,
  trackId: string,
  sourceId: string,
  start: number,
  mode: 'overwrite' | 'insert' = 'overwrite',
) {
  const next = copy(animation),
    track = next.sequence.tracks.find((t) => t.id === trackId)
  const source = next.sources.find((s) => s.id === sourceId)
  if (!track || !source || source.end <= source.start) return fail('请选择有效素材和视频轨道')
  editable(track)
  const clip = FilmClip.parse({
    sourceId,
    start: Math.round(start),
    in: 0,
    out: source.end - source.start,
  })
  if (mode === 'insert') {
    // Insert splits crossing clips and makes room, without extending their source footage.
    for (const other of next.sequence.tracks) {
      if (other.id !== trackId && !other.syncLocked) continue
      if (other.clips.some((c) => filmClipEnd(c) > clip.start)) editable(other)
      other.clips = other.clips.flatMap((c) => {
        if (filmClipEnd(c) <= clip.start) return [c]
        if (c.start >= clip.start) return [{ ...c, start: c.start + filmClipDuration(clip) }]
        return [
          sliceFilmClip(c, c.start, clip.start),
          {
            ...sliceFilmClip(c, clip.start, filmClipEnd(c), generateId('clip')),
            start: clip.start + filmClipDuration(clip),
          },
        ]
      })
    }
  } else overwrite(track, clip.start, filmClipEnd(clip))
  track.clips.push(clip)
  return finish(next)
}
export function moveFilmClip(
  animation: SceneAnimation,
  id: string,
  trackId: string,
  start: number,
) {
  const next = copy(animation),
    { track, clip } = locate(next, id)
  const target = next.sequence.tracks.find((t) => t.id === trackId)
  if (!target) return fail('视频轨道不存在')
  editable(target)
  track.clips = track.clips.filter((c) => c.id !== id)
  const moved = { ...clip, start: Math.max(0, Math.round(start)) }
  overwrite(target, moved.start, filmClipEnd(moved))
  target.clips.push(moved)
  return finish(next)
}
export function splitFilmClip(animation: SceneAnimation, id: string, frame: number) {
  const next = copy(animation),
    { track, clip } = locate(next, id)
  frame = Math.round(frame)
  if (frame <= clip.start || frame >= filmClipEnd(clip)) return fail('播放头需位于片段内部')
  const right = sliceFilmClip(clip, frame, filmClipEnd(clip), generateId('clip'))
  const left = sliceFilmClip(clip, clip.start, frame)
  if (left.out <= left.in || right.out <= right.in) return fail('拆分后每段至少需要一帧源画面')
  track.clips.splice(track.clips.indexOf(clip), 1, left, right)
  track.transitions = track.transitions.map((t) =>
    t.clipId === id && t.kind !== 'fade-in' ? { ...t, clipId: right.id } : t,
  )
  return finish(next)
}
export function duplicateFilmClip(animation: SceneAnimation, id: string) {
  const next = copy(animation),
    { track, clip } = locate(next, id)
  const duplicated = {
    ...clip,
    id: generateId('clip'),
    start: Math.max(...track.clips.map(filmClipEnd), 0),
  }
  track.clips.push(duplicated)
  return finish(next)
}
export function deleteFilmClip(animation: SceneAnimation, id: string, rippleDelete = false) {
  const next = copy(animation),
    { track, clip } = locate(next, id)
  if (rippleDelete) {
    for (const other of next.sequence.tracks) {
      if (other.id !== track.id && !other.syncLocked) continue
      if (
        other.clips.some(
          (c) => c.id !== id && c.start < filmClipEnd(clip) && filmClipEnd(c) > clip.start,
        )
      )
        fail(`${other.name} 在此范围仍有画面，请使用普通删除`)
    }
    ripple(next, filmClipEnd(clip), -filmClipDuration(clip), track.id, new Set([id]), false)
  }
  track.clips = track.clips.filter((c) => c.id !== id)
  return finish(next)
}
export function trimFilmClip(
  animation: SceneAnimation,
  id: string,
  edge: 'in' | 'out',
  frame: number,
  rippleTrim = false,
) {
  const next = copy(animation),
    { track, clip } = locate(next, id)
  frame = Math.round(frame)
  const oldEnd = filmClipEnd(clip),
    oldDuration = filmClipDuration(clip)
  const start = edge === 'in' ? frame : clip.start
  const end = edge === 'out' ? frame : oldEnd
  if (start < 0 || end <= start) return fail('入出点无效，片段至少保留一帧')
  const a = clip.phase + (start - clip.start) * clip.rate
  const b = clip.phase + (end - clip.start) * clip.rate
  const advance = Math.floor(a + 1e-7)
  const edited = {
    ...clip,
    start: rippleTrim ? clip.start : start,
    duration: end - start,
    phase: Math.max(0, a - advance),
    in: clip.reverse ? clip.out - Math.ceil(b - 1e-7) : clip.in + advance,
    out: clip.reverse ? clip.out - advance : clip.in + Math.ceil(b - 1e-7),
  }
  if (edited.in < 0 || edited.out <= edited.in) return fail('入出点无效，片段至少保留一帧')
  requireSource(next, edited)
  if (rippleTrim)
    ripple(
      next,
      edge === 'in' ? clip.start : oldEnd,
      filmClipDuration(edited) - oldDuration,
      track.id,
      new Set([id]),
      true,
    )
  const currentTrack = next.sequence.tracks.find((t) => t.id === track.id)!
  currentTrack.clips = currentTrack.clips.map((c) => (c.id === id ? edited : c))
  return finish(next)
}
export function setFilmClipSpeed(
  animation: SceneAnimation,
  id: string,
  rate: number,
  reverse: boolean,
  shiftTrailing = false,
) {
  const next = copy(animation),
    { track, clip } = locate(next, id)
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100) return fail('速度需大于 0 且不超过 10000%')
  const edited = { ...clip, rate, reverse, duration: undefined, phase: 0 }
  if (shiftTrailing)
    ripple(
      next,
      filmClipEnd(clip),
      filmClipDuration(edited) - filmClipDuration(clip),
      track.id,
      new Set([id]),
      true,
    )
  track.clips = track.clips.map((c) => (c.id === id ? edited : c))
  return finish(next)
}
export function addFilmTransition(
  animation: SceneAnimation,
  trackId: string,
  transition: FilmTransition,
) {
  const next = copy(animation),
    track = next.sequence.tracks.find((t) => t.id === trackId)
  if (!track) return fail('视频轨道不存在')
  editable(track)
  if (filmTransitionNeedsHandles(next, transition, track.clips) && !transition.repeatEdges)
    return fail('转场余量不足：请裁剪素材，或允许重复边界帧')
  track.transitions = track.transitions.filter(
    (t) => !(t.clipId === transition.clipId && t.kind === transition.kind),
  )
  track.transitions.push(transition)
  return finish(next)
}

export function changeFilmFps(animation: SceneAnimation, fps: 24 | 30): SceneAnimation {
  if (animation.fps === fps) return animation
  const next = copy(animation),
    scale = fps / animation.fps,
    frame = (n: number) => Math.round(n * scale)
  next.fps = fps
  for (const track of next.tracks) {
    if (track.kind !== 'camera') continue
    for (const curve of track.propertyCurves ?? [])
      for (const key of curve.keys)
        for (const point of [key.co, key.left, key.right]) point[0] *= scale
  }
  next.sources = next.sources.map((s) => ({ ...s, start: frame(s.start), end: frame(s.end) }))
  for (const track of next.sequence.tracks) {
    track.clips = track.clips.map((c) => ({
      ...c,
      start: frame(c.start),
      in: frame(c.in),
      out: frame(c.out),
      phase: 0,
      duration: undefined,
    }))
    track.transitions = track.transitions.map((t) => ({
      ...t,
      frames: Math.max(1, frame(t.frames)),
    }))
  }
  return finish(next)
}
