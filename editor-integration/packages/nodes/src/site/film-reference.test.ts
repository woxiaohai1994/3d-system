import { expect, test } from 'bun:test'
import {
  addFilmClip,
  CameraPropertyCurve,
  cameraTracks,
  cloneSceneGraph,
  createFCurveEvaluator,
  FilmClip,
  FilmTrack,
  reconcileFilmSources,
  resolveFilmFrame,
  SceneAnimation,
  SceneCameraNode,
  SiteNode,
} from '@pascal-app/core'
import { nodeRegistry, registerNode } from '@pascal-app/core/registry'
import { siteDefinition } from './definition'

test('project cloning remaps workspace cameras while preserving source identities and film sampling', () => {
  if (!nodeRegistry.has('site')) registerNode(siteDefinition)
  const camera = SceneCameraNode.parse({}),
    site = SiteNode.parse({
      children: [camera.id],
      animation: {
        version: 2,
        activeCameraId: camera.id,
        cameraMarkers: [{ name: 'cam_24', frame: 24, cameraId: camera.id }],
        shots: [{ id: 'shot_a', name: 'A', cameraId: camera.id }],
        sources: [{ id: 'source_a', shotId: 'shot_a', name: 'Range', start: 120, end: 192 }],
        sequence: {
          tracks: [
            FilmTrack.parse({
              name: 'V1',
              clips: [FilmClip.parse({ sourceId: 'source_a', start: 480, in: 0, out: 72 })],
            }),
          ],
        },
      },
    })
  const copy = cloneSceneGraph({
    nodes: { [camera.id]: camera, [site.id]: site },
    rootNodeIds: [site.id],
  })
  const a = Object.values(copy.nodes).find((n) => n.type === 'site')!.animation!
  const newCamera = Object.values(copy.nodes).find((n) => n.type === 'scene-camera')!
  expect(a.shots[0]!.cameraId).toBe(newCamera.id)
  expect(a.shots[0]!.cameraId).not.toBe(camera.id)
  expect(a.activeCameraId).toBe(newCamera.id)
  expect(a.cameraMarkers![0]).toEqual({
    ...site.animation!.cameraMarkers![0]!,
    cameraId: newCamera.id,
  })
  expect(a.sources).toEqual(site.animation!.sources)
  expect(resolveFilmFrame(a, 504).samples[0]).toMatchObject({
    cameraId: newCamera.id,
    sourceTime: 6,
  })
})

test('project cloning preserves independent camera property curves and their film sources', () => {
  if (!nodeRegistry.has('site')) registerNode(siteDefinition)
  const site = SiteNode.parse({}),
    camera = SceneCameraNode.parse({ parentId: site.id })
  site.children = [camera.id]
  const curve = CameraPropertyCurve.parse({
    owner: 'rig',
    dataPath: 'pose.bones["Camera"]["lens"]',
    index: 0,
    keys: [],
  })
  const evaluator = createFCurveEvaluator(curve)
  try {
    evaluator.insert(0, 24)
    evaluator.insert(96, 70)
    curve.keys = evaluator.keys()
  } finally {
    evaluator.dispose()
  }
  let animation = reconcileFilmSources(
    SceneAnimation.parse({
      shots: [{ id: 'shot_a', name: '相机一', cameraId: camera.id }],
      tracks: [
        {
          kind: 'camera',
          nodeId: camera.id,
          parentId: site.id,
          points: [],
          segments: [],
          propertyCurves: [curve],
        },
      ],
      sequence: { tracks: [FilmTrack.parse({ name: '视频一' })] },
    }),
  )
  animation = addFilmClip(animation, animation.sequence.tracks[0]!.id, animation.sources[0]!.id, 0)
  site.animation = animation
  const cloned = cloneSceneGraph({
    nodes: { [site.id]: site, [camera.id]: camera },
    rootNodeIds: [site.id],
  })
  const copy = Object.values(cloned.nodes).find((node) => node.type === 'site')!
  const copiedCamera = Object.values(cloned.nodes).find((node) => node.type === 'scene-camera')!
  const data = reconcileFilmSources(copy.animation!)
  expect(cameraTracks(data)[0]!.nodeId).toBe(copiedCamera.id)
  expect(cameraTracks(data)[0]!.parentId).toBe(copy.id)
  expect(cameraTracks(data)[0]!.propertyCurves).toEqual(cameraTracks(animation)[0]!.propertyCurves)
  expect(resolveFilmFrame(data, 48).samples[0]).toMatchObject({
    cameraId: copiedCamera.id,
    sourceTime: 2,
    black: false,
  })
  cameraTracks(data)[0]!.propertyCurves![0]!.keys[0]!.co[1] = 99
  expect(cameraTracks(animation)[0]!.propertyCurves![0]!.keys[0]!.co[1]).toBe(24)
})
