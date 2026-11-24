import { afterEach, expect, test } from 'bun:test'
import { ColumnNode, SceneCameraNode, SiteNode, sceneRegistry, useScene } from '@pascal-app/core'
import { createSourceCameraRig, sceneCameraRigPose, useViewer } from '@pascal-app/viewer'
import { BoxGeometry, Group, Matrix3, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { create } from '@react-three/test-renderer'
import { useThree } from '@react-three/fiber'
import { act } from 'react'
import { useMotionAnchorPicker } from './motion-anchor-picker'
import { renderToStaticMarkup } from 'react-dom/server'
import useEditor from '../../store/use-editor'
import { useSceneAnimation } from '../scene-animation/store'
import { alignRigToSurface } from './rig-surface-align'
import { sceneCameraWorldPose } from './camera-math'
import { RigAimControls } from './rig-aim-controls'
import { rigAimPickCamera, startRigAimPick, stopRigAimPick } from './rig-aim-picker'
import { rigSnapshot, setRigTarget, useRigEditor } from './rig-state'
import { useCameraStudio } from './store'

const savedScene = useScene.getState(),
  savedAnimation = useSceneAnimation.getState(),
  savedEditor = useEditor.getState(),
  savedViewer = useViewer.getState(),
  savedRig = useRigEditor.getState(),
  savedStudio = useCameraStudio.getState()
const savedRaf = globalThis.requestAnimationFrame,
  savedCancel = globalThis.cancelAnimationFrame
const objects: Group[] = []
afterEach(() => {
  stopRigAimPick()
  globalThis.requestAnimationFrame = savedRaf
  globalThis.cancelAnimationFrame = savedCancel
  useScene.setState(savedScene, true)
  useSceneAnimation.setState(savedAnimation, true)
  useEditor.setState(savedEditor, true)
  useViewer.setState(savedViewer, true)
  useRigEditor.setState(savedRig, true)
  useCameraStudio.setState(savedStudio, true)
  for (const object of objects.splice(0)) {
    sceneRegistry.nodes.delete(object.userData.id)
    object.traverse((child) => {
      if (child instanceof Mesh) {
        child.geometry.dispose()
        ;(child.material as MeshBasicMaterial).dispose()
      }
    })
  }
})
function setup(type?: 'dolly' | 'crane' | '2d') {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const site = SiteNode.parse({}),
    camera = SceneCameraNode.parse({ parentId: site.id, focalLength: 50 }),
    target = ColumnNode.parse({ parentId: site.id, name: '测试物品' })
  if (type) camera.rig = createSourceCameraRig(type, sceneCameraRigPose(camera))
  site.children = [camera.id, target.id]
  useScene.setState({
    nodes: { [site.id]: site, [camera.id]: camera, [target.id]: target },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useSceneAnimation.setState({
    open: false,
    cameraId: null,
    playing: false,
    exporting: false,
    previewing: false,
    lockedIds: [],
    cameraView: false,
    pickingRigAim: false,
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  const parent = new Group(),
    object = new Group()
  parent.position.set(7, 2, -4)
  parent.rotation.y = 0.4
  parent.scale.set(2, 1, 0.7)
  parent.add(object)
  object.position.set(2, 1, -5)
  const mesh = new Mesh(new BoxGeometry(2, 4, 2), new MeshBasicMaterial())
  mesh.position.set(0, 2, 0)
  object.add(mesh)
  for (const [id, value] of [
    [site.id, parent],
    [target.id, object],
  ] as const) {
    value.userData.id = id
    sceneRegistry.nodes.set(id, value)
    objects.push(value)
  }
  parent.updateMatrixWorld(true)
  const current = () => useScene.getState().nodes[camera.id] as SceneCameraNode
  return { camera, target, parent, object, current }
}
for (const type of [undefined, 'dolly', 'crane', '2d'] as const)
  test(`${type ?? 'free'} camera binds object center once, follows movement and unbinds without moving controls`, () => {
    const f = setup(type)
    const subjectBefore = JSON.stringify(useScene.getState().nodes[f.target.id])
    expect(setRigTarget(f.target.id, undefined, f.current())).toBe(true)
    const bound = f.current()
    expect(bound.rig!.type).toBe(type ?? 'dolly')
    bound.rig!.target!.localPoint!.forEach((v, i) => expect(v).toBeCloseTo([0, 2, 0][i]!, 7))
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    const checkAim = () => {
      const current = f.current(),
        snapshot = rigSnapshot(current)!
      const placement = f.parent.matrixWorld
        .clone()
        .multiply(new Matrix4().fromArray(current.rig!.native!.placement))
      const aim = new Vector3().setFromMatrixPosition(
        placement.multiply(
          new Matrix4().fromArray(snapshot.widgets.find((w) => w.name === 'Aim')!.boneMatrix),
        ),
      )
      expect(aim.distanceTo(f.object.localToWorld(new Vector3(0, 2, 0)))).toBeLessThan(1e-6)
    }
    checkAim()
    f.object.position.x += 3
    f.parent.updateMatrixWorld(true)
    checkAim()
    const before = sceneCameraRigPose(f.current())
    expect(setRigTarget(null, undefined, f.current())).toBe(true)
    const after = sceneCameraRigPose(f.current())
    expect(f.current().rig!.target).toBeNull()
    before.rotation.forEach((v, i) => expect(after.rotation[i]).toBeCloseTo(v, 6))
    before.position.forEach((v, i) => expect(after.position[i]).toBeCloseTo(v, 6))
    expect(JSON.stringify(useScene.getState().nodes[f.target.id])).toBe(subjectBefore)
    useScene.temporal.getState().undo()
    expect(f.current().rig!.target!.nodeId).toBe(f.target.id)
    useScene.temporal.getState().undo()
    expect(f.current()).toEqual(f.camera)
  })

test('picked local point follows transformed objects; recenter replaces it; serialized binding survives reload', () => {
  const f = setup('dolly')
  expect(setRigTarget(f.target.id, [0.7, 3.1, -0.2], f.current())).toBe(true)
  expect(f.current().rig!.target!.localPoint).toEqual([0.7, 3.1, -0.2])
  const saved = SceneCameraNode.parse(JSON.parse(JSON.stringify(f.current())))
  expect(saved.rig!.target).toEqual(f.current().rig!.target)
  expect(setRigTarget(f.target.id, undefined, f.current())).toBe(true)
  f.current().rig!.target!.localPoint!.forEach((v, i) => expect(v).toBeCloseTo([0, 2, 0][i]!, 7))
})

test('invalid subjects and locked/read-only cameras cannot change binding or create a rig', () => {
  const f = setup()
  expect(setRigTarget(f.camera.id, undefined, f.current())).toBe(false)
  expect(setRigTarget(f.camera.parentId!, undefined, f.current())).toBe(false)
  expect(setRigTarget('missing', undefined, f.current())).toBe(false)
  useScene.setState({ readOnly: true })
  expect(setRigTarget(f.target.id, undefined, f.current())).toBe(false)
  expect(startRigAimPick(f.current())).toBe(false)
  useScene.setState({ readOnly: false })
  useSceneAnimation.setState({ lockedIds: [f.camera.id] })
  expect(setRigTarget(f.target.id, undefined, f.current())).toBe(false)
  expect(f.current()).toEqual(f.camera)
})

test('standalone scene picking owns its camera, cancels without edits and invalidates on lock', () => {
  const f = setup()
  expect(startRigAimPick(f.current())).toBe(true)
  expect(rigAimPickCamera()?.id).toBe(f.camera.id)
  expect(useSceneAnimation.getState().open).toBe(false)
  expect(f.current().rig).toBeUndefined()
  stopRigAimPick()
  expect(rigAimPickCamera()).toBeNull()
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  startRigAimPick(f.current())
  useSceneAnimation.setState({ lockedIds: [f.camera.id] })
  expect(rigAimPickCamera()).toBeNull()
})

test('aim controls expose object binding for free and rig cameras and explain a missing subject', () => {
  const f = setup()
  let html = renderToStaticMarkup(<RigAimControls node={f.current()} />)
  expect(html).toContain('瞄准物品')
  expect(html).toContain('在场景中点选')
  setRigTarget(f.target.id, undefined, f.current())
  html = renderToStaticMarkup(<RigAimControls node={f.current()} />)
  expect(html).toContain('解除绑定')
  const { [f.target.id]: removed, ...nodes } = useScene.getState().nodes
  useScene.setState({ nodes })
  expect(renderToStaticMarkup(<RigAimControls node={f.current()} />)).toContain('原物品已删除')
})

test('successful scene aim consumes pointer release even after picking mode ends', async () => {
  const f = setup('dolly')
  const savedWindow = globalThis.window,
    savedDocument = globalThis.document
  const events = new EventTarget()
  globalThis.window = events as Window & typeof globalThis
  const mockDocument = {
    createElement: () => ({ textContent: '', remove() {} }),
    head: { append() {} },
  } as unknown as Document
  let canvas: HTMLCanvasElement
  function Picker() {
    const state = useThree()
    canvas = state.gl.domElement
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect
    canvas.setAttribute = () => {}
    canvas.removeAttribute = () => {}
    const center = f.object.localToWorld(new Vector3(0, 2, 0))
    state.camera.position.copy(center).add(new Vector3(0, 0, 10))
    state.camera.lookAt(center)
    state.camera.updateMatrixWorld(true)
    useMotionAnchorPicker()
    return null
  }
  let renderer: Awaited<ReturnType<typeof create>> | undefined
  try {
    renderer = await create(<Picker />)
    globalThis.document = mockDocument
    await act(async () => {
      startRigAimPick(f.current())
    })
    const send = (type: string) => {
      const event = new Event(type, { cancelable: true })
      Object.defineProperties(event, {
        target: { value: canvas! },
        pointerId: { value: 17 },
        button: { value: 0 },
        clientX: { value: 50 },
        clientY: { value: 50 },
      })
      events.dispatchEvent(event)
      return event
    }
    await act(async () => {
      expect(send('pointerdown').defaultPrevented).toBe(true)
    })
    expect(f.current().rig!.target!.nodeId).toBe(f.target.id)
    expect(useSceneAnimation.getState().pickingRigAim).toBe(false)
    let leakedRelease = false
    events.addEventListener('pointerup', () => {
      leakedRelease = true
    })
    expect(send('pointerup').defaultPrevented).toBe(true)
    expect(leakedRelease).toBe(false)
    expect(send('click').defaultPrevented).toBe(true)
    expect(send('pointerup').defaultPrevented).toBe(false)
  } finally {
    await renderer?.unmount()
    globalThis.window = savedWindow
    globalThis.document = savedDocument
  }
})

for (const type of [undefined, 'dolly', 'crane', '2d'] as const) {
  for (const face of [
    [0, 0, 1],
    [1, 0, 0],
    [0, 1, 0],
  ] as const) {
    test(`${type ?? 'free'} faces cube plane ${face} without tilt through a scaled rotated parent`, () => {
      const f = setup(type)
      f.object.rotation.set(0.2, 0.3, 0.15)
      f.parent.updateMatrixWorld(true)
      const point = f.object.localToWorld(new Vector3(0, 2, 1))
      const normal = new Vector3(...face).applyNormalMatrix(
        new Matrix3().getNormalMatrix(f.object.matrixWorld),
      )
      const before = sceneCameraWorldPose(sceneCameraRigPose(f.current()), f.parent.matrixWorld)
      const hit = {
        targetId: f.target.id,
        point: point.toArray(),
        normal: normal.toArray(),
        localPoint: [0, 2, 1] as [number, number, number],
        distance: 10,
        object: f.object,
      }
      const focal = sceneCameraRigPose(f.current()).rigFocalLength ?? f.camera.focalLength
      expect(alignRigToSurface(f.current(), hit, point.clone().add(normal))).toBe(true)
      const pose = sceneCameraRigPose(f.current())
      const world = sceneCameraWorldPose(pose, f.parent.matrixWorld)
      expect(world.position.distanceTo(point)).toBeCloseTo(before.position.distanceTo(point), 6)
      const forward = new Vector3(0, 0, -1).applyQuaternion(world.quaternion)
      expect(forward.dot(normal)).toBeCloseTo(-1, 6)
      expect(world.position.clone().sub(point).normalize().dot(normal)).toBeCloseTo(1, 6)
      const up = new Vector3().setFromMatrixColumn(f.object.matrixWorld, 1).normalize()
      up.addScaledVector(normal, -up.dot(normal))
      if (up.lengthSq() < 1e-8) {
        up.setFromMatrixColumn(f.object.matrixWorld, 2).negate().normalize()
        up.addScaledVector(normal, -up.dot(normal))
      }
      expect(
        new Vector3(0, 1, 0).applyQuaternion(world.quaternion).dot(up.normalize()),
      ).toBeCloseTo(1, 6)
      expect(pose.rigFocalLength).toBeCloseTo(focal, 5)
      expect(pose.lensShift?.[0] ?? 0).toBeCloseTo(0, 6)
      expect(pose.lensShift?.[1] ?? 0).toBeCloseTo(0, 6)
      expect(f.current().rig!.target!.nodeId).toBe(f.target.id)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      useScene.temporal.getState().undo()
      expect(f.current()).toEqual(f.camera)
    })
  }
}

for (const type of ['dolly', 'crane', '2d'] as const) {
  test(`${type}: orthographic face alignment preserves image height with a mirrored parent`, () => {
    const f = setup(type)
    useScene
      .getState()
      .updateNode(f.camera.id, { projection: 'orthographic', orthographicHeight: 7 })
    f.parent.scale.x = -2
    f.parent.updateMatrixWorld(true)
    const beforeHeight = sceneCameraRigPose(f.current()).orthographicHeight
    const point = f.object.localToWorld(new Vector3(0, 2, 1))
    const normal = new Vector3(0, 0, 1).applyNormalMatrix(
      new Matrix3().getNormalMatrix(f.object.matrixWorld),
    )
    const hit = {
      targetId: f.target.id,
      point: point.toArray(),
      normal: normal.toArray(),
      localPoint: [0, 2, 1] as [number, number, number],
      distance: 10,
      object: f.object,
    }
    expect(alignRigToSurface(f.current(), hit, point.clone().add(normal))).toBe(true)
    const pose = sceneCameraRigPose(f.current())
    const world = sceneCameraWorldPose(pose, f.parent.matrixWorld)
    expect(new Vector3(0, 0, -1).applyQuaternion(world.quaternion).dot(normal)).toBeCloseTo(-1, 6)
    expect(pose.orthographicHeight).toBeCloseTo(beforeHeight, 6)
    const before = f.current()
    useScene.setState({ readOnly: true })
    expect(alignRigToSurface(before, hit, point.clone().add(normal))).toBe(false)
    expect(f.current()).toEqual(before)
  })
}
