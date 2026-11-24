import type { FilmShot, FilmSource } from '../schema/film'
import { cameraTracks, type SceneAnimation } from '../schema/scene-animation'

type CameraIdentity = { id: string; name?: string }
export function filmCatalog(animation: SceneAnimation): FilmSource[] {
  return animation.shots.flatMap((shot) => {
    const track = cameraTracks(animation).find((t) => t.nodeId === shot.cameraId)
    const sources: FilmSource[] = (track?.points ?? [])
      .slice(1)
      .map((point, i) => {
        const previous = track!.points[i]!
        return {
          id: `source_${shot.id}_${previous.id}_${point.id}`,
          shotId: shot.id,
          name: `${shot.name} · ${i + 1}`,
          start: Math.round(previous.time * animation.fps),
          end: Math.round(point.time * animation.fps),
          fromKeyId: previous.id,
          toKeyId: point.id,
        }
      })
      .filter((source) => source.end > source.start)
    let start = Infinity,
      end = -Infinity
    for (const curve of track?.propertyCurves ?? []) {
      if (!curve.keys.length) continue
      start = Math.min(start, curve.keys[0]!.co[0])
      end = Math.max(end, curve.keys.at(-1)!.co[0])
    }
    if (!Number.isFinite(start) || !Number.isFinite(end)) return sources
    start = Math.max(0, Math.round(start))
    end = Math.max(0, Math.round(end))
    const propertySource = (suffix: string, from: number, to: number): FilmSource[] =>
      to > from
        ? [
            {
              id: `source_${shot.id}_properties${suffix}`,
              shotId: shot.id,
              name: `${shot.name} · 属性动画`,
              start: from,
              end: to,
              fromKeyId: null,
              toKeyId: null,
            },
          ]
        : []
    if (!sources.length) return propertySource('', start, end)
    // Existing pose intervals already include property animation; add only uncovered ends.
    return [
      ...propertySource('_before', start, Math.min(end, sources[0]!.start)),
      ...sources,
      ...propertySource('_after', Math.max(start, sources.at(-1)!.end), end),
    ]
  })
}
export function reconcileFilmSources(animation: SceneAnimation): SceneAnimation {
  const used = new Set(animation.sequence.tracks.flatMap((t) => t.clips.map((c) => c.sourceId)))
  const sources = new Map(filmCatalog(animation).map((s) => [s.id, s]))
  for (const previous of animation.sources) {
    if (!used.has(previous.id) || sources.has(previous.id)) continue
    const shot = animation.shots.find((s) => s.id === previous.shotId)
    const track = cameraTracks(animation).find((t) => t.nodeId === shot?.cameraId)
    const from = track?.points.find((p) => p.id === previous.fromKeyId)
    const to = track?.points.find((p) => p.id === previous.toKeyId)
    const start = from ? Math.round(from.time * animation.fps) : previous.start
    const end = to ? Math.round(to.time * animation.fps) : previous.end
    sources.set(previous.id, {
      ...previous,
      start,
      end: Math.max(start, end),
      fromKeyId: from ? from.id : null,
      toKeyId: to ? to.id : null,
    })
  }
  return { ...animation, sources: [...sources.values()] }
}
export function ensureFilmShots(
  animation: SceneAnimation,
  cameras: CameraIdentity[],
): SceneAnimation {
  const ids = new Set(animation.shots.map((s) => s.cameraId))
  const added: FilmShot[] = cameras
    .filter((c) => !ids.has(c.id))
    .map((c, i) => ({
      id: `shot_${c.id}` as const,
      name: c.name || `相机工作区 ${animation.shots.length + i + 1}`,
      cameraId: c.id,
    }))
  if (!animation.shots.length && !added.length)
    added.push({ id: 'shot_default', name: '相机工作区 1', cameraId: null })
  return reconcileFilmSources({ ...animation, shots: [...animation.shots, ...added] })
}
export function removeFilmShot(animation: SceneAnimation, shotId: string, keepEmpty = false) {
  const sourceIds = new Set(animation.sources.filter((s) => s.shotId === shotId).map((s) => s.id))
  const shot = animation.shots.find((s) => s.id === shotId)
  return {
    ...animation,
    shots: keepEmpty
      ? animation.shots.map((s) => (s.id === shotId ? { ...s, cameraId: null } : s))
      : animation.shots.filter((s) => s.id !== shotId),
    sources: animation.sources.filter((s) => s.shotId !== shotId),
    tracks: animation.tracks.filter((t) => t.nodeId !== shot?.cameraId),
    sequence: {
      tracks: animation.sequence.tracks.map((track) => {
        const clips = track.clips.filter((c) => !sourceIds.has(c.sourceId))
        const ids = new Set<string>(clips.map((c) => c.id))
        return {
          ...track,
          clips,
          transitions: track.transitions.filter(
            (t) => ids.has(t.clipId) && (!t.nextClipId || ids.has(t.nextClipId)),
          ),
        }
      }),
    },
  }
}
