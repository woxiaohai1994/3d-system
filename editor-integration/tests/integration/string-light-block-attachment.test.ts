import { expect, test } from 'bun:test'
import {
  BlockNode,
  LevelNode,
  capturePointAttachment,
  resolvePointAttachment,
  registerNode,
  nodeRegistry,
  useScene,
  sceneRegistry,
  useLiveNodeOverrides,
} from '@pascal-app/core'
import { Group, Mesh, Raycaster, Vector3 } from 'three'
import { blockDefinition } from '../../packages/nodes/src/block/definition'
import { buildBlockGeometry, getBlockSurface } from '../../packages/nodes/src/block/geometry'
import { stringLightDefinition } from '../../../string-lights-plugin/src/definition'
import { commitLight } from '../../../string-lights-plugin/src/commands'
import { planLightContext } from '../../../string-lights-plugin/src/plan-light'
import { resolveLightPoints } from '../../../string-lights-plugin/src/surface-anchors'
import { apiGraphSchema } from '../../apps/editor/lib/graph-schema'

test('block stable face bindings follow shape edits in 2D/3D, preview, history and saved graphs', () => {
  const restore = nodeRegistry._snapshot(),
    saved = useScene.getState(),
    registry = new Map(sceneRegistry.nodes)
  const overrides = useLiveNodeOverrides.getState().overrides
  const raf = globalThis.requestAnimationFrame,
    caf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  if (!nodeRegistry.has('block')) registerNode(blockDefinition)
  if (!nodeRegistry.has(stringLightDefinition.kind)) registerNode(stringLightDefinition as never)
  const level = LevelNode.parse({ level: 0 }),
    block = BlockNode.parse({ parentId: level.id })
  const rendered = buildBlockGeometry(block),
    host = new Group(),
    object = new Group()
  host.add(rendered)
  host.updateMatrixWorld(true)
  sceneRegistry.nodes.set(block.id, host)
  useScene.setState({
    nodes: { [level.id]: level, [block.id]: block },
    rootNodeIds: [level.id],
    readOnly: false,
  })
  useLiveNodeOverrides.getState().clearAll()
  try {
    const source = getBlockSurface(block)
    const renderMesh = rendered.children[0] as Mesh
    expect(renderMesh.geometry).not.toBe(source.geometry)
    expect(Array.from(renderMesh.geometry.getAttribute('position').array)).toEqual(
      Array.from(source.geometry.getAttribute('position').array),
    )
    const points = [0.25, -0.35].map((x) => {
      const hit = new Raycaster(new Vector3(x, 1.1, 5), new Vector3(0, 0, -1)).intersectObject(
        rendered,
        true,
      )[0]!
      expect(hit).toBeDefined()
      return hit.point.clone().addScaledVector(hit.face!.normal, 0.04).toArray()
    })
    const light = commitLight(
      {
        points,
        curve: 'straight',
        spacing: 0.3,
        bulbSize: 0.045,
        anchors: points.map((p, index) => ({
          index,
          nodeId: block.id,
          localPosition: p,
          referencePosition: p,
        })),
      },
      level.id,
    )
    sceneRegistry.nodes.set(light.id, object)
    const stored = JSON.parse(JSON.stringify(light)) as typeof light
    const topology = {
      ...block.topology,
      vertices: [...block.topology.vertices]
        .reverse()
        .map((v) => ({
          ...v,
          position: [v.position[0] * 1.5, v.position[1] * 2, v.position[2] * 0.7] as [
            number,
            number,
            number,
          ],
        })),
      faces: [...block.topology.faces].reverse(),
    }
    const next = { ...block, topology }
    const expected = points.map(
      (p) => new Vector3(p[0] * 1.5, p[1] * 2, (p[2] - 0.04) * 0.7 + 0.04),
    )
    useScene.temporal.getState().resume()
    useScene.temporal.getState().clear()
    useLiveNodeOverrides.getState().set(block.id, { topology })
    const preview = resolveLightPoints(stored, object, (id) => sceneRegistry.nodes.get(id))
    const nodes = { ...useScene.getState().nodes, [block.id]: next }
    const plan = planLightContext(stored, (id) => nodes[id]).points!(stored)
    preview.forEach((p, i) => {
      expect(new Vector3(...p).distanceTo(expected[i]!)).toBeLessThan(1e-6)
      expect(new Vector3(...plan[i]!).distanceTo(expected[i]!)).toBeLessThan(1e-6)
    })
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    useLiveNodeOverrides.getState().clear(block.id)
    useScene.getState().updateNode(block.id, { topology })
    expect(resolveLightPoints(stored, object, (id) => sceneRegistry.nodes.get(id))).toEqual(preview)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    const graph = JSON.parse(
      JSON.stringify({ nodes: useScene.getState().nodes, rootNodeIds: [level.id] }),
    )
    expect(apiGraphSchema.safeParse(graph).success).toBe(true)
    const restoredPlan = planLightContext(graph.nodes[light.id], (id) => graph.nodes[id]).points!(
      graph.nodes[light.id],
    )
    expect(restoredPlan).toEqual(plan)
    const binding = stored.anchors[0]!.attachment!
    const identity = JSON.parse(String(binding.parameters.triangle)) as string[]
    expect(
      resolvePointAttachment(binding, {
        [block.id]: {
          ...next,
          topology: { ...topology, faces: topology.faces.filter((f) => f.id !== identity[0]) },
        },
      }),
    ).toBeNull()
    renderMesh.geometry.dispose()
    expect(capturePointAttachment(block, points[0]!, { [block.id]: block })).toBeDefined()
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[block.id]).toEqual(block)
    const original = resolveLightPoints(stored, object, (id) => sceneRegistry.nodes.get(id))
    original.forEach((p, i) =>
      expect(new Vector3(...p).distanceTo(new Vector3(...points[i]!))).toBeLessThan(1e-6),
    )
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
