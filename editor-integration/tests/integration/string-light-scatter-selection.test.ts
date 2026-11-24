import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { registerSurfaceSource } from '@pascal-app/viewer'
import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Texture,
  TextureLoader,
  Vector3,
} from 'three'
import { TreeNode } from '../../node_modules/@pascal-app/plugin-trees/src/schema'
import { prepareScatterOnModel } from '../../../string-lights-plugin/src/scatter-selection'
import { commitLight } from '../../../string-lights-plugin/src/commands'
import { stringLightDefinition } from '../../../string-lights-plugin/src/definition'
import { LightSettings } from '../../../string-lights-plugin/src/schema'
import { makeLayout } from '../../../string-lights-plugin/src/layout'

const saved = useScene.getState(),
  objects = new Map(sceneRegistry.nodes)
const level = LevelNode.parse({ level: 0 })
const host = ItemNode.parse({
  parentId: level.id,
  asset: { id: 'shrub', name: 'Shrub', src: '/shrub.glb', category: 'outdoor', thumbnail: '' },
})
let restore: () => void, unregister: () => void, parent: Group, model: Group, source: Group
let geometry: BoxGeometry, material: MeshBasicMaterial
let raf: typeof requestAnimationFrame, caf: typeof cancelAnimationFrame

beforeEach(() => {
  raf = globalThis.requestAnimationFrame
  caf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  restore = nodeRegistry._snapshot()
  if (!nodeRegistry.has(stringLightDefinition.kind)) registerNode(stringLightDefinition as never)
  useScene.setState({
    nodes: { [level.id]: level, [host.id]: host },
    rootNodeIds: [level.id],
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  sceneRegistry.nodes.clear()
  parent = new Group()
  parent.position.set(5, 3, -4)
  parent.rotation.y = 0.6
  model = new Group()
  model.position.set(3, 1, -2)
  model.rotation.y = 0.3
  model.scale.set(2, 0.5, 1.5)
  parent.add(model)
  parent.updateWorldMatrix(true, true)
  sceneRegistry.nodes.set(level.id, parent)
  sceneRegistry.nodes.set(host.id, model)
  geometry = new BoxGeometry(2, 4, 6)
  geometry.translate(0, 2, 0)
  material = new MeshBasicMaterial()
  source = new Group()
  source.add(new Mesh(geometry, material))
  unregister = registerSurfaceSource(model, () => source)
})

afterEach(() => {
  unregister()
  geometry.dispose()
  material.dispose()
  restore()
  useScene.setState(saved)
  useScene.temporal.getState().clear()
  sceneRegistry.nodes.clear()
  objects.forEach((object, id) => sceneRegistry.nodes.set(id, object))
  globalThis.requestAnimationFrame = raf
  globalThis.cancelAnimationFrame = caf
})

test('scatter uses the shared surface source for batched models in a rotated elevated level', () => {
  expect(new Box3().setFromObject(model).isEmpty()).toBe(true)
  const settings = LightSettings.parse({
    mode: 'scatter',
    count: 24,
    seed: 49,
    bulbSize: 0.015,
    spacing: 0.35,
    colors: ['#ff0000', '#ffffff'],
    rotation: [0.2, 0.6, 0.1],
    anchors: [
      { index: 0, nodeId: 'stale', localPosition: [0, 0, 0], referencePosition: [0, 0, 0] },
    ],
  })
  const before = useScene.getState().nodes
  const fitted = prepareScatterOnModel(settings, level.id, host.id)
  geometry.computeBoundingBox()
  const expected = geometry.boundingBox!.clone().applyMatrix4(model.matrix)
  const actual = new Box3(
    new Vector3(...fitted.position).add(
      new Vector3(-fitted.region[0] / 2, 0, -fitted.region[2] / 2),
    ),
    new Vector3(...fitted.position).add(
      new Vector3(fitted.region[0] / 2, fitted.region[1], fitted.region[2] / 2),
    ),
  )
  expect(actual.min.distanceTo(expected.min)).toBeLessThan(1e-6)
  expect(actual.max.distanceTo(expected.max)).toBeLessThan(1e-6)
  expect(fitted.rotation).toEqual([0, 0, 0])
  expect(fitted.anchors).toEqual([])
  expect(fitted.surfaceTargets).toEqual([host.id])
  expect(fitted.cableVisible).toBe(false)
  expect([fitted.count, fitted.seed, fitted.bulbSize, fitted.spacing, fitted.colors]).toEqual([
    settings.count,
    settings.seed,
    settings.bulbSize,
    settings.spacing,
    settings.colors,
  ])
  expect(useScene.getState().nodes).toBe(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  const light = commitLight(fitted, level.id)
  expect(makeLayout(light).cable).toEqual([])
  expect(makeLayout(light).bulbs).toHaveLength(24)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(before)
  useScene.temporal.getState().redo()
  expect(JSON.parse(JSON.stringify(useScene.getState().nodes[light.id]))).toEqual(light)
})

test('missing, hidden or out-of-level targets do not fit another model or write history', () => {
  const settings = LightSettings.parse({ mode: 'scatter' })
  const before = useScene.getState().nodes
  expect(() => prepareScatterOnModel(settings, level.id, 'missing')).toThrow('可用表面')
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  useScene.setState({ nodes: { ...before, [host.id]: { ...host, visible: false } } })
  useScene.temporal.getState().clear()
  expect(() => prepareScatterOnModel(settings, level.id, host.id)).toThrow('可用表面')
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  useScene.setState({ nodes: { ...before, [host.id]: { ...host, parentId: null } } })
  useScene.temporal.getState().clear()
  expect(() => prepareScatterOnModel(settings, level.id, host.id)).toThrow('可用表面')
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})

test('real rotated bush scatter bounds use foliage vertices rather than rotated empty box corners', () => {
  const load = spyOn(TextureLoader.prototype, 'load').mockImplementation(() => new Texture())
  try {
    const { getVariantData, treeSpecOf } =
      require('../../node_modules/@pascal-app/plugin-trees/src/geometry') as typeof import('../../node_modules/@pascal-app/plugin-trees/src/geometry')
    const bush = TreeNode.parse({ preset: 'bush', size: 'medium', height: 1.5 })
    const data = getVariantData(treeSpecOf(bush))
    parent.position.set(0, 0, 0)
    parent.rotation.set(0, 0, 0)
    model.position.set(0, 0, 0)
    model.rotation.set(0, Math.PI / 4, 0)
    model.scale.setScalar(1)
    source.clear()
    const geometryGroup = new Group()
    geometryGroup.scale.setScalar(bush.height / data.naturalHeight)
    for (const part of data.subMeshes) geometryGroup.add(new Mesh(part.geometry, part.material))
    source.add(geometryGroup)
    const fitted = prepareScatterOnModel(
      LightSettings.parse({ mode: 'scatter' }),
      level.id,
      host.id,
    )
    const exact = new Box3(),
      conservative = new Box3(),
      point = new Vector3()
    for (const child of geometryGroup.children) {
      const mesh = child as Mesh
      mesh.geometry.computeBoundingBox()
      conservative.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld))
      const position = mesh.geometry.getAttribute('position')
      for (let i = 0; i < position.count; i++)
        exact.expandByPoint(point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld))
    }
    expect(new Vector3(...fitted.region).distanceTo(exact.getSize(new Vector3()))).toBeLessThan(
      1e-6,
    )
    expect(conservative.getSize(new Vector3()).x).toBeGreaterThan(fitted.region[0] * 1.15)
    console.info('Real bush bounds', {
      previous: conservative.getSize(new Vector3()).toArray(),
      actual: fitted.region,
    })
  } finally {
    load.mockRestore()
  }
})
