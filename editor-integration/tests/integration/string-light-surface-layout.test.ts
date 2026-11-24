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
import { Box3, BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { stringLightDefinition } from '../../../string-lights-plugin/src/definition'
import { commitLight, updateLight } from '../../../string-lights-plugin/src/commands'
import { LIGHT_KIND, StringLightNode } from '../../../string-lights-plugin/src/schema'
import { resolveLightPoints } from '../../../string-lights-plugin/src/surface-anchors'
import { lightQuickActions } from '../../../string-lights-plugin/src/quick-actions'
import { useLightDraft } from '../../../string-lights-plugin/src/store'
import { buildLightGeometry } from '../../../string-lights-plugin/src/geometry'
import {
  defaultSurfaceLayout,
  prepareSurfaceLayout,
} from '../../../string-lights-plugin/src/surface-layout'

const saved = useScene.getState(),
  registered = new Map(sceneRegistry.nodes)
const level = LevelNode.parse({ level: 0 })
const host = ItemNode.parse({
  parentId: level.id,
  asset: { id: 'column', name: 'Column', category: 'furniture', thumbnail: '', src: '/test.glb' },
})
let restore: () => void, light: StringLightNode, parent: Group, model: Group, object: Group
let raf: typeof requestAnimationFrame, cancelRaf: typeof cancelAnimationFrame
const lookup = (id: string) => sceneRegistry.nodes.get(id)
beforeEach(() => {
  raf = globalThis.requestAnimationFrame
  cancelRaf = globalThis.cancelAnimationFrame
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
  parent = new Group()
  parent.position.set(4, 2, -3)
  parent.rotation.y = 0.4
  model = new Group()
  model.rotation.set(0.1, 0.3, 0.2)
  model.scale.set(1.4, 0.8, 0.7)
  model.add(new Mesh(new CylinderGeometry(0.2, 0.6, 4, 64, 16), new MeshBasicMaterial()))
  parent.add(model)
  sceneRegistry.nodes.set(level.id, parent)
  sceneRegistry.nodes.set(host.id, model)
  light = commitLight(
    {
      surfaceTargets: [host.id],
      position: [1, 0.3, -0.5],
      rotation: [0, -0.2, 0],
      bulbSize: 0.045,
      spacing: 0.35,
      colors: ['#ff0000', '#ffffff', '#0000ff'],
      colorRule: 'sequence',
    },
    level.id,
  )
  object = new Group()
  object.position.fromArray(light.position)
  object.rotation.set(...light.rotation)
  parent.add(object)
  sceneRegistry.nodes.set(light.id, object)
  parent.updateWorldMatrix(true, true)
  useScene.temporal.getState().clear()
})
afterEach(() => {
  useLiveNodeOverrides.getState().clear(light.id)
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  useScene.setState(saved)
  sceneRegistry.nodes.clear()
  registered.forEach((value, id) => sceneRegistry.nodes.set(id, value))
  restore()
  globalThis.requestAnimationFrame = raf
  globalThis.cancelAnimationFrame = cancelRaf
})

test('surface wrap previews read-only, commits once and preserves product facts through reload and undo', () => {
  const result = prepareSurfaceLayout(light, level.id, {
    ...defaultSurfaceLayout,
    kind: 'wrap',
    turns: 3,
  })
  expect(result.missed).toBe(0)
  expect(result.crossings).toBe(0)
  expect(result.collisions).toBe(0)
  expect(result.patch.anchors).toHaveLength(result.samples.length)
  useLiveNodeOverrides.getState().set(light.id, result.patch)
  expect(useScene.getState().nodes[light.id]).toEqual(light as never)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  useLiveNodeOverrides.getState().clear(light.id)
  const next = updateLight(light.id, result.patch)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  expect([next.bulbSize, next.spacing, next.colors, next.colorRule, next.seed]).toEqual([
    light.bulbSize,
    light.spacing,
    light.colors,
    light.colorRule,
    light.seed,
  ])
  const restored = StringLightNode.parse(JSON.parse(JSON.stringify(next)))
  const points = resolveLightPoints(restored, object, lookup)
  points.forEach((p, i) => {
    expect(
      object.localToWorld(new Vector3(...p)).distanceTo(new Vector3(...result.samples[i]!.point)),
    ).toBeLessThan(1e-6)
  })
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[light.id]).toEqual(light as never)
  useScene.temporal.getState().redo()
  expect(useScene.getState().nodes[light.id]).toEqual(next as never)
})

test('wrapped supports follow host translation, rotation and scaling inside a transformed parent', () => {
  const result = prepareSurfaceLayout(light, level.id, {
    ...defaultSurfaceLayout,
    kind: 'wrap',
    turns: 2,
  })
  const next = updateLight(light.id, result.patch)
  model.position.set(2, 0.4, 1)
  model.rotation.y += 0.6
  model.scale.x *= 1.3
  parent.updateWorldMatrix(true, true)
  const points = resolveLightPoints(next, object, lookup)
  next.anchors.forEach((anchor) => {
    const expected = model.localToWorld(new Vector3(...anchor.localPosition))
    const actual = object.localToWorld(new Vector3(...points[anchor.index]!))
    expect(actual.distanceTo(expected)).toBeLessThan(1e-6)
  })
})

test('closed surface following preserves corners and one closing span under parent rotation', () => {
  model.clear()
  model.position.set(0, 0, 0)
  model.rotation.set(0, 0, 0)
  model.scale.set(1, 1, 1)
  model.add(new Mesh(new BoxGeometry(4, 2, 4), new MeshBasicMaterial()))
  light = updateLight(light.id, {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    closed: true,
    points: [
      [-1, 1.05, -1],
      [1, 1.05, -1],
      [1, 1.05, 1],
      [-1, 1.05, 1],
    ],
  })
  object.position.set(0, 0, 0)
  object.rotation.set(0, 0, 0)
  const result = prepareSurfaceLayout(light, level.id, {
    ...defaultSurfaceLayout,
    direction: '+y',
    step: 0.5,
  })
  expect(result.missed).toBe(0)
  expect(result.crossings).toBe(0)
  expect(result.patch.closed).toBe(true)
  expect(result.patch.points).toHaveLength(16)
  expect(result.patch.points?.[0]).not.toEqual(result.patch.points?.at(-1))
  expect(result.collisions).toBe(0)
  expect(result.effectiveClearance).toBeGreaterThan(0.04)
  expect(
    result.patch.points?.every((p) => Math.abs(p[1] - 1 - result.effectiveClearance) < 1e-5),
  ).toBe(true)
  const rendered = buildLightGeometry({ ...light, ...result.patch })
  expect(new Box3().setFromObject(rendered.group).min.y).toBeGreaterThan(1)
  rendered.dispose()
})

test('missing or ambiguous target models refuse wrapping rather than silently using other geometry', () => {
  expect(() =>
    prepareSurfaceLayout({ ...light, surfaceTargets: [] }, level.id, defaultSurfaceLayout),
  ).toThrow('选择交互模型')
  expect(() =>
    prepareSurfaceLayout({ ...light, surfaceTargets: ['missing'] }, level.id, defaultSurfaceLayout),
  ).toThrow('可查询的表面')
  expect(() =>
    prepareSurfaceLayout({ ...light, surfaceTargets: [host.id, level.id] }, level.id, {
      ...defaultSurfaceLayout,
      kind: 'wrap',
    }),
  ).toThrow('请选择一个')
})

test('quick surface following attaches every support, preserves product facts and refuses gaps atomically', () => {
  model.clear()
  model.rotation.set(0, 0, 0)
  model.scale.set(1, 1, 1)
  model.add(new Mesh(new BoxGeometry(4, 2, 4), new MeshBasicMaterial()))
  object.position.set(0, 0, 0)
  object.rotation.set(0, 0, 0)
  light = updateLight(light.id, {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    points: [
      [-1, 1.05, -1],
      [1, 1.05, -1],
      [1, 1.05, 1],
    ],
    sag: 0.3,
  })
  useScene.temporal.getState().clear()
  const action = lightQuickActions({ node: light }).find((a) => a.id === 'string-light:follow')!
  expect(action.disabled).toBe(false)
  action.run({ node: light } as never)
  expect(useLightDraft.getState().error).toBe('')
  const followed = useScene.getState().nodes[light.id] as unknown as StringLightNode
  expect(followed.points.length).toBeGreaterThan(3)
  expect(followed.anchors).toHaveLength(followed.points.length)
  expect(followed.points.every((p) => p[1] > 1.04)).toBe(true)
  const rendered = buildLightGeometry(followed)
  expect(new Box3().setFromObject(rendered.group).min.y).toBeGreaterThan(1)
  rendered.dispose()
  expect(followed.points.some((p) => Math.abs(p[0] - 1) < 1e-5 && Math.abs(p[2] + 1) < 1e-5)).toBe(
    true,
  )
  expect([followed.bulbSize, followed.spacing, followed.colors, followed.sag]).toEqual([
    light.bulbSize,
    light.spacing,
    light.colors,
    light.sag,
  ])
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[light.id]).toEqual(light as never)
  model.clear()
  const first = new Mesh(new BoxGeometry(0.2, 2, 0.2), new MeshBasicMaterial())
  first.position.set(-1, 0, -1)
  const last = first.clone()
  last.position.set(1, 0, 1)
  model.add(first, last)
  action.run({ node: light } as never)
  expect(useLightDraft.getState().error).not.toBe('')
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  expect(useScene.getState().nodes[light.id]).toEqual(light as never)
  useLightDraft.setState({ error: '' })
})

test('quick styles wrap selected A-B supports, preserve product facts and undo in one step', () => {
  model.rotation.set(0, 0, 0)
  model.scale.set(1, 1, 1)
  light = updateLight(light.id, {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    points: [
      [0.56, -1.6, 0],
      [0, 1.6, 0.24],
    ],
    curve: 'sag',
    sag: 0.3,
  })
  object.position.set(0, 0, 0)
  object.rotation.set(0, 0, 0)
  useScene.temporal.getState().clear()
  const run = (node: StringLightNode, name: string) => {
    const action = lightQuickActions({ node }).find((a) => a.id === `string-light:${name}`)!
    expect(action.history).toBe('single')
    action.run({ node } as never)
    expect(useLightDraft.getState().error).toBe('')
    return useScene.getState().nodes[light.id] as unknown as StringLightNode
  }
  const wrapped = run(light, 'wrap')
  expect(wrapped.points.length).toBeGreaterThan(100)
  expect(wrapped.anchors.length).toBe(wrapped.points.length)
  expect([wrapped.bulbSize, wrapped.spacing, wrapped.colors, wrapped.sag]).toEqual([
    light.bulbSize,
    light.spacing,
    light.colors,
    light.sag,
  ])
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[light.id]).toEqual(light as never)
  useScene.temporal.getState().redo()
  const straight = run(wrapped, 'straight')
  expect(straight.points).toHaveLength(2)
  expect(straight.curve).toBe('straight')
  const sagged = run(straight, 'sag')
  expect(sagged.curve).toBe('sag')
  expect(sagged.sag).toBe(0.3)
  const past = useScene.temporal.getState().pastStates.length
  sceneRegistry.nodes.delete(host.id)
  lightQuickActions({ node: sagged })
    .find((a) => a.id === 'string-light:wrap')!
    .run({ node: sagged } as never)
  expect(useLightDraft.getState().error).not.toBe('')
  expect(useScene.temporal.getState().pastStates).toHaveLength(past)
  expect(useScene.getState().nodes[light.id]).toEqual(sagged as never)
  useLightDraft.setState({ error: '' })
})

test('free drawing reuses snapped support hosts for quick wrapping without a target picker', () => {
  model.rotation.set(0, 0, 0)
  model.scale.set(1, 1, 1)
  object.position.set(0, 0, 0)
  object.rotation.set(0, 0, 0)
  const points: StringLightNode['points'] = [
    [0.56, -1.6, 0],
    [0, 1.6, 0.24],
  ]
  light = updateLight(light.id, {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    surfaceTargets: [],
    points,
    anchors: points.map((point, index) => ({
      index,
      nodeId: host.id,
      localPosition: point,
      referencePosition: point,
    })),
  })
  useScene.temporal.getState().clear()
  const actions = lightQuickActions({ node: light })
  expect(actions.find((a) => a.id === 'string-light:follow')!.disabled).toBe(false)
  const wrap = actions.find((a) => a.id === 'string-light:wrap')!
  expect(wrap.disabled).toBe(false)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  wrap.run({ node: light } as never)
  expect(useLightDraft.getState().error).toBe('')
  const wrapped = useScene.getState().nodes[light.id] as unknown as StringLightNode
  expect(wrapped.surfaceTargets).toEqual([host.id])
  expect(wrapped.points.length).toBeGreaterThan(100)
  expect(wrapped.anchors.every((anchor) => anchor.nodeId === host.id)).toBe(true)
  expect([wrapped.bulbSize, wrapped.spacing, wrapped.colors]).toEqual([
    light.bulbSize,
    light.spacing,
    light.colors,
  ])
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[light.id]).toEqual(light as never)
})

test('automatic quick targets preserve explicit restrictions and do not guess a wrap host', () => {
  const anchor = {
    index: 0,
    nodeId: host.id,
    localPosition: [0, 0, 0],
    referencePosition: [0, 0, 0],
  }
  const enabled = (node: StringLightNode, kind: string) =>
    !lightQuickActions({ node }).find((a) => a.id === `string-light:${kind}`)!.disabled
  const attached = StringLightNode.parse({ ...light, surfaceTargets: [], anchors: [anchor] })
  expect(enabled(attached, 'wrap')).toBe(true)
  expect(enabled({ ...attached, anchors: [] }, 'wrap')).toBe(false)
  expect(enabled({ ...attached, anchors: [] }, 'follow')).toBe(false)
  expect(
    enabled(
      {
        ...attached,
        anchors: [attached.anchors[0]!, { ...attached.anchors[0]!, index: 1, nodeId: 'other' }],
      },
      'wrap',
    ),
  ).toBe(false)
  expect(enabled({ ...attached, surfaceTargets: [host.id, 'other'] }, 'wrap')).toBe(false)
})

test('unresolved bulb volume collisions reject quick application without changing the scene', () => {
  model.clear()
  model.rotation.set(0, 0, 0)
  model.scale.set(1, 1, 1)
  model.add(new Mesh(new BoxGeometry(4, 8, 4), new MeshBasicMaterial()))
  object.position.set(0, 0, 0)
  object.rotation.set(0, 0, 0)
  light = updateLight(light.id, {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    points: [
      [-1, 4.05, 0],
      [1, 4.05, 0],
    ],
    bulbHead: 's14',
    arrangement: 'pendant',
    drop: 2,
  })
  useScene.temporal.getState().clear()
  const preview = prepareSurfaceLayout(light, level.id, defaultSurfaceLayout)
  expect(preview.crossings).toBe(0)
  expect(preview.collisions).toBeGreaterThan(0)
  lightQuickActions({ node: light })
    .find((a) => a.id === 'string-light:follow')!
    .run({ node: light } as never)
  expect(useLightDraft.getState().error).toContain('灯泡')
  expect(useScene.getState().nodes[light.id]).toEqual(light as never)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  useLightDraft.setState({ error: '' })
})
