import { expect, spyOn, test } from 'bun:test'
import { sceneRegistry, usePlaybackTransforms, useScene } from '@pascal-app/core'
import { SCENE_LAYER, useViewer } from '@pascal-app/viewer'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import { resetNodeBatchState, runBatchFrame, subscribeBatchInteractions } from './system'

test('animated sources and descendants leave static batches immediately, remain excluded, then rejoin', () => {
  let now = 0
  const clock = spyOn(performance, 'now').mockImplementation(() => now),
    originalScene = useScene.getState(),
    originalViewer = useViewer.getState()
  const wake = { current: null as ReturnType<typeof setTimeout> | null },
    root = new Group(),
    parent = new Group()
  const material = new MeshBasicMaterial(),
    geometry = new BoxGeometry()
  const meshes = Array.from({ length: 4 }, () => new Mesh(geometry, material))
  sceneRegistry.clear()
  resetNodeBatchState()
  root.add(parent)
  sceneRegistry.nodes.set('level_test', root)
  sceneRegistry.byType.level.add('level_test')
  sceneRegistry.nodes.set('block_parent', parent)
  meshes.forEach((mesh, i) => {
    parent.add(mesh)
    mesh.userData.itemModelSettled = true
    sceneRegistry.nodes.set(`item_${i}`, mesh)
    sceneRegistry.byType.item.add(`item_${i}`)
  })
  useScene.setState({
    nodes: {
      level_test: { id: 'level_test', type: 'level' },
      block_parent: { id: 'block_parent', type: 'block', parentId: 'level_test' },
      ...Object.fromEntries(
        meshes.map((_, i) => [
          `item_${i}`,
          { id: `item_${i}`, type: 'item', parentId: 'level_test', visible: true, children: [] },
        ]),
      ),
    },
    dirtyNodes: new Set(),
    materials: {},
    rootNodeIds: [],
  } as never)
  useViewer.setState({
    selection: { ...originalViewer.selection, selectedIds: [], levelId: null },
    hoveredId: null,
    externalSelectedIds: [],
    previewSelectedIds: [],
    levelMode: 'stacked',
  })
  const release = subscribeBatchInteractions(() => {})
  const settle = () => {
    runBatchFrame(() => {}, wake)
    now += 181
    runBatchFrame(() => {}, wake)
  }
  try {
    settle()
    expect(meshes.every((mesh) => !mesh.layers.isEnabled(SCENE_LAYER))).toBe(true)
    usePlaybackTransforms.setState({
      poses: new Map([['level_test', { position: [3, 0, 0], rotation: [0, 0, 0] }]]),
    })
    expect(meshes.every((mesh) => mesh.layers.isEnabled(SCENE_LAYER))).toBe(true)
    settle()
    expect(meshes.every((mesh) => mesh.layers.isEnabled(SCENE_LAYER))).toBe(true)
    usePlaybackTransforms.setState({ poses: new Map() })
    settle()
    expect(meshes.every((mesh) => !mesh.layers.isEnabled(SCENE_LAYER))).toBe(true)
    usePlaybackTransforms.setState({
      poses: new Map([['item_0', { position: [1, 0, 0], rotation: [0, 0, 0] }]]),
    })
    expect(meshes[0]!.layers.isEnabled(SCENE_LAYER)).toBe(true)
    expect(meshes[1]!.layers.isEnabled(SCENE_LAYER)).toBe(false)
    settle()
    expect(meshes[0]!.layers.isEnabled(SCENE_LAYER)).toBe(true)
  } finally {
    usePlaybackTransforms.setState({ poses: new Map() })
    release()
    resetNodeBatchState()
    if (wake.current) clearTimeout(wake.current)
    sceneRegistry.clear()
    useScene.setState(originalScene, true)
    useViewer.setState(originalViewer, true)
    material.dispose()
    geometry.dispose()
    clock.mockRestore()
  }
})
