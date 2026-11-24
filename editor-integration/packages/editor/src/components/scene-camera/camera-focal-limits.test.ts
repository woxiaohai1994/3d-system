import { expect, test } from 'bun:test'
import {
  CameraMotion,
  CameraMotionPoint,
  type CameraRig,
  MotionSegment,
  SceneCameraNode,
} from '@pascal-app/core'
import {
  applySourceRigOperator,
  blenderRigRequest,
  cameraMotionFrame,
  createCameraMotionEvaluator,
  createSourceCameraRig,
  evaluateSourceCameraRig,
  sceneCameraRigPose,
  solveCameraRig,
} from '@pascal-app/viewer'
import { PerspectiveCamera } from 'three'
import { applySceneCameraProjection, cameraFocalLength, cameraFov } from './camera-math'

const node = SceneCameraNode.parse({ focalLength: 50 })
const base = sceneCameraRigPose(node)
const lens = { aspect: 16 / 9, projection: 'perspective' }
const evaluate = (rig: CameraRig) => evaluateSourceCameraRig(blenderRigRequest(rig, lens, base))
function check(rig: CameraRig, expected?: number) {
  const snapshot = evaluate(rig)
  const pose = solveCameraRig(base, rig, lens)
  const frame = cameraMotionFrame(node, pose)
  const camera = new PerspectiveCamera()
  applySceneCameraProjection(camera, frame)
  const projectedLens = 36 / (2 * lens.aspect * Math.tan((camera.fov * Math.PI) / 360))
  expect(snapshot.lens).toBeGreaterThanOrEqual(1)
  expect(snapshot.projectionMatrix.every(Number.isFinite)).toBe(true)
  expect(projectedLens).toBeCloseTo(snapshot.lens, 7)
  expect(frame.focalLength).toBeCloseTo(snapshot.lens, 7)
  expect(cameraFocalLength(frame)).toBeCloseTo(snapshot.lens, 7)
  if (expected !== undefined)
    expect(Math.abs(snapshot.lens - expected)).toBeLessThan(1e-6 * Math.max(1, expected))
  return snapshot
}

for (const type of ['dolly', 'crane'] as const) {
  test(`${type}: source lens and driven optics retain original RNA limits`, () => {
    for (const authored of [1, 12, 24, 50, 85, 200, 1000, 5000, 1000000]) {
      const rig = createSourceCameraRig(type, base)
      rig.native!.bones.Camera!.properties.lens = authored
      check(rig, authored)
      expect(rig.native!.bones.Camera!.properties.lens).toBe(authored)
    }
    for (const offset of [-100, 1950]) {
      const initial = createSourceCameraRig(type, base)
      const rig = applySourceRigOperator(initial, evaluate(initial), 'set_dolly_zoom')
      rig.native!.bones.Camera!.properties.lens_offset = offset
      check(rig, Math.max(1, 50 + offset))
    }
    const rig = createSourceCameraRig(type, base)
    rig.native!.bones.Camera!.properties.lens_breathing_scale = 1000
    rig.native!.bones.Camera!.properties.focus_distance = 0
    check(rig, 1)
  })
}

test('2D driven focal length follows framing corners outside free-camera limits', () => {
  for (const width of [0.18, 1, 7.2, 36, 3600]) {
    const rig = createSourceCameraRig('2d', base)
    rig.native!.bones.Left_Corner!.location[0] = (6 - width) / 2
    rig.native!.bones.Right_Corner!.location[0] = (width - 6) / 2
    check(rig, Math.max(1, 360 / width))
  }
})

for (const type of ['dolly', 'crane', '2d'] as const)
  test(`${type}: source Camera translation preserves driven optics and reverses to the original framing`, () => {
    let rig = createSourceCameraRig(type, base)
    if (type !== '2d') rig = applySourceRigOperator(rig, evaluate(rig), 'set_dolly_zoom')
    for (const delta of [-0.8, 0.8, 0.8, -0.8]) {
      rig.native!.bones.Camera!.location[1] += delta
      check(rig)
    }
    check(rig, 50)
  })

test('old free-camera focal lengths and explicit FOV overrides use the same safe projection and readout', () => {
  for (const aspectRatio of ['16:9', '9:16'] as const)
    for (const patch of [
      { focalLength: 5000 },
      { focalLength: 1 },
      { verticalFov: 179.9 },
      { verticalFov: 0.001 },
    ]) {
      const old = SceneCameraNode.parse({ ...patch, aspectRatio })
      const reloaded = SceneCameraNode.parse(JSON.parse(JSON.stringify(old)))
      const camera = new PerspectiveCamera()
      applySceneCameraProjection(camera, reloaded)
      expect(cameraFocalLength(reloaded)).toBeGreaterThanOrEqual(24)
      expect(cameraFocalLength(reloaded)).toBeLessThanOrEqual(85)
      expect(camera.fov).toBeCloseTo(cameraFov(reloaded), 8)
      expect(sceneCameraRigPose(reloaded).verticalFov).toBeCloseTo(camera.fov, 8)
      expect(camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true)
    }
})

test('animated rig optics retain source focal values through interpolation and frame writeback', () => {
  const rig = createSourceCameraRig('crane', base)
  const end = structuredClone(rig)
  rig.native!.bones.Camera!.properties.lens = 1
  end.native!.bones.Camera!.properties.lens = 5000
  const a = CameraMotionPoint.parse({ ...base, rig, time: 0 })
  const b = CameraMotionPoint.parse({ ...base, rig: end, time: 4 })
  const motion = CameraMotion.parse({
    points: [a, b],
    segments: [MotionSegment.parse({ fromId: a.id, toId: b.id, path: 'line', rhythm: 'linear' })],
  })
  const evaluator = createCameraMotionEvaluator(motion)
  for (const time of [0, 1, 4, 2, 0]) check(evaluator.sample(time)!.rig!, 1 + (4999 * time) / 4)
  expect(motion.points[0]!.rig!.native!.bones.Camera!.properties.lens).toBe(1)
  expect(motion.points[1]!.rig!.native!.bones.Camera!.properties.lens).toBe(5000)
})

test('integrated requests preserve the complete source projection without a free-camera range', () => {
  const rig = createSourceCameraRig('dolly', base)
  for (const value of [1, 12, 24, 35, 50, 85, 200, 1000, 5000]) {
    rig.native!.bones.Camera!.properties.lens = value
    const request = blenderRigRequest(rig, lens, base)
    expect(request.focalRange).toBeUndefined()
    const raw = evaluateSourceCameraRig({ ...request, focalRange: undefined })
    expect(evaluateSourceCameraRig(request)).toEqual(raw)
  }
})
