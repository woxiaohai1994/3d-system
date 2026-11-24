import { afterEach, beforeEach, expect, test } from 'bun:test'
import { ItemNode, LevelNode, sceneRegistry, useScene } from '@pascal-app/core'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Ray, Vector3 } from 'three'
import {
  projectSceneSurfacePoint,
  querySceneSurface,
  sceneSurfaceTargets,
} from './scene-surface-query'

const saved = useScene.getState(),
  registered = new Map(sceneRegistry.nodes)
const level = LevelNode.parse({ level: 0 }),
  other = LevelNode.parse({ level: 1 })
const item = (name: string, parentId: string) =>
  ItemNode.parse({
    name,
    parentId,
    asset: { id: name, name, category: 'furniture', thumbnail: '', src: '/test.glb' },
  })
const a = item('a', level.id),
  b = item('b', level.id),
  c = item('c', other.id)
const ray = new Ray(new Vector3(0, 0, 10), new Vector3(0, 0, -1))
beforeEach(() => {
  sceneRegistry.nodes.clear()
  useScene.setState({
    nodes: { [level.id]: level, [other.id]: other, [a.id]: a, [b.id]: b, [c.id]: c },
  })
  for (const [i, node] of [a, b, c].entries()) {
    const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial())
    mesh.position.z = i * 3
    sceneRegistry.nodes.set(node.id, mesh)
  }
})
afterEach(() => {
  useScene.setState(saved)
  sceneRegistry.nodes.clear()
  registered.forEach((object, id) => sceneRegistry.nodes.set(id, object))
})

test('level scope, explicit target scope, exclusion and stale IDs never fall back to unrelated models', () => {
  expect(querySceneSurface(ray, { levelId: level.id })?.targetId).toBe(b.id)
  expect(querySceneSurface(ray, { levelId: level.id, targetIds: [a.id] })?.targetId).toBe(a.id)
  expect(querySceneSurface(ray, { targetIds: [] })).toBeNull()
  expect(querySceneSurface(ray, { targetIds: ['deleted'] })).toBeNull()
  expect(querySceneSurface(ray, { levelId: level.id, excludeIds: [b.id] })?.targetId).toBe(a.id)
  expect(querySceneSurface(ray, { levelId: level.id, targetIds: [c.id] })).toBeNull()
})

test('hidden semantic ancestors are excluded even before the renderer updates', () => {
  useScene.setState({
    nodes: { ...useScene.getState().nodes, [level.id]: { ...level, visible: false } },
  })
  expect(sceneSurfaceTargets({ levelId: level.id })).toHaveLength(0)
})

test('nested physical objects keep their own identity and excluded children cannot be hit through a parent target', () => {
  const root = new Group(),
    child = sceneRegistry.nodes.get(b.id)!
  root.add(child)
  sceneRegistry.nodes.set(a.id, root)
  useScene.setState({ nodes: { ...useScene.getState().nodes, [b.id]: { ...b, parentId: a.id } } })
  expect(querySceneSurface(ray, { targetIds: [a.id] })?.targetId).toBe(b.id)
  expect(querySceneSurface(ray, { targetIds: [a.id], excludeIds: [b.id] })).toBeNull()
})

test('bounded point projection retains a nearby original host, with no distant jump', () => {
  expect(
    projectSceneSurfacePoint([0.2, 0.4, 1.05], 0.15, { targetIds: [a.id] })?.point[2],
  ).toBeCloseTo(1)
  expect(projectSceneSurfacePoint([0, 0, 1.5], 0.15, { targetIds: [a.id] })).toBeNull()
  expect(projectSceneSurfacePoint([0, 0, 1], -1, { targetIds: [a.id] })).toBeNull()
})
