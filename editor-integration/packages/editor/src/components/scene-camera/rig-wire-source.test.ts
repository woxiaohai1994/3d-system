import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  Matrix4,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  WebGPUCoordinateSystem,
} from 'three'
import { context, Fn, float, uniform } from 'three/tsl'
import * as ThreeWebGPU from 'three/webgpu'
import { GLSLNodeBuilder, type Node, WebGPURenderer } from 'three/webgpu'
import reference from '../../../../../tests/integration/fixtures/blender-rig-wire.json'
import {
  createSourceRigWireFrame,
  createSourceRigWireMaterial,
  SourceRigWireGeometryCache,
} from './rig-source-wire'
import {
  type SourceRigClip,
  sourceRigWireAlpha,
  sourceRigWireQuad,
  sourceRigWireWidth,
} from './rig-wire-source'
import source from './rig-wire-source.json'

// Three r186 exports this builder, while the installed r184 declarations omit that export.
const { WGSLNodeBuilder } = ThreeWebGPU as typeof ThreeWebGPU & {
  WGSLNodeBuilder: typeof GLSLNodeBuilder
}

test('wire source module has no host imports and retains original shader and adapter hashes', () => {
  const bytes = Uint8Array.from(atob(source.wasm), (c) => c.charCodeAt(0))
  expect(WebAssembly.Module.imports(new WebAssembly.Module(bytes))).toEqual([])
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.wasmHash)
  expect(source.hashes).toEqual(reference.hashes)
  for (const [path, hash] of Object.entries(source.hashes))
    expect(
      createHash('sha256')
        .update(readFileSync(new URL(`../../../../../${path}`, import.meta.url)))
        .digest('hex'),
    ).toBe(hash)
})

test('wire quads and opacity match independent native compilation of original GLSL bodies', () => {
  for (const sample of reference.cases) {
    const p = sample.params
    const style = {
      wireWidth: p[8]!,
      pixelSize: p[9]!,
      themeEdgeWidth: p[10]!,
      smooth: Boolean(p[13]),
    }
    const quad = sourceRigWireQuad(
      p.slice(0, 4) as unknown as SourceRigClip,
      p.slice(4, 8) as unknown as SourceRigClip,
      { width: p[11]!, height: p[12]! },
      style,
    )
    expect(quad ? 4 : 0).toBe(sample.expected.count)
    const actual = quad ? [...quad.clip, ...quad.edge, quad.width] : []
    actual.forEach((value, i) => {
      expect(Math.abs(value - sample.expected.values[i]!)).toBeLessThanOrEqual(
        Math.max(1e-7, Math.abs(value) * 2e-7),
      )
    })
    const width = sourceRigWireWidth(style)
    expect(width).toBeCloseTo(sample.expected.width, 5)
    expect(sourceRigWireAlpha(p[14]!, width, style.smooth, p[15]!)).toBeCloseTo(
      sample.expected.alpha,
      6,
    )
  }
})

test('quad end caps do not extend the segment, while smoothing adds coverage and preserves depth', () => {
  const style = { wireWidth: 1, pixelSize: 1 }
  const a: SourceRigClip = [-0.5, 0, -0.25, 1],
    b: SourceRigClip = [1, 0, 1, 2],
    viewport = { width: 100, height: 100 }
  const hard = sourceRigWireQuad(a, b, viewport, { ...style, smooth: false })!,
    smooth = sourceRigWireQuad(a, b, viewport, style)!
  for (let vertex = 0; vertex < 4; vertex++) {
    const endpoint = vertex < 2 ? a : b
    expect(smooth.clip[vertex * 4]).toBe(endpoint[0])
    expect(smooth.clip[vertex * 4 + 2]).toBe(endpoint[2])
    expect(smooth.clip[vertex * 4 + 3]).toBe(endpoint[3])
    expect(Math.abs(smooth.edge[vertex]!) - Math.abs(hard.edge[vertex]!)).toBeCloseTo(0.5)
  }
  const copy = smooth.clip.slice()
  sourceRigWireQuad([0, -0.5, 0, 1], [0, 0.5, 0, 1], viewport, style)
  expect(smooth.clip).toEqual(copy)
})

test('frozen geometry supports camera projection systems without a second scene transform', () => {
  const widget = {
    vertices: [
      [-1, 0, -4],
      [1, 0, -4],
    ] as [number, number, number][],
    edges: [[0, 1]] as [number, number][],
  }
  const style = { wireWidth: 1.5, pixelSize: 2 }
  for (const camera of [
    new PerspectiveCamera(50, 2, 0.1, 100),
    new OrthographicCamera(-2, 2, 1, -1, 0.1, 100),
  ]) {
    camera.updateMatrixWorld()
    const gl = createSourceRigWireFrame(
      widget,
      camera,
      new Matrix4(),
      { width: 1000, height: 500 },
      style,
    )
    camera.coordinateSystem = WebGPUCoordinateSystem
    camera.updateProjectionMatrix()
    const gpu = createSourceRigWireFrame(
      widget,
      camera,
      new Matrix4(),
      { width: 1000, height: 500 },
      style,
    )
    const a = gl.getAttribute('sourceRigClip'),
      b = gpu.getAttribute('sourceRigClip')
    expect(a.count).toBe(4)
    expect([...gl.index!.array]).toEqual([0, 1, 2, 2, 1, 3])
    for (let i = 0; i < 4; i++) {
      expect(a.getX(i)).toBe(b.getX(i))
      expect(a.getY(i)).toBe(b.getY(i))
      expect((a.getZ(i) + a.getW(i)) / 2).toBeCloseTo(b.getZ(i), 6)
      expect(a.getW(i)).toBe(b.getW(i))
    }
    const frozen = [...a.array]
    camera.position.z = 5
    camera.updateMatrixWorld()
    expect([...a.array]).toEqual(frozen)
    gl.dispose()
    gpu.dispose()
  }
  const render = createSourceRigWireMaterial({ color: 0xffffff })
  expect(render.material.vertexNode).not.toBeNull()
  expect(render.material.fragmentNode).toBeNull()
  expect(render.material.outputNode).not.toBeNull()
  expect(render.material.depthWrite).toBe(true)
  render.material.dispose()
})

test('geometry cache rebuilds only when projection, pose, pixels, style or shape changes', () => {
  const widget = {
    vertices: [
      [-1, 0, -4],
      [1, 0, -4],
    ] as [number, number, number][],
    edges: [[0, 1]] as [number, number][],
  }
  const camera = new PerspectiveCamera(),
    world = new Matrix4(),
    viewport = { width: 800, height: 600 },
    style = { wireWidth: 1, pixelSize: 1 },
    cache = new SourceRigWireGeometryCache()
  const update = () => cache.update(widget, camera, world, viewport, style)
  const first = update()!
  expect(update()).toBeNull()
  const firstClip = [...first.getAttribute('sourceRigClip').array]
  const rebuild = (change: () => void) => {
    change()
    const next = update()
    expect(next).not.toBeNull()
    expect(update()).toBeNull()
    next!.dispose()
  }
  rebuild(() => {
    camera.aspect = 2
    camera.updateProjectionMatrix()
  })
  rebuild(() => {
    camera.position.x = 1
    camera.updateMatrixWorld()
  })
  rebuild(() => {
    world.makeTranslation(1, 0, 0)
  })
  rebuild(() => {
    viewport.width = 900
  })
  rebuild(() => {
    style.pixelSize = 2
  })
  rebuild(() => {
    style.wireWidth = 2
  })
  rebuild(() => {
    camera.coordinateSystem = WebGPUCoordinateSystem
    camera.updateProjectionMatrix()
  })
  rebuild(() => {
    widget.vertices = widget.vertices.map((point) => [...point])
  })
  rebuild(() => {
    widget.edges = widget.edges.map((edge) => [...edge])
  })
  rebuild(() => cache.invalidate())
  expect([...first.getAttribute('sourceRigClip').array]).toEqual(firstClip)
  first.dispose()
})

test('source wire compiles WGSL and WebGL2 GLSL while retaining the scene depth output gate', () => {
  for (const webgl of [false, true]) {
    const canvas = {
      width: 800,
      height: 600,
      style: {},
      addEventListener() {},
      removeEventListener() {},
    } as unknown as HTMLCanvasElement
    const renderer = new WebGPURenderer({ canvas, forceWebGL: webgl })
    const camera = new PerspectiveCamera()
    if (!webgl) {
      camera.coordinateSystem = WebGPUCoordinateSystem
      camera.updateProjectionMatrix()
    }
    const geometry = createSourceRigWireFrame(
      {
        vertices: [
          [-1, 0, -4],
          [1, 0, -4],
        ],
        edges: [[0, 1]],
      },
      camera,
      new Matrix4(),
      { width: 800, height: 600 },
      { wireWidth: 1, pixelSize: 1 },
    )
    const { material } = createSourceRigWireMaterial({ color: 0xffffff })
    let gates = 0
    const sceneDepth = uniform(0.75).setName('source_test_scene_depth')
    renderer.contextNode = context({
      getOutput(output: Node<'vec4'>) {
        gates++
        return Fn(() => {
          float(0.5).greaterThan(sceneDepth).discard()
          return output
        })()
      },
    })
    const mesh = new Mesh(geometry, material)
    const builder = webgl
      ? new GLSLNodeBuilder(mesh, renderer)
      : new WGSLNodeBuilder(mesh, renderer)
    Object.assign(builder, { camera, scene: new Scene() })
    builder.build()
    expect(gates).toBe(1)
    expect(builder.fragmentShader).toContain('source_test_scene_depth')
    expect(builder.fragmentShader).toContain('discard')
    expect(builder.fragmentShader).toContain('smoothstep')
    expect(builder.fragmentShader).toMatch(/\.w = \( \w+\.w \* \( 1\.0 - \w+ \) \)/)
    expect(builder.vertexShader).toContain('sourceRigClip')
    if (webgl) expect(builder.fragmentShader).not.toContain('noperspective')
    else {
      expect(builder.fragmentShader).toContain('@interpolate( linear )')
      expect(builder.fragmentShader).not.toContain('normal )')
    }
    geometry.dispose()
    material.dispose()
  }
})
