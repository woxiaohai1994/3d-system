// SPDX-License-Identifier: GPL-2.0-or-later
import { Matrix3, Matrix4 } from 'three'
import source from './rig-pose-local-orientation-source.json'

type OrientationExports = {
  memory: WebAssembly.Memory
  pose_orientation_input: () => number
  pose_orientation_result: () => number
  pose_orientation: (worldInput: number) => number
}

let moduleExports: OrientationExports | undefined
const conversion = new Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1)
const inverseConversion = conversion.clone().invert()

function orientationModule() {
  if (!moduleExports) {
    const bytes = Uint8Array.from(atob(source.wasm), (value) => value.charCodeAt(0))
    moduleExports = new WebAssembly.Instance(new WebAssembly.Module(bytes), {})
      .exports as OrientationExports
  }
  return moduleExports
}

export const sourcePoseLocalOrientationHashes = source.hashes

// Blender consumes pose_mat in armature space, even when the displayed bone follows a body edit.
export function sourcePoseLocalOrientation(
  armatureWorld: Matrix4,
  displayedBoneWorld: Matrix4,
  displayedArmatureBone?: Matrix4,
): Matrix4 {
  if (
    !armatureWorld.elements.every(Number.isFinite) ||
    !displayedBoneWorld.elements.every(Number.isFinite) ||
    (displayedArmatureBone && !displayedArmatureBone.elements.every(Number.isFinite))
  )
    return conversion.clone()
  const runtime = orientationModule()
  const inputs = new Float32Array(runtime.memory.buffer, runtime.pose_orientation_input(), 18)
  inputs.set(
    new Matrix3().setFromMatrix4(
      inverseConversion.clone().multiply(armatureWorld).multiply(conversion),
    ).elements,
  )
  inputs.set(
    new Matrix3().setFromMatrix4(
      inverseConversion.clone().multiply(displayedArmatureBone ?? displayedBoneWorld),
    ).elements,
    9,
  )
  // Local input retains pose axes when the armature's world scale contains zero axes.
  runtime.pose_orientation(displayedArmatureBone ? 0 : 1)
  const result = new Float32Array(runtime.memory.buffer, runtime.pose_orientation_result(), 9)
  return conversion.clone().multiply(new Matrix4().setFromMatrix3(new Matrix3().fromArray(result)))
}
