import { expect, test } from 'bun:test'
import {
  emitter,
  SceneCameraNode,
  SiteNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  createSourceCameraRig,
  OVERLAY_LAYER,
  sceneCameraRigPose,
  sceneCameraSourceDisplay,
  sourceCameraObjectWireColors,
  useViewer,
} from '@pascal-app/viewer'
import { create } from '@react-three/test-renderer'
import { act } from 'react'
import {
  Color,
  Euler,
  Group,
  type LineSegments,
  Matrix4,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  Vector3,
} from 'three'
import {
  createSceneCameraBodyVisibility,
  hideSceneCameraHelpers,
} from '../../../editor/src/components/scene-camera/camera-visibility'
import SceneCameraRenderer from './renderer'

async function fixture(type: 'dolly' | 'crane' | '2d' | null, parentScale = new Vector3(1, 1, 1)) {
  const saved = {
    scene: useScene.getState(),
    viewer: useViewer.getState(),
    overrides: useLiveNodeOverrides.getState(),
    act: Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'),
  }
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const site = SiteNode.parse({}),
    node = SceneCameraNode.parse({ parentId: site.id }),
    parent = new Group(),
    camera = new PerspectiveCamera(50, 1, 0.01, 1000)
  parent.position.set(3, 2, -4)
  parent.rotation.set(0.1, -0.3, 0.2)
  parent.scale.copy(parentScale)
  parent.updateMatrixWorld(true)
  sceneRegistry.nodes.set(site.id, parent)
  if (type) {
    node.rig = createSourceCameraRig(type, sceneCameraRigPose(node))
    node.rig.native!.cameraOffsetMatrix = new Matrix4()
      .compose(
        new Vector3(2, -1, 0.5),
        new Quaternion().setFromEuler(new Euler(0.1, 0.3, -0.2)),
        new Vector3(1, 1, 1),
      )
      .toArray()
    node.rig.native!.lensShift = [0.3, -0.2]
    node.rig.native!.bones.Root!.rotation = [0.2, -0.3, 0.4]
    node.rig.native!.bones.Root!.scale = [1.7, 0.8, 1.2]
  }
  site.children = [node.id]
  useLiveNodeOverrides.getState().clearAll()
  useScene.setState({ nodes: { [site.id]: site, [node.id]: node }, rootNodeIds: [site.id] })
  useViewer.setState({
    selection: { ...saved.viewer.selection, selectedIds: [node.id] },
    cameraDragging: false,
    inputDragging: false,
  })
  camera.position.set(20, 15, 20)
  camera.lookAt(0, 2, 0)
  camera.updateMatrixWorld()
  const renderer = await create(
    <primitive object={parent}>
      <SceneCameraRenderer node={node} />
    </primitive>,
    { camera },
  )
  await renderer.advanceFrames(1, 1 / 60)
  const root = sceneRegistry.nodes.get(node.id)!
  root.updateWorldMatrix(true, true)
  const line = renderer.scene.findAllByType('LineSegments')[0]!,
    source = renderer.scene.findAll((n) => !!n.instance.userData.sceneCameraSourceFrame)[0]
  return {
    node,
    parent,
    camera,
    root,
    line,
    source,
    renderer,
    async dispose() {
      await renderer.unmount()
      sceneRegistry.nodes.delete(site.id)
      useLiveNodeOverrides.setState(saved.overrides, true)
      useScene.setState(saved.scene, true)
      useViewer.setState(saved.viewer, true)
      if (saved.act) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', saved.act)
      else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
    },
  }
}

for (const type of ['dolly', 'crane', '2d'] as const)
  test(`mounted ${type} source frame keeps physical registry origin, shear and live body offset through a nonuniform parent`, async () => {
    const f = await fixture(type, new Vector3(2, 0.7, 1.4))
    try {
      const verify = (node = f.node) => {
        const display = sceneCameraSourceDisplay(node)!,
          expectedBody = f.parent.matrixWorld.clone().multiply(display.bodyMatrix),
          geometry = (f.line.instance as LineSegments).geometry,
          position = geometry.getAttribute('position')
        f.root.updateWorldMatrix(true, true)
        f.root.matrixWorld.elements.forEach((value, i) => {
          expect(Math.abs(value - expectedBody.elements[i]!)).toBeLessThan(1e-10)
        })
        expect(position.count).toBe(22)
        for (let i = 0; i < position.count; i++) {
          const actual = new Vector3()
              .fromBufferAttribute(position, i)
              .applyMatrix4(f.source.instance.matrixWorld),
            expected = new Vector3()
              .fromArray(i < 16 ? display.frame : display.triangle!, (i < 16 ? i : i - 16) * 3)
              .applyMatrix4(display.matrix)
          expect(actual.distanceTo(expected)).toBeLessThan(1e-8)
        }
        expect(
          new Vector3()
            .setFromMatrixPosition(f.source.instance.matrixWorld)
            .distanceTo(new Vector3().setFromMatrixPosition(f.root.matrixWorld)),
        ).toBeLessThan(1e-5)
        expect(f.source.instance.visible).toBe(true)
        expect(f.source.instance.parent!.visible).toBe(true)
      }
      verify()
      const rig = structuredClone(f.node.rig!)
      rig.native!.cameraOffsetMatrix = new Matrix4().makeTranslation(-1, 2, 0.3).toArray()
      await act(async () => {
        useLiveNodeOverrides.getState().set(f.node.id, { rig })
        await f.renderer.advanceFrames(1, 1 / 60)
      })
      verify({ ...f.node, rig })
      expect(useScene.getState().nodes[f.node.id]).toBe(f.node)
      expect(f.renderer.scene.findAllByType('Mesh')).toHaveLength(0)
    } finally {
      await f.dispose()
    }
  })

test('source frame uses native object colors and ordinary object selection while Pose blocks only its raycast', async () => {
  const f = await fixture('dolly'),
    visibility = createSceneCameraBodyVisibility(),
    clicks: string[] = [],
    clicked = ({ node }: { node: SceneCameraNode }) => clicks.push(node.id)
  emitter.on('scene-camera:click', clicked)
  try {
    const line = f.line.instance as LineSegments,
      color = new Color().setRGB(
        ...(sourceCameraObjectWireColors.active as [number, number, number]),
        SRGBColorSpace,
      )
    expect((line.material as { color: Color }).color.toArray()).toEqual(color.toArray())
    for (const [state, ids] of [
      ['select', [f.node.id, f.node.parentId!]],
      ['normal', []],
      ['active', [f.node.id]],
    ] as const) {
      await act(async () => {
        useViewer.setState({
          selection: { ...useViewer.getState().selection, selectedIds: [...ids] },
        })
        await f.renderer.advanceFrames(1, 1 / 60)
      })
      color.setRGB(
        ...(sourceCameraObjectWireColors[state] as [number, number, number]),
        SRGBColorSpace,
      )
      expect((line.material as { color: Color }).color.toArray()).toEqual(color.toArray())
      expect(f.source.instance.parent!.visible).toBe(true)
    }
    const position = line.geometry.getAttribute('position'),
      a = new Vector3().fromBufferAttribute(position, 0).applyMatrix4(line.matrixWorld),
      b = new Vector3().fromBufferAttribute(position, 1).applyMatrix4(line.matrixWorld),
      point = a.clone().add(b).multiplyScalar(0.5),
      origin = point.clone().add(new Vector3(0, 0, 1)),
      raycaster = new Raycaster(origin, point.clone().sub(origin).normalize()),
      raycast = line.raycast
    raycaster.layers.set(OVERLAY_LAYER)
    expect(raycaster.intersectObject(f.root)).not.toHaveLength(0)
    await f.renderer.fireEvent(f.line, 'pointerUp', {
      button: 0,
      object: line,
      point,
      stopPropagation() {},
    })
    expect(clicks).toEqual([f.node.id])
    visibility.sync(f.root)
    expect(f.source.instance.visible).toBe(true)
    expect(raycaster.intersectObject(f.root)).toHaveLength(0)
    const visible: unknown[] = []
    f.root.traverseVisible((object) => visible.push(object))
    expect(visible).toContain(line)
    visibility.restore()
    expect(line.raycast).toBe(raycast)
    expect(raycaster.intersectObject(f.root)).not.toHaveLength(0)
    const restore = hideSceneCameraHelpers(f.renderer.scene.instance)
    const captureVisible: unknown[] = []
    f.renderer.scene.instance.traverseVisible((object) => captureVisible.push(object))
    expect(captureVisible).not.toContain(line)
    restore()
    expect(f.root.visible).toBe(true)
  } finally {
    emitter.off('scene-camera:click', clicked)
    visibility.restore()
    await f.dispose()
  }
})

test('source frame hides for a zero parent axis without nonfinite geometry and nonrig cameras keep their body', async () => {
  const f = await fixture('dolly', new Vector3(0, 1, 1))
  try {
    expect(f.source.instance.parent!.visible).toBe(false)
    const body = sceneCameraSourceDisplay(f.node)!
    expect(body.visible).toBe(false)
    f.root.updateWorldMatrix(true, true)
    const expected = f.parent.matrixWorld.clone().multiply(body.bodyMatrix)
    f.root.matrixWorld.elements.forEach((value, i) => {
      expect(Number.isFinite(value)).toBe(true)
      expect(Math.abs(value - expected.elements[i]!)).toBeLessThan(1e-10)
    })
    expect(f.root.quaternion.toArray().every(Number.isFinite)).toBe(true)
    expect(
      [...(f.line.instance as LineSegments).geometry.getAttribute('position').array].every(
        Number.isFinite,
      ),
    ).toBe(true)
  } finally {
    await f.dispose()
  }
  const free = await fixture(null)
  try {
    expect(free.source).toBeUndefined()
    let meshes = 0
    free.root.traverse((object) => {
      if ('isMesh' in object && object.isMesh) meshes++
    })
    expect(meshes).toBe(2)
    const restore = hideSceneCameraHelpers(free.renderer.scene.instance)
    expect(free.root.visible).toBe(false)
    restore()
    expect(free.root.visible).toBe(true)
  } finally {
    await free.dispose()
  }
})
