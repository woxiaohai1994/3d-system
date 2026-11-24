import { afterEach, expect, test } from 'bun:test'
import { MotionKey } from '../schema/motion'
import { ColumnNode } from '../schema/nodes/column'
import { SceneCameraNode } from '../schema/nodes/scene-camera'
import { SiteNode } from '../schema/nodes/site'
import { SceneAnimation } from '../schema/scene-animation'
import useScene from '../store/use-scene'

const originalRaf = globalThis.requestAnimationFrame
const originalScene = useScene.getState()
afterEach(() => {
  globalThis.requestAnimationFrame = originalRaf
  useScene.setState(originalScene)
  useScene.temporal.getState().clear()
})

function fixture() {
  globalThis.requestAnimationFrame = () => 0
  const site = SiteNode.parse({})
  const parent = ColumnNode.parse({ parentId: site.id })
  const child = ColumnNode.parse({ parentId: parent.id })
  const keep = ColumnNode.parse({ parentId: site.id })
  const camera = SceneCameraNode.parse({ parentId: site.id })
  parent.children = [child.id]
  site.children = [parent.id, keep.id, camera.id]
  site.animation = SceneAnimation.parse({
    shots: [{ id: 'shot_keep', name: 'Keep', cameraId: camera.id }],
    sources: [{ id: 'source_keep', shotId: 'shot_keep', name: 'Keep', start: 0, end: 24 }],
    sequence: {
      tracks: [{ name: 'V1', clips: [{ sourceId: 'source_keep', start: 0, in: 0, out: 24 }] }],
    },
    tracks: [parent, child, keep].map((node) => ({
      kind: 'object',
      nodeId: node.id,
      parentId: node.parentId,
      points: [MotionKey.parse({ time: 0, position: [1, 2, 3], rotation: [0, 0, 0] })],
      segments: [],
    })),
  })
  const nodes = Object.fromEntries(
    [site, parent, child, keep, camera].map((node) => [node.id, node]),
  )
  useScene.setState({ nodes, rootNodeIds: [site.id], readOnly: false })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  return { site, parent, child, keep, nodes }
}

for (const mode of ['single', 'subtree', 'batch'] as const) {
  test(`${mode} deletion removes object tracks in the same undo step and preserves other animation`, () => {
    const { site, parent, child, keep, nodes } = fixture()
    if (mode === 'single') useScene.getState().deleteNode(child.id)
    else if (mode === 'subtree') useScene.getState().deleteNode(parent.id)
    else useScene.getState().deleteNodes([parent.id, child.id])
    const animation = (useScene.getState().nodes[site.id] as typeof site).animation!
    expect(animation.tracks.map((t) => t.nodeId)).toEqual(
      mode === 'single' ? [parent.id, keep.id] : [keep.id],
    )
    expect(animation.sequence).toEqual(site.animation!.sequence)
    expect(animation.sources).toEqual(site.animation!.sources)
    expect(animation.tracks.at(-1)).toEqual(site.animation!.tracks.at(-1))
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(nodes)
    useScene.temporal.getState().redo()
    expect((useScene.getState().nodes[site.id] as typeof site).animation).toEqual(animation)
  })
}

test('loading a saved scene removes stale tracks and tracks of unreachable nodes without changing the input', () => {
  const { site, parent, child, keep, nodes } = fixture()
  const saved = {
    ...nodes,
    [site.id]: { ...site, children: [keep.id] },
    [parent.id]: { ...parent, parentId: null },
  }
  delete saved[child.id]
  useScene.getState().setScene(saved, [site.id])
  const animation = (useScene.getState().nodes[site.id] as typeof site).animation!
  expect(animation.tracks.map((t) => t.nodeId)).toEqual([keep.id])
  expect(site.animation!.tracks).toHaveLength(3)
  expect(animation.sources).toEqual(site.animation!.sources)
  const reloaded = useScene.getState().nodes
  useScene.getState().setScene(reloaded, [site.id])
  expect((useScene.getState().nodes[site.id] as typeof site).animation).toEqual(animation)
})
