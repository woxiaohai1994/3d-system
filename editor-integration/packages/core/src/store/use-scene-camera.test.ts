import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { BuildingNode, LevelNode, SceneCameraNode, SiteNode } from '../schema'
import useScene from './use-scene'

const originalRaf = globalThis.requestAnimationFrame
const originalCancelRaf = globalThis.cancelAnimationFrame
beforeAll(() => {
  globalThis.requestAnimationFrame = (callback) =>
    setTimeout(() => callback(performance.now()), 0) as unknown as number
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
})
afterAll(() => {
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancelRaf
})

describe('scene camera persistence and history', () => {
  beforeEach(() => {
    useScene.setState({
      nodes: {},
      rootNodeIds: [],
      dirtyNodes: new Set(),
      collections: {},
      materials: {},
      readOnly: false,
    } as never)
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
  })
  test('multiple cameras survive save/reopen and edits remain independently undoable', () => {
    const site = SiteNode.parse({})
    const building = BuildingNode.parse({ parentId: site.id })
    const level = LevelNode.parse({ parentId: building.id, level: 0 })
    site.children = [building.id]
    building.children = [level.id]
    useScene
      .getState()
      .setScene({ [site.id]: site, [building.id]: building, [level.id]: level }, [site.id])
    const first = SceneCameraNode.parse({
      parentId: level.id,
      position: [1, 2, 3],
      focalLength: 85,
      depthOfField: true,
      aperture: 1.8,
      focusPoint: [0, 1, 0],
    })
    const second = SceneCameraNode.parse({
      parentId: level.id,
      position: [-3, 2, 0],
      focalLength: 24,
    })
    useScene.getState().createNode(first, level.id)
    useScene.getState().createNode(second, level.id)
    useScene.temporal.getState().clear()
    useScene.getState().updateNode(first.id, { position: [4, 2, 3], focalLength: 120 })
    expect(useScene.getState().nodes[second.id]).toEqual(second)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[first.id]).toEqual(first)
    useScene.temporal.getState().redo()
    const saved = JSON.parse(
      JSON.stringify({
        nodes: useScene.getState().nodes,
        rootNodeIds: useScene.getState().rootNodeIds,
      }),
    )
    useScene.getState().unloadScene()
    useScene.getState().setScene(saved.nodes, saved.rootNodeIds)
    const reloaded = SceneCameraNode.parse(useScene.getState().nodes[first.id])
    expect(reloaded.position).toEqual([4, 2, 3])
    expect(reloaded.focalLength).toBe(120)
    expect(reloaded.focusPoint).toEqual([0, 1, 0])
    expect(reloaded.aperture).toBe(1.8)
    expect(LevelNode.parse(useScene.getState().nodes[level.id]).children).toContain(first.id)
    expect(LevelNode.parse(useScene.getState().nodes[level.id]).children).toContain(second.id)
    useScene.getState().deleteNode(first.id)
    expect(useScene.getState().nodes[first.id]).toBeUndefined()
    expect(useScene.getState().nodes[second.id]).toEqual(second)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[first.id]).toEqual(reloaded)
  })

  test('loading an older camera fills framing defaults without changing saved optics or pose', () => {
    const camera = SceneCameraNode.parse({
      position: [3, 4, 5],
      rotation: [0.2, 0.5, 0],
      focalLength: 85,
      aperture: 1.8,
      depthOfField: true,
    })
    const legacy = JSON.parse(JSON.stringify(camera))
    for (const key of [
      'orbitDistance',
      'projection',
      'frameAspect',
      'verticalFov',
      'orthographicHeight',
      'near',
      'far',
    ])
      delete legacy[key]
    const input = JSON.stringify(legacy)
    useScene.getState().setScene({ [camera.id]: legacy }, [camera.id])
    const loaded = useScene.getState().nodes[camera.id]
    expect(loaded).toEqual(camera)
    expect(JSON.stringify(legacy)).toBe(input)
    const saved = JSON.parse(JSON.stringify(loaded))
    useScene.getState().setScene({ [camera.id]: saved }, [camera.id])
    expect(useScene.getState().nodes[camera.id]).toEqual(camera)
  })
})
