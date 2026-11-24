// SPDX-License-Identifier: GPL-2.0-or-later
import type { CameraRig } from '@pascal-app/core'
import {
  blenderRigRequest,
  cameraRigsSource,
  createSourceCameraRig,
  evaluateSourceCameraRig,
} from '@pascal-app/viewer'
import { Matrix3, Matrix4, Object3D, PerspectiveCamera, Scene, Vector3 } from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { bindRigKeyboard } from '../../packages/editor/src/components/scene-camera/rig-keyboard'
import {
  sourcePoseConstraintAxes,
  sourcePoseConstraintRotation,
} from '../../packages/editor/src/components/scene-camera/rig-pose-local-constraints-source'
import { sourcePoseTransformSelection } from '../../packages/editor/src/components/scene-camera/rig-pose-selection-source'
import { rigSelectionTransform } from '../../packages/editor/src/components/scene-camera/rig-selection-transform'
import {
  InputAngle,
  sourceAnglePrecision,
} from '../../packages/editor/src/components/scene-camera/rig-transform-angle-source'
import { sourceChannelLockBits } from '../../packages/editor/src/components/scene-camera/rig-transform-modes-source'
import { sourcePosePivotLocation } from '../../packages/editor/src/components/scene-camera/rig-transform-pivot-source'
import { sourcePoseRotation } from '../../packages/editor/src/components/scene-camera/rig-transform-rotation-source'
import fixture from '../../tests/integration/fixtures/add-camera-rigs-pose-local-boundaries.json'

const savedWindow = globalThis.window
const savedElement = globalThis.HTMLElement
globalThis.window = new EventTarget() as Window & typeof globalThis
globalThis.HTMLElement = class extends EventTarget {} as typeof HTMLElement
const failures: Array<{ case: string; error: number; detail: string }> = []
let cases = 0
try {
  for (const type of ['dolly', 'crane', '2d'] as const)
    for (const pivot of ['MEDIAN_POINT', 'ACTIVE_ELEMENT', 'INDIVIDUAL_ORIGINS'])
      for (const axis of [0, 1, 2]) {
        const item = fixture.cases.find(
          (value) =>
            value.type === type &&
            value.pivot === pivot &&
            value.active === 'Root' &&
            value.mode === 'rotate',
        )!
        const pose = {
          position: [0, 2, 10] as [number, number, number],
          rotation: [0, 0, 0] as [number, number, number],
          verticalFov: 42,
          orthographicHeight: 10,
          orbitDistance: 10,
        }
        const rig = createSourceCameraRig(type, pose)
        rig.native!.bones = structuredClone(item.before) as unknown as NonNullable<
          CameraRig['native']
        >['bones']
        rig.native!.placement = [...item.placement]
        const snapshot = evaluateSourceCameraRig(
          blenderRigRequest(rig, { aspect: 16 / 9, projection: 'perspective' }, pose),
        )
        const armature = new Matrix4().fromArray(item.placement)
        const entries = sourcePoseTransformSelection(
          cameraRigsSource[type].bones,
          snapshot.widgets.map((value) => value.name),
          item.selected,
          'rotate',
          pivot,
        ).map((entry) => {
          const widget = snapshot.widgets.find((value) => value.name === entry.name)!
          const world = armature.clone().multiply(new Matrix4().fromArray(widget.boneMatrix))
          return {
            ...entry,
            widget,
            world,
            axes: sourcePoseConstraintAxes(world),
            edit: armature.clone().multiply(new Matrix4().fromArray(widget.editMatrix)),
          }
        })
        const selection = rigSelectionTransform(
          rig,
          snapshot,
          item.selected,
          item.active,
          'rotate',
          pivot,
          new Vector3(),
          armature,
        )
        const first = new Vector3().setFromMatrixColumn(entries[0]!.axes, axis)
        const second = new Vector3().setFromMatrixColumn(entries[1]!.axes, axis)
        // Observe from a direction which sees the two bone axes with opposite signs.
        const towardView = first.clone().sub(second).normalize()
        if (first.dot(towardView) <= 0.001 || second.dot(towardView) >= -0.001)
          throw new Error('Oracle needs distinct per-bone directions')
        const camera = new PerspectiveCamera(50, 1, 0.1, 100)
        camera.position.copy(selection.center).addScaledVector(towardView, 15)
        camera.lookAt(selection.center)
        camera.updateMatrixWorld()
        const proxy = new Object3D()
        proxy.position.copy(selection.center)
        const scene = new Scene()
        scene.add(proxy)
        const controls = new TransformControls(camera)
        controls.attach(proxy)
        controls.setMode('rotate')
        scene.updateMatrixWorld(true)
        const canvas = {
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }),
        } as HTMLCanvasElement
        const binding = bindRigKeyboard(
          controls,
          canvas,
          (mode) => {
            controls.setMode(mode)
            return true
          },
          () => {
            controls.dragging = false
          },
          () => {},
          undefined,
          undefined,
          undefined,
          () => selection.localOrientation(),
        )
        let result = rig
        controls.addEventListener('objectChange', () => {
          result = selection.apply(
            new Vector3(),
            binding.transformMatrix(),
            binding.rotationInput(),
            result,
            binding.constraintInput(),
          )
        })
        const from = {
          target: canvas,
          pointerId: 1,
          clientX: 500,
          clientY: 400,
        } as unknown as PointerEvent
        binding.startDrag('rotate', from, from)
        const key = (value: string) => {
          const event = new Event('keydown', { cancelable: true })
          Object.assign(event, { key: value })
          window.dispatchEvent(event)
        }
        key('xyz'[axis]!)
        key('xyz'[axis]!)
        const move = new Event('pointermove', { cancelable: true })
        Object.assign(move, { pointerId: 1, clientX: 470, clientY: 310 })
        window.dispatchEvent(move)
        const mouse = {
          center: [400, 400] as [number, number],
          precision: false,
          precision_factor: sourceAnglePrecision,
          data: { angle: 0, mval_prev: [500, 400] as [number, number] },
        }
        const rawAngle: [number, number, number] = [0, 0, 0]
        InputAngle(null, mouse, [470, 490], rawAngle)
        const setup = sourcePoseConstraintRotation(entries[0]!.axes, 1 << axis, rawAngle[0], {
          numeric: false,
          applyViewFlip: true,
          viewVector: towardView,
        })
        const angle = binding.rotationInput()!.angle
        let maximum = Number.isFinite(angle)
          ? Math.abs(angle - setup.angle)
          : Number.POSITIVE_INFINITY
        let detail = 'first-TransData setup angle'
        for (const entry of entries) {
          const bone = rig.native!.bones[entry.name]!
          const constrained = sourcePoseConstraintRotation(entry.axes, 1 << axis, setup.angle, {
            numeric: false,
            applyViewFlip: false,
          })
          const matrix = new Matrix3().setFromMatrix4(
            new Matrix4().makeRotationAxis(constrained.axis, constrained.angle),
          )
          const locks = (channel: 'rotate' | 'translate', values: boolean[]) =>
            values.reduce(
              (value, locked, i) => value | (locked ? sourceChannelLockBits[channel][i]! : 0),
              0,
            )
          const expectedRotation = sourcePoseRotation(
            bone.rotation,
            bone.rotation,
            matrix,
            new Matrix3().setFromMatrix4(entry.edit),
            locks('rotate', entry.widget.locks.rotation),
          )
          const expectedLocation =
            pivot === 'INDIVIDUAL_ORIGINS' || entry.noLocation
              ? bone.location
              : sourcePosePivotLocation(
                  bone.location,
                  new Vector3().setFromMatrixPosition(entry.world).toArray(),
                  selection.center.toArray(),
                  matrix,
                  new Matrix3().setFromMatrix4(entry.edit).invert(),
                  locks('translate', entry.widget.locks.location),
                )
          for (const [channel, expected] of [
            ['rotation', expectedRotation],
            ['location', expectedLocation],
          ] as const) {
            const actual = result.native!.bones[entry.name]![channel]
            const error = Math.max(
              ...actual.map((value, i) =>
                Number.isFinite(value) ? Math.abs(value - expected[i]!) : Number.POSITIVE_INFINITY,
              ),
            )
            if (error > maximum) {
              maximum = error
              detail = `${entry.name}.${channel}`
            }
          }
        }
        if (maximum > 2e-5)
          failures.push({ case: `${type}/${pivot}/${axis}`, error: maximum, detail })
        cases++
        binding()
        controls.detach()
      }
} finally {
  globalThis.window = savedWindow
  globalThis.HTMLElement = savedElement
}
console.log(JSON.stringify({ cases, failures }, null, 2))
process.exitCode = failures.length ? 1 : 0
