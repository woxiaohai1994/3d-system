// SPDX-FileCopyrightText: 2024 Blender Authors, 2026 Pascal Authors
// SPDX-License-Identifier: GPL-2.0-or-later
import type { SceneCameraNode } from '@pascal-app/core'
import { sceneCameraOptics } from '@pascal-app/core'
import { Matrix4 } from 'three'
import { evaluateSourceCameraRig } from './add-camera-rigs-runtime'
import source from './blender-camera-display-source.json'
import { applyBlenderRigResult, blenderRigRequest } from './blender-camera-rig'
import { cameraRigParentMatrix, resolveCameraRigTarget } from './camera-rig'

export type SourceCameraDisplayParameters = {
  lens: number
  sensorWidth: number
  sensorHeight?: number
  sensorFit?: 'AUTO' | 'HORIZONTAL' | 'VERTICAL'
  projection: 'perspective' | 'orthographic'
  width: number
  height: number
  shift: readonly [number, number]
  orthographicScale: number
  drawSize?: number
  near: number
  lookThrough?: boolean
}
export type SourceCameraDisplay = {
  matrix: Matrix4
  frame: Float32Array
  triangle: Float32Array | null
  triangleFill: Float32Array | null
}
export type SceneCameraSourceDisplay = SourceCameraDisplay & {
  bodyMatrix: Matrix4
  visible: boolean
}
type Exports = {
  memory: WebAssembly.Memory
  camera_display_matrix_input: () => number
  camera_display_result: () => number
  camera_display: (...args: number[]) => number
}
let instance: Exports | undefined
function api() {
  instance ??= new WebAssembly.Instance(
    new WebAssembly.Module(Uint8Array.from(atob(source.wasm), (c) => c.charCodeAt(0))),
  ).exports as unknown as Exports
  return instance
}
export const sourceCameraDisplayHashes = source.hashes
export const sourceCameraDisplayDrawSize = source.drawSize
export const sourceCameraObjectWireColors = source.objectWireColors

export function sourceCameraDisplay(
  parameters: SourceCameraDisplayParameters,
  world: Matrix4,
): SourceCameraDisplay | null {
  const values = [
    parameters.lens,
    parameters.sensorWidth,
    parameters.sensorHeight ?? 24,
    ['AUTO', 'HORIZONTAL', 'VERTICAL'].indexOf(parameters.sensorFit ?? 'AUTO'),
    Number(parameters.projection === 'orthographic'),
    parameters.width,
    parameters.height,
    ...parameters.shift,
    parameters.orthographicScale,
    parameters.drawSize ?? source.drawSize,
    parameters.near,
    Number(parameters.lookThrough === true),
  ]
  if (
    ![...values, ...world.elements].every(Number.isFinite) ||
    values.slice(0, 3).some((value) => value <= 0) ||
    parameters.width <= 0 ||
    parameters.height <= 0 ||
    parameters.orthographicScale <= 0 ||
    (parameters.drawSize ?? source.drawSize) <= 0 ||
    parameters.near <= 0
  )
    return null
  const wasm = api()
  new Float32Array(wasm.memory.buffer, wasm.camera_display_matrix_input(), 16).set(world.elements)
  const count = wasm.camera_display(...values)
  if (!count) return null
  // The source GPU adapter shares scratch buffers; mounted cameras own their geometry samples.
  const result = new Float32Array(wasm.memory.buffer, wasm.camera_display_result(), 91).slice()
  if (!result.every(Number.isFinite)) return null
  return {
    matrix: new Matrix4().fromArray(result.subarray(0, 16)),
    frame: result.slice(16, 64),
    triangle: count > 1 ? result.slice(64, 82) : null,
    triangleFill: count > 1 ? result.slice(82, 91) : null,
  }
}

export function sceneCameraSourceDisplay(
  node: SceneCameraNode,
  lookThrough = false,
): SceneCameraSourceDisplay | null {
  const rig = node.rig
  if (!rig?.native) return null
  const [width, height] = node.aspectRatio.split(':').map(Number),
    aspect = node.frameAspect ?? width! / height!,
    parent = cameraRigParentMatrix(node),
    pose = {
      position: node.position,
      rotation: node.rotation,
      verticalFov: sceneCameraOptics(node, aspect).verticalFov,
      orthographicHeight: node.orthographicHeight,
      orbitDistance: node.orbitDistance,
      rig,
    },
    data = evaluateSourceCameraRig(
      blenderRigRequest(
        rig,
        { aspect, projection: node.projection, parentMatrix: parent },
        pose,
        resolveCameraRigTarget(node, rig),
        rig.focus.kind === 'object' ? resolveCameraRigTarget(node, rig, rig.focus.target) : null,
      ),
    )
  if (!data) return null
  const solved = applyBlenderRigResult(pose, rig, data),
    horizontal = rig.type === '2d' || aspect >= 1,
    shift = solved.lensShift ?? [0, 0],
    bodyMatrix = new Matrix4()
      .fromArray(rig.native.placement)
      .multiply(new Matrix4().fromArray(data.cameraMatrix)),
    world = (parent?.clone() ?? new Matrix4()).multiply(bodyMatrix)
  const display = sourceCameraDisplay(
    {
      lens: data.lens,
      sensorWidth: rig.native.sensorWidth,
      sensorFit: rig.type === '2d' ? 'HORIZONTAL' : 'AUTO',
      projection: node.projection,
      width: Math.round(1440 * aspect),
      height: 1440,
      shift: [shift[0]! * (horizontal ? 1 : aspect), shift[1]! / (horizontal ? aspect : 1)],
      orthographicScale: solved.orthographicHeight * (horizontal ? aspect : 1),
      near: node.near,
      lookThrough,
    },
    world,
  )
  return display
    ? { ...display, bodyMatrix, visible: true }
    : {
        bodyMatrix,
        visible: false,
        matrix: world,
        frame: new Float32Array(),
        triangle: null,
        triangleFill: null,
      }
}
