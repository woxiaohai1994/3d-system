import { expect, test } from 'bun:test'
import type { CameraRig } from '@pascal-app/core'
import { Matrix4, Vector3 } from 'three'
import { pollSourceRigOperator } from './add-camera-rigs-operators'
import { evaluateSourceCameraRig } from './add-camera-rigs-runtime'
import {
  applySourceRigOperator,
  blenderRigRequest,
  createSourceCameraRig,
} from './blender-camera-rig'

const pose = {
  position: [0, 2, 10] as [number, number, number],
  rotation: [0.1, 0.2, 0.05] as [number, number, number],
  verticalFov: 42,
  orthographicHeight: 10,
  orbitDistance: 10,
}
const transforms = {
  placement: {
    placement: new Matrix4().makeScale(2, 0.6, 1.4),
    parent: new Matrix4(),
    focus: { kind: 'manual' } as CameraRig['focus'],
  },
  parent: {
    placement: new Matrix4(),
    parent: new Matrix4().makeRotationZ(0.4).multiply(new Matrix4().makeScale(2, 0.6, 1.4)),
    focus: { kind: 'rig', bone: 'Aim' } as CameraRig['focus'],
  },
  shear: {
    placement: new Matrix4().makeRotationY(0.35).multiply(new Matrix4().makeScale(2, 0.6, 1.4)),
    parent: new Matrix4().makeRotationZ(-0.3).multiply(new Matrix4().makeScale(0.7, 1.8, 1.3)),
    focus: {
      kind: 'object',
      target: { nodeId: null, localPoint: [0, 0, 0], offset: [0, 0, 0], fallback: [12, 3, -4] },
    } as CameraRig['focus'],
  },
}

for (const type of ['dolly', 'crane'] as const)
  for (const [name, transform] of Object.entries(transforms))
    for (const breathing of [0, 0.3])
      test(`${type}: removing Dolly Zoom preserves evaluated lens with ${name} and breathing ${breathing}`, () => {
        let rig = createSourceCameraRig(type, pose)
        rig.native!.placement = transform.placement
          .clone()
          .multiply(new Matrix4().fromArray(rig.native!.placement))
          .toArray()
        rig.focus = structuredClone(transform.focus)
        rig.native!.bones.Root!.scale = [0.9, 1.2, 1.1]
        rig.native!.bones.Camera!.properties.lens = 65
        rig.native!.bones.Camera!.properties.lens_offset = 8
        rig.native!.bones.Camera!.properties.focus_distance = 12
        rig.native!.bones.Camera!.properties.lens_breathing_scale = breathing
        const sample = (value: CameraRig) =>
          evaluateSourceCameraRig(
            blenderRigRequest(
              value,
              { aspect: 16 / 9, projection: 'perspective', parentMatrix: transform.parent },
              pose,
              null,
              value.focus.kind === 'object' ? new Vector3(...value.focus.target.fallback) : null,
            ),
          )
        rig = applySourceRigOperator(rig, sample(rig), 'set_dolly_zoom')
        rig.native!.bones.Camera!.location = [0.8, -2.5, 1.1]
        rig.native!.bones.Aim!.location[0] += 1
        const before = sample(rig)
        const withoutBreathing = structuredClone(rig)
        withoutBreathing.native!.bones.Camera!.properties.lens_breathing_scale = 0
        const rawLens = sample(withoutBreathing).lens
        const saved = structuredClone(rig)
        const released = applySourceRigOperator(rig, before, 'remove_dolly_zoom')
        const after = sample(released)
        expect(released.native!.bones.Camera!.properties.lens).toBeCloseTo(rawLens, 7)
        expect(released.native!.bones.Camera!.properties.lens_offset).toBe(0)
        expect(after.lens).toBeCloseTo(before.lens, 7)
        expect(after.projectionMatrix).toEqual(before.projectionMatrix)
        expect(after.cameraMatrix).toEqual(before.cameraMatrix)
        expect(released.focus).toEqual(saved.focus)
        expect(released.native!.placement).toEqual(saved.native!.placement)
        expect(released.dollyZoom).toBe(false)
        expect(rig).toEqual(saved)
      })

for (const type of ['dolly', 'crane'] as const)
  test(`${type}: removing Dolly Zoom keeps the source lens before breathing and camera minimum clipping`, () => {
    let rig = createSourceCameraRig(type, pose)
    rig.native!.placement = new Matrix4()
      .makeScale(2, 0.6, 1.4)
      .multiply(new Matrix4().fromArray(rig.native!.placement))
      .toArray()
    rig.native!.bones.Camera!.properties.focus_distance = 0.4
    rig.native!.bones.Camera!.properties.lens_breathing_scale = 0.4
    const sample = (value: CameraRig) =>
      evaluateSourceCameraRig(
        blenderRigRequest(value, { aspect: 16 / 9, projection: 'perspective' }, pose),
      )
    rig = applySourceRigOperator(rig, sample(rig), 'set_dolly_zoom')
    rig.native!.bones.Camera!.location[1] -= 2
    const before = sample(rig)
    const clearBreathing = structuredClone(rig)
    clearBreathing.native!.bones.Camera!.properties.lens_breathing_scale = 0
    const rawLens = sample(clearBreathing).lens
    const released = applySourceRigOperator(rig, before, 'remove_dolly_zoom')
    expect(before.lens).toBe(1)
    expect(rawLens).toBeGreaterThan(1)
    expect(released.native!.bones.Camera!.properties.lens).toBeCloseTo(rawLens, 7)
    expect(sample(released).lens).toBe(1)
  })

for (const type of ['dolly', 'crane'] as const)
  for (const projection of ['perspective', 'orthographic'] as const)
    for (const operation of ['set_dolly_zoom', 'remove_dolly_zoom', 'swap_lens'] as const)
      test(`${type}: ${operation} polls the evaluated ${projection} projection`, () => {
        const authoredProjection = projection === 'perspective' ? 'orthographic' : 'perspective'
        const rig = createSourceCameraRig(type, pose, 16 / 9, authoredProjection)
        const evaluated = evaluateSourceCameraRig(
          blenderRigRequest(rig, { aspect: 16 / 9, projection }, pose),
        )
        const availability = pollSourceRigOperator(rig, evaluated, operation)
        expect(availability.disabled).toBe(projection === 'orthographic')
        expect(availability.reason).toBe(
          projection === 'orthographic'
            ? 'This operator is not supported for orthographic cameras.'
            : '',
        )
      })
