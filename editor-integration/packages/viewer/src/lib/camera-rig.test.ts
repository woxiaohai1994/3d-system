import { expect, test } from 'bun:test'
import {
  CameraMotion,
  CameraMotionPoint,
  CameraRig,
  MotionSegment,
  SceneCameraNode,
} from '@pascal-app/core'
import { Matrix4, Vector3 } from 'three'
import { evaluateSourceCameraRig } from './add-camera-rigs-runtime'
import {
  applySourceRigOperator,
  blenderRigRequest,
  createSourceCameraRig,
  detachSourceRigAim,
} from './blender-camera-rig'
import { cameraMotionFrame, createCameraMotionEvaluator } from './camera-motion'
import { moveCameraRig, solveCameraRig } from './camera-rig'

const pose = {
  position: [0, 2, 10] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  verticalFov: 42,
  orthographicHeight: 10,
  orbitDistance: 10,
}
const lens = { aspect: 16 / 9, projection: 'perspective' }
const near = (a: number[], b: number[]) =>
  a.forEach((v, i) => {
    expect(v).toBeCloseTo(b[i]!, 5)
  })
const sample = (rig: CameraRig, target?: Vector3) =>
  evaluateSourceCameraRig(blenderRigRequest(rig, lens, pose, target))
test('source rigs attach without changing camera pose or lens and serialize all controls', () => {
  for (const type of ['dolly', 'crane', '2d'] as const) {
    const rig = createSourceCameraRig(type, pose),
      solved = solveCameraRig(pose, rig, lens)
    near(solved.position, pose.position)
    near(solved.rotation, pose.rotation)
    expect(solved.verticalFov).toBeCloseTo(pose.verticalFov, 5)
    expect(JSON.stringify(CameraRig.parse(JSON.parse(JSON.stringify(rig))))).toBe(
      JSON.stringify(rig),
    )
    expect(sample(rig).widgets.length).toBe(type === 'dolly' ? 4 : type === 'crane' ? 6 : 8)
  }
})
test('direct camera navigation updates native controls and retains requested position/rotation', () => {
  for (const type of ['dolly', 'crane', '2d'] as const) {
    const rig = createSourceCameraRig(type, pose),
      before = solveCameraRig(pose, rig, lens),
      patch = {
        position: [1, 3, 8] as [number, number, number],
        rotation: [0.1, 0.2, 0.3] as [number, number, number],
      }
    const moved = moveCameraRig(rig, before, patch),
      after = solveCameraRig(before, moved, lens)
    near(after.position, patch.position)
    near(after.rotation, patch.rotation)
  }
})
test('source Dolly Zoom maintains framing, and removing it preserves the evaluated lens', () => {
  const rig = createSourceCameraRig('dolly', pose),
    zoom = applySourceRigOperator(rig, sample(rig), 'set_dolly_zoom')
  const before = solveCameraRig(pose, zoom, lens),
    moved = moveCameraRig(zoom, before, { position: [0, 2, 9.5] })
  const after = solveCameraRig(before, moved, lens),
    a = sample(zoom),
    b = sample(moved)
  expect(Math.tan((before.verticalFov * Math.PI) / 360) * a.dollyDistance).toBeCloseTo(
    Math.tan((after.verticalFov * Math.PI) / 360) * b.dollyDistance,
    5,
  )
  const released = applySourceRigOperator(moved, b, 'remove_dolly_zoom')
  expect(solveCameraRig(after, released, lens).verticalFov).toBeCloseTo(after.verticalFov, 5)
})
test('unbinding Aim preserves the source control position and composition', () => {
  const rig = {
    ...createSourceCameraRig('dolly', pose),
    target: {
      nodeId: null,
      offset: [0, 0, 0] as [number, number, number],
      fallback: [3, 1, 0] as [number, number, number],
    },
  }
  const target = new Vector3(3, 1, 0),
    before = solveCameraRig(pose, rig, lens, target),
    detached = detachSourceRigAim(rig, sample(rig, target))
  near(solveCameraRig(pose, detached, lens).rotation, before.rotation)
})
test('2D source corner controls project to opposite frame boundaries', () => {
  const rig = createSourceCameraRig('2d', pose),
    bones = rig.native!.bones
  bones.Camera!.properties.rotation_shift = 1
  bones.Left_Corner!.location[0] = -2
  bones.Right_Corner!.location[0] = 3
  const result = sample(rig),
    view = new Matrix4().fromArray(result.cameraMatrix).invert(),
    projection = new Matrix4().fromArray(result.projectionMatrix)
  for (const [name, x] of [
    ['Left_Corner', -1],
    ['Right_Corner', 1],
  ] as const) {
    const matrix = new Matrix4().fromArray(result.widgets.find((w) => w.name === name)!.boneMatrix)
    expect(
      new Vector3().setFromMatrixPosition(matrix).applyMatrix4(view).applyMatrix4(projection).x,
    ).toBeCloseTo(x, 5)
  }
})
test('camera keys interpolate original bone channels and retain hold/random-seek behavior', () => {
  const rig = createSourceCameraRig('crane', pose),
    changed = structuredClone(rig)
  changed.native!.bones.Crane_Height!.scale[1] = 3
  changed.native!.bones.Crane_Arm!.rotation[2] = Math.PI
  const a = CameraMotionPoint.parse({ ...pose, rig, time: 0 }),
    b = CameraMotionPoint.parse({ ...pose, rig: changed, time: 4 })
  const segment = MotionSegment.parse({ fromId: a.id, toId: b.id, path: 'line', rhythm: 'linear' }),
    data = CameraMotion.parse({ points: [a, b], segments: [segment] })
  for (const time of [2, 0, 3, 1, 4, 2]) {
    const sampled = createCameraMotionEvaluator(data).sample(time)!
    expect(sampled.rig!.native!.bones.Crane_Height!.scale[1]).toBeCloseTo(1 + time / 2)
    expect(sampled.rig!.native!.bones.Crane_Arm!.rotation[2]).toBeCloseTo((Math.PI * time) / 4)
  }
  expect(
    createCameraMotionEvaluator({ ...data, segments: [{ ...segment, rhythm: 'hold' }] }).sample(3)!
      .rig!.native!.bones.Crane_Height!.scale[1],
  ).toBe(1)
})

test('rig conversion preserves existing asymmetric framing in portrait and orthographic output', () => {
  const shifted = { ...pose, lensShift: [0.2, -0.1] as [number, number] }
  for (const type of ['dolly', 'crane', '2d'] as const)
    for (const aspect of [16 / 9, 9 / 16])
      for (const projection of ['perspective', 'orthographic']) {
        const rig = createSourceCameraRig(type, shifted, aspect, projection),
          solved = solveCameraRig(shifted, rig, { aspect, projection })
        near(solved.lensShift!, shifted.lensShift)
        near(solved.position, shifted.position)
        near(solved.rotation, shifted.rotation)
        expect(
          projection === 'perspective' ? solved.verticalFov : solved.orthographicHeight,
        ).toBeCloseTo(projection === 'perspective' ? pose.verticalFov : pose.orthographicHeight, 5)
      }
})

test('choosing the rig focus target does not enable or disable the depth-of-field effect', () => {
  const rig = createSourceCameraRig('dolly', pose)
  const focused = applySourceRigOperator(rig, sample(rig), 'set_dof_bone')
  for (const depthOfField of [false, true]) {
    const node = SceneCameraNode.parse({ ...pose, depthOfField })
    expect(cameraMotionFrame(node, solveCameraRig(pose, focused, lens)).depthOfField).toBe(
      depthOfField,
    )
    expect(cameraMotionFrame(node, solveCameraRig(pose, rig, lens)).depthOfField).toBe(depthOfField)
  }
})

test('source Shift values remain constant across portrait and landscape output', () => {
  const rig = createSourceCameraRig('dolly', pose)
  rig.native!.lensShift = [0.2, -0.1]
  for (const aspect of [16 / 9, 1, 9 / 16])
    for (const projection of ['perspective', 'orthographic']) {
      const result = solveCameraRig(pose, rig, { aspect, projection })
      near(result.lensShift!, [0.2 / Math.min(1, aspect), -0.1 * Math.max(1, aspect)])
      expect(rig.native!.lensShift).toEqual([0.2, -0.1])
    }
})

test('2D conversion from other sensor sizes preserves framing with the source 36 mm driver', () => {
  for (const aspect of [16 / 9, 9 / 16]) {
    const rig = createSourceCameraRig('2d', pose, aspect, 'perspective', 50)
    expect(rig.native!.sensorWidth).toBe(36)
    expect(
      solveCameraRig(pose, rig, { aspect, projection: 'perspective' }).verticalFov,
    ).toBeCloseTo(pose.verticalFov, 5)
  }
})

test('off-axis subjects keep axial DOF depth while breathing follows straight-line distance', () => {
  const rig = createSourceCameraRig('dolly', pose)
  rig.focus = { kind: 'object', target: { nodeId: null, offset: [0, 0, 0], fallback: [0, 2, 0] } }
  rig.native!.bones.Camera!.properties.lens_breathing_scale = 0.3
  const center = solveCameraRig(pose, rig, lens, null, new Vector3(0, 2, 0))
  const side = solveCameraRig(pose, rig, lens, null, new Vector3(8, 2, 0))
  expect(center.rigFocusDistance).toBeCloseTo(10, 5)
  expect(side.rigFocusDistance).toBeCloseTo(10, 5)
  expect(center.verticalFov).not.toBeCloseTo(side.verticalFov, 5)
})

test('photographic output receives the evaluated rig lens and sensor for DOF in every projection', () => {
  for (const type of ['dolly', 'crane', '2d'] as const)
    for (const projection of ['perspective', 'orthographic'] as const) {
      const rig = createSourceCameraRig(type, pose, 9 / 16, projection, 50)
      if (type !== '2d') rig.native!.bones.Camera!.properties.lens_breathing_scale = 0.3
      const lens = { aspect: 9 / 16, projection },
        result = evaluateSourceCameraRig(blenderRigRequest(rig, lens, pose))
      const frame = cameraMotionFrame(
        SceneCameraNode.parse({ projection, sensorWidth: 50 }),
        solveCameraRig(pose, rig, lens),
      )
      expect(frame.focalLength).toBeCloseTo(result.lens, 6)
      expect(frame.sensorWidth).toBe(type === '2d' ? 36 : 50)
    }
})
