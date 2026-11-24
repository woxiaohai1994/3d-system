import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { type CameraRig, SceneCameraNode, SiteNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Euler, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import native from '../../../../../tests/integration/fixtures/add-camera-rigs-creation.json'
import useEditor from '../../store/use-editor'
import { animationData } from '../scene-animation/document'
import { initialSceneAnimationState, useSceneAnimation } from '../scene-animation/store'
import { addSceneCameraRig, selectCameraTransform } from './actions'
import { applySceneCameraProjection, sceneCameraWorldPose } from './camera-math'
import defaults from './rig-create-defaults-source.json'
import { createSourceRigCamera } from './rig-create-source'
import {
  editCameraRig,
  exitCameraRig,
  rigIsPoseMode,
  rigSelectedControls,
  rigSnapshot,
  selectRigControl,
  updateRig,
  useRigEditor,
} from './rig-state'
import { currentSceneCameraId } from './scene-camera-state'
import { useCameraStudio } from './store'
import { registerViewportSource } from './viewport-source'

const close = (actual: number[], expected: number[]) => {
  expect(actual.length).toBe(expected.length)
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index]!, 4)
  })
}

test('creation defaults come from the pinned add-on and original object operator', () => {
  for (const [file, hash] of Object.entries(native.sources))
    expect(
      createHash('sha256')
        .update(readFileSync(new URL(`../../../../../${file}`, import.meta.url)))
        .digest('hex'),
    ).toBe(hash)
  expect(defaults.sourceSHA256).toBe(native.sources['vendor/add-camera-rigs/build_rigs.py'])
  const { focusBone, ...expectedDefaults } = native.cases[0]!.cameraDefaults
  expect(focusBone).toBeNull()
  expect(defaults.cameraDefaults).toEqual(expectedDefaults)
})

for (const [index, item] of native.cases.entries())
  test(`original creation ${index}: ${item.type} at cursor with unchanged authored controls`, () => {
    const type = item.type as CameraRig['type']
    const cursor = item.cursor as [number, number, number]
    const aspect = item.resolution[0]! / item.resolution[1]!
    const parent = new Matrix4().compose(
      new Vector3(4, 2, -3),
      new Quaternion().setFromEuler(new Euler(0.25, -0.35, 0.45)),
      new Vector3(1.3, 0.8, 1.1),
    )
    for (const matrix of [new Matrix4(), parent]) {
      const node = createSourceRigCamera(type, cursor, aspect, matrix)
      close(
        matrix.clone().multiply(new Matrix4().fromArray(node.rig!.native!.placement)).toArray(),
        item.placement,
      )
      expect(node.rig!.native!.objectTransform).toEqual({
        location: [cursor[0], -cursor[2], cursor[1]],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        rotationMode: 'XYZ',
        parentInverse: matrix.clone().invert().toArray(),
      })
      expect(node.focalLength).toBeCloseTo(item.lens, 4)
      expect(item.cameraDefaults.projection).toBe(node.projection)
      expect(node.near).toBe(item.cameraDefaults.near)
      expect(node.far).toBe(item.cameraDefaults.far)
      expect(node.depthOfField).toBe(item.cameraDefaults.depthOfField)
      expect(node.focusDistance).toBe(item.cameraDefaults.focusDistance)
      expect(node.aperture).toBe(item.cameraDefaults.aperture)
      expect(node.rig!.showInFront).toBe(item.cameraDefaults.showInFront)
      expect(node.rig!.lockCamera).toBe(item.cameraDefaults.lockCamera)
      expect(node.rig!.focus).toEqual(
        item.cameraDefaults.focusBone
          ? { kind: 'rig', bone: item.cameraDefaults.focusBone }
          : { kind: 'manual' },
      )
      for (const [name, bone] of Object.entries(item.bones)) {
        const created = node.rig!.native!.bones[name]!
        for (const channel of ['location', 'rotation', 'scale'] as const)
          close(created[channel], bone[channel])
        expect(created.properties).toEqual(bone.properties)
      }
      const world = sceneCameraWorldPose(node, matrix)
      const camera = new PerspectiveCamera()
      camera.position.copy(world.position)
      camera.quaternion.copy(world.quaternion)
      camera.updateMatrixWorld()
      applySceneCameraProjection(camera, { ...node, viewCorrection: world.viewCorrection })
      close(
        camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse).toArray(),
        new Matrix4()
          .fromArray(item.projectionMatrix)
          .multiply(new Matrix4().fromArray(item.cameraMatrix).invert())
          .toArray(),
      )
    }
    expect(item.mode).toBe('OBJECT')
    expect(item.activeIsRig).toBe(true)
    expect(item.selectedObjects).toEqual(['rig'])
    expect(item.sceneCameraIsCreatedCamera).toBe(true)
    expect(item.activeBone).toBeNull()
    expect(item.selectedControls).toEqual([])
  })

let sceneBefore = useScene.getState()
let viewerBefore = useViewer.getState()
let editorBefore = useEditor.getState()
let animationBefore = useSceneAnimation.getState()
let studioBefore = useCameraStudio.getState()
let rigBefore = useRigEditor.getState()
let unregister: (() => void) | undefined
const originalRaf = globalThis.requestAnimationFrame
const originalCancelRaf = globalThis.cancelAnimationFrame
beforeEach(() => {
  sceneBefore = useScene.getState()
  viewerBefore = useViewer.getState()
  editorBefore = useEditor.getState()
  animationBefore = useSceneAnimation.getState()
  studioBefore = useCameraStudio.getState()
  rigBefore = useRigEditor.getState()
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  useScene.setState({ nodes: {}, rootNodeIds: [], readOnly: false })
  useViewer.getState().resetSelection()
  useSceneAnimation.setState(initialSceneAnimationState)
  useRigEditor.setState({
    cursor: [2, 3, -4],
    control: 'Left_Corner',
    selectionCameraId: 'old-camera',
    selectedControls: ['Left_Corner'],
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
})
afterEach(() => {
  unregister?.()
  unregister = undefined
  useScene.setState(sceneBefore, true)
  useViewer.setState(viewerBefore, true)
  useEditor.setState(editorBefore, true)
  useSceneAnimation.setState(animationBefore, true)
  useCameraStudio.setState(studioBefore, true)
  useRigEditor.setState(rigBefore, true)
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancelRaf
  useScene.temporal.getState().clear()
})

test('direct rig creation ignores the view, clears old bones, selects the new rig and is one undo step', () => {
  unregister = registerViewportSource(() => {
    throw new Error('Native creation must not sample the viewport')
  })
  const node = addSceneCameraRig('dolly', '滑轨相机架')!
  expect(node).toBeDefined()
  expect(node.rig!.native!.placement.slice(12, 15)).toEqual([2, 3, -4])
  expect(useViewer.getState().selection.selectedIds).toEqual([node.id])
  expect(useCameraStudio.getState().activeId).toBe(node.id)
  expect(useSceneAnimation.getState().cameraView).toBe(false)
  expect(useRigEditor.getState().control).toBe('')
  expect(rigIsPoseMode(node.id)).toBe(false)
  expect(
    rigSelectedControls(node.id, 'Camera', ['Root', 'Camera', 'Aim', 'Camera_Offset']),
  ).toEqual([])
  selectCameraTransform(node)
  expect(
    rigSelectedControls(node.id, 'Camera', ['Root', 'Camera', 'Aim', 'Camera_Offset']),
  ).toEqual([])
  expect(useRigEditor.getState().selectedControls).toEqual([])
  expect(useScene.temporal.getState().pastStates.length).toBe(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[node.id]).toBeUndefined()
})

test('native creation Object to Pose to Object preserves its authored pose and empty initial bone selection', () => {
  const node = addSceneCameraRig('dolly', '滑轨相机架')!
  const original = structuredClone(node.rig)
  const nativeTransition = native.cases[0]!.modeTransitions
  expect(nativeTransition.enterPose.mode).toBe('POSE')
  expect(nativeTransition.enterPose.selectedControls).toEqual([])
  expect(nativeTransition.enterPose.activeBone).toBeNull()
  editCameraRig(node)
  expect(rigIsPoseMode(node.id)).toBe(true)
  expect(useRigEditor.getState().selectedControls).toEqual([])
  expect((useScene.getState().nodes[node.id] as SceneCameraNode).rig).toEqual(original)
  selectRigControl(
    node.id,
    rigSnapshot(node)!.widgets.map((w) => w.name),
    'Camera',
  )
  const moved = structuredClone(node.rig!)
  moved.native!.bones.Camera!.location = [0.7, -0.2, 0.3]
  expect(updateRig(node, moved)).toBe(true)
  exitCameraRig(node)
  expect(rigIsPoseMode(node.id)).toBe(false)
  expect(useRigEditor.getState().control).toBe(nativeTransition.exitActiveBone!)
  expect(useRigEditor.getState().selectedControls).toEqual(nativeTransition.exitSelectedControls)
  expect(nativeTransition.exitCameraLocation).toEqual(nativeTransition.posedCameraLocation)
  expect((useScene.getState().nodes[node.id] as SceneCameraNode).rig).toEqual(moved)
})

test('creating in an empty shot binds its camera in the same undo step', () => {
  const site = SiteNode.parse({
    animation: { version: 2, shots: [{ id: 'shot_new_rig', name: '新镜头', cameraId: null }] },
  })
  useScene.setState({ nodes: { [site.id]: site }, rootNodeIds: [site.id] })
  useSceneAnimation.setState({ open: true, shotId: 'shot_new_rig' })
  useScene.temporal.getState().clear()
  const node = addSceneCameraRig('2d', '平面相机架')!
  const updated = useScene.getState().nodes[site.id]
  expect(updated?.type === 'site' && updated.animation?.shots[0]?.cameraId).toBe(node.id)
  expect(updated?.type === 'site' && updated.animation?.activeCameraId).toBe(node.id)
  expect(useSceneAnimation.getState().cameraId).toBe(node.id)
  expect(useSceneAnimation.getState().cameraView).toBe(false)
  expect(useScene.temporal.getState().pastStates.length).toBe(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[node.id]).toBeUndefined()
  expect(useScene.getState().nodes[site.id]).toEqual(site)
})

for (const type of ['dolly', 'crane', '2d'] as const)
  test(`${type} creation replaces the scene camera and undoes its reference with the new node`, () => {
    const previousCamera = SceneCameraNode.parse({ name: '已有场景相机' })
    const site = SiteNode.parse({
      animation: {
        version: 2,
        activeCameraId: previousCamera.id,
        cameraMarkers: [{ name: '原绑定', frame: 24, cameraId: previousCamera.id }],
        shots: [{ id: 'shot_kept', name: '已有镜头', cameraId: previousCamera.id }],
      },
    })
    useScene.setState({
      nodes: { [site.id]: site, [previousCamera.id]: previousCamera },
      rootNodeIds: [site.id, previousCamera.id],
    })
    useSceneAnimation.setState({ time: 1 })
    useScene.temporal.getState().clear()
    const node = addSceneCameraRig(type, '源码相机架')!
    expect(animationData().activeCameraId).toBe(node.id)
    expect(currentSceneCameraId()).toBe(node.id)
    expect(animationData().cameraMarkers).toEqual(site.animation!.cameraMarkers)
    const createdSite = useScene.getState().nodes[site.id]
    expect(
      createdSite?.type === 'site' &&
        createdSite.animation!.shots.filter((shot) => shot.id === 'shot_kept'),
    ).toEqual(site.animation!.shots)
    expect(useSceneAnimation.getState().cameraView).toBe(false)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    const saved = SiteNode.parse(JSON.parse(JSON.stringify(useScene.getState().nodes[site.id])))
    expect(saved.animation!.activeCameraId).toBe(node.id)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[node.id]).toBeUndefined()
    expect(useScene.getState().nodes[site.id]).toEqual(site)
    expect(currentSceneCameraId()).toBe(previousCamera.id)
    useScene.temporal.getState().redo()
    expect(animationData().activeCameraId).toBe(node.id)
    expect(currentSceneCameraId()).toBe(node.id)
    const following = addSceneCameraRig(type, '后建相机架')!
    expect(currentSceneCameraId()).toBe(following.id)
    useScene.temporal.getState().undo()
    expect(animationData().activeCameraId).toBe(node.id)
    expect(currentSceneCameraId()).toBe(node.id)
    useSceneAnimation.setState({ time: 2 })
    expect(currentSceneCameraId()).toBe(previousCamera.id)
  })

test('read-only and an occupied camera workspace reject a new rig without changing selection', () => {
  useScene.setState({ readOnly: true })
  expect(addSceneCameraRig('crane', '摇臂相机架')).toBeUndefined()
  expect(Object.keys(useScene.getState().nodes)).toEqual([])
  useScene.setState({ readOnly: false })
  const camera = SceneCameraNode.parse({})
  const site = SiteNode.parse({
    animation: {
      version: 2,
      shots: [{ id: 'shot_existing_rig', name: '已有镜头', cameraId: camera.id }],
    },
  })
  useScene.setState({
    nodes: { [site.id]: site, [camera.id]: camera },
    rootNodeIds: [site.id, camera.id],
  })
  useSceneAnimation.setState({ open: true, shotId: 'shot_existing_rig' })
  const selection = useViewer.getState().selection
  expect(addSceneCameraRig('crane', '摇臂相机架')).toBeUndefined()
  expect(Object.keys(useScene.getState().nodes).length).toBe(2)
  expect(useViewer.getState().selection).toBe(selection)
  expect(useSceneAnimation.getState().message).toContain('最多一台相机')
})
