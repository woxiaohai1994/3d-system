import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Ray, Vector3 } from 'three'
import { querySceneSurface } from '../../packages/editor/src/lib/scene-surface-query'
import { stringLightDefinition } from '../../../string-lights-plugin/src/definition'
import { commitLight, updateLight } from '../../../string-lights-plugin/src/commands'
import { LIGHT_KIND, type StringLightNode } from '../../../string-lights-plugin/src/schema'
import { prepareLightSurfaceMove } from '../../../string-lights-plugin/src/surface-move'
import { resolveLightPoints } from '../../../string-lights-plugin/src/surface-anchors'
const saved = useScene.getState(),
  registry = new Map(sceneRegistry.nodes)
const level = LevelNode.parse({ level: 0 })
const host = ItemNode.parse({
  parentId: level.id,
  asset: { id: 'eave', name: 'Eave', src: '/eave.glb', thumbnail: '', category: 'furniture' },
})
let light: StringLightNode, object: Group, model: Mesh, restore: () => void
let raf: typeof requestAnimationFrame, caf: typeof cancelAnimationFrame
beforeEach(() => {
  raf = globalThis.requestAnimationFrame
  caf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  restore = nodeRegistry._snapshot()
  if (!nodeRegistry.has(LIGHT_KIND)) registerNode(stringLightDefinition as never)
  sceneRegistry.nodes.clear()
  useScene.setState({
    nodes: { [level.id]: level, [host.id]: host },
    rootNodeIds: [level.id],
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  const parent = new Group()
  model = new Mesh(new BoxGeometry(6, 0.4, 4), new MeshBasicMaterial())
  model.position.y = 2
  parent.add(model)
  sceneRegistry.nodes.set(host.id, model)
  sceneRegistry.nodes.set(level.id, parent)
  light = commitLight(
    {
      points: [
        [-2.8, 2.3, 2.3],
        [2.8, 2.3, 2.3],
      ],
      curve: 'straight',
      bulbHead: 'c9',
      mount: 'direct',
      orientation: 'down',
      bulbSize: 0.05,
      spacing: 0.3,
      surfaceTargets: [host.id],
    },
    level.id,
  )
  object = new Group()
  parent.add(object)
  sceneRegistry.nodes.set(light.id, object)
  parent.updateWorldMatrix(true, true)
  useScene.temporal.getState().clear()
})
afterEach(() => {
  useLiveNodeOverrides.getState().clear(light.id)
  useScene.temporal.getState().clear()
  useScene.setState(saved)
  sceneRegistry.nodes.clear()
  registry.forEach((v, k) => sceneRegistry.nodes.set(k, v))
  restore()
  model.geometry.dispose()
  ;(model.material as MeshBasicMaterial).dispose()
  globalThis.requestAnimationFrame = raf
  globalThis.cancelAnimationFrame = caf
})
test('clicking the eave side moves the whole path, rebinds it and keeps product facts through undo/reload', () => {
  const hit = querySceneSurface(new Ray(new Vector3(0, 2, 5), new Vector3(0, 0, -1)), {
    targetIds: [host.id],
  })!
  expect(hit.normal[2]).toBeCloseTo(1)
  const patch = prepareLightSurfaceMove(light, hit)
  useLiveNodeOverrides.getState().set(light.id, patch)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  const next = updateLight(light.id, patch)
  useLiveNodeOverrides.getState().clear(light.id)
  object.position.fromArray(next.position)
  const points = resolveLightPoints(next, object, (id) => sceneRegistry.nodes.get(id)).map((p) =>
    object.localToWorld(new Vector3(...p)),
  )
  expect(points.every((p) => Math.abs(p.y - 2) < 1e-5 && p.z > 2)).toBe(true)
  expect(next.anchors.length).toBe(next.points.length)
  expect([next.bulbSize, next.spacing, next.colors]).toEqual([
    light.bulbSize,
    light.spacing,
    light.colors,
  ])
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  const loaded = JSON.parse(JSON.stringify(next)) as StringLightNode
  model.position.x = 1
  const moved = resolveLightPoints(loaded, object, (id) => sceneRegistry.nodes.get(id)).map((p) =>
    object.localToWorld(new Vector3(...p)),
  )
  moved.forEach((p, i) =>
    expect(p.distanceTo(points[i]!.clone().add(new Vector3(1, 0, 0)))).toBeLessThan(1e-6),
  )
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[light.id]).toEqual(light as never)
})
test('a target face too short for the string rejects placement without changing history', () => {
  const hit = querySceneSurface(new Ray(new Vector3(5, 2, 0), new Vector3(-1, 0, 0)), {
    targetIds: [host.id],
  })!
  expect(() => prepareLightSurfaceMove(light, hit)).toThrow()
  expect(useScene.getState().nodes[light.id]).toEqual(light as never)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})
