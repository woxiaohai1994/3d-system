// SPDX-License-Identifier: GPL-2.0-or-later
import { Matrix3, Matrix4, Vector3 } from 'three'
import source from './rig-pose-local-constraints-source.json'

type ConstraintExports = {
  memory: WebAssembly.Memory
  pose_constraints_input: () => number
  pose_constraints_result: () => number
  pose_constraints: (operation: number, mask: number, numeric: number, setup: number) => void
}

let moduleExports: ConstraintExports | undefined

function constraintModule() {
  if (!moduleExports) {
    const bytes = Uint8Array.from(atob(source.wasm), (value) => value.charCodeAt(0))
    moduleExports = new WebAssembly.Instance(new WebAssembly.Module(bytes), {})
      .exports as ConstraintExports
  }
  return moduleExports
}

function apply(
  operation: number,
  boneAxes: Matrix4,
  sharedBasis = new Matrix4(),
  vector = new Vector3(),
  sharedSize = new Matrix4(),
  mask = 0,
  angle = 0,
  numeric = false,
  setup = false,
  viewVector = new Vector3(),
) {
  const runtime = constraintModule()
  const input = new Float32Array(runtime.memory.buffer, runtime.pose_constraints_input(), 34)
  input.set(new Matrix3().setFromMatrix4(boneAxes).elements)
  input.set(new Matrix3().setFromMatrix4(sharedBasis).elements, 9)
  input.set(vector.toArray(), 18)
  input.set(new Matrix3().setFromMatrix4(sharedSize).elements, 21)
  input.set(viewVector.toArray(), 30)
  input[33] = angle
  runtime.pose_constraints(operation, mask, Number(numeric), Number(setup))
  return new Float32Array(runtime.memory.buffer, runtime.pose_constraints_result(), 10).slice()
}

export const sourcePoseLocalConstraintHashes = source.hashes

// TransData axes keep shear and zero columns; the source does not invent missing directions.
export function sourcePoseConstraintAxes(displayedBoneWorld: Matrix4): Matrix4 {
  return new Matrix4().setFromMatrix3(
    new Matrix3().fromArray(apply(0, displayedBoneWorld).subarray(0, 9)),
  )
}

export function sourcePoseConstraintVector(
  boneAxes: Matrix4,
  sharedBasis: Matrix4,
  sharedDelta: Vector3,
): Vector3 {
  return new Vector3().fromArray(apply(1, boneAxes, sharedBasis, sharedDelta))
}

export function sourcePoseConstraintSize(
  boneAxes: Matrix4,
  sharedBasis: Matrix4,
  sharedSize: Matrix4,
  axisMask: number,
): Matrix4 {
  return new Matrix4().setFromMatrix3(
    new Matrix3().fromArray(
      apply(2, boneAxes, sharedBasis, undefined, sharedSize, axisMask).subarray(0, 9),
    ),
  )
}

export function sourcePoseConstraintRotation(
  boneAxes: Matrix4,
  axisMask: number,
  angle: number,
  options: { numeric: boolean; applyViewFlip: boolean; viewVector?: Vector3 },
): { axis: Vector3; angle: number } {
  const result = apply(
    3,
    boneAxes,
    undefined,
    undefined,
    undefined,
    axisMask,
    angle,
    options.numeric,
    options.applyViewFlip,
    options.viewVector,
  )
  // Blender flips the pointer angle on the first-TransData setup call only.
  return { axis: new Vector3().fromArray(result), angle: result[3]! }
}
