// SPDX-License-Identifier: GPL-2.0-or-later
import type { CameraRig } from '@pascal-app/core'
import type { BlenderRigResult } from '@pascal-app/viewer'
import {
  BufferGeometry,
  type Camera,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  SRGBColorSpace,
} from 'three'
import { attribute, distance, Fn, uniform, varying, vec3, vec4 } from 'three/tsl'
import { MeshBasicNodeMaterial, type NodeBuilder } from 'three/webgpu'
import {
  type SourceRigRelation,
  sourceRigRelationScreen,
  sourceRigRelationStyle,
  sourceRigRelations,
} from './rig-relations-source'
import { createSourceRigWireFrame } from './rig-source-wire'
import type { SourceRigClip } from './rig-wire-source'

const f32 = Math.fround
function multiply(matrix: Matrix4, point: SourceRigClip): [number, number, number, number] {
  return [0, 1, 2, 3].map((row) => {
    let value = f32(f32(matrix.elements[row]!) * f32(point[0]))
    for (let column = 1; column < 4; column++)
      value = f32(value + f32(f32(matrix.elements[row + column * 4]!) * f32(point[column]!)))
    return value
  }) as [number, number, number, number]
}

export function createSourceRigRelationFrame(
  relations: readonly SourceRigRelation[],
  camera: Camera,
  placement: Matrix4,
  viewport: { width: number; height: number },
) {
  const clip: number[] = [],
    position: number[] = [],
    start: number[] = [],
    coord: number[] = [],
    indices: number[] = []
  for (const relation of relations) {
    const world = multiply(placement, [...relation.start, 1]),
      view = multiply(camera.matrixWorldInverse, [world[0], world[1], world[2], 1]),
      originalStart = sourceRigRelationScreen(multiply(camera.projectionMatrix, view), viewport)
    if (!originalStart.every(Number.isFinite)) continue
    // The source extras pass submits a native one-pixel GL line. The existing original-wire
    // raster bridge supplies that coverage on both browser backends without a new shape.
    const line = createSourceRigWireFrame(
      { vertices: [relation.start, relation.end], edges: [[0, 1]] },
      camera,
      placement,
      viewport,
      { wireWidth: 0, pixelSize: 1, smooth: false },
    )
    const frozen = line.getAttribute('sourceRigClip'),
      base = clip.length / 4
    for (let index = 0; index < frozen.count; index++) {
      clip.push(frozen.getX(index), frozen.getY(index), frozen.getZ(index), frozen.getW(index))
      const p = line.getAttribute('position')
      position.push(p.getX(index), p.getY(index), p.getZ(index))
      start.push(...originalStart)
      const first = index < 2 ? 0 : 2
      const midpoint: SourceRigClip = [
        f32(f32(frozen.getX(first) + frozen.getX(first + 1)) * 0.5),
        f32(f32(frozen.getY(first) + frozen.getY(first + 1)) * 0.5),
        frozen.getZ(first),
        frozen.getW(first),
      ]
      coord.push(...sourceRigRelationScreen(midpoint, viewport))
    }
    for (const index of line.index!.array) indices.push(base + index)
    line.dispose()
  }
  const result = new BufferGeometry()
  result.setAttribute('position', new Float32BufferAttribute(position, 3))
  result.setAttribute('sourceRigClip', new Float32BufferAttribute(clip, 4))
  result.setAttribute('sourceRigStippleStart', new Float32BufferAttribute(start, 2))
  result.setAttribute('sourceRigStippleCoord', new Float32BufferAttribute(coord, 2))
  result.setIndex(indices)
  return result
}

export function createSourceRigRelationMaterial() {
  const material = new MeshBasicNodeMaterial({
    side: DoubleSide,
    depthTest: true,
    depthWrite: true,
    toneMapped: false,
    fog: false,
  })
  material.vertexNode = attribute<'vec4'>('sourceRigClip', 'vec4')
  const coordinates = attribute<'vec2'>('sourceRigStippleCoord', 'vec2'),
    w = attribute<'vec4'>('sourceRigClip', 'vec4').w,
    linear = varying<'vec2'>(coordinates).setInterpolation('linear'),
    perspective = varying<'vec3'>(vec3(coordinates.mul(w), w)),
    start = varying<'vec2'>(attribute<'vec2'>('sourceRigStippleStart', 'vec2')).setInterpolation(
      'flat',
    ),
    rgb = uniform(
      new Color().setRGB(
        ...(sourceRigRelationStyle.color as [number, number, number]),
        SRGBColorSpace,
      ),
    )
  material.outputNode = Fn((_: unknown, builder: NodeBuilder) => {
    const webgl =
        (builder.renderer.backend as { isWebGLBackend?: boolean }).isWebGLBackend === true,
      coord = webgl ? perspective.xy.div(perspective.z) : linear
    // The original extra-wire fragment's condition, including its strict half-period boundary.
    distance(start, coord)
      .div(sourceRigRelationStyle.dashWidth)
      .fract()
      .greaterThan(sourceRigRelationStyle.dashFactor)
      .discard()
    return vec4(rgb, 1)
  })()
  return material
}

export class SourceRigRelationsOverlay {
  readonly mesh = new Mesh(new BufferGeometry(), createSourceRigRelationMaterial())
  private previous: number[] | undefined
  private relations: SourceRigRelation[] = []
  private placement = new Matrix4()
  constructor() {
    this.mesh.matrixAutoUpdate = false
    this.mesh.frustumCulled = false
    this.mesh.raycast = () => {}
    this.mesh.userData = { cameraHelper: true, rigBoneRelations: true }
  }
  update(
    rig: CameraRig,
    snapshot: BlenderRigResult,
    selected: readonly string[],
    poseMode: boolean,
    camera: Camera,
    placement: Matrix4,
    viewport: { width: number; height: number },
  ) {
    this.prepare(rig, snapshot, selected, poseMode, placement)
    this.render(camera, viewport)
  }
  prepare(
    rig: CameraRig,
    snapshot: BlenderRigResult,
    selected: readonly string[],
    poseMode: boolean,
    placement: Matrix4,
  ) {
    this.relations = sourceRigRelations(rig, snapshot, selected, { poseMode })
    this.placement.copy(placement)
    this.mesh.visible = this.relations.length > 0
  }
  render(camera: Camera, viewport: { width: number; height: number }) {
    const relations = this.relations,
      placement = this.placement,
      values = [
        ...camera.projectionMatrix.elements,
        ...camera.matrixWorldInverse.elements,
        camera.coordinateSystem,
        ...placement.elements,
        viewport.width,
        viewport.height,
        ...relations.flatMap((relation) => [...relation.start, ...relation.end]),
      ]
    if (
      values.length === this.previous?.length &&
      values.every((value, index) => value === this.previous![index])
    )
      return
    this.mesh.geometry.dispose()
    this.mesh.geometry = createSourceRigRelationFrame(relations, camera, placement, viewport)
    this.previous = values
  }
  dispose() {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}
