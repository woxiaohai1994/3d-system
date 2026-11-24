import { expect, test } from 'bun:test'
import { act, create } from '@react-three/test-renderer'
import { createElement } from 'react'
import { Group, InstancedMesh, Matrix4, Vector3 } from 'three'
import {
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import LightRenderer from '../../../string-lights-plugin/src/renderer'
import { commitLight } from '../../../string-lights-plugin/src/commands'
import { stringLightDefinition } from '../../../string-lights-plugin/src/definition'
import { LIGHT_KIND, type StringLightNode } from '../../../string-lights-plugin/src/schema'
import { planLightContext } from '../../../string-lights-plugin/src/plan-light'
import {
  collectParticipants,
  rotateGroupPatches,
  translateGroupPatches,
} from '../../packages/editor/src/components/editor/group-transform-shared'

test('mounted group preview matches commit for host plus attached string, repeated translation/rotation and cancel', async () => {
  const saved = useScene.getState(),
    overrides = useLiveNodeOverrides.getState().overrides
  const registry = new Map(sceneRegistry.nodes),
    restore = nodeRegistry._snapshot()
  const raf = globalThis.requestAnimationFrame,
    caf = globalThis.cancelAnimationFrame
  const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const savedAct = actGlobal.IS_REACT_ACT_ENVIRONMENT
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  if (!nodeRegistry.has(LIGHT_KIND)) registerNode(stringLightDefinition as never)
  const level = LevelNode.parse({ level: 0 })
  const host = ItemNode.parse({
    parentId: level.id,
    position: [2, 0, 1],
    rotation: [0, 0.4, 0],
    asset: { id: 'post', name: 'Post', src: '/post.glb', thumbnail: '', category: 'furniture' },
  })
  useScene.setState({
    nodes: { [level.id]: level, [host.id]: host },
    rootNodeIds: [level.id],
    readOnly: false,
  })
  useLiveNodeOverrides.getState().clearAll()
  sceneRegistry.nodes.clear()
  const model = new Group()
  model.position.fromArray(host.position)
  model.rotation.fromArray([...host.rotation, 'XYZ'])
  model.updateMatrixWorld(true)
  sceneRegistry.nodes.set(host.id, model)
  const light = commitLight(
    {
      curve: 'straight',
      distribution: 'count',
      count: 5,
      points: [
        [1, 2, 0],
        [3, 2, 0],
      ],
      anchors: [1, 3].map((x, index) => ({
        index,
        nodeId: host.id,
        localPosition: [x, 2, 0],
        referencePosition: [x, 2, 0],
      })),
    },
    level.id,
  )
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  function Probe() {
    const node = useScene((s) => s.nodes[light.id]) as unknown as StringLightNode
    return createElement(LightRenderer, { node })
  }
  const renderer = await create(createElement(Probe))
  const bulbs = () => {
    const points: Vector3[] = [],
      matrix = new Matrix4()
    renderer.scene.instance.updateMatrixWorld(true)
    renderer.scene.instance.traverse((object) => {
      if (!(object instanceof InstancedMesh) || !object.geometry.hasAttribute('lightEmission'))
        return
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, matrix)
        points.push(new Vector3().setFromMatrixPosition(matrix).applyMatrix4(object.matrixWorld))
      }
    })
    expect(points.length).toBeGreaterThan(0)
    return points
  }
  const close = (a: Vector3[], b: Vector3[]) => {
    expect(a.length).toBe(b.length)
    a.forEach((p, i) => expect(p.distanceTo(b[i]!)).toBeLessThan(1e-5))
  }
  try {
    await act(async () => {
      await renderer.advanceFrames(3, 1 / 60)
    })
    const initial = bulbs(),
      baseline = useScene.getState().nodes
    const { starts, links } = collectParticipants([host.id, light.id], baseline, level.id)
    let finalEntries: ReturnType<typeof translateGroupPatches> = []
    for (const amount of [0.1, 0.4, 1.2]) {
      finalEntries = translateGroupPatches(starts, links, amount, -amount / 2)
      await act(async () => {
        useLiveNodeOverrides.getState().setMany(finalEntries)
        const patch = new Map(finalEntries).get(host.id)!
        model.position.fromArray(patch.position as [number, number, number])
        model.updateMatrixWorld(true)
      })
      await act(async () => {
        await renderer.advanceFrames(2, 1 / 60)
      })
      close(
        bulbs(),
        initial.map((p) => p.clone().add(new Vector3(amount, 0, -amount / 2))),
      )
      const next = { ...baseline }
      for (const [id, patch] of finalEntries) next[id] = { ...next[id], ...patch } as never
      const lightNext = next[light.id] as unknown as StringLightNode
      const plan = planLightContext(lightNext, (id) => next[id as keyof typeof next]).points!(
        lightNext,
      )
      plan.forEach((p, i) =>
        expect(new Vector3(...p).distanceTo(new Vector3(...lightNext.points[i]!))).toBeLessThan(
          1e-7,
        ),
      )
      expect(useScene.getState().nodes).toBe(baseline)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    }
    const preview = bulbs()
    await act(async () => {
      useScene.getState().updateNodes(finalEntries.map(([id, data]) => ({ id, data })))
      useLiveNodeOverrides.getState().clearAll()
    })
    await act(async () => {
      await renderer.advanceFrames(3, 1 / 60)
    })
    close(bulbs(), preview)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    await act(async () => {
      useScene.temporal.getState().undo()
      model.position.fromArray(host.position)
    })
    await act(async () => {
      await renderer.advanceFrames(3, 1 / 60)
    })
    close(bulbs(), initial)
    const pivot = { x: 1, z: 2 }
    for (const angle of [0.2, 0.7]) {
      const entries = rotateGroupPatches(starts, links, pivot, angle)
      await act(async () => {
        useLiveNodeOverrides.getState().setMany(entries)
        const patch = new Map(entries).get(host.id)!
        model.position.fromArray(patch.position as [number, number, number])
        model.rotation.fromArray([...(patch.rotation as [number, number, number]), 'XYZ'])
        model.updateMatrixWorld(true)
      })
      await act(async () => {
        await renderer.advanceFrames(2, 1 / 60)
      })
      close(
        bulbs(),
        initial.map((p) => {
          const x = p.x - pivot.x,
            z = p.z - pivot.z
          return new Vector3(
            pivot.x + x * Math.cos(angle) - z * Math.sin(angle),
            p.y,
            pivot.z + x * Math.sin(angle) + z * Math.cos(angle),
          )
        }),
      )
    }
    await act(async () => {
      useLiveNodeOverrides.getState().clearAll()
      model.position.fromArray(host.position)
      model.rotation.fromArray([...host.rotation, 'XYZ'])
    })
    await act(async () => {
      await renderer.advanceFrames(3, 1 / 60)
    })
    close(bulbs(), initial)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  } finally {
    await renderer.unmount()
    useScene.setState(saved)
    useScene.temporal.getState().clear()
    useLiveNodeOverrides.setState({ overrides })
    restore()
    sceneRegistry.nodes.clear()
    registry.forEach((v, k) => sceneRegistry.nodes.set(k, v))
    globalThis.requestAnimationFrame = raf
    globalThis.cancelAnimationFrame = caf
    actGlobal.IS_REACT_ACT_ENVIRONMENT = savedAct
  }
})
