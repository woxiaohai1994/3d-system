import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { SceneCameraNode } from '@pascal-app/core'
import { createSourceCameraRig, sceneCameraRigPose } from '@pascal-app/viewer'
import {
  Matrix4,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLCoordinateSystem,
  WebGPUCoordinateSystem,
} from 'three'
import { context, Fn, float, uniform } from 'three/tsl'
import * as ThreeWebGPU from 'three/webgpu'
import { GLSLNodeBuilder, type Node, WebGPURenderer } from 'three/webgpu'
import reference from '../../../../../tests/integration/fixtures/blender-rig-bbone.json'
import {
  sourceBboneBatch,
  sourceBboneOutline,
  sourceBbonePoseFillAlpha,
  sourceBboneShade,
  sourceBoneWireColor,
} from './rig-bbone-source'
import source from './rig-bbone-source.json'
import {
  createSourceRigBboneFrame,
  createSourceRigBboneMaterial,
  SourceRigBboneGeometryCache,
} from './rig-source-bbone'
import { rigSnapshot } from './rig-state'
import type { SourceRigClip } from './rig-wire-source'

const { WGSLNodeBuilder } = ThreeWebGPU as typeof ThreeWebGPU & {
  WGSLNodeBuilder: typeof GLSLNodeBuilder
}
type V3 = [number, number, number]

test('BBONE geometry, shaders and adapter have pinned hashes and no host imports', () => {
  const bytes = Uint8Array.from(atob(source.wasm), (char) => char.charCodeAt(0))
  expect(WebAssembly.Module.imports(new WebAssembly.Module(bytes))).toEqual([])
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.wasmHash)
  expect(source.hashes).toEqual(reference.hashes)
  for (const [path, hash] of Object.entries(source.hashes))
    expect(
      createHash('sha256')
        .update(readFileSync(new URL(`../../../../../${path}`, import.meta.url)))
        .digest('hex'),
    ).toBe(hash)
  expect(sourceBboneBatch.bone_box_verts).toHaveLength(8)
  expect(sourceBboneBatch.bone_box_solid_tris).toHaveLength(12)
  expect(sourceBboneBatch.bone_box_wire_lines_adjacency).toHaveLength(12)
  expect(sourceBbonePoseFillAlpha).toBe(0.6)
})

test('BBONE silhouette, solid lighting and unselected byte colors match independent native source compilation', () => {
  expect(reference.cases).toHaveLength(65)
  for (const { opcode, params: p, expected } of reference.cases) {
    let actual: number[]
    if (opcode === 0) {
      const segment = sourceBboneOutline(
        [0, 1, 2, 3].map((index) => ({
          view: p.slice(index * 7, index * 7 + 3) as V3,
          clip: p.slice(index * 7 + 3, index * 7 + 7) as unknown as SourceRigClip,
        })),
        { width: p[28]!, height: p[29]! },
        Boolean(p[30]),
        Boolean(p[31]),
      )
      actual = segment?.flat() ?? []
    } else if (opcode === 1) {
      actual = sourceBboneShade(p.slice(0, 3) as V3, p.slice(3, 6) as V3, p.slice(6, 9) as V3)
    } else actual = sourceBoneWireColor(p.slice(0, 3), p[3]!)
    expect(actual).toHaveLength(expected.length)
    actual.forEach((value, index) => {
      expect(Math.abs(value - expected[index]!)).toBeLessThanOrEqual(
        Math.max(1e-7, Math.abs(value) * 3e-7),
      )
    })
  }
  const previous = sourceBoneWireColor([1, 0.6, 0]),
    frozen = previous.slice()
  sourceBoneWireColor([0, 0, 1])
  expect(previous).toEqual(frozen)
  expect(() => sourceBboneOutline([], { width: 100, height: 100 }, false, false)).toThrow()
})

test('only the original Crane height and arm controls use source BBONE display metadata', () => {
  for (const type of ['dolly', 'crane', '2d'] as const) {
    const node = SceneCameraNode.parse({})
    node.rig = createSourceCameraRig(type, sceneCameraRigPose(node))
    const widgets = rigSnapshot(node)!.widgets.filter((widget) => widget.display)
    expect(widgets.map((widget) => widget.name)).toEqual(
      type === 'crane' ? ['Crane_Height', 'Crane_Arm'] : [],
    )
    for (const widget of widgets) {
      expect(widget.display!.type).toBe('bbone')
      expect(widget.display!.size[0]).toBeCloseTo(0.05)
      expect(widget.display!.size[2]).toBeCloseTo(0.05)
      expect(widget.display!.size[1]).toBeGreaterThan(0)
    }
  }
})

function widget() {
  const node = SceneCameraNode.parse({})
  node.rig = createSourceCameraRig('crane', sceneCameraRigPose(node))
  return structuredClone(
    rigSnapshot(node)!.widgets.find((widget) => widget.name === 'Crane_Height')!,
  )
}
const style = { wire: [0.2, 0.3, 0.4], solid: [0.3, 0.5, 0.7], pixelSize: 1, fill: true }

test('source face triangles retain display size, reflected culling flags and GL/GPU depth mapping', () => {
  const original = widget()
  for (const camera of [
    new PerspectiveCamera(50, 1, 0.1, 100),
    new OrthographicCamera(-2, 2, 2, -2, 0.1, 100),
  ])
    for (const mirror of [1, -1]) {
      camera.coordinateSystem = WebGLCoordinateSystem
      camera.updateProjectionMatrix()
      camera.position.set(0, 1, 5)
      camera.lookAt(0, 1, 0)
      camera.updateMatrixWorld()
      const matrix = new Matrix4().makeScale(mirror, 1, 1)
      const gl = createSourceRigBboneFrame(
        original,
        camera,
        matrix,
        { width: 1000, height: 1000 },
        style,
      )
      camera.coordinateSystem = WebGPUCoordinateSystem
      camera.updateProjectionMatrix()
      const gpu = createSourceRigBboneFrame(
        original,
        camera,
        matrix,
        { width: 1000, height: 1000 },
        style,
      )
      const a = gl.fill.getAttribute('sourceRigClip'),
        b = gpu.fill.getAttribute('sourceRigClip')
      expect(a.count).toBe(36)
      expect(gl.fill.getAttribute('sourceBboneColor').count).toBe(36)
      expect(gl.fill.getAttribute('sourceBboneInverted').getX(0)).toBe(Number(mirror < 0))
      for (let index = 0; index < a.count; index++) {
        expect(a.getX(index)).toBe(b.getX(index))
        expect(a.getY(index)).toBe(b.getY(index))
        expect((a.getZ(index) + a.getW(index)) / 2).toBeCloseTo(b.getZ(index), 6)
        const vertex =
          sourceBboneBatch.bone_box_verts[
            sourceBboneBatch.bone_box_solid_tris[Math.floor(index / 3)]![index % 3]!
          ]!
        const point = new Vector3(...(vertex as V3))
          .multiply(new Vector3(...original.display!.size))
          .applyMatrix4(matrix)
          .project(camera)
        expect(b.getX(index) / b.getW(index)).toBeCloseTo(point.x, 5)
        expect(b.getY(index) / b.getW(index)).toBeCloseTo(point.y, 5)
      }
      const frozen = [...a.array]
      camera.position.x += 2
      camera.updateMatrixWorld()
      expect([...a.array]).toEqual(frozen)
      gl.fill.dispose()
      gl.outline.dispose()
      gpu.fill.dispose()
      gpu.outline.dispose()
    }
})

test('BBONE cache rebuilds for display size, pose fill, style and projection changes', () => {
  const original = widget(),
    camera = new PerspectiveCamera(),
    matrix = new Matrix4(),
    viewport = { width: 1000, height: 1000 },
    settings = { ...style },
    cache = new SourceRigBboneGeometryCache()
  camera.position.z = 5
  camera.updateMatrixWorld()
  const update = () => cache.update(original, camera, matrix, viewport, settings)
  const initial = update()!
  expect(update()).toBeNull()
  for (const change of [
    () => {
      original.display!.size[1] += 1
    },
    () => {
      settings.fill = false
    },
    () => {
      settings.solid = [0.1, 0.2, 0.3]
    },
    () => {
      settings.pixelSize = 2
    },
    () => {
      camera.aspect = 2
      camera.updateProjectionMatrix()
    },
    () => {
      matrix.makeTranslation(1, 0, 0)
    },
    () => {
      cache.invalidate()
    },
  ]) {
    change()
    const next = update()
    expect(next).not.toBeNull()
    expect(update()).toBeNull()
    next!.fill.dispose()
    next!.outline.dispose()
  }
  initial.fill.dispose()
  initial.outline.dispose()
})

test('BBONE solid compiles with source reflected face culling and the scene-depth output gate', () => {
  for (const webgl of [false, true]) {
    const canvas = {
      width: 800,
      height: 600,
      style: {},
      addEventListener() {},
      removeEventListener() {},
    } as unknown as HTMLCanvasElement
    const renderer = new WebGPURenderer({ canvas, forceWebGL: webgl }),
      camera = new PerspectiveCamera()
    if (!webgl) {
      camera.coordinateSystem = WebGPUCoordinateSystem
      camera.updateProjectionMatrix()
    }
    camera.position.z = 5
    camera.updateMatrixWorld()
    const geometry = createSourceRigBboneFrame(
      widget(),
      camera,
      new Matrix4(),
      { width: 800, height: 600 },
      style,
    )
    const material = createSourceRigBboneMaterial()
    expect(material.depthTest).toBe(true)
    expect(material.depthWrite).toBe(false)
    let gates = 0
    const depth = uniform(0.75).setName('source_test_scene_depth')
    renderer.contextNode = context({
      getOutput(output: Node<'vec4'>) {
        gates++
        return Fn(() => {
          float(0.5).greaterThan(depth).discard()
          return output
        })()
      },
    })
    const mesh = new Mesh(geometry.fill, material),
      builder = webgl ? new GLSLNodeBuilder(mesh, renderer) : new WGSLNodeBuilder(mesh, renderer)
    Object.assign(builder, { camera, scene: new Scene() })
    builder.build()
    expect(gates).toBe(1)
    expect(builder.fragmentShader).toContain('source_test_scene_depth')
    expect(builder.fragmentShader).toContain('discard')
    expect(builder.fragmentShader).toContain(webgl ? 'gl_FrontFacing' : 'front_facing')
    expect(builder.vertexShader).toContain('sourceRigClip')
    expect(builder.vertexShader).toContain('sourceBboneInverted')
    geometry.fill.dispose()
    geometry.outline.dispose()
    material.dispose()
  }
})
