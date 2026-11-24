import { expect, test, spyOn } from 'bun:test'
import {
  LevelNode,
  nodeRegistry,
  registerNode,
  useScene,
  sceneRegistry,
  useLiveNodeOverrides,
  capturePointAttachment,
  resolvePointAttachment,
} from '@pascal-app/core'
import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Texture,
  TextureLoader,
  Triangle,
  Vector3,
} from 'three'
import { treeDefinition } from '../../node_modules/@pascal-app/plugin-trees/src/definition'
import { TreeNode } from '../../node_modules/@pascal-app/plugin-trees/src/schema'
import { stringLightDefinition } from '../../../string-lights-plugin/src/definition'
import { commitLight } from '../../../string-lights-plugin/src/commands'
import { planLightContext } from '../../../string-lights-plugin/src/plan-light'
import { resolveLightPoints } from '../../../string-lights-plugin/src/surface-anchors'
import { apiGraphSchema } from '../../apps/editor/lib/graph-schema'

test('tree height attachment follows uniform geometry scaling in 2D/3D, previews, history and serialization', () => {
  const raf = globalThis.requestAnimationFrame,
    caf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const restore = nodeRegistry._snapshot(),
    saved = useScene.getState()
  const registry = new Map(sceneRegistry.nodes),
    overrides = useLiveNodeOverrides.getState().overrides
  if (!nodeRegistry.has('trees:tree')) registerNode(treeDefinition as never)
  if (!nodeRegistry.has(stringLightDefinition.kind)) registerNode(stringLightDefinition as never)
  const level = LevelNode.parse({ level: 0 })
  const tree = TreeNode.parse({
    parentId: level.id,
    height: 5,
    position: [2, 0, 1],
    rotation: [0, 0.3, 0],
  })
  const host = new Group(),
    object = new Group()
  host.position.fromArray(tree.position)
  host.rotation.fromArray([...tree.rotation, 'XYZ'])
  host.updateMatrixWorld(true)
  sceneRegistry.nodes.set(tree.id, host)
  useScene.setState({
    nodes: { [level.id]: level, [tree.id]: tree as never },
    rootNodeIds: [level.id],
    readOnly: false,
  })
  useLiveNodeOverrides.getState().clearAll()
  const local = [
    [0.12, 1, 0.03],
    [-0.12, 2, 0.08],
  ] as [number, number, number][]
  const points = local.map((p) => host.localToWorld(new Vector3(...p)).toArray())
  try {
    const light = commitLight(
      {
        points,
        curve: 'straight',
        spacing: 0.35,
        bulbSize: 0.045,
        colors: ['#ff0000', '#ffffff'],
        anchors: points.map((p, index) => ({
          index,
          nodeId: tree.id,
          localPosition: local[index]!,
          referencePosition: p,
        })),
      },
      level.id,
    )
    sceneRegistry.nodes.set(light.id, object)
    const stored = JSON.parse(JSON.stringify(light)) as typeof light
    expect(stored.anchors.every((a) => a.attachment?.kind === 'trees%3Atree')).toBe(true)
    const graph = { nodes: useScene.getState().nodes, rootNodeIds: [level.id] }
    expect(apiGraphSchema.safeParse(graph).success).toBe(true)
    const hostile = {
      ...stored,
      anchors: stored.anchors.map((a) => ({
        ...a,
        attachment: {
          ...a.attachment!,
          parameters: { ...a.attachment!.parameters, src: 'javascript:alert(1)' },
        },
      })),
    }
    expect(
      apiGraphSchema.safeParse({ ...graph, nodes: { ...graph.nodes, [stored.id]: hostile } })
        .success,
    ).toBe(false)
    useScene.temporal.getState().resume()
    useScene.temporal.getState().clear()
    const baseline = useScene.getState().nodes
    useLiveNodeOverrides.getState().set(tree.id, { height: 8 })
    const preview = resolveLightPoints(stored, object, (id) => sceneRegistry.nodes.get(id))
    const effective = { ...baseline, [tree.id]: { ...tree, height: 8 } as never }
    const plan = planLightContext(stored, (id) => effective[id]).points!(stored)
    preview.forEach((p, i) => {
      const expected = host.localToWorld(new Vector3(...local[i]!).multiplyScalar(8 / 5))
      expect(new Vector3(...p).distanceTo(expected)).toBeLessThan(1e-6)
      expect(new Vector3(...plan[i]!).distanceTo(expected)).toBeLessThan(1e-6)
    })
    expect(useScene.getState().nodes).toBe(baseline)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    useLiveNodeOverrides.getState().clear(tree.id)
    useScene.getState().updateNode(tree.id as never, { height: 8 } as never)
    expect(resolveLightPoints(stored, object, (id) => sceneRegistry.nodes.get(id))).toEqual(preview)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    resolveLightPoints(stored, object, (id) => sceneRegistry.nodes.get(id)).forEach((p, i) => {
      expect(new Vector3(...p).distanceTo(new Vector3(...points[i]!))).toBeLessThan(1e-6)
    })
    expect(useScene.getState().nodes[light.id]).toEqual(light)
  } finally {
    globalThis.requestAnimationFrame = raf
    globalThis.cancelAnimationFrame = caf
    useLiveNodeOverrides.setState({ overrides })
    useScene.setState(saved)
    sceneRegistry.nodes.clear()
    registry.forEach((v, k) => sceneRegistry.nodes.set(k, v))
    restore()
  }
})

test('tree appearance edits keep binding; headless geometry regeneration fails safely', () => {
  const restore = nodeRegistry._snapshot()
  if (!nodeRegistry.has('trees:tree')) registerNode(treeDefinition as never)
  try {
    for (const preset of ['oak', 'pine', 'aspen', 'ash', 'bush', 'trellis'] as const) {
      const tree = TreeNode.parse({ preset, height: 7 })
      const nodes = { [tree.id]: tree as never }
      const binding = capturePointAttachment(tree as never, [0.1, 2, 0.2], nodes)!
      expect(
        resolvePointAttachment(binding, {
          [tree.id]: { ...tree, branchColor: '#123456', leafColor: '#abcdef' } as never,
        }),
      ).toEqual([0.1, 2, 0.2])
      for (const patch of [
        { seed: 13 },
        { trunkThickness: 1.8 },
        { leafless: true },
        { foliageDensity: 0.5 },
        { size: 'large' },
        { treeType: 'evergreen' },
      ]) {
        expect(
          resolvePointAttachment(binding, { [tree.id]: { ...tree, ...patch } as never }),
        ).toBeNull()
      }
    }
  } finally {
    restore()
  }
})

test('real generated tree bark retains surface anchors through thickness and foliage regeneration', () => {
  const load = spyOn(TextureLoader.prototype, 'load').mockImplementation(() => new Texture())
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const restore = nodeRegistry._snapshot()
  if (!nodeRegistry.has('trees:tree')) registerNode(treeDefinition as never)
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {} })
  try {
    const { getVariantData, treeSpecOf } =
      require('../../node_modules/@pascal-app/plugin-trees/src/geometry') as typeof import('../../node_modules/@pascal-app/plugin-trees/src/geometry')
    for (const preset of ['oak', 'pine', 'aspen', 'ash', 'bush', 'trellis'] as const) {
      const tree = TreeNode.parse({ preset, size: 'small', height: 5 })
      const data = getVariantData(treeSpecOf(tree))
      const bark = data.subMeshes.find((part) => part.role === 'branches')!
      expect(bark).toBeDefined()
      const mesh = new Mesh(bark.geometry, new MeshBasicMaterial({ side: DoubleSide }))
      mesh.scale.setScalar(tree.height / data.naturalHeight)
      mesh.updateMatrixWorld(true)
      const hit = new Raycaster(new Vector3(3, 0.4, 0.013), new Vector3(-1, 0, 0)).intersectObject(
        mesh,
      )[0]!
      expect(hit).toBeDefined()
      const point = hit.point.clone().addScaledVector(hit.face!.normal, 0.04)
      const binding = capturePointAttachment(tree as never, point.toArray(), {
        [tree.id]: tree as never,
      })!
      for (const patch of [
        { trunkThickness: 1.8 },
        { trunkThickness: 0.5 },
        { foliageDensity: 0.5 },
        { leafless: true },
      ]) {
        const next = TreeNode.parse({ ...tree, ...patch })
        const resolved = resolvePointAttachment(JSON.parse(JSON.stringify(binding)), {
          [tree.id]: next as never,
        })
        expect(resolved).not.toBeNull()
        const nextData = getVariantData(treeSpecOf(next))
        const nextBark = nextData.subMeshes.find((part) => part.role === 'branches')!
        // Independently recover the raycast triangle correspondence from the actual render meshes.
        const oldPosition = bark.geometry.getAttribute('position'),
          nextPosition = nextBark.geometry.getAttribute('position')
        const ids = [hit.face!.a, hit.face!.b, hit.face!.c]
        const oldVertices = ids.map((id) =>
          new Vector3()
            .fromBufferAttribute(oldPosition, id)
            .multiplyScalar(tree.height / data.naturalHeight),
        )
        const newVertices = ids.map((id) =>
          new Vector3()
            .fromBufferAttribute(nextPosition, id)
            .multiplyScalar(next.height / nextData.naturalHeight),
        )
        const bary = new Triangle(...(oldVertices as [Vector3, Vector3, Vector3])).getBarycoord(
          hit.point,
          new Vector3(),
        )!
        const newTriangle = new Triangle(...(newVertices as [Vector3, Vector3, Vector3]))
        const expected = newVertices[0]!
          .clone()
          .multiplyScalar(bary.x)
          .addScaledVector(newVertices[1]!, bary.y)
          .addScaledVector(newVertices[2]!, bary.z)
          .addScaledVector(newTriangle.getNormal(new Vector3()), 0.04)
        expect(new Vector3(...resolved!).distanceTo(expected)).toBeLessThan(2e-5)
      }
      expect(
        resolvePointAttachment(binding, { [tree.id]: { ...tree, seed: 987 } as never }),
      ).toBeNull()
      const canopy = capturePointAttachment(tree as never, [8, 3, 8], { [tree.id]: tree as never })!
      expect(
        resolvePointAttachment(canopy, { [tree.id]: { ...tree, trunkThickness: 1.8 } as never }),
      ).toBeNull()
      mesh.material.dispose()
    }
  } finally {
    load.mockRestore()
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument)
    else Reflect.deleteProperty(globalThis, 'document')
    restore()
  }
})
