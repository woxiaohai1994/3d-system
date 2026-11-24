// SPDX-License-Identifier: GPL-2.0-or-later
import type { BlenderRigWidget } from '@pascal-app/viewer'
import {
  BufferGeometry,
  type Camera,
  DoubleSide,
  Float32BufferAttribute,
  Matrix3,
  type Matrix4,
  Vector3,
  WebGPUCoordinateSystem,
} from 'three'
import { attribute, Fn, frontFacing, varying, vec4 } from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  sourceBboneBatch,
  sourceBboneOutline,
  sourceBbonePoseFillAlpha,
  sourceBboneShade,
} from './rig-bbone-source'
import { type SourceRigClip, sourceRigWireQuad } from './rig-wire-source'

export type SourceRigBboneStyle = {
  wire: readonly number[]
  solid: readonly number[]
  pixelSize: number
  fill: boolean
}
type Point = { view: [number, number, number]; clip: SourceRigClip }
const f32 = Math.fround
function multiply(matrix: Matrix4, point: SourceRigClip): [number, number, number, number] {
  return [0, 1, 2, 3].map((row) => {
    let result = f32(f32(matrix.elements[row]!) * f32(point[0]))
    for (let column = 1; column < 4; column++)
      result = f32(result + f32(f32(matrix.elements[row + column * 4]!) * f32(point[column]!)))
    return result
  }) as [number, number, number, number]
}

function geometry(clip: number[], indices: number[], gpu: boolean) {
  const position: number[] = []
  for (let i = 0; i < clip.length; i += 4) {
    if (gpu) clip[i + 2] = f32(f32(clip[i + 2]! + clip[i + 3]!) * 0.5)
    position.push(clip[i]! / clip[i + 3]!, clip[i + 1]! / clip[i + 3]!, clip[i + 2]! / clip[i + 3]!)
  }
  const result = new BufferGeometry()
  result.setAttribute('position', new Float32BufferAttribute(position, 3))
  result.setAttribute('sourceRigClip', new Float32BufferAttribute(clip, 4))
  result.setIndex(indices)
  return result
}

export function createSourceRigBboneFrame(
  widget: BlenderRigWidget,
  camera: Camera,
  worldMatrix: Matrix4,
  viewport: { width: number; height: number },
  style: SourceRigBboneStyle,
) {
  if (widget.display?.type !== 'bbone') throw new TypeError('BBONE display metadata is required')
  const model = worldMatrix.clone().scale(new Vector3(...widget.display.size))
  const gpu = camera.coordinateSystem === WebGPUCoordinateSystem
  const inverted = model.determinant() < 0
  const points: Point[] = sourceBboneBatch.bone_box_verts.map((vertex) => {
    const world = multiply(model, [vertex[0]!, vertex[1]!, vertex[2]!, 1])
    const view = multiply(camera.matrixWorldInverse, world)
    const clip = multiply(camera.projectionMatrix, view)
    if (gpu) clip[2] = f32(f32(2 * clip[2]) - clip[3])
    return { view: view.slice(0, 3) as Point['view'], clip }
  })
  const solidPoints = sourceBboneBatch.bone_box_solid_tris.flatMap((triangle) =>
    triangle.map((index) => points[index]!),
  )
  const normalMatrix = new Matrix3().getNormalMatrix(model)
  const viewNormal = new Matrix3().setFromMatrix4(camera.matrixWorldInverse)
  const hint = style.wire.map((component) => component * component * 0.1) as Point['view']
  const solidClip = solidPoints.flatMap((point) => [...point.clip])
  const fill = geometry(
    solidClip,
    solidPoints.map((_, index) => index),
    gpu,
  )
  const colors = sourceBboneBatch.bone_box_solid_normals.flatMap((normal) => {
    const view = new Vector3(...(normal as Point['view']))
      .applyMatrix3(normalMatrix)
      .applyMatrix3(viewNormal)
      .normalize()
    const color = sourceBboneShade(view.toArray(), hint, style.solid as Point['view'])
    return [...color, ...color, ...color]
  })
  fill.setAttribute('sourceBboneColor', new Float32BufferAttribute(colors, 3))
  fill.setAttribute(
    'sourceBboneInverted',
    new Float32BufferAttribute(
      solidPoints.map(() => Number(inverted)),
      1,
    ),
  )
  const outlineClip: number[] = [],
    edge: number[] = [],
    widths: number[] = [],
    indices: number[] = []
  for (const adjacency of sourceBboneBatch.bone_box_wire_lines_adjacency) {
    const segment = sourceBboneOutline(
      adjacency.map((index) => solidPoints[index]!),
      viewport,
      camera.projectionMatrix.elements[15] === 0,
      inverted,
    )
    if (!segment) continue
    // Browsers cannot submit the source geometry shader's GL line primitive; retain its
    // silhouette decisions and offsets, then use the existing source wire raster bridge.
    const quad = sourceRigWireQuad(segment[0], segment[1], viewport, {
      wireWidth: 1,
      pixelSize: style.pixelSize,
    })
    if (!quad) continue
    const base = edge.length
    outlineClip.push(...quad.clip)
    edge.push(...quad.edge)
    widths.push(quad.width, quad.width, quad.width, quad.width)
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3)
  }
  const outline = geometry(outlineClip, indices, gpu)
  outline.setAttribute('sourceRigEdge', new Float32BufferAttribute(edge, 1))
  outline.setAttribute('sourceRigWidth', new Float32BufferAttribute(widths, 1))
  return { outline, fill }
}

export class SourceRigBboneGeometryCache {
  private previous: number[] | undefined
  invalidate() {
    this.previous = undefined
  }
  update(
    widget: BlenderRigWidget,
    camera: Camera,
    matrix: Matrix4,
    viewport: { width: number; height: number },
    style: SourceRigBboneStyle,
  ) {
    const values = [
      ...camera.projectionMatrix.elements,
      ...camera.matrixWorldInverse.elements,
      ...matrix.elements,
      ...widget.display!.size,
      ...style.wire,
      ...style.solid,
      camera.coordinateSystem,
      viewport.width,
      viewport.height,
      style.pixelSize,
      Number(style.fill),
    ]
    if (values.every((value, index) => value === this.previous?.[index])) return null
    const next = createSourceRigBboneFrame(widget, camera, matrix, viewport, style)
    this.previous = values
    return next
  }
}

export function createSourceRigBboneMaterial() {
  const material = new MeshBasicNodeMaterial({
    side: DoubleSide,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  })
  material.vertexNode = attribute<'vec4'>('sourceRigClip', 'vec4')
  const inverted = varying<'float'>(
    attribute<'float'>('sourceBboneInverted', 'float'),
  ).setInterpolation('flat')
  material.outputNode = Fn(() => {
    // The original solid fragment shader culls manually to preserve mirrored bone matrices.
    const reflected = inverted.greaterThan(0.5)
    reflected.and(frontFacing).or(reflected.not().and(frontFacing.not())).discard()
    return vec4(attribute<'vec3'>('sourceBboneColor', 'vec3'), sourceBbonePoseFillAlpha)
  })()
  return material
}
