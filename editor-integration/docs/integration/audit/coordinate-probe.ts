import {
  BuildingNode,
  clearSceneHistory,
  getScaledDimensions,
  ItemNode,
  LevelNode,
  nodeRegistry,
  SiteNode,
  useScene,
} from '@pascal-app/core'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { openPlanFurnitureLocalMatrix } from '../../../packages/editor/src/integrations/openplan/coordinates'
import { sceneCoordinateFrames } from '../../../packages/editor/src/integrations/pascal/scene-coordinates'
import { SceneEditAdapter } from '../../../packages/editor/src/integrations/pascal/scene-edit-adapter'

export async function runCoordinateProbe() {
  const saved = useScene.getState()
  const restore = nodeRegistry._snapshot()
  const adapter = new SceneEditAdapter('coordinate-browser')
  try {
    nodeRegistry._reset()
    nodeRegistry._register({
      kind: 'item',
      category: 'furnish',
      schema: ItemNode,
      schemaVersion: 1,
      defaults: () => ({}),
      capabilities: {
        floorPlaced: {
          footprint: (node) => ({
            dimensions: getScaledDimensions(node as ItemNode),
            rotation: (node as ItemNode).rotation,
          }),
          applies: (node) => !(node as ItemNode).asset.attachTo,
        },
      },
    })
    const site = SiteNode.parse({})
    const building = BuildingNode.parse({
      parentId: site.id,
      position: [10, 2, 20],
      rotation: [0, Math.PI / 2, 0],
    })
    const ground = LevelNode.parse({ parentId: building.id, height: 3, baseElevation: 0.5 })
    const upper = LevelNode.parse({
      parentId: building.id,
      level: 1,
      height: 4,
      baseElevation: 0.25,
    })
    const item = ItemNode.parse({
      parentId: upper.id,
      asset: {
        id: 'asymmetric',
        name: '非对称方向夹具',
        category: 'fixture',
        src: '/fixture.glb',
        thumbnail: '',
        dimensions: [2, 1, 0.5],
      },
    })
    site.children = [building.id]
    building.children = [ground.id, upper.id]
    upper.children = [item.id]
    useScene.setState({
      nodes: Object.fromEntries(
        [site, building, ground, upper, item].map((node) => [node.id, node]),
      ),
      rootNodeIds: [site.id],
      collections: {},
      materials: {},
      installedPlugins: [],
      readOnly: false,
    })
    clearSceneHistory()
    const before = adapter.read().scene
    const matrix = new Matrix4().compose(
      new Vector3(12, 6.5, 16),
      new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0)),
      new Vector3(-2, 3, 0.5),
    )
    const preview = adapter.prepare({
      ...adapter.read(),
      requestId: 'mirrored-world',
      operations: [{ op: 'transform', id: item.id, matrix: matrix.elements }],
    })
    const close = (a: number[], b: number[]) =>
      a.length === b.length && a.every((n, i) => Math.abs(n - b[i]!) < 1e-8)
    const checks: Record<string, boolean> = {
      detachedPreview: JSON.stringify(before) === JSON.stringify(adapter.read().scene),
    }
    adapter.commit(preview)
    const after = adapter.read().scene
    const placed = after.nodes[item.id] as ItemNode
    checks.localCoordinates = close(placed.position, [4, 0.75, 2])
    checks.mirrorScale = close(placed.scale, [-2, 3, 0.5])
    const world = sceneCoordinateFrames(after)
      .frame(item.id)
      .scale(new Vector3(...placed.scale))
    checks.asymmetricWorldMarker = close(
      new Vector3(1, 0, 0).applyMatrix4(world).toArray(),
      [12, 6.5, 18],
    )
    checks.singleHistory = useScene.temporal.getState().pastStates.length === 1
    useScene.temporal.getState().undo()
    await Promise.resolve()
    checks.undo = JSON.stringify(adapter.read().scene) === JSON.stringify(before)
    useScene.temporal.getState().redo()
    await Promise.resolve()
    checks.redo = JSON.stringify(adapter.read().scene) === JSON.stringify(after)
    const shear = matrix.clone()
    shear.elements[4] = 0.5
    let rejected = false
    try {
      adapter.prepare({
        ...adapter.read(),
        requestId: 'shear',
        operations: [{ op: 'transform', id: item.id, matrix: shear.elements }],
      })
    } catch (error) {
      rejected = error instanceof Error && error.message === 'SHEAR_TRANSFORM'
    }
    checks.shearRejectedAtomically =
      rejected &&
      JSON.stringify(adapter.read().scene) === JSON.stringify(after) &&
      useScene.temporal.getState().pastStates.length === 1
    checks.openPlanCardinalDirections = [0, 90, 180, -90].every((rotation, index) => {
      const local = new Matrix4().fromArray(
        openPlanFurnitureLocalMatrix(
          { position: { x: 100, y: 250 }, rotation, scale: { x: 1, y: 1, z: 1 } },
          { elevationMeters: 0.8, forwardCorrectionRadians: 0 },
        ),
      )
      return (
        close(new Vector3().applyMatrix4(local).toArray(), [1, 0.8, 2.5]) &&
        close(
          new Vector3(1, 0, 0).transformDirection(local).toArray(),
          [
            [1, 0, 0],
            [0, 0, 1],
            [-1, 0, 0],
            [0, 0, -1],
          ][index]!,
        )
      )
    })
    const mappedScale = new Matrix4().fromArray(
      openPlanFurnitureLocalMatrix(
        { position: { x: 100, y: 250 }, rotation: 90, scale: { x: -2, y: -3, z: -0.5 } },
        { elevationMeters: 0.8, forwardCorrectionRadians: 0 },
      ),
    )
    checks.openPlanScaleAxes = close(
      new Vector3(1, 1, 1).applyMatrix4(mappedScale).toArray(),
      [4, 1.3, 0.5],
    )
    const persisted = JSON.parse(JSON.stringify(after))
    useScene
      .getState()
      .setScene(persisted.nodes, persisted.rootNodeIds, {
        collections: persisted.collections,
        materials: persisted.materials,
        installedPlugins: persisted.installedPlugins,
      })
    checks.jsonReload = close(
      sceneCoordinateFrames(adapter.read().scene)
        .frame(item.id)
        .scale(new Vector3(...(useScene.getState().nodes[item.id] as ItemNode).scale)).elements,
      matrix.elements,
    )
    return {
      checks,
      passed: Object.values(checks).every(Boolean),
      localPosition: placed.position,
      scale: placed.scale,
    }
  } finally {
    adapter.dispose()
    restore()
    useScene.setState(saved)
    clearSceneHistory()
  }
}
