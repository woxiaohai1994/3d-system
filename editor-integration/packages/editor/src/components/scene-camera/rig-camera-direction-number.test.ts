import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  CameraMotion,
  CameraMotionPoint,
  cameraTracks,
  getEffectiveNode,
  MotionSegment,
  SceneAnimation,
  SceneCameraNode,
  SiteNode,
  sceneRegistry,
  updateSceneCameraMotion,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  cameraRigParentMatrix,
  createSourceCameraRig,
  sceneCameraRigPose,
} from '@pascal-app/viewer'
import { Object3D, Vector3 } from 'three'
import { animationData } from '../scene-animation/document'
import { initialSceneAnimationState, useSceneAnimation } from '../scene-animation/store'
import { bindObjectMotionSampler } from './motion-objects'
import { commitMotionPoint, motionCameraParentMatrix } from './motion-state'
import { createRigCameraDirection, resetRigCameraDirection } from './rig-camera-direction'
import {
  beginRigCameraDirectionNumber,
  changeRigCameraDirectionNumber,
  levelCameraDirection,
  resetCameraDirection,
} from './rig-camera-direction-number'
import { setRigCameraAuthorChannel } from './rig-camera-transform'
import { rigPose, rigSnapshot, useRigEditor } from './rig-state'

const savedScene = useScene.getState(),
  savedAnimation = useSceneAnimation.getState(),
  savedLive = useLiveNodeOverrides.getState(),
  savedEditor = useRigEditor.getState(),
  savedTemporal = useScene.temporal.getState(),
  savedRAF = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame'),
  savedCancelRAF = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame')
let release = () => {}

beforeEach(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  useLiveNodeOverrides.setState({ overrides: new Map() })
  useSceneAnimation.setState(initialSceneAnimationState)
  useRigEditor.setState({ ...savedEditor, gesture: null, keepCameraLevel: false })
})

afterEach(() => {
  release()
  release = () => {}
  useScene.setState(savedScene, true)
  useSceneAnimation.setState(savedAnimation, true)
  useLiveNodeOverrides.setState(savedLive, true)
  useRigEditor.setState(savedEditor, true)
  useScene.temporal.setState(savedTemporal, true)
  for (const [key, descriptor] of [
    ['requestAnimationFrame', savedRAF],
    ['cancelAnimationFrame', savedCancelRAF],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})

function fixture(timeline = false, keyed = false, midpoint = false) {
  const site = SiteNode.parse({ animation: SceneAnimation.parse({}) }),
    node = SceneCameraNode.parse({ parentId: site.id, position: [0, 2, 10] })
  node.rig = createSourceCameraRig('dolly', sceneCameraRigPose(node))
  node.rig.target = {
    nodeId: null,
    localPoint: [0, 0, 0],
    offset: [0, 0, 0],
    fallback: [0, 2, 0],
  }
  if (keyed) {
    const pose = sceneCameraRigPose(node),
      later = setRigCameraAuthorChannel(node.rig, 'rotation', 1, 0.4),
      points = [
        CameraMotionPoint.parse({ ...pose, time: 0 }),
        ...(midpoint ? [CameraMotionPoint.parse({ ...pose, rig: later, time: 2 })] : []),
      ]
    site.animation = updateSceneCameraMotion(
      site.animation!,
      node,
      CameraMotion.parse({
        points,
        segments: points.slice(1).map((point, index) =>
          MotionSegment.parse({
            fromId: points[index]!.id,
            toId: point.id,
            path: 'line',
            rhythm: 'linear',
          }),
        ),
      }),
    )
  }
  site.children = [node.id]
  useScene.setState({
    nodes: { [site.id]: site, [node.id]: node },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useSceneAnimation.setState({
    ...initialSceneAnimationState,
    open: timeline,
    cameraId: node.id,
    time: midpoint ? 1 : 0,
  })
  useRigEditor.setState({
    poseCameraId: node.id,
    control: 'Camera',
    selectionCameraId: node.id,
    selectedControls: ['Camera'],
  })
  release = bindObjectMotionSampler()
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  const current = () => useScene.getState().nodes[node.id] as SceneCameraNode,
    body = () => {
      const rig = rigPose(current()).rig!,
        state = useSceneAnimation.getState()
      return createRigCameraDirection(
        rig,
        rigSnapshot(current(), rig)!,
        state.open
          ? motionCameraParentMatrix(current(), state.time)
          : cameraRigParentMatrix(current()),
      )
    }
  return {
    node,
    current,
    body,
    orientation: () => body().orientation,
    history: () => useScene.temporal.getState().pastStates.length,
    undo: () => useScene.temporal.getState().undo(),
  }
}

test('world yaw numeric drag previews the tracked camera body and commits one undo record', () => {
  const f = fixture(),
    original = structuredClone(f.current().rig),
    start = f.orientation(),
    edit = beginRigCameraDirectionNumber(f.node, 1)
  expect(edit.change(0.4)).toBe(true)
  expect(edit.change(0.7)).toBe(true)
  expect(f.orientation()[1]).toBeCloseTo(0.7, 9)
  expect(f.orientation()[0]).toBeCloseTo(start[0], 9)
  expect(f.orientation()[2]).toBeCloseTo(start[2], 9)
  expect(f.current().rig).toEqual(original)
  expect(f.history()).toBe(0)
  expect(getEffectiveNode(f.current()).rig!.native!.bones).toEqual(original!.native!.bones)
  expect(getEffectiveNode(f.current()).rig!.target).toEqual(original!.target)
  edit.finish(false)
  expect(f.orientation()[1]).toBeCloseTo(0.7, 9)
  expect(f.current().rig!.native!.bones).toEqual(original!.native!.bones)
  expect(f.current().rig!.target).toEqual(original!.target)
  expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBeUndefined()
  expect(f.history()).toBe(1)
  f.undo()
  expect(f.current().rig).toEqual(original)
})

test('pitch clamps near vertical and separate roll leaves the other world angles stable', () => {
  const f = fixture()
  expect(changeRigCameraDirectionNumber(f.node, 0, Math.PI / 2)).toBe(true)
  expect(f.orientation()[0]).toBeCloseTo((89 * Math.PI) / 180, 9)
  const beforeRoll = f.orientation()
  expect(changeRigCameraDirectionNumber(f.current(), 2, 0.6)).toBe(true)
  expect(f.orientation()[2]).toBeCloseTo(0.6, 9)
  expect(f.orientation()[0]).toBeCloseTo(beforeRoll[0], 9)
  expect(f.orientation()[1]).toBeCloseTo(beforeRoll[1], 9)
})

test('numeric yaw uses world angles under a rotated and scaled parent while keeping camera position', () => {
  const f = fixture(),
    parent = new Object3D(),
    parentId = f.node.parentId!,
    previous = sceneRegistry.nodes.get(parentId)
  parent.position.set(4, 1, -3)
  parent.rotation.set(0.2, 0.4, -0.1)
  parent.scale.set(2, 0.5, 1)
  parent.updateMatrixWorld(true)
  sceneRegistry.nodes.set(parentId, parent)
  try {
    const before = f.orientation(),
      rig = rigPose(f.current()).rig!,
      body = createRigCameraDirection(rig, rigSnapshot(f.current(), rig)!, parent.matrixWorld),
      position = new Vector3().setFromMatrixPosition(body.world)
    expect(changeRigCameraDirectionNumber(f.node, 1, 0.9)).toBe(true)
    expect(f.orientation()[1]).toBeCloseTo(0.9, 9)
    expect(f.orientation()[0]).toBeCloseTo(before[0], 9)
    expect(f.orientation()[2]).toBeCloseTo(before[2], 9)
    const afterRig = rigPose(f.current()).rig!,
      after = createRigCameraDirection(
        afterRig,
        rigSnapshot(f.current(), afterRig)!,
        parent.matrixWorld,
      )
    expect(new Vector3().setFromMatrixPosition(after.world).distanceTo(position)).toBeLessThan(1e-9)
  } finally {
    if (previous) sceneRegistry.nodes.set(parentId, previous)
    else sceneRegistry.nodes.delete(parentId)
  }
})

test('cancel restores an owned preview and preserves unrelated live fields without history', () => {
  const f = fixture(),
    original = structuredClone(f.current().rig)
  useLiveNodeOverrides.getState().set(f.node.id, { rig: original, near: 0.5 })
  const edit = beginRigCameraDirectionNumber(f.node, 1)
  expect(edit.change(0.8)).toBe(true)
  useLiveNodeOverrides.getState().set(f.node.id, { far: 250 })
  edit.finish(true)
  expect(useLiveNodeOverrides.getState().get(f.node.id)).toMatchObject({
    rig: original,
    near: 0.5,
    far: 250,
  })
  expect(f.current().rig).toEqual(original)
  expect(f.history()).toBe(0)
})

test('leaving pose selection cancels stale numeric previews and foreign ownership stays intact', () => {
  const f = fixture(),
    original = structuredClone(f.current().rig),
    edit = beginRigCameraDirectionNumber(f.node, 1)
  expect(edit.change(0.8)).toBe(true)
  useRigEditor.setState({ control: 'Aim', selectedControls: ['Aim'] })
  expect(edit.change(1)).toBe(false)
  edit.finish(false)
  expect(f.current().rig).toEqual(original)
  expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBeUndefined()
  expect(f.history()).toBe(0)
  useRigEditor.setState({ control: 'Camera', selectedControls: ['Camera'] })
  const stale = beginRigCameraDirectionNumber(f.node, 1),
    replacement = setRigCameraAuthorChannel(f.current().rig!, 'rotation', 2, 0.3)
  expect(stale.change(0.9)).toBe(true)
  useLiveNodeOverrides.getState().set(f.node.id, { rig: replacement })
  expect(stale.change(1)).toBe(false)
  stale.finish(false)
  expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBe(replacement)
  expect(f.current().rig).toEqual(original)
  expect(f.history()).toBe(0)
})

test('numeric direction at a timeline midpoint preserves both endpoints until the pose is explicitly keyed', () => {
  const f = fixture(true, true, true),
    original = structuredClone(animationData()),
    authored = structuredClone(f.current().rig),
    sampledRig = structuredClone(rigPose(f.current()).rig),
    endpoints = structuredClone(cameraTracks(original)[0]!.points),
    edit = beginRigCameraDirectionNumber(f.node, 1)
  expect(edit.change(0.8)).toBe(true)
  expect(edit.change(1)).toBe(true)
  expect(f.orientation()[1]).toBeCloseTo(1, 9)
  expect(animationData()).toEqual(original)
  expect(f.history()).toBe(0)
  edit.finish(false)
  expect(animationData()).toEqual(original)
  expect(f.current().rig).toEqual(authored)
  expect(useSceneAnimation.getState().draft).not.toBeNull()
  expect(f.history()).toBe(0)
  commitMotionPoint()
  const track = cameraTracks(animationData())[0]!
  expect(track.points.map((point) => point.time)).toEqual([0, 1, 2])
  expect(track.points[0]).toMatchObject(endpoints[0]!)
  expect(track.points[2]).toMatchObject(endpoints[1]!)
  expect(track.points[1]!.rig!.native!.bones).toEqual(sampledRig!.native!.bones)
  expect(track.points[1]!.rig!.target).toEqual(authored!.target)
  expect(track.propertyCurves ?? []).toEqual([])
  expect(f.current().rig).toEqual(authored)
  expect(f.history()).toBe(1)
  expect(useSceneAnimation.getState().draft).toBeNull()
  f.undo()
  expect(animationData()).toEqual(original)
})

test('numeric direction at an existing key replaces only that pose with one undo record', () => {
  const f = fixture(true, true),
    original = structuredClone(animationData()),
    authored = structuredClone(f.current().rig),
    edit = beginRigCameraDirectionNumber(f.node, 1)
  expect(edit.change(0.8)).toBe(true)
  expect(animationData()).toEqual(original)
  edit.finish(false)
  const track = cameraTracks(animationData())[0]!
  expect(track.points).toHaveLength(1)
  expect(f.orientation()[1]).toBeCloseTo(0.8, 9)
  expect(track.points[0]!.rig!.native!.bones).toEqual(authored!.native!.bones)
  expect(track.points[0]!.rig!.target).toEqual(authored!.target)
  expect(track.propertyCurves ?? []).toEqual([])
  expect(f.current().rig).toEqual(authored)
  expect(f.history()).toBe(1)
  expect(useSceneAnimation.getState().draft).toBeNull()
  f.undo()
  expect(animationData()).toEqual(original)
})

test('timeline cancel and playhead changes cannot commit a stale direction or create keys', () => {
  const f = fixture(true, true, true),
    original = structuredClone(animationData()),
    edit = beginRigCameraDirectionNumber(f.node, 1)
  expect(edit.change(0.8)).toBe(true)
  edit.finish(true)
  expect(animationData()).toEqual(original)
  expect(useSceneAnimation.getState().draft).toBeNull()
  const stale = beginRigCameraDirectionNumber(f.node, 1)
  expect(stale.change(0.9)).toBe(true)
  useSceneAnimation.setState({ time: 2 })
  expect(stale.change(1)).toBe(false)
  stale.finish(false)
  expect(animationData()).toEqual(original)
  expect(useSceneAnimation.getState().time).toBe(2)
  expect(useSceneAnimation.getState().draft).toBeNull()
  expect(f.history()).toBe(0)
})

test('direction reset keeps offset location, bones and Aim binding and undo restores rotation', () => {
  const f = fixture()
  expect(changeRigCameraDirectionNumber(f.node, 1, 0.7)).toBe(true)
  const rig = setRigCameraAuthorChannel(f.current().rig!, 'location', 0, 3)
  useScene.getState().updateNode(f.node.id, { rig })
  useScene.temporal.getState().clear()
  const before = structuredClone(f.current().rig)
  expect(resetCameraDirection(f.current())).toBe(true)
  expect(f.current().rig!.native!.cameraOffsetMatrix!.slice(12, 15)).toEqual(
    before!.native!.cameraOffsetMatrix!.slice(12, 15),
  )
  expect(f.current().rig!.native!.bones).toEqual(before!.native!.bones)
  expect(f.current().rig!.target).toEqual(before!.target)
  expect(f.history()).toBe(1)
  expect(resetCameraDirection(f.current())).toBe(false)
  expect(f.history()).toBe(1)
  f.undo()
  expect(f.current().rig).toEqual(before)
})

test('the Camera_Offset handle uses the same numeric body direction and reset without editing source bones', () => {
  const f = fixture(),
    original = structuredClone(f.current().rig)
  useRigEditor.setState({ control: 'Camera_Offset', selectedControls: ['Camera_Offset'] })
  expect(changeRigCameraDirectionNumber(f.node, 1, 0.6)).toBe(true)
  expect(f.orientation()[1]).toBeCloseTo(0.6, 9)
  expect(f.current().rig!.native!.bones).toEqual(original!.native!.bones)
  expect(f.current().rig!.target).toEqual(original!.target)
  useScene.temporal.getState().clear()
  const turned = structuredClone(f.current().rig)
  expect(resetCameraDirection(f.current())).toBe(true)
  expect(f.current().rig!.native!.bones).toEqual(original!.native!.bones)
  expect(f.history()).toBe(1)
  f.undo()
  expect(f.current().rig).toEqual(turned)
})

test('Keep level numeric pitch and yaw clear inherited roll and reject roll authoring', () => {
  const f = fixture()
  expect(changeRigCameraDirectionNumber(f.node, 1, 0.5)).toBe(true)
  expect(changeRigCameraDirectionNumber(f.current(), 2, 0.4)).toBe(true)
  const before = structuredClone(f.current().rig),
    orientation = f.orientation(),
    position = new Vector3().setFromMatrixPosition(f.body().world)
  useScene.temporal.getState().clear()
  useRigEditor.setState({ keepCameraLevel: true })
  expect(changeRigCameraDirectionNumber(f.current(), 2, 0.8)).toBe(false)
  expect(f.history()).toBe(0)
  expect(changeRigCameraDirectionNumber(f.current(), 0, 0.3)).toBe(true)
  expect(f.orientation()[0]).toBeCloseTo(0.3, 9)
  expect(f.orientation()[1]).toBeCloseTo(orientation[1], 9)
  expect(f.orientation()[2]).toBeCloseTo(0, 9)
  expect(new Vector3().setFromMatrixPosition(f.body().world).distanceTo(position)).toBeLessThan(
    1e-9,
  )
  expect(f.current().rig!.native!.bones).toEqual(before!.native!.bones)
  expect(f.current().rig!.target).toEqual(before!.target)
  expect(f.history()).toBe(1)
  f.undo()
  expect(f.current().rig).toEqual(before)
  useScene.temporal.getState().clear()
  expect(changeRigCameraDirectionNumber(f.current(), 1, 0.8)).toBe(true)
  expect(f.orientation()[0]).toBeCloseTo(orientation[0], 9)
  expect(f.orientation()[1]).toBeCloseTo(0.8, 9)
  expect(f.orientation()[2]).toBeCloseTo(0, 9)
  expect(f.history()).toBe(1)
  f.undo()
  expect(f.current().rig).toEqual(before)
})

test('Level frame clears world roll immediately with one undo while preserving pitch and yaw', () => {
  const f = fixture()
  expect(changeRigCameraDirectionNumber(f.node, 0, 0.35)).toBe(true)
  expect(changeRigCameraDirectionNumber(f.current(), 1, 0.6)).toBe(true)
  expect(changeRigCameraDirectionNumber(f.current(), 2, -0.5)).toBe(true)
  const before = structuredClone(f.current().rig),
    orientation = f.orientation(),
    position = new Vector3().setFromMatrixPosition(f.body().world)
  useScene.temporal.getState().clear()
  useRigEditor.setState({ keepCameraLevel: true })
  expect(levelCameraDirection(f.current())).toBe(true)
  expect(f.orientation()[0]).toBeCloseTo(orientation[0], 9)
  expect(f.orientation()[1]).toBeCloseTo(orientation[1], 9)
  expect(f.orientation()[2]).toBeCloseTo(0, 9)
  expect(new Vector3().setFromMatrixPosition(f.body().world).distanceTo(position)).toBeLessThan(
    1e-9,
  )
  expect(f.current().rig!.native!.bones).toEqual(before!.native!.bones)
  expect(f.current().rig!.target).toEqual(before!.target)
  expect(f.history()).toBe(1)
  expect(levelCameraDirection(f.current())).toBe(false)
  expect(f.history()).toBe(1)
  f.undo()
  expect(f.current().rig).toEqual(before)
})

test('changing Keep level ownership cancels a stale numeric preview without committing its roll policy', () => {
  const f = fixture(),
    before = structuredClone(f.current().rig),
    edit = beginRigCameraDirectionNumber(f.node, 1)
  expect(edit.change(0.7)).toBe(true)
  useRigEditor.setState({ keepCameraLevel: true })
  expect(edit.change(0.9)).toBe(false)
  edit.finish(false)
  expect(f.current().rig).toEqual(before)
  expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBeUndefined()
  expect(f.history()).toBe(0)
})

test('Keep level reset restores the authored rig heading and levels a rolled bone baseline without moving the camera', () => {
  const f = fixture(),
    rig = structuredClone(f.current().rig!)
  rig.native!.bones.Camera_Offset!.rotation[2] = 0.4
  let turned = setRigCameraAuthorChannel(rig, 'rotation', 0, 0.2)
  turned = setRigCameraAuthorChannel(turned, 'rotation', 1, 0.6)
  turned = setRigCameraAuthorChannel(turned, 'location', 0, 3)
  useScene.getState().updateNode(f.node.id, { rig: turned })
  const before = structuredClone(f.current().rig),
    position = new Vector3().setFromMatrixPosition(f.body().world),
    baseline = resetRigCameraDirection(turned),
    direction = createRigCameraDirection(baseline, rigSnapshot(f.current(), baseline)!)
  useScene.temporal.getState().clear()
  useRigEditor.setState({ keepCameraLevel: true })
  expect(resetCameraDirection(f.current())).toBe(true)
  expect(f.orientation()[0]).toBeCloseTo(direction.orientation[0], 9)
  expect(f.orientation()[1]).toBeCloseTo(direction.orientation[1], 9)
  expect(f.orientation()[2]).toBeCloseTo(0, 9)
  expect(new Vector3().setFromMatrixPosition(f.body().world).distanceTo(position)).toBeLessThan(
    1e-9,
  )
  expect(f.current().rig!.native!.bones).toEqual(before!.native!.bones)
  expect(f.current().rig!.target).toEqual(before!.target)
  expect(f.history()).toBe(1)
  expect(resetCameraDirection(f.current())).toBe(false)
  expect(f.history()).toBe(1)
  f.undo()
  expect(f.current().rig).toEqual(before)
})

test('numeric direction rejects invalid values, non-Camera selection, Object mode and locked edits', () => {
  const f = fixture(),
    before = structuredClone(f.current().rig)
  expect(changeRigCameraDirectionNumber(f.node, 3, 0.4)).toBe(false)
  expect(changeRigCameraDirectionNumber(f.node, 1, Infinity)).toBe(false)
  expect(changeRigCameraDirectionNumber(f.node, 1, NaN)).toBe(false)
  useRigEditor.setState({ selectedControls: ['Camera', 'Aim'] })
  expect(changeRigCameraDirectionNumber(f.node, 1, 0.4)).toBe(false)
  expect(resetCameraDirection(f.node)).toBe(false)
  useRigEditor.setState({ selectedControls: ['Camera'], poseCameraId: null })
  expect(changeRigCameraDirectionNumber(f.node, 1, 0.4)).toBe(false)
  useRigEditor.setState({ poseCameraId: f.node.id })
  useSceneAnimation.setState({ lockedIds: [f.node.id] })
  expect(changeRigCameraDirectionNumber(f.node, 1, 0.4)).toBe(false)
  useSceneAnimation.setState({ lockedIds: [], renderingFilm: true })
  expect(changeRigCameraDirectionNumber(f.node, 1, 0.4)).toBe(false)
  useSceneAnimation.setState({ renderingFilm: false })
  useScene.setState({ readOnly: true })
  expect(changeRigCameraDirectionNumber(f.node, 1, 0.4)).toBe(false)
  expect(f.current().rig).toEqual(before)
  expect(f.history()).toBe(0)
})
