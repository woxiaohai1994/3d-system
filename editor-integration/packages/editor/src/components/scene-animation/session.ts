import { type SceneAnimation, type SceneCameraNode, useScene } from '@pascal-app/core'
import { z } from 'zod'
import { useSceneAnimation } from './store'

const Session = z.object({
  workspace: z.enum(['shot', 'film']),
  shotId: z.string().nullable(),
  time: z.number().min(0).max(600),
  filmFrame: z.number().int().nonnegative(),
  filmClipId: z.string().nullable(),
  filmTrackId: z.string().nullable(),
})
export function saveAnimationSession(siteId: string | undefined) {
  if (!siteId || typeof window === 'undefined') return
  const state = useSceneAnimation.getState()
  if (!state.open || state.exporting) return
  try {
    window.localStorage.setItem(`animation-session:${siteId}`, JSON.stringify(Session.parse(state)))
  } catch {
    /* An unavailable local store must not interrupt scene editing. */
  }
}
export function restoreAnimationSession(siteId: string, data: SceneAnimation) {
  if (typeof window === 'undefined') return
  try {
    const parsed = Session.safeParse(
      JSON.parse(window.localStorage.getItem(`animation-session:${siteId}`) ?? 'null'),
    )
    if (!parsed.success) return
    const saved = parsed.data,
      shot = data.shots.find((s) => s.id === saved.shotId) ?? data.shots[0]
    const cameraId =
      saved.workspace === 'shot' &&
      shot?.cameraId &&
      useScene.getState().nodes[shot.cameraId as SceneCameraNode['id']]?.type === 'scene-camera'
        ? shot.cameraId
        : null
    useSceneAnimation.setState({
      ...saved,
      shotId: shot?.id ?? null,
      cameraId: cameraId as SceneCameraNode['id'] | null,
      outputCameraId: cameraId,
      filmClipId: data.sequence.tracks.some((t) => t.clips.some((c) => c.id === saved.filmClipId))
        ? saved.filmClipId
        : null,
      filmTrackId: data.sequence.tracks.some((t) => t.id === saved.filmTrackId)
        ? saved.filmTrackId
        : null,
    })
  } catch {
    /* A stale session never changes the project document. */
  }
}
