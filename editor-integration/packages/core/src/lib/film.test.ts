import { expect, test } from 'bun:test'
import { CameraMotionPoint } from '../schema/camera-motion'
import { FilmClip, FilmTrack, FilmTransition, filmClipDuration, filmDuration } from '../schema/film'
import { MotionSegment } from '../schema/motion'
import { SceneAnimation } from '../schema/scene-animation'
import { migrateFilmAnimation } from '../utils/film-migration'
import {
  addFilmClip,
  addFilmTransition,
  changeFilmFps,
  deleteFilmClip,
  setFilmClipSpeed,
  splitFilmClip,
  trimFilmClip,
} from './film-edit'
import { resolveFilmFrame } from './film-resolver'
import { filmCatalog, reconcileFilmSources } from './film-sources'

function fixture() {
  return SceneAnimation.parse({
    shots: [
      { id: 'shot_a', name: 'A', cameraId: 'scene-camera_a' },
      { id: 'shot_b', name: 'B', cameraId: 'scene-camera_b' },
    ],
    sources: [
      { id: 'source_a', shotId: 'shot_a', name: 'A', start: 120, end: 360 },
      { id: 'source_b', shotId: 'shot_b', name: 'B', start: 240, end: 480 },
    ],
    sequence: {
      tracks: [
        FilmTrack.parse({
          name: 'V1',
          clips: [
            FilmClip.parse({ sourceId: 'source_a', start: 0, in: 0, out: 72 }),
            FilmClip.parse({ sourceId: 'source_b', start: 72, in: 24, out: 96 }),
          ],
        }),
      ],
    },
  })
}
test('migration preserves old cuts inside keys and static cameras without inventing keys', () => {
  const migrated = migrateFilmAnimation({
    version: 1,
    tracks: [],
    duration: 8,
    defaultCameraId: 'scene-camera_a',
    cuts: [{ id: 'cut_b', time: 3, cameraId: 'scene-camera_b' }],
    playbackRange: [1, 7],
  })
  expect(migrated.version).toBe(2)
  expect(migrated.shots).toHaveLength(2)
  expect(migrated.tracks).toEqual([])
  expect(filmDuration(migrated.sequence)).toBe(144)
  expect(resolveFilmFrame(migrated, 47).samples[0]?.cameraId).toBe('scene-camera_a')
  expect(resolveFilmFrame(migrated, 48).samples[0]?.cameraId).toBe('scene-camera_b')
  expect(resolveFilmFrame(migrated, 48).samples[0]?.sourceTime).toBe(3)
  expect(migrateFilmAnimation(migrated)).toEqual(migrated)
})
test('migration rejects malformed data instead of silently replacing with empty animation', () => {
  expect(() => migrateFilmAnimation({ version: 1, tracks: null })).toThrow()
  expect(() => migrateFilmAnimation({ version: 5, tracks: [] })).toThrow()
})
test('one camera cannot belong to two workspaces', () => {
  const a = fixture()
  a.shots[1]!.cameraId = a.shots[0]!.cameraId
  expect(SceneAnimation.safeParse(a).success).toBe(false)
})
test('API rejects speeds and positions that overflow the integer frame range', () => {
  const a = fixture(),
    clip = a.sequence.tracks[0]!.clips[0]!
  clip.rate = 1e-300
  expect(SceneAnimation.safeParse(a).success).toBe(false)
  clip.rate = 1
  clip.start = Number.MAX_SAFE_INTEGER
  expect(SceneAnimation.safeParse(a).success).toBe(false)
})
test('a clip at final 20 seconds samples the world at source 5 seconds', () => {
  const a = fixture()
  a.sequence.tracks[0]!.clips = [{ ...a.sequence.tracks[0]!.clips[0]!, start: 480 }]
  expect(resolveFilmFrame(a, 504).samples[0]?.sourceTime).toBe(6)
  expect(resolveFilmFrame(a, 552).samples).toHaveLength(0)
})
test('upper track covers lower, gaps reveal lower, hidden tracks are ignored', () => {
  const a = fixture()
  a.sequence.tracks.push(
    FilmTrack.parse({
      name: 'V2',
      clips: [FilmClip.parse({ sourceId: 'source_b', start: 24, in: 0, out: 24 })],
    }),
  )
  expect(resolveFilmFrame(a, 23).samples[0]?.cameraId).toBe('scene-camera_a')
  expect(resolveFilmFrame(a, 24).samples[0]?.cameraId).toBe('scene-camera_b')
  expect(resolveFilmFrame(a, 48).samples[0]?.cameraId).toBe('scene-camera_a')
  a.sequence.tracks[1]!.visible = false
  expect(resolveFilmFrame(a, 24).samples[0]?.cameraId).toBe('scene-camera_a')
})
test('shortened source shows black without altering instance or exposing the lower track', () => {
  const a = fixture(),
    clip = structuredClone(a.sequence.tracks[0]!.clips[0]!)
  a.sources[0]!.end = 144
  expect(resolveFilmFrame(a, 24).samples[0]?.black).toBe(true)
  expect(a.sequence.tracks[0]!.clips[0]).toEqual(clip)
})
test('reverse samples last valid frame first and split preserves its sampled sequence', () => {
  const a = fixture()
  a.sequence.tracks[0]!.clips[0]!.reverse = true
  const clip = a.sequence.tracks[0]!.clips[0]!,
    b = splitFilmClip(a, clip.id, 30)
  for (const frame of [0, 29, 30, 71])
    expect(resolveFilmFrame(b, frame).samples[0]?.sourceTime).toBe(
      resolveFilmFrame(a, frame).samples[0]?.sourceTime,
    )
  expect(resolveFilmFrame(a, 0).samples[0]?.sourceTime).toBe(191 / 24)
})
test('dissolve renders distinct source times without shortening the sequence', () => {
  const a = fixture(),
    track = a.sequence.tracks[0]!
  const t = FilmTransition.parse({
    kind: 'dissolve',
    clipId: track.clips[0]!.id,
    nextClipId: track.clips[1]!.id,
    frames: 24,
  })
  const b = addFilmTransition(a, track.id, t),
    samples = resolveFilmFrame(b, 72).samples
  expect(filmDuration(b.sequence)).toBe(144)
  expect(samples.map((s) => s.sourceTime)).toEqual([8, 11])
  expect(samples.reduce((v, s) => v + s.weight, 0)).toBeCloseTo(1)
})
test('missing handles require explicit repeated-frame choice', () => {
  const a = fixture(),
    track = a.sequence.tracks[0]!
  track.clips[1]!.in = 0
  const t = FilmTransition.parse({
    kind: 'dissolve',
    clipId: track.clips[0]!.id,
    nextClipId: track.clips[1]!.id,
    frames: 24,
  })
  expect(() => addFilmTransition(a, track.id, t)).toThrow('余量不足')
  const b = addFilmTransition(a, track.id, { ...t, repeatEdges: true })
  expect(resolveFilmFrame(b, 60).samples[1]?.repeated).toBe(true)
})
test('ordinary deletion leaves a gap; ripple deletion closes it without modifying sources', () => {
  const a = fixture(),
    id = a.sequence.tracks[0]!.clips[0]!.id
  expect(deleteFilmClip(a, id).sequence.tracks[0]!.clips[0]!.start).toBe(72)
  expect(deleteFilmClip(a, id, true).sequence.tracks[0]!.clips[0]!.start).toBe(0)
  expect(a.sequence.tracks[0]!.clips).toHaveLength(2)
})
test('ripple deletion refuses to erase a crossing clip on another sync-locked track', () => {
  const a = fixture()
  a.sequence.tracks.push(
    FilmTrack.parse({
      name: 'V2',
      clips: [FilmClip.parse({ sourceId: 'source_b', start: 24, in: 0, out: 80 })],
    }),
  )
  expect(() => deleteFilmClip(a, a.sequence.tracks[0]!.clips[0]!.id, true)).toThrow('仍有画面')
  a.sequence.tracks[1]!.syncLocked = false
  expect(
    deleteFilmClip(a, a.sequence.tracks[0]!.clips[0]!.id, true).sequence.tracks[1]!.clips[0]!.start,
  ).toBe(24)
})
test('insert splits crossing content and shifts locked-sync followers atomically', () => {
  const a = fixture(),
    track = a.sequence.tracks[0]!
  const b = addFilmClip(a, track.id, 'source_b', 24, 'insert')
  expect(b.sequence.tracks[0]!.clips.map((c) => c.start)).toEqual([0, 24, 264, 312])
  expect(a.sequence.tracks[0]!.clips).toHaveLength(2)
})
test('speed changes can ripple, while source tracks and other instances remain independent', () => {
  const a = fixture(),
    clip = a.sequence.tracks[0]!.clips[0]!
  expect(() => setFilmClipSpeed(a, clip.id, 0.5, false)).toThrow()
  const b = setFilmClipSpeed(a, clip.id, 0.5, false, true)
  expect(filmClipDuration(b.sequence.tracks[0]!.clips[0]!)).toBe(144)
  expect(b.sequence.tracks[0]!.clips[1]!.start).toBe(144)
  expect(a.tracks).toEqual(b.tracks)
})
test('ripple trimming respects track edit locks', () => {
  const a = fixture()
  a.sequence.tracks[0]!.locked = true
  expect(() => trimFilmClip(a, a.sequence.tracks[0]!.clips[0]!.id, 'out', 48, true)).toThrow('锁定')
})
test('used source survives internal key insertion and endpoint deletion with fixed external cuts', () => {
  const point = (time: number) =>
    CameraMotionPoint.parse({
      time,
      position: [time, 0, 0],
      rotation: [0, 0, 0],
      verticalFov: 50,
      orthographicHeight: 20,
      orbitDistance: 10,
    })
  const a = fixture(),
    p = point(5),
    q = point(8),
    mid = point(6)
  a.tracks = [
    {
      kind: 'camera',
      nodeId: 'scene-camera_a',
      parentId: null,
      points: [p, q],
      segments: [MotionSegment.parse({ fromId: p.id, toId: q.id })],
    },
  ]
  const source = filmCatalog(a)[0]!
  a.sources = [source]
  a.sequence.tracks[0]!.clips = [FilmClip.parse({ sourceId: source.id, start: 0, in: 0, out: 72 })]
  a.tracks[0]!.points = [p, mid, q]
  let b = reconcileFilmSources(a)
  expect(filmCatalog(b)).toHaveLength(2)
  expect(b.sources.some((s) => s.id === source.id)).toBe(true)
  b.tracks[0]!.points = [mid, q]
  b = reconcileFilmSources(b)
  expect(b.sources.find((s) => s.id === source.id)?.start).toBe(120)
  expect(b.sequence.tracks[0]!.clips[0]!.out).toBe(72)
})
test('splits preserve every sampled frame at non-integer speeds in both directions', () => {
  for (const rate of [0.25, 0.5, 0.75, 1.25, 1.5, 2.5])
    for (const reverse of [false, true]) {
      const a = fixture(),
        clip = { ...a.sequence.tracks[0]!.clips[0]!, rate, reverse }
      a.sequence.tracks[0]!.clips = [clip]
      const split = splitFilmClip(a, clip.id, 7)
      expect(filmDuration(split.sequence)).toBe(filmDuration(a.sequence))
      for (let frame = 0; frame < filmDuration(a.sequence); frame++)
        expect(resolveFilmFrame(split, frame).samples[0]!.sourceTime).toBeCloseTo(
          resolveFilmFrame(a, frame).samples[0]!.sourceTime,
          8,
        )
    }
})
test('ripple trim splits crossing tracks; source shortage or edit lock leaves original untouched', () => {
  const a = fixture(),
    first = a.sequence.tracks[0]!.clips[0]!
  a.sequence.tracks.push(
    FilmTrack.parse({
      name: 'V2',
      clips: [FilmClip.parse({ sourceId: 'source_b', start: 0, in: 0, out: 144 })],
    }),
  )
  const trimmed = trimFilmClip(a, first.id, 'out', 48, true)
  expect(trimmed.sequence.tracks[1]!.clips.map((c) => [c.start, c.in, c.out])).toEqual([
    [0, 0, 48],
    [48, 72, 144],
  ])
  expect(trimmed.sequence.tracks[0]!.clips[1]!.start).toBe(48)
  const before = structuredClone(a)
  a.sequence.tracks[1]!.locked = true
  expect(() => trimFilmClip(a, first.id, 'out', 48, true)).toThrow('锁定')
  a.sequence.tracks[1]!.locked = false
  expect(a).toEqual(before)
  a.sequence.tracks[1]!.clips[0]!.in = 220
  a.sequence.tracks[1]!.clips[0]!.out = 360
  expect(() => trimFilmClip(a, first.id, 'out', 96, true)).toThrow('不足')
})
test('editing cannot silently shorten an existing transition', () => {
  const a = fixture(),
    track = a.sequence.tracks[0]!
  const transition = FilmTransition.parse({
    kind: 'fade-in',
    clipId: track.clips[0]!.id,
    frames: 48,
  })
  const b = addFilmTransition(a, track.id, transition)
  expect(() => trimFilmClip(b, track.clips[0]!.id, 'out', 24)).toThrow()
  expect(b.sequence.tracks[0]!.transitions[0]!.frames).toBe(48)
})

test('slow reverse holds valid first and last source frames without accidental black', () => {
  const a = fixture()
  const clip = { ...a.sequence.tracks[0]!.clips[0]!, rate: 0.25, reverse: true }
  a.sequence.tracks[0]!.clips = [clip]
  for (let frame = 0; frame < 288; frame++)
    expect(resolveFilmFrame(a, frame).samples[0]!.black).toBe(false)
  expect(resolveFilmFrame(a, 287).samples[0]!.sourceTime).toBe(5)
})
test('project fps conversion preserves source seconds, film seconds, and transition seconds', () => {
  const a = fixture(),
    t = a.sequence.tracks[0]!
  t.transitions = [
    FilmTransition.parse({
      kind: 'dissolve',
      clipId: t.clips[0]!.id,
      nextClipId: t.clips[1]!.id,
      frames: 24,
    }),
  ]
  const b = changeFilmFps(a, 30)
  expect(filmDuration(b.sequence) / 30).toBe(6)
  expect(resolveFilmFrame(b, 30).samples[0]!.sourceTime).toBe(6)
  expect(b.sequence.tracks[0]!.transitions[0]!.frames).toBe(30)
  expect(changeFilmFps(b, 24)).toEqual(a)
})
test('fractional speed trimming preserves the retained sampled frames', () => {
  for (const reverse of [false, true]) {
    const a = fixture(),
      clip = { ...a.sequence.tracks[0]!.clips[0]!, rate: 0.75, reverse }
    a.sequence.tracks[0]!.clips = [clip]
    const b = trimFilmClip(a, clip.id, 'in', 7)
    for (let f = 7; f < 96; f++)
      expect(resolveFilmFrame(b, f).samples[0]!.sourceTime).toBe(
        resolveFilmFrame(a, f).samples[0]!.sourceTime,
      )
  }
})
