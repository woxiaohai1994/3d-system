import { expect, test } from 'bun:test'
import native from '../../../../tests/integration/fixtures/add-camera-rigs-property-animation.json'
import { CameraPropertyCurve } from '../schema/animation-fcurve'
import { CameraMotionPoint } from '../schema/camera-motion'
import { FilmTrack } from '../schema/film'
import { MotionSegment } from '../schema/motion'
import { cameraTracks, SceneAnimation } from '../schema/scene-animation'
import { createFCurveEvaluator } from './blender-fcurve'
import { addFilmClip, changeFilmFps } from './film-edit'
import { filmClipUnavailable, resolveFilmFrame } from './film-resolver'
import { filmCatalog, reconcileFilmSources } from './film-sources'

function fixture() {
  const curve = CameraPropertyCurve.parse({
    owner: 'rig',
    dataPath: 'pose.bones["Camera"]["lens"]',
    index: 0,
    keys: [],
  })
  const editor = createFCurveEvaluator(curve)
  try {
    editor.insert(0, 24)
    editor.insert(96, 70)
    curve.keys = editor.keys()
  } finally {
    editor.dispose()
  }
  return SceneAnimation.parse({
    shots: [{ id: 'shot_a', name: '相机一', cameraId: 'scene-camera_a' }],
    tracks: [
      {
        kind: 'camera',
        nodeId: 'scene-camera_a',
        parentId: null,
        points: [],
        segments: [],
        propertyCurves: [curve],
      },
    ],
    sequence: { tracks: [FilmTrack.parse({ name: '视频一' })] },
  })
}
test('property-only camera animation can be inserted into the film without pose keys', () => {
  const animation = reconcileFilmSources(fixture())
  expect(animation.sources.map((source) => [source.start, source.end])).toEqual([[0, 96]])
  const source = animation.sources[0]!
  const film = addFilmClip(animation, animation.sequence.tracks[0]!.id, source.id, 240)
  expect(resolveFilmFrame(film, 288).samples[0]).toMatchObject({
    cameraId: 'scene-camera_a',
    sourceTime: 2,
    black: false,
  })
  expect(cameraTracks(film)[0]!.points).toEqual([])
  expect(cameraTracks(film)[0]!.propertyCurves).toEqual(cameraTracks(animation)[0]!.propertyCurves)
})

test('properties outside pose intervals add end spans without splitting or duplicating pose sources', () => {
  const animation = fixture(),
    track = cameraTracks(animation)[0]!
  const point = (time: number) =>
    CameraMotionPoint.parse({
      time,
      position: [time, 0, 0],
      rotation: [0, 0, 0],
      verticalFov: 50,
      orthographicHeight: 20,
      orbitDistance: 10,
    })
  const a = point(1),
    b = point(3)
  track.points = [a, b]
  track.segments = [MotionSegment.parse({ fromId: a.id, toId: b.id })]
  const sources = filmCatalog(animation)
  expect(sources.map((s) => [s.start, s.end])).toEqual([
    [0, 24],
    [24, 72],
    [72, 96],
  ])
  expect(sources[1]!.id).toBe(`source_shot_a_${a.id}_${b.id}`)
})

test('changing output fps preserves source seconds and native curve values and handles', () => {
  for (const record of native.cases) {
    const animation = fixture(),
      track = cameraTracks(animation)[0]!
    track.propertyCurves = [
      CameraPropertyCurve.parse({
        owner: record.owner,
        dataPath: record.path,
        index: record.index ?? 0,
        keys: record.keys,
        smoothing: record.smoothing,
        extrapolation: record.extrapolation,
        discrete: ['BOOLEAN', 'ENUM'].includes(record.type),
        integer: ['BOOLEAN', 'ENUM', 'INT'].includes(record.type),
      }),
    ]
    const before = createFCurveEvaluator(track.propertyCurves[0]!)
    const converted = changeFilmFps(animation, 30)
    const after = createFCurveEvaluator(cameraTracks(converted)[0]!.propertyCurves![0]!)
    try {
      for (const sample of record.samples) {
        const expected = before.sample(sample.frame)
        expect(Math.abs(after.sample((sample.frame * 30) / 24) - expected)).toBeLessThanOrEqual(
          0.00005 * Math.max(1, Math.abs(expected)),
        )
      }
    } finally {
      before.dispose()
      after.dispose()
    }
    expect(track.propertyCurves[0]!.keys).toEqual(record.keys)
  }
})

test('shrinking a property source keeps the existing clip and reports its source shortage', () => {
  let animation = reconcileFilmSources(fixture())
  animation = addFilmClip(animation, animation.sequence.tracks[0]!.id, animation.sources[0]!.id, 0)
  const clip = structuredClone(animation.sequence.tracks[0]!.clips[0]!)
  const curve = cameraTracks(animation)[0]!.propertyCurves![0]!
  curve.keys.at(-1)!.co[0] = 48
  animation = reconcileFilmSources(animation)
  expect(animation.sequence.tracks[0]!.clips[0]).toEqual(clip)
  expect(animation.sources[0]!.end).toBe(48)
  expect(filmClipUnavailable(clip, animation.sources[0])).toBe(true)
  expect(resolveFilmFrame(animation, 60).samples[0]!.black).toBe(true)
})

test('fps conversion keeps a property-only film clip aligned with its curve', () => {
  let animation = reconcileFilmSources(fixture())
  animation = addFilmClip(
    animation,
    animation.sequence.tracks[0]!.id,
    animation.sources[0]!.id,
    240,
  )
  const converted = changeFilmFps(animation, 30)
  expect(converted.sources[0]!.end).toBe(120)
  expect(converted.sequence.tracks[0]!.clips[0]!.start).toBe(300)
  expect(converted.sequence.tracks[0]!.clips[0]!.out).toBe(120)
  const sample = resolveFilmFrame(converted, 360).samples[0]!
  expect(sample.sourceTime).toBe(2)
  const curve = createFCurveEvaluator(cameraTracks(converted)[0]!.propertyCurves![0]!)
  try {
    expect(curve.sample(sample.sourceTime * converted.fps)).toBeCloseTo(47, 4)
  } finally {
    curve.dispose()
  }
})
