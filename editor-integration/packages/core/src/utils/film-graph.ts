import { ensureFilmShots, removeFilmShot } from '../lib/film-sources'
import type { AnyNode, AnyNodeId } from '../schema'
import { SceneAnimation } from '../schema/scene-animation'
import { migrateFilmAnimation } from './film-migration'

export function removeMissingAnimationTracks(
  animation: SceneAnimation,
  nodes: Record<AnyNodeId, AnyNode>,
): SceneAnimation {
  const tracks = animation.tracks.filter((track) => nodes[track.nodeId as AnyNodeId])
  const exists = (id: string | null | undefined) =>
    !id || nodes[id as AnyNodeId]?.type === 'scene-camera'
  const missingCamera =
    !exists(animation.activeCameraId) || animation.cameraMarkers?.some((m) => !exists(m.cameraId))
  if (tracks.length === animation.tracks.length && !missingCamera) return animation
  return {
    ...animation,
    tracks,
    ...(animation.activeCameraId !== undefined
      ? { activeCameraId: exists(animation.activeCameraId) ? animation.activeCameraId : null }
      : {}),
    ...(animation.cameraMarkers
      ? {
          cameraMarkers: animation.cameraMarkers.map((m) =>
            exists(m.cameraId) ? m : { ...m, cameraId: null },
          ),
        }
      : {}),
  }
}

export function reconcileFilmGraph(
  previous: Record<AnyNodeId, AnyNode>,
  nodes: Record<AnyNodeId, AnyNode>,
) {
  const changed: AnyNodeId[] = []
  const cameras = Object.values(nodes).filter((n) => n.type === 'scene-camera')
  for (const site of Object.values(nodes)) {
    if (site.type !== 'site' || !site.animation) continue
    let animation: SceneAnimation
    try {
      animation = migrateFilmAnimation(site.animation)
    } catch (error) {
      const old = previous[site.id]
      if (old?.type === 'site' && old.animation === site.animation) continue
      throw error
    }
    for (const shot of animation.shots) {
      if (!shot.cameraId || nodes[shot.cameraId as AnyNodeId]?.type === 'scene-camera') continue
      if (previous[shot.cameraId as AnyNodeId]?.type === 'scene-camera') {
        animation = removeFilmShot(animation, shot.id)
        continue
      }
      const old = previous[site.id]
      let inheritedCameraId: string | null | undefined
      if (old?.type === 'site' && old.animation) {
        try {
          inheritedCameraId = migrateFilmAnimation(old.animation).shots.find(
            (s) => s.id === shot.id,
          )?.cameraId
        } catch {}
      }
      // Existing dangling references must not block unrelated edits or silently delete used clips.
      if (inheritedCameraId !== shot.cameraId) throw new Error('工作区引用的相机不存在')
    }
    animation = SceneAnimation.parse(
      ensureFilmShots(removeMissingAnimationTracks(animation, nodes), cameras),
    )
    if (JSON.stringify(animation) === JSON.stringify(site.animation)) continue
    nodes[site.id] = { ...site, animation }
    changed.push(site.id)
  }
  return changed
}
