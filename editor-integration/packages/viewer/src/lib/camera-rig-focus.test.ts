import { afterEach, expect, test } from 'bun:test'
import {
  getEffectiveNode,
  SceneCameraNode,
  SiteNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { Group, Matrix4, Vector3 } from 'three'
import { evaluateSourceCameraRig } from './add-camera-rigs-runtime'
import { cameraRigsSource } from './add-camera-rigs-source'
import { blenderRigRequest, createSourceCameraRig } from './blender-camera-rig'
import { resolveCameraRigTarget, sceneCameraRigPose } from './camera-rig'

const savedScene = useScene.getState(),
  savedRegistry = new Map(sceneRegistry.nodes)
afterEach(() => {
  useScene.setState(savedScene, true)
  sceneRegistry.nodes.clear()
  for (const [id, object] of savedRegistry) sceneRegistry.nodes.set(id, object)
})
const pose = {
  position: [0, 2, 10] as [number, number, number],
  rotation: [0.1, 0.2, 0.05] as [number, number, number],
  verticalFov: 42,
  orthographicHeight: 10,
  orbitDistance: 10,
}
const world = new Matrix4()
  .makeTranslation(5, 2, -3)
  .multiply(new Matrix4().makeRotationY(0.3))
  .multiply(new Matrix4().makeScale(2, 0.6, 1.4))

for (const type of ['dolly', 'crane', '2d'] as const)
  test(`${type}: an empty focus bone means armature origin, and all source bones are evaluated`, () => {
    const rig = createSourceCameraRig(type, pose)
    const request = blenderRigRequest(rig, { aspect: 16 / 9, projection: 'perspective' }, pose)
    const sampled = evaluateSourceCameraRig({
      ...request,
      worldMatrix: world.toArray(),
      focusBone: '',
    })
    const cameraWorld = world.clone().multiply(new Matrix4().fromArray(sampled.cameraMatrix)),
      origin = new Vector3().setFromMatrixPosition(world),
      cameraPosition = new Vector3().setFromMatrixPosition(cameraWorld),
      depth = Math.abs(
        origin
          .sub(cameraPosition)
          .dot(new Vector3().setFromMatrixColumn(cameraWorld, 2).normalize()),
      )
    expect(sampled.focusDistance).toBeCloseTo(Math.max(1e-5, depth), 7)
    expect(Object.keys(sampled.boneMatrices)).toEqual(
      cameraRigsSource[type].bones.map((bone) => bone.name),
    )
    for (const widget of sampled.widgets)
      expect(sampled.boneMatrices[widget.name]).toEqual(widget.boneMatrix)
  })

for (const type of ['dolly', 'crane', '2d'] as const)
  for (const hidden of cameraRigsSource[type].bones.filter((bone) => bone.name.startsWith('MCH-')))
    test(`${type}: hidden ${hidden.name} head actually determines evaluated DOF`, () => {
      const rig = createSourceCameraRig(type, pose)
      const request = blenderRigRequest(rig, { aspect: 16 / 9, projection: 'perspective' }, pose)
      const sampled = evaluateSourceCameraRig({
        ...request,
        worldMatrix: world.toArray(),
        focusBone: hidden.name,
      })
      const cameraWorld = world.clone().multiply(new Matrix4().fromArray(sampled.cameraMatrix)),
        boneWorld = world
          .clone()
          .multiply(new Matrix4().fromArray(sampled.boneMatrices[hidden.name]!)),
        expected = Math.abs(
          new Vector3()
            .setFromMatrixPosition(boneWorld)
            .sub(new Vector3().setFromMatrixPosition(cameraWorld))
            .dot(new Vector3().setFromMatrixColumn(cameraWorld, 2).normalize()),
        )
      expect(sampled.focusDistance).toBeCloseTo(Math.max(1e-5, expected), 7)
    })

function scenePair() {
  const leftParent = SiteNode.parse({}),
    rightParent = SiteNode.parse({}),
    left = SceneCameraNode.parse({ parentId: leftParent.id }),
    right = SceneCameraNode.parse({ parentId: rightParent.id })
  left.rig = createSourceCameraRig('dolly', pose)
  right.rig = createSourceCameraRig('2d', { ...pose, position: [3, 4, -2] })
  right.rig.native!.cameraOffsetMatrix = new Matrix4().makeTranslation(9, -2, 4).toArray()
  const leftGroup = new Group(),
    rightGroup = new Group(),
    body = new Group()
  leftGroup.position.set(-5, 3, 1)
  leftGroup.rotation.set(0, 0.2, 0)
  rightGroup.position.set(4, -2, 7)
  rightGroup.rotation.set(0.3, -0.4, 0.1)
  rightGroup.scale.set(2, 0.6, 1.4)
  body.position.set(30, 40, 50)
  rightGroup.add(body)
  leftGroup.updateMatrixWorld(true)
  rightGroup.updateMatrixWorld(true)
  sceneRegistry.nodes.set(leftParent.id, leftGroup)
  sceneRegistry.nodes.set(rightParent.id, rightGroup)
  sceneRegistry.nodes.set(right.id, body)
  useScene.setState({
    nodes: {
      [leftParent.id]: leftParent,
      [rightParent.id]: rightParent,
      [left.id]: left,
      [right.id]: right,
    },
  })
  return { left, right, leftGroup, rightGroup, body }
}

for (const subtarget of ['', 'Camera', 'Left_Corner', 'MCH-Center', 'MCH-DOF_Parent'])
  test(`foreign rig ${subtarget || 'origin'} focuses its source armature rather than its camera body`, () => {
    const { left, right, leftGroup, rightGroup } = scenePair()
    left.rig!.focus = {
      kind: 'object',
      target: {
        nodeId: right.id,
        localPoint: [0, 0, 0],
        offset: [0, 0, 0],
        fallback: [-99, -99, -99],
        subtarget,
      },
    }
    const sampled = evaluateSourceCameraRig(
      blenderRigRequest(
        right.rig!,
        { aspect: 16 / 9, projection: 'perspective', parentMatrix: rightGroup.matrixWorld },
        pose,
      ),
    )
    const bone = subtarget
      ? new Matrix4().fromArray(sampled.boneMatrices[subtarget]!)
      : new Matrix4()
    const expected = new Vector3()
      .setFromMatrixPosition(
        rightGroup.matrixWorld
          .clone()
          .multiply(new Matrix4().fromArray(right.rig!.native!.placement))
          .multiply(bone),
      )
      .applyMatrix4(leftGroup.matrixWorld.clone().invert())
    const actual = resolveCameraRigTarget(left, left.rig!, left.rig!.focus.target)!
    expect(actual.distanceTo(expected)).toBeLessThan(1e-7)
  })

test('mutually focused rigs evaluate bone targets without recursing through their DOF', () => {
  const { left, right, leftGroup, body } = scenePair()
  const leftBody = new Group()
  leftBody.position.set(-30, 10, 20)
  leftGroup.add(leftBody)
  leftGroup.updateMatrixWorld(true)
  sceneRegistry.nodes.set(left.id, leftBody)
  for (const [camera, subject] of [
    [left, right],
    [right, left],
  ] as const)
    camera.rig!.focus = {
      kind: 'object',
      target: {
        nodeId: subject.id,
        localPoint: [0, 0, 0],
        offset: [0, 0, 0],
        fallback: [0, 0, 0],
        subtarget: 'Camera',
      },
    }
  const a = sceneCameraRigPose(getEffectiveNode(left)),
    b = sceneCameraRigPose(getEffectiveNode(right))
  expect(Number.isFinite(a.rigFocusDistance)).toBe(true)
  expect(Number.isFinite(b.rigFocusDistance)).toBe(true)
  expect(sceneCameraRigPose(left)).toEqual(a)
  expect(sceneCameraRigPose(right)).toEqual(b)
  expect(body.position.toArray()).toEqual([30, 40, 50])
})

test('ordinary camera targets keep their object origin and do not gain an armature subtarget', () => {
  const { left, right, leftGroup, body } = scenePair()
  delete right.rig
  left.rig!.focus = {
    kind: 'object',
    target: {
      nodeId: right.id,
      localPoint: [0, 0, 0],
      offset: [0, 0, 0],
      fallback: [-99, -99, -99],
    },
  }
  const expected = body
    .getWorldPosition(new Vector3())
    .applyMatrix4(leftGroup.matrixWorld.clone().invert())
  expect(
    resolveCameraRigTarget(left, left.rig!, left.rig!.focus.target)!.distanceTo(expected),
  ).toBeLessThan(1e-7)
})
