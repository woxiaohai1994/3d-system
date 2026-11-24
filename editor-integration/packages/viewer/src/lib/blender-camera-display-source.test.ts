import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { SceneCameraNode } from '@pascal-app/core'
import { Matrix4, Vector3 } from 'three'
import reference from '../../../../tests/integration/fixtures/blender-camera-display.json'
import blender from '../../../../tests/integration/fixtures/blender-camera-view-frame.json'
import {
  type SourceCameraDisplayParameters,
  sceneCameraSourceDisplay,
  sourceCameraDisplay,
} from './blender-camera-display-source'
import source from './blender-camera-display-source.json'
import { createSourceCameraRig } from './blender-camera-rig'
import { sceneCameraRigPose } from './camera-rig'

test('camera display compiles verified original Blender bodies without host imports', () => {
  const bytes = Uint8Array.from(atob(source.wasm), (c) => c.charCodeAt(0))
  expect(WebAssembly.Module.imports(new WebAssembly.Module(bytes))).toEqual([])
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.wasmHash)
  expect(source.hashes).toEqual(reference.hashes)
  for (const [path, hash] of Object.entries(source.hashes))
    expect(
      createHash('sha256')
        .update(readFileSync(new URL(`../../../../${path}`, import.meta.url)))
        .digest('hex'),
    ).toBe(hash)
})

test('camera overlay matches independent native original-source compilation across all sensor fits and scale cases', () => {
  for (const sample of reference.cases) {
    const p = sample.params,
      actual = sourceCameraDisplay(
        {
          lens: p[0]!,
          sensorWidth: p[1]!,
          sensorHeight: p[2]!,
          sensorFit: ['AUTO', 'HORIZONTAL', 'VERTICAL'][
            p[3]!
          ] as SourceCameraDisplayParameters['sensorFit'],
          projection: p[4] ? 'orthographic' : 'perspective',
          width: p[5]!,
          height: p[6]!,
          shift: [p[7]!, p[8]!],
          orthographicScale: p[9]!,
          drawSize: p[10]!,
          near: p[11]!,
          lookThrough: Boolean(p[12]),
        },
        new Matrix4().fromArray(sample.world),
      )
    expect(actual ? (actual.triangle ? 2 : 1) : 0).toBe(sample.expected.count)
    if (!actual) continue
    const values = [...actual.matrix.elements, ...actual.frame]
    if (actual.triangle) values.push(...actual.triangle, ...actual.triangleFill!)
    values.forEach((value, i) => {
      expect(Math.abs(value - sample.expected.values[i]!)).toBeLessThanOrEqual(
        Math.max(1e-7, Math.abs(value) * 2e-7),
      )
    })
  }
})

test('camera source display keeps a fixed frame width, changes depth with focal length, shifts it, and retains its top triangle', () => {
  const parameters: SourceCameraDisplayParameters = {
      lens: 50,
      sensorWidth: 36,
      projection: 'perspective',
      width: 1920,
      height: 1080,
      shift: [0, 0],
      orthographicScale: 6,
      near: 0.05,
    },
    frame = sourceCameraDisplay(parameters, new Matrix4())!,
    longer = sourceCameraDisplay({ ...parameters, lens: 100 }, new Matrix4())!
  expect(frame.frame[0]).toBe(-0.5)
  expect(longer.frame[0]).toBe(frame.frame[0])
  expect(longer.frame[2]).toBe(frame.frame[2]! * 2)
  expect(frame.triangle).not.toBeNull()
  expect(Math.min(...frame.triangle!.filter((_, i) => i % 3 === 1))).toBeGreaterThan(
    Math.max(...frame.frame.filter((_, i) => i % 3 === 1)),
  )
  const shifted = sourceCameraDisplay({ ...parameters, shift: [0.2, -0.3] }, new Matrix4())!
  expect(shifted.frame[0]! - frame.frame[0]!).toBeCloseTo(0.2, 6)
  expect(shifted.frame[1]! - frame.frame[1]!).toBeCloseTo(-0.3, 6)
  const frozen = frame.frame.slice()
  sourceCameraDisplay({ ...parameters, lens: 1 }, new Matrix4())
  expect(frame.frame).toEqual(frozen)
  const through = sourceCameraDisplay({ ...parameters, lookThrough: true }, new Matrix4())!
  expect(through.triangle).toBeNull()
  expect(through.frame[2]).toBeCloseTo(-0.15, 6)
  for (let i = 0; i < through.frame.length; i += 3)
    expect(through.frame[i + 2]).toBe(through.frame[2])
})

test('source camera perimeter agrees with actual Blender Camera.view_frame for perspective and orthographic cameras', () => {
  for (const sample of blender.cases) {
    const display = sourceCameraDisplay(
      {
        lens: sample.lens,
        sensorWidth: 36,
        sensorHeight: 24,
        sensorFit: sample.fit as SourceCameraDisplayParameters['sensorFit'],
        projection: sample.projection === 'ORTHO' ? 'orthographic' : 'perspective',
        width: sample.width,
        height: sample.height,
        shift: sample.shift as [number, number],
        orthographicScale: 6,
        near: 0.05,
      },
      new Matrix4(),
    )!
    for (const corner of sample.frame) {
      const point = new Vector3(...(corner as [number, number, number])),
        distances = [0, 2, 4, 6].map((i) =>
          new Vector3().fromArray(display.frame, i * 3).distanceTo(point),
        )
      expect(Math.min(...distances)).toBeLessThan(1e-4)
    }
  }
})

test('actual original rig camera matrices and view frames include body offsets without repeating rig placement', () => {
  for (const sample of blender.rigs) {
    const node = SceneCameraNode.parse({ frameAspect: sample.aspect }),
      rig = createSourceCameraRig(sample.type as 'dolly' | 'crane' | '2d', sceneCameraRigPose(node))
    rig.native!.bones = sample.bones
    rig.native!.placement = new Matrix4().toArray()
    rig.native!.cameraOffsetMatrix = sample.offset
    rig.native!.lensShift = sample.type === '2d' ? [0, 0] : [0.3, -0.2]
    node.rig = rig
    const display = sceneCameraSourceDisplay(node)!
    display.bodyMatrix.elements.forEach((value, i) => {
      expect(Math.abs(value - sample.cameraMatrix[i]!)).toBeLessThan(1e-4)
    })
    for (const corner of sample.frame) {
      const point = new Vector3(...(corner as [number, number, number])),
        distances = [0, 2, 4, 6].map((i) =>
          new Vector3().fromArray(display.frame, i * 3).distanceTo(point),
        )
      expect(Math.min(...distances)).toBeLessThan(1e-4)
    }
  }
})

for (const type of ['dolly', 'crane', '2d'] as const)
  test(`source ${type} camera frame follows final optical projection, body offset and authored shift`, () => {
    const node = SceneCameraNode.parse({}),
      rig = createSourceCameraRig(type, sceneCameraRigPose(node))
    rig.native!.lensShift = [0.3, -0.2]
    rig.native!.cameraOffsetMatrix = new Matrix4().makeTranslation(2, -1, 0.5).toArray()
    node.rig = rig
    if (type === '2d') {
      rig.native!.bones.Camera!.properties.rotation_shift = 1
      rig.native!.bones.Aim!.location[0] = 2
    }
    const display = sceneCameraSourceDisplay(node)!,
      pose = sceneCameraRigPose(node),
      camera = new Vector3(...pose.position)
    expect(new Vector3().setFromMatrixPosition(display.matrix).distanceTo(camera)).toBeLessThan(
      1e-5,
    )
    expect(display.triangle).not.toBeNull()
    for (let i = 0; i < 8; i += 2) {
      const point = new Vector3().fromArray(display.frame, i * 3),
        z = -point.z,
        f = 1 / Math.tan((pose.verticalFov * Math.PI) / 360),
        ndcX = (point.x / z) * (f / (16 / 9)) - 2 * pose.lensShift![0],
        ndcY = (point.y / z) * f - 2 * pose.lensShift![1]
      expect(Math.abs(ndcX)).toBeCloseTo(1, 5)
      expect(Math.abs(ndcY)).toBeCloseTo(1, 5)
    }
  })
