// SPDX-License-Identifier: GPL-2.0-or-later
import type { CameraRig } from '@pascal-app/core'
import type { BlenderRigResult } from '@pascal-app/viewer'
import { Matrix4, Vector3 } from 'three'
import { rigCameraControlDelta } from './rig-control-follow'
import metadata from './rig-relations-metadata.json'
import source from './rig-relations-source.json'
import type { SourceRigClip } from './rig-wire-source'

type API = WebAssembly.Exports & {
  memory: WebAssembly.Memory
  relation_visible(
    mode: number,
    parent: number,
    connected: number,
    selected: number,
    parentSelected: number,
  ): number
  relation_stipple(distance: number, enabled: number): number
  relation_screen(...values: number[]): number
}
let instance: API | undefined
function api() {
  instance ??= new WebAssembly.Instance(
    new WebAssembly.Module(Uint8Array.from(atob(source.wasm), (char) => char.charCodeAt(0))),
  ).exports as API
  return instance
}

export const sourceRigRelationStyle = {
  color: metadata.color,
  dashWidth: source.dashWidth,
  dashFactor: source.dashFactor,
}
export function sourceRigRelationVisible(
  mode: 0 | 1 | 2,
  parent: boolean,
  connected: boolean,
  selected: boolean,
  parentSelected: boolean,
) {
  return !!api().relation_visible(
    mode,
    Number(parent),
    Number(connected),
    Number(selected),
    Number(parentSelected),
  )
}
export function sourceRigRelationStipple(distance: number, enabled = true) {
  return !!api().relation_stipple(distance, Number(enabled))
}
export function sourceRigRelationScreen(
  clip: SourceRigClip,
  viewport: { width: number; height: number },
) {
  const wasm = api(),
    pointer = wasm.relation_screen(...clip, viewport.width, viewport.height)
  return [...new Float32Array(wasm.memory.buffer, pointer, 2)] as [number, number]
}
export type SourceRigRelation = {
  name: string
  parent: string
  start: [number, number, number]
  end: [number, number, number]
}

export function sourceRigRelations(
  rig: CameraRig,
  snapshot: BlenderRigResult,
  selected: readonly string[],
  options: { poseMode: boolean },
): SourceRigRelation[] {
  if (!options.poseMode || !selected.length) return []
  const camera = new Vector3().setFromMatrixPosition(
      new Matrix4().fromArray(snapshot.cameraMatrix),
    ),
    relations: SourceRigRelation[] = []
  const connect = (name: string, parent: string, start: Vector3, end: Vector3) => {
    if (
      start.toArray().every(Number.isFinite) &&
      end.toArray().every(Number.isFinite) &&
      start.distanceToSquared(end) > 1e-12
    )
      relations.push({ name, parent, start: start.toArray(), end: end.toArray() })
  }
  const aim = snapshot.boneMatrices.Aim
  if (aim)
    connect(
      'Camera',
      'Aim',
      camera,
      new Vector3().setFromMatrixPosition(new Matrix4().fromArray(aim)),
    )
  if (selected.length === 1 && selected[0] === 'Camera_Offset' && snapshot.boneMatrices.Camera) {
    const baseline = new Matrix4().fromArray(snapshot.boneMatrices.Camera),
      delta = rigCameraControlDelta(rig, snapshot)
    // Match the displayed camera-position control after independent camera-body adjustments.
    if (delta) baseline.premultiply(delta)
    connect('Camera_Offset', 'Camera', new Vector3().setFromMatrixPosition(baseline), camera)
  }
  return relations
}
