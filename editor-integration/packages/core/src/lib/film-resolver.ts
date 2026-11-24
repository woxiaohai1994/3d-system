import {
  type FilmClip,
  type FilmSource,
  type FilmTransition,
  filmClipDuration,
  filmClipEnd,
} from '../schema/film'
import type { SceneAnimation } from '../schema/scene-animation'

export type FilmSample = {
  clipId: string
  sourceId: string
  cameraId: string | null
  sourceTime: number
  weight: number
  black: boolean
  repeated: boolean
}
export type FilmFrameResult = { frame: number; samples: FilmSample[]; warnings: string[] }
export function filmClipSourceFrame(clip: FilmClip, frame: number) {
  const offset = Math.floor((clip.phase ?? 0) + (frame - clip.start) * clip.rate + 1e-7)
  return clip.reverse ? clip.out - 1 - offset : clip.in + offset
}
function sample(
  animation: SceneAnimation,
  clip: FilmClip,
  frame: number,
  weight: number,
  repeat = false,
): FilmSample {
  const source = animation.sources.find((s) => s.id === clip.sourceId)
  const cameraId = animation.shots.find((s) => s.id === source?.shotId)?.cameraId ?? null
  const local = filmClipSourceFrame(clip, frame),
    length = source ? source.end - source.start : 0
  const outside = local < -1e-7 || local >= length - 1e-7
  const repeated = !!(outside && repeat && length > 0)
  return {
    clipId: clip.id,
    sourceId: clip.sourceId,
    cameraId,
    sourceTime:
      ((source?.start ?? 0) + (repeated ? Math.max(0, Math.min(length - 1, local)) : local)) /
      animation.fps,
    weight,
    black: !cameraId || !length || (outside && !repeated),
    repeated,
  }
}
export function filmTransitionRange(transition: FilmTransition, clip: FilmClip): [number, number] {
  const start =
    transition.kind === 'fade-in'
      ? clip.start
      : filmClipEnd(clip) -
        (transition.kind === 'dissolve' ? Math.floor(transition.frames / 2) : transition.frames)
  return [start, start + transition.frames]
}
export function filmTransitionNeedsHandles(
  animation: SceneAnimation,
  transition: FilmTransition,
  clips: FilmClip[],
) {
  if (transition.kind !== 'dissolve') return false
  const a = clips.find((c) => c.id === transition.clipId),
    b = clips.find((c) => c.id === transition.nextClipId)
  if (!a || !b) return true
  const [start, end] = filmTransitionRange(transition, a)
  return [a, b].some((clip) =>
    [start, end - 1].some((frame) => sample(animation, clip, frame, 1).black),
  )
}
export function resolveFilmFrame(animation: SceneAnimation, frame: number): FilmFrameResult {
  const result: FilmFrameResult = { frame, samples: [], warnings: [] }
  for (const track of [...animation.sequence.tracks].reverse()) {
    if (!track.visible) continue
    for (const transition of track.transitions) {
      const a = track.clips.find((c) => c.id === transition.clipId)
      if (!a) continue
      const [start, end] = filmTransitionRange(transition, a)
      if (frame < start || frame >= end) continue
      const progress = transition.frames <= 1 ? 1 : (frame - start) / (transition.frames - 1)
      if (transition.kind === 'dissolve') {
        const b = track.clips.find((c) => c.id === transition.nextClipId)
        if (!b) continue
        result.samples = [
          sample(animation, a, frame, 1 - progress, transition.repeatEdges),
          sample(animation, b, frame, progress, transition.repeatEdges),
        ]
      } else
        result.samples = [
          sample(animation, a, frame, transition.kind === 'fade-in' ? progress : 1 - progress),
        ]
      result.warnings = result.samples
        .filter((s) => s.black || s.repeated)
        .map(
          (s) =>
            `${animation.sources.find((source) => source.id === s.sourceId)?.name ?? '素材'}：${s.black ? '超出有效源范围，显示黑场' : '转场余量不足，重复边界帧'}`,
        )
      return result
    }
    const clip = track.clips.find((c) => frame >= c.start && frame < filmClipEnd(c))
    if (clip) {
      result.samples = [sample(animation, clip, frame, 1)]
      if (result.samples[0]!.black)
        result.warnings.push(
          `${animation.sources.find((s) => s.id === clip.sourceId)?.name ?? '素材'}：超出有效源范围，显示黑场`,
        )
      return result
    }
  }
  return result
}
export function filmClipUnavailable(clip: FilmClip, source: FilmSource | undefined) {
  return (
    !source || clip.in < 0 || clip.out > source.end - source.start || filmClipDuration(clip) < 1
  )
}
