// SPDX-FileCopyrightText: 2024 Blender Authors, 2026 Pascal Authors
// SPDX-License-Identifier: GPL-2.0-or-later
import type { BlenderRigWidget } from '@pascal-app/viewer'
import {
  BufferGeometry,
  type Camera,
  Color,
  type ColorRepresentation,
  DoubleSide,
  Float32BufferAttribute,
  type Matrix4,
  WebGPUCoordinateSystem,
} from 'three'
import {
  attribute,
  clamp,
  Fn,
  float,
  mix,
  smoothstep,
  step,
  uniform,
  varying,
  vec2,
  vec4,
} from 'three/tsl'
import { MeshBasicNodeMaterial, type NodeBuilder } from 'three/webgpu'
import {
  type SourceRigClip,
  type SourceRigWireStyle,
  type SourceRigWireViewport,
  sourceRigWireQuad,
  sourceRigWireSmoothRange,
} from './rig-wire-source'

const f32 = Math.fround
function multiply(matrix: Matrix4, point: SourceRigClip): [number, number, number, number] {
  const m = matrix.elements
  return [0, 1, 2, 3].map((row) => {
    let value = f32(f32(m[row]!) * f32(point[0]))
    for (let column = 1; column < 4; column++)
      value = f32(value + f32(f32(m[row + column * 4]!) * f32(point[column]!)))
    return value
  }) as [number, number, number, number]
}

export function createSourceRigWireFrame(
  widget: Pick<BlenderRigWidget, 'vertices' | 'edges'>,
  camera: Camera,
  worldMatrix: Matrix4,
  viewportPixels: SourceRigWireViewport,
  style: SourceRigWireStyle,
): BufferGeometry {
  const gpu = camera.coordinateSystem === WebGPUCoordinateSystem
  const projected = widget.vertices.map((vertex) => {
    const world = multiply(worldMatrix, [...vertex, 1])
    // The source shader takes model_mat * position .xyz, then supplies a new homogeneous 1.
    const view = multiply(camera.matrixWorldInverse, [world[0], world[1], world[2], 1])
    const clip = multiply(camera.projectionMatrix, view)
    if (gpu) clip[2] = f32(f32(2 * clip[2]) - clip[3])
    return clip
  })
  const clip: number[] = [],
    edge: number[] = [],
    width: number[] = [],
    position: number[] = [],
    indices: number[] = []
  for (const [i, j] of widget.edges) {
    const quad = sourceRigWireQuad(projected[i]!, projected[j]!, viewportPixels, style)
    if (!quad) continue
    const base = edge.length
    for (let vertex = 0; vertex < 4; vertex++) {
      const [x, y, sourceZ, w] = quad.clip.slice(vertex * 4, vertex * 4 + 4)
      const z = gpu ? f32(f32(sourceZ! + w!) * 0.5) : sourceZ!
      clip.push(x!, y!, z, w!)
      // Three requires a position attribute even when vertexNode supplies homogeneous clip data.
      position.push(x! / w!, y! / w!, z / w!)
      edge.push(quad.edge[vertex]!)
      width.push(quad.width)
    }
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3))
  geometry.setAttribute('sourceRigClip', new Float32BufferAttribute(clip, 4))
  geometry.setAttribute('sourceRigEdge', new Float32BufferAttribute(edge, 1))
  geometry.setAttribute('sourceRigWidth', new Float32BufferAttribute(width, 1))
  geometry.setIndex(indices)
  return geometry
}

export class SourceRigWireGeometryCache {
  private previous:
    | {
        vertices: BlenderRigWidget['vertices']
        edges: BlenderRigWidget['edges']
        values: number[]
      }
    | undefined

  invalidate() {
    this.previous = undefined
  }

  update(
    widget: Pick<BlenderRigWidget, 'vertices' | 'edges'>,
    camera: Camera,
    worldMatrix: Matrix4,
    viewportPixels: SourceRigWireViewport,
    style: SourceRigWireStyle,
  ): BufferGeometry | null {
    const values = [
      ...camera.projectionMatrix.elements,
      ...camera.matrixWorldInverse.elements,
      ...worldMatrix.elements,
      camera.coordinateSystem,
      viewportPixels.width,
      viewportPixels.height,
      style.wireWidth,
      style.pixelSize,
      style.themeEdgeWidth ?? 1,
      Number(style.smooth !== false),
    ]
    if (
      this.previous?.vertices === widget.vertices &&
      this.previous.edges === widget.edges &&
      values.every((value, index) => value === this.previous!.values[index])
    )
      return null
    const geometry = createSourceRigWireFrame(widget, camera, worldMatrix, viewportPixels, style)
    this.previous = { vertices: widget.vertices, edges: widget.edges, values }
    return geometry
  }
}

export function createSourceRigWireMaterial({
  color,
  opacity = 1,
  smooth = true,
  depthTest = true,
  depthWrite = true,
}: {
  color: ColorRepresentation
  opacity?: number
  smooth?: boolean
  depthTest?: boolean
  depthWrite?: boolean
}) {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    side: DoubleSide,
    depthTest,
    depthWrite,
    toneMapped: false,
    fog: false,
  })
  material.vertexNode = attribute<'vec4'>('sourceRigClip', 'vec4')
  const edgeAttribute = attribute<'float'>('sourceRigEdge', 'float')
  const clipW = attribute<'vec4'>('sourceRigClip', 'vec4').w
  const edgeLinear = varying<'float'>(edgeAttribute).setInterpolation('linear')
  // WebGL2 lacks the desktop GL noperspective qualifier; this ratio reconstructs linear coverage.
  const edgePerspective = varying<'vec2'>(vec2(edgeAttribute.mul(clipW), clipW))
  const width = varying<'float'>(attribute<'float'>('sourceRigWidth', 'float')).setInterpolation(
    'flat',
  )
  const rgb = uniform(new Color(color))
  const alpha = uniform(opacity)
  const [start, end] = sourceRigWireSmoothRange()
  // outputNode retains LayerPass's getOutput depth gate, which custom fragmentNode skips.
  material.outputNode = Fn((_: unknown, builder: NodeBuilder) => {
    const webgl = (builder.renderer.backend as { isWebGLBackend?: boolean }).isWebGLBackend === true
    const edge = webgl ? edgePerspective.x.div(edgePerspective.y) : edgeLinear
    // This is the TSL bridge of overlay_armature_shape_wire_frag.glsl, including its second alpha factor.
    const half = (smooth ? width.sub(0.5) : width).div(2)
    const dist = edge.abs().sub(half)
    const fade = clamp(smooth ? smoothstep(start, end, dist) : step(0.5, dist), 0, 1)
    const result = mix(vec4(rgb, alpha), vec4(0), fade).toVar()
    result.a.mulAssign(float(1).sub(fade))
    return result
  })()
  return { material, color: rgb, opacity: alpha }
}
