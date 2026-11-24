import { afterEach, expect, test } from 'bun:test'
import { FilmClip, FilmTrack } from '../schema/film'
import { SceneCameraNode } from '../schema/nodes/scene-camera'
import { SiteNode } from '../schema/nodes/site'
import { SceneAnimation } from '../schema/scene-animation'
import useScene from '../store/use-scene'
import { reconcileFilmGraph } from './film-graph'

const originalRaf = globalThis.requestAnimationFrame
afterEach(() => {
  globalThis.requestAnimationFrame = originalRaf
})

test('moving an existing camera preserves pre-existing missing workspace references and remains undoable', () => {
  globalThis.requestAnimationFrame = () => 0
  const camera = SceneCameraNode.parse({ name: '相机 2' })
  const site = SiteNode.parse({
    animation: {
      version: 2,
      shots: [
        { id: 'shot_old', name: '相机 1', cameraId: 'scene-camera_missing' },
        { id: 'shot_live', name: '相机 2', cameraId: camera.id },
      ],
      sources: [{ id: 'source_old', name: 'Old source', shotId: 'shot_old', start: 0, end: 24 }],
      sequence: {
        tracks: [{ name: 'V1', clips: [{ sourceId: 'source_old', start: 0, in: 0, out: 24 }] }],
      },
    },
  })
  useScene.setState({
    nodes: { [site.id]: site, [camera.id]: camera },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  expect(() => useScene.getState().updateNode(camera.id, { position: [2, 3, 4] })).not.toThrow()
  expect((useScene.getState().nodes[camera.id] as typeof camera).position).toEqual([2, 3, 4])
  expect((useScene.getState().nodes[site.id] as typeof site).animation).toEqual(site.animation)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[camera.id]).toEqual(camera)
  useScene.temporal.getState().redo()
  expect((useScene.getState().nodes[camera.id] as typeof camera).position).toEqual([2, 3, 4])
})

test('editing an animation with an unchanged missing reference is allowed, but introducing another is rejected', () => {
  const site = SiteNode.parse({
    animation: {
      version: 2,
      shots: [{ id: 'shot_old', name: 'Old', cameraId: 'scene-camera_missing' }],
    },
  })
  const before = { [site.id]: site }
  const updated = { ...site, animation: { ...site.animation!, duration: 12 } }
  expect(() => reconcileFilmGraph(before, { [site.id]: updated })).not.toThrow()
  updated.animation.shots = [{ ...updated.animation.shots[0]!, cameraId: 'scene-camera_another' }]
  expect(() => reconcileFilmGraph(before, { [site.id]: updated })).toThrow('不存在')
})

test('camera creation and deletion reconcile film references in one undoable graph edit', () => {
  const site = SiteNode.parse({}),
    camera = SceneCameraNode.parse({ parentId: site.id })
  site.children = [camera.id]
  site.animation = SceneAnimation.parse({
    shots: [{ id: 'shot_test', name: 'Test', cameraId: camera.id }],
    sources: [{ id: 'source_test', shotId: 'shot_test', name: 'Range', start: 0, end: 48 }],
    sequence: {
      tracks: [
        FilmTrack.parse({
          name: 'V1',
          clips: [FilmClip.parse({ sourceId: 'source_test', start: 24, in: 0, out: 48 })],
        }),
      ],
    },
  })
  useScene.setState({
    nodes: { [site.id]: site, [camera.id]: camera },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  const before = useScene.getState().nodes
  useScene.getState().deleteNode(camera.id)
  const after = useScene.getState().nodes[site.id] as typeof site
  expect(after.animation!.shots[0]!.cameraId).toBeNull()
  expect(after.animation!.shots.some((shot) => shot.id === 'shot_test')).toBe(false)
  expect(after.animation!.sources).toEqual([])
  expect(after.animation!.sequence.tracks[0]!.clips).toEqual([])
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(before)
  useScene.temporal.getState().redo()
  expect(useScene.getState().nodes[camera.id]).toBeUndefined()
})

test('repeated camera creation and deletion never accumulates named empty camera workspaces', () => {
  globalThis.requestAnimationFrame = () => 0
  const site = SiteNode.parse({ animation: SceneAnimation.parse({}) })
  useScene.setState({ nodes: { [site.id]: site }, rootNodeIds: [site.id], readOnly: false })
  for (let i = 0; i < 3; i++) {
    const camera = SceneCameraNode.parse({ name: `Removed ${i}`, parentId: site.id })
    useScene.getState().createNode(camera, site.id)
    useScene.getState().deleteNode(camera.id)
    const graph = JSON.parse(JSON.stringify(useScene.getState().nodes))
    reconcileFilmGraph(graph, graph)
    const animation = graph[site.id].animation as SceneAnimation
    expect(Object.values(graph).some((node: any) => node.type === 'scene-camera')).toBe(false)
    expect(animation.shots).toEqual([{ id: 'shot_default', name: '相机工作区 1', cameraId: null }])
  }
})
test('a graph edit cannot assign an absent camera or duplicate a camera owner', () => {
  const site = SiteNode.parse({
    animation: {
      version: 2,
      shots: [{ id: 'shot_a', name: 'A', cameraId: 'scene-camera_missing' }],
    },
  })
  expect(() => reconcileFilmGraph({}, { [site.id]: site })).toThrow('不存在')
  expect(() =>
    SiteNode.parse({
      animation: {
        version: 2,
        shots: [
          { id: 'shot_a', name: 'A', cameraId: 'scene-camera_x' },
          { id: 'shot_b', name: 'B', cameraId: 'scene-camera_x' },
        ],
      },
    }),
  ).toThrow()
})
