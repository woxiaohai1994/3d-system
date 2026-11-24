import { describe, expect, test } from 'bun:test'
import { FloatType, HalfFloatType, Mesh, PerspectiveCamera, Scene, Vector4 } from 'three'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import ClippingContext from 'three/src/renderers/common/ClippingContext.js'
import { context, pass, vec4 } from 'three/tsl'
import * as WebGPU from 'three/webgpu'
import { sceneDepthContext } from './scene-depth-context'

type ShaderBuilder = WebGPU.NodeBuilder & {
  scene: Scene
  camera: PerspectiveCamera
  uniforms: { fragment: WebGPU.NodeUniform<unknown, unknown>[] }
  clippingContext: ClippingContext | null
}
type ShaderBuilderConstructor = new (object: Mesh, renderer: WebGPU.Renderer) => ShaderBuilder
// The installed declarations omit the exported WGSL builder and NodeBuilder
// scene/camera/uniforms fields. Keep both builders in the bundled TSL runtime.
const builders = WebGPU as unknown as {
  WGSLNodeBuilder: ShaderBuilderConstructor
  GLSLNodeBuilder: ShaderBuilderConstructor
}

function compile({
  samples = 1,
  reversed = false,
  floatDepth = false,
  enabled = true,
  line = false,
  webgpu = true,
  clipped = false,
} = {}) {
  const scene = new Scene()
  const camera = new PerspectiveCamera()
  const main = pass(scene, camera, { samples })
  if (floatDepth) main.renderTarget.depthTexture!.type = FloatType
  // Match PassNode.setup before compiling a material rendered by that pass.
  main.renderTarget.samples = samples
  const renderer = {
    contextNode: enabled ? sceneDepthContext(main) : context(),
    reversedDepthBuffer: reversed,
    coordinateSystem: webgpu ? WebGPU.WebGPUCoordinateSystem : WebGPU.WebGLCoordinateSystem,
    samples,
    currentSamples: samples,
    lighting: { enabled: false },
    debug: { diagnostics: { keywords: false } },
    backend: {
      isWebGPUBackend: webgpu,
      isWebGLBackend: !webgpu,
      extensions: { has: () => false, get: () => null },
      has: () => false,
      utils: { getTextureSampleData: () => ({ primarySamples: samples }) },
    },
    library: { fromMaterial: (material: WebGPU.NodeMaterial) => material },
    getRenderTarget: () => main.renderTarget,
    getMRT: () => null,
    getOutputRenderTarget: () => null,
    getOutputBufferType: () => HalfFloatType,
    getPixelRatio: () => 1,
    hasFeature: () => false,
    hasCompatibility: () => false,
  }
  const material = line
    ? new WebGPU.Line2NodeMaterial({ depthWrite: false })
    : new WebGPU.MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
  if (!line) material.vertexNode = vec4(0, 0, 0, 1)
  material.colorNode = vec4(1, 0.5, 0.25, 0.4)
  material.fog = false
  if (clipped) material.alphaTest = 0.5
  const geometry = line ? new LineSegmentsGeometry().setPositions([0, 0, 0, 1, 1, 1]) : undefined
  const ShaderNodeBuilder = webgpu ? builders.WGSLNodeBuilder : builders.GLSLNodeBuilder
  const builder = new ShaderNodeBuilder(
    new Mesh(geometry, material),
    renderer as unknown as WebGPU.Renderer,
  )
  builder.scene = scene
  builder.camera = camera
  if (clipped) {
    builder.clippingContext = new ClippingContext()
    builder.clippingContext.unionPlanes.push(new Vector4(1, 0, 0, 0))
  }
  builder.build()
  return { builder, material, main, shader: builder.fragmentShader! }
}

function discardCondition(builder: ShaderBuilder) {
  const conditional = [...builder.nodes].find(
    (node): node is WebGPU.ConditionalNode<unknown> =>
      node instanceof WebGPU.ConditionalNode && node.ifNode instanceof WebGPU.ExpressionNode,
  )
  if (!conditional) throw new Error('The compiled material has no discard predicate')
  return conditional.condNode
}

function evaluate(
  node: WebGPU.Node,
  values: { material: WebGPU.NodeMaterial; fragmentDepth: number; sceneDepth: number },
): number | boolean {
  if (node instanceof WebGPU.ConstNode) {
    if (typeof node.value === 'number' || typeof node.value === 'boolean') return node.value
  }
  if (node instanceof WebGPU.VarNode && node.node instanceof WebGPU.Node) {
    return evaluate(node.node, values)
  }
  if (node instanceof WebGPU.SplitNode && node.components === 'x') {
    return evaluate(node.node, values)
  }
  if (node instanceof WebGPU.TextureNode) return values.sceneDepth
  if (node instanceof WebGPU.BuiltinNode && node.name.endsWith('.z')) return values.fragmentDepth
  if (node instanceof WebGPU.MaterialReferenceNode) {
    if (node.property === 'depthTest') return values.material.depthTest
    if (node.property === 'depthFunc') return values.material.depthFunc
  }
  if (node instanceof WebGPU.OperatorNode) {
    const a = evaluate(node.aNode, values)
    const b = evaluate(node.bNode, values)
    switch (node.op) {
      case '&&':
        return Boolean(a && b)
      case '||':
        return Boolean(a || b)
      case '==':
        return a === b
      case '!=':
        return a !== b
      case '-':
        return Math.fround(Number(a) - Number(b))
      case '>':
        return Number(a) > Number(b)
      case '>=':
        return Number(a) >= Number(b)
      case '<':
        return Number(a) < Number(b)
      case '<=':
        return Number(a) <= Number(b)
    }
  }
  throw new Error(`Unsupported scalar shader node: ${node.constructor.name}`)
}

describe('scene depth context shader', () => {
  test('compiles the discard gate against the main pass depth while retaining material color and alpha', () => {
    const { builder, main, shader } = compile()
    expect(shader).toContain('discard;')
    expect(shader).toContain('fragCoord.z')
    expect(shader).toContain('texture_depth_2d')
    expect(shader).toContain('0.4')
    expect(
      builder.uniforms.fragment.some(
        (uniform) => uniform.node.value === main.renderTarget.depthTexture,
      ),
    ).toBe(true)
    expect(
      [...builder.nodes].some(
        (node) => node instanceof WebGPU.MaterialReferenceNode && node.property === 'depthTest',
      ),
    ).toBe(true)
  })

  test('ordinary rendering outside this context has no extra scene depth binding or discard gate', () => {
    const { shader } = compile({ enabled: false })
    expect(shader).not.toContain('texture_depth_2d')
    expect(shader).not.toContain('discard;')
    expect(shader).not.toContain('fragCoord.z')
  })

  test('depthTest follows the rendered material after compilation', () => {
    const { builder, material } = compile()
    const reference = [...builder.nodes].find(
      (node): node is WebGPU.MaterialReferenceNode =>
        node instanceof WebGPU.MaterialReferenceNode && node.property === 'depthTest',
    )!
    const uniform = builder.uniforms.fragment.find((entry) => entry.node === reference.node)!
    expect(uniform.value).toBe(true)
    material.depthTest = false
    reference.update(new WebGPU.NodeFrame())
    expect(uniform.value).toBe(false)
    material.depthTest = true
    reference.update(new WebGPU.NodeFrame())
    expect(uniform.value).toBe(true)
  })

  test('the actual compiled predicate follows all native depth functions on both backends and depth directions', () => {
    const cases: [WebGPU.DepthModes, boolean[]][] = [
      [WebGPU.NeverDepth, [false, false, false]],
      [WebGPU.AlwaysDepth, [true, true, true]],
      [WebGPU.LessDepth, [true, false, false]],
      [WebGPU.LessEqualDepth, [true, true, false]],
      [WebGPU.EqualDepth, [false, true, false]],
      [WebGPU.GreaterEqualDepth, [false, true, true]],
      [WebGPU.GreaterDepth, [false, false, true]],
      [WebGPU.NotEqualDepth, [true, false, true]],
    ]
    for (const webgpu of [true, false]) {
      for (const reversed of [true, false]) {
        const { builder, material } = compile({ webgpu, reversed })
        const condition = discardCondition(builder)
        const depths = reversed ? [0.75, 0.5, 0.25] : [0.25, 0.5, 0.75]
        for (const [depthFunc, accepted] of cases) {
          material.depthFunc = depthFunc
          for (const [i, fragmentDepth] of depths.entries()) {
            expect(evaluate(condition, { material, fragmentDepth, sceneDepth: 0.5 })).toBe(
              !accepted[i],
            )
          }
        }
        material.depthTest = false
        material.depthFunc = WebGPU.NeverDepth
        expect(evaluate(condition, { material, fragmentDepth: 0.75, sceneDepth: 0.5 })).toBe(false)
      }
    }
  })

  test('LessEqual rejects even the next float depth value behind the scene', () => {
    for (const reversed of [false, true]) {
      const { builder, material } = compile({ reversed })
      const condition = discardCondition(builder)
      const sceneDepth = 0.5
      const fragmentDepth = reversed ? sceneDepth - 2 ** -25 : sceneDepth + 2 ** -24
      expect(evaluate(condition, { material, fragmentDepth: sceneDepth, sceneDepth })).toBe(false)
      expect(evaluate(condition, { material, fragmentDepth, sceneDepth })).toBe(true)
    }
  })

  test('wide lines retain their alpha coverage before the scene depth gate', () => {
    const { builder, main, shader } = compile({ line: true, samples: 4 })
    expect(shader).toContain('fwidth(')
    expect(shader).toContain('smoothstep(')
    expect(shader).toContain('DiffuseColor.w = ( DiffuseColor.w * alpha )')
    expect(shader.indexOf('DiffuseColor.w = ( DiffuseColor.w * alpha )')).toBeLessThan(
      shader.indexOf('fragCoord.z'),
    )
    expect(shader).toContain('fragCoord.z')
    expect(shader).toContain('discard;')
    expect(
      builder.uniforms.fragment.some(
        (uniform) => uniform.node.value === main.renderTarget.depthTexture,
      ),
    ).toBe(true)
  })

  test('loads every multisample and averages differences from sample zero', () => {
    const { shader } = compile({ samples: 4 })
    expect(shader).toContain('texture_depth_multisampled_2d')
    expect(shader.match(/textureLoad\(/g)).toHaveLength(4)
    expect(shader).toMatch(/\/ 4\.0/)
  })

  test('normalized, float and reversed depth compare strictly without extra depth allowance', () => {
    const normalized = compile().shader
    const floating = compile({ floatDepth: true }).shader
    const reversed = compile({ reversed: true }).shader
    for (const shader of [normalized, floating, reversed]) {
      expect(shader).not.toContain('bitcast<u32>')
      expect(shader).not.toContain('exp2(')
      expect(shader).toContain('> 0.0')
    }
    expect(floating).toMatch(/fragCoord\.z -/)
    expect(reversed).toMatch(/- fragCoord\.z/)
  })

  test('WebGL fallback samples resolved depth once with native fragment Z and correct texture orientation', () => {
    const { builder, main, shader } = compile({ webgpu: false, samples: 4, line: true })
    expect(shader).toContain('gl_FragCoord.z')
    expect(shader).toContain('discard;')
    expect(shader).toContain('sampler2D')
    expect(shader).not.toContain('sampler2DMS')
    expect(shader).not.toContain('/ 4.0')
    expect(shader).toContain('gl_FragCoord.xy')
    expect(
      builder.uniforms.fragment.some(
        (uniform) => uniform.node.value === main.renderTarget.depthTexture,
      ),
    ).toBe(true)
  })

  test('WebGL reversed depth reverses the comparison without an allowance', () => {
    const { shader } = compile({ webgpu: false, reversed: true })
    expect(shader).not.toContain('floatBitsToUint(')
    expect(shader).not.toContain('exp2(')
    expect(shader).toContain('> 0.0')
    expect(shader).toMatch(/- gl_FragCoord\.z/)
  })

  test('retains alpha testing and clipping before the extra depth discard on both backends', () => {
    for (const webgpu of [true, false]) {
      const { shader } = compile({ webgpu, clipped: true })
      const baseline = compile({ webgpu, clipped: true, enabled: false }).shader
      expect(baseline.match(/discard;/g)).toHaveLength(2)
      expect(shader.match(/discard;/g)).toHaveLength(3)
      expect(shader).toContain('dot(')
      expect(shader.indexOf('discard;')).toBeLessThan(
        shader.indexOf('FragCoord.z') > -1
          ? shader.indexOf('FragCoord.z')
          : shader.indexOf('fragCoord.z'),
      )
    }
  })
})
