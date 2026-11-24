import { z } from 'zod'
import { objectId } from './base'

export const FilmFrame = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const FilmShot = z.object({
  id: objectId('shot'),
  name: z.string().min(1),
  cameraId: z.string().nullable(),
})
export type FilmShot = z.infer<typeof FilmShot>
export const FilmSource = z.object({
  id: z.string().min(1),
  shotId: z.string(),
  name: z.string(),
  start: FilmFrame,
  end: FilmFrame,
  fromKeyId: z.string().nullable().default(null),
  toKeyId: z.string().nullable().default(null),
})
export type FilmSource = z.infer<typeof FilmSource>
export const FilmClip = z.object({
  id: objectId('clip'),
  sourceId: z.string(),
  start: FilmFrame,
  in: FilmFrame,
  out: FilmFrame,
  rate: z.number().finite().positive().max(100).default(1),
  reverse: z.boolean().default(false),
  phase: z.number().min(0).lt(1).default(0),
  duration: FilmFrame.refine((n) => n > 0).optional(),
})
export type FilmClip = z.infer<typeof FilmClip>
export const FilmTransition = z.object({
  id: objectId('transition'),
  kind: z.enum(['dissolve', 'fade-in', 'fade-out']),
  clipId: z.string(),
  nextClipId: z.string().nullable().default(null),
  frames: FilmFrame.refine((n) => n > 0),
  repeatEdges: z.boolean().default(false),
})
export type FilmTransition = z.infer<typeof FilmTransition>
export const FilmTrack = z.object({
  id: objectId('video-track'),
  name: z.string(),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  syncLocked: z.boolean().default(true),
  clips: z.array(FilmClip).default([]),
  transitions: z.array(FilmTransition).default([]),
})
export type FilmTrack = z.infer<typeof FilmTrack>
export const FilmSequence = z.object({ tracks: z.array(FilmTrack).default([]) })
export type FilmSequence = z.infer<typeof FilmSequence>

export function filmClipDuration(clip: FilmClip) {
  return (
    clip.duration ?? Math.max(1, Math.ceil((clip.out - clip.in - clip.phase) / clip.rate - 1e-7))
  )
}
export function filmClipEnd(clip: FilmClip) {
  return clip.start + filmClipDuration(clip)
}
export function filmDuration(sequence: FilmSequence) {
  return Math.max(0, ...sequence.tracks.flatMap((track) => track.clips.map(filmClipEnd)))
}
export function validateFilm(
  film: { shots: FilmShot[]; sources: FilmSource[]; sequence: FilmSequence },
  context: z.RefinementCtx,
) {
  const fail = (message: string) => context.addIssue({ code: 'custom', message })
  const ids = new Set<string>(),
    cameras = new Set<string>()
  const unique = (id: string) => {
    if (ids.has(id)) fail('Duplicate film ID')
    ids.add(id)
  }
  for (const shot of film.shots) {
    unique(shot.id)
    if (shot.cameraId) {
      if (cameras.has(shot.cameraId)) fail('A camera can belong to only one shot')
      cameras.add(shot.cameraId)
    }
  }
  for (const source of film.sources) {
    unique(source.id)
    if (source.end < source.start || !film.shots.some((s) => s.id === source.shotId && s.cameraId))
      fail('Invalid film source')
  }
  for (const track of film.sequence.tracks) {
    unique(track.id)
    const clips = [...track.clips].sort((a, b) => a.start - b.start)
    for (const [i, clip] of clips.entries()) {
      unique(clip.id)
      if (clip.out <= clip.in || !film.sources.some((s) => s.id === clip.sourceId))
        fail('Invalid film clip')
      if (!Number.isSafeInteger(filmClipDuration(clip)) || !Number.isSafeInteger(filmClipEnd(clip)))
        fail('Clip duration exceeds the supported integer frame range')
      if (
        clip.duration &&
        clip.phase + (clip.duration - 1) * clip.rate >= clip.out - clip.in + 1e-7
      )
        fail('Clip duration exceeds its source in/out range')
      if (i > 0 && filmClipEnd(clips[i - 1]!) > clip.start)
        fail('Clips on one track must not overlap')
    }
    const ranges: [number, number][] = []
    for (const transition of track.transitions) {
      unique(transition.id)
      const a = clips.find((c) => c.id === transition.clipId)
      const b = clips.find((c) => c.id === transition.nextClipId)
      if (!a) {
        fail('Missing transition clip')
        continue
      }
      let start: number, end: number
      if (transition.kind === 'dissolve') {
        if (!b || filmClipEnd(a) !== b.start) {
          fail('Dissolve requires adjacent clips')
          continue
        }
        start = filmClipEnd(a) - Math.floor(transition.frames / 2)
        end = start + transition.frames
        if (start < a.start || end > filmClipEnd(b)) fail('Transition is longer than its clips')
      } else {
        start = transition.kind === 'fade-in' ? a.start : filmClipEnd(a) - transition.frames
        end = start + transition.frames
        if (transition.frames > filmClipDuration(a)) fail('Fade is longer than its clip')
      }
      if (ranges.some(([s, e]) => start < e && end > s)) fail('Transitions must not overlap')
      ranges.push([start, end])
    }
  }
}
