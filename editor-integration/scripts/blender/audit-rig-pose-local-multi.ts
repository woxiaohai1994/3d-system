// SPDX-License-Identifier: GPL-3.0-or-later
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { CameraRig } from '@pascal-app/core'
import {
  blenderRigRequest,
  createSourceCameraRig,
  evaluateSourceCameraRig,
} from '@pascal-app/viewer'
import { Euler, Matrix4, Object3D, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { rigControlBasis } from '../../packages/editor/src/components/scene-camera/rig-control-follow'
import { bindRigKeyboard } from '../../packages/editor/src/components/scene-camera/rig-keyboard'
import {
  rigSelectionMode,
  rigSelectionTransform,
} from '../../packages/editor/src/components/scene-camera/rig-selection-transform'
import fixture from '../../tests/integration/fixtures/add-camera-rigs-pose-local-multi.json'

const hash = (url: URL) => createHash('sha256').update(readFileSync(url)).digest('hex')
if (
  hash(new URL('../../vendor/add-camera-rigs/build_rigs.py', import.meta.url)) !==
  fixture.sourceSHA256
)
  throw new Error('Original rig source hash changed')
if (hash(new URL('./export-rig-pose-local-multi.py', import.meta.url)) !== fixture.generatorSHA256)
  throw new Error('Native fixture exporter hash changed')

const savedWindow = globalThis.window
const savedElement = globalThis.HTMLElement
globalThis.window = new EventTarget() as Window & typeof globalThis
globalThis.HTMLElement = class extends EventTarget {} as typeof HTMLElement
const errors: Array<{ case: string; beforeMatrixError: number; maxError: number; detail: string }> =
  []
const green: string[] = []
try {
  for (const item of fixture.cases) {
    const label = `${item.type}/${item.selected.join('+')}/${item.pivot}/${item.requestedMode}->${item.mode}/${'XYZ'[item.axis]}`
    const pose = {
      position: [0, 2, 10] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      verticalFov: 42,
      orthographicHeight: 10,
      orbitDistance: 10,
    }
    const rig = createSourceCameraRig(item.type as CameraRig['type'], pose)
    rig.native!.bones = structuredClone(item.before) as unknown as NonNullable<
      CameraRig['native']
    >['bones']
    rig.native!.placement = [...item.placement]
    const data = evaluateSourceCameraRig(
      blenderRigRequest(rig, { aspect: 16 / 9, projection: 'perspective' }, pose),
    )
    const armature = new Matrix4().fromArray(item.placement)
    let beforeMatrixError = 0
    for (const [name, expected] of Object.entries(item.boneWorldMatrices)) {
      const raw = armature
        .clone()
        .multiply(
          new Matrix4().fromArray(data.widgets.find((widget) => widget.name === name)!.boneMatrix),
        )
      beforeMatrixError = Math.max(
        beforeMatrixError,
        ...raw.elements.map((v, i) => Math.abs(v - expected[i]!)),
      )
    }
    const activeWidget = data.widgets.find((widget) => widget.name === item.active)!
    const activeBone = rig.native!.bones[item.active]!
    const edit = armature.clone().multiply(new Matrix4().fromArray(activeWidget.editMatrix))
    const location = armature.clone().multiply(new Matrix4().fromArray(activeWidget.locationMatrix))
    const proxy = new Object3D()
    edit
      .clone()
      .multiply(
        new Matrix4().compose(
          new Vector3(...activeBone.location),
          new Quaternion().setFromEuler(new Euler(...activeBone.rotation, 'ZYX')),
          new Vector3(...activeBone.scale),
        ),
      )
      .decompose(proxy.position, proxy.quaternion, proxy.scale)
    proxy.position.copy(new Vector3(...activeBone.location).applyMatrix4(location))
    proxy.quaternion.normalize()
    const camera = new PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.set(5, 5, 10)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    const scene = new Scene()
    scene.add(proxy)
    const controls = new TransformControls(camera)
    controls.attach(proxy)
    scene.updateMatrixWorld(true)
    const canvas = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }),
    } as HTMLCanvasElement
    let selection = rigSelectionTransform(
      rig,
      data,
      item.selected,
      item.active,
      item.mode as 'translate' | 'rotate' | 'scale',
      item.pivot,
      new Vector3(),
      armature,
    )
    proxy.position.copy(selection.center)
    const start = proxy.clone()
    let result = rig
    const binding = bindRigKeyboard(
      controls,
      canvas,
      (requestedMode) => {
        const mode = rigSelectionMode(rig, data, item.selected, requestedMode, item.pivot)
        controls.setMode(mode)
        controls.showX = controls.showY = controls.showZ = true
        selection = rigSelectionTransform(
          rig,
          data,
          item.selected,
          item.active,
          mode,
          item.pivot,
          new Vector3(),
          armature,
          undefined,
          requestedMode,
        )
        return true
      },
      () => {
        controls.dragging = false
      },
      () => {},
      () => armature.clone().multiply(rigControlBasis(rig, data, activeWidget)),
      undefined,
      undefined,
      () => selection.localOrientation(),
    )
    controls.addEventListener('objectChange', () => {
      const delta = proxy.position.clone().sub(start.position)
      const matrix = binding.transformMatrix()
      if (
        controls.getMode() === 'translate' ? delta.lengthSq() === 0 : matrix.equals(new Matrix4())
      ) {
        result = rig
        return
      }
      result = selection.apply(
        delta,
        matrix,
        binding.rotationInput(),
        result,
        binding.constraintInput(),
      )
    })
    const key = (value: string) => {
      const event = new Event('keydown', { cancelable: true })
      Object.assign(event, { key: value })
      window.dispatchEvent(event)
    }
    key(
      { translate: 'g', rotate: 'r', scale: 's' }[
        item.requestedMode as 'translate' | 'rotate' | 'scale'
      ],
    )
    const axis = 'xyz'[item.axis]!
    key(axis)
    key(axis)
    const numeric = item.mode === 'rotate' ? (item.value * 180) / Math.PI : item.value
    for (const value of String(numeric)) key(value)
    let maxError = 0,
      detail = ''
    for (const [name, bone] of Object.entries(item.after))
      for (const channel of ['location', 'rotation', 'scale'] as const) {
        const actual = result.native!.bones[name]![channel]
        const expected = bone[channel]
        const error = Math.max(...actual.map((value, i) => Math.abs(value - expected[i]!)))
        if (error > maxError) {
          maxError = error
          detail = `${name}.${channel}`
        }
      }
    if (maxError > 2e-4 || beforeMatrixError > 2e-4)
      errors.push({ case: label, beforeMatrixError, maxError, detail })
    else green.push(label)
    binding()
    controls.detach()
  }
} finally {
  globalThis.window = savedWindow
  globalThis.HTMLElement = savedElement
}

console.log(
  JSON.stringify(
    {
      nativeBlender: fixture.blender,
      cases: fixture.cases.length,
      productionHashes: Object.fromEntries(
        ['rig-keyboard.ts', 'rig-selection-transform.ts'].map((name) => [
          name,
          hash(
            new URL(`../../packages/editor/src/components/scene-camera/${name}`, import.meta.url),
          ),
        ]),
      ),
      green,
      errors,
    },
    null,
    2,
  ),
)
process.exitCode = errors.length ? 1 : 0
