import { describe, expect, spyOn, test } from 'bun:test'
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  FloatType,
  Mesh,
  PerspectiveCamera,
  Scene,
  UnsignedIntType,
  Vector4,
} from 'three'
import { context } from 'three/tsl'
import * as WebGPU from 'three/webgpu'
import {
  chooseRigGpuSelectionHit,
  RigGpuSelectionFrame,
  RigGpuSelectionPass,
  rigGpuPickProjection,
  rigGpuSelectionSamples,
} from './rig-gpu-selection'

function geometry(depth = 0.2) {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'sourceRigClip',
    new Float32BufferAttribute(
      [-0.1, -0.1, depth, 1, 0.1, -0.1, depth, 1, -0.1, 0.1, depth, 1, 0.1, 0.1, depth, 1],
      4,
    ),
  )
  geometry.setIndex([0, 1, 2, 2, 1, 3])
  return geometry
}

function pixels(webgpu: boolean) {
  const stride = webgpu ? 128 : 112
  const pixels = new Float32Array(27 * stride + 112)
  for (let y = 0; y < 28; y++) {
    for (let x = 0; x < 28; x++) pixels[y * stride + x * 4] = 1
  }
  return {
    pixels,
    fill(x: number, y: number, depth: number) {
      pixels[y * stride + x * 4] = depth
      pixels[y * stride + x * 4 + 3] = 1
    },
  }
}

function rendererFixture(webgpu = true, reversed = false) {
  const calls: string[] = []
  const pending: { resolve: (pixels: Float32Array) => void; reject: (error: Error) => void }[] = []
  const state = {
    target: {} as unknown,
    mrt: {} as unknown,
    color: new Color(0x123456),
    alpha: 0.75,
    object: (() => {}) as unknown,
    ratio: 2,
    scissor: true,
    depth: 0.3,
  }
  const renderer = {
    contextNode: context({ original: true }),
    backend: { isWebGPUBackend: webgpu },
    reversedDepthBuffer: reversed,
    opaque: false,
    transparent: false,
    autoClear: true,
    toneMapping: 3,
    toneMappingExposure: 1.4,
    outputColorSpace: 'srgb',
    getRenderTarget: () => state.target,
    setRenderTarget: (value: unknown) => {
      state.target = value
    },
    getMRT: () => state.mrt,
    setMRT: (value: unknown) => {
      state.mrt = value
    },
    getClearColor: (value: Color) => value.copy(state.color),
    getClearAlpha: () => state.alpha,
    setClearColor: (value: Color, alpha: number) => {
      state.color.copy(value)
      state.alpha = alpha
    },
    getRenderObjectFunction: () => state.object,
    setRenderObjectFunction: (value: unknown) => {
      state.object = value
    },
    getPixelRatio: () => state.ratio,
    setPixelRatio: (value: number) => {
      state.ratio = value
    },
    getScissorTest: () => state.scissor,
    setScissorTest: (value: boolean) => {
      state.scissor = value
    },
    getClearDepth: () => (reversed ? 1 - state.depth : state.depth),
    setClearDepth: (value: number) => {
      state.depth = value
    },
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    clear: (color: boolean, depth: boolean, stencil: boolean) => {
      expect([color, depth, stencil]).toEqual([true, true, true])
      calls.push('clear')
    },
    render: (scene: Scene | Mesh) => {
      expect(renderer.opaque).toBe(true)
      if (scene instanceof Scene) {
        expect(scene.children).toHaveLength(1)
        expect((scene.children[0] as Mesh).frustumCulled).toBe(false)
        calls.push('draw')
      } else {
        expect((scene as WebGPU.QuadMesh).isQuadMesh).toBe(true)
        calls.push('snapshot')
      }
    },
    readRenderTargetPixelsAsync: (
      _target: unknown,
      x: number,
      y: number,
      width: number,
      height: number,
    ) => {
      expect([x, y, width, height]).toEqual([0, 0, 28, 28])
      calls.push('copy')
      return new Promise<Float32Array>((resolve, reject) => pending.push({ resolve, reject }))
    },
  }
  return {
    renderer: renderer as unknown as WebGPU.WebGPURenderer,
    raw: renderer,
    state,
    pending,
    calls,
  }
}

describe('GPU pose selection', () => {
  test('source rectangles read 28/18/10 pixel areas and ignore WebGPU row padding', () => {
    for (const webgpu of [false, true]) {
      const data = pixels(webgpu)
      data.fill(0, 0, 0.1)
      data.fill(5, 5, 0.2)
      data.fill(9, 9, 0.3)
      // Padding is deliberately a closer opaque sample, and must never be examined.
      if (webgpu) {
        data.pixels[112] = 0
        data.pixels[115] = 1
      }
      const samples = rigGpuSelectionSamples(data.pixels, webgpu)
      expect(samples.map((sample) => sample.radius)).toEqual([14, 9, 5])
      samples.forEach((sample, i) => {
        expect(sample.depth).toBeCloseTo([0.1, 0.2, 0.3][i]!, 6)
      })
      expect(rigGpuSelectionSamples(pixels(webgpu).pixels, webgpu)).toEqual([])
      const far = pixels(webgpu)
      far.fill(14, 14, 1)
      expect(rigGpuSelectionSamples(far.pixels, webgpu)).toEqual([])
    }
    expect(() => rigGpuSelectionSamples(new Float32Array(1), true)).toThrow('Incomplete')
  })

  test('cropping preserves source clip Z/W and window pixel phase', () => {
    const crop = rigGpuPickProjection({ width: 700, height: 400 }, { x: 350.9, y: 200.9 })
    const center = new Vector4(0, 0, 0.42, 1).applyMatrix4(crop)
    expect(center.toArray()).toEqual([0, 0, 0.42, 1])
    const edge = new Vector4((2 * 364) / 700 - 1, 1 - (2 * 186) / 400, 0.42, 1).applyMatrix4(crop)
    expect(edge.x).toBeCloseTo(1, 12)
    expect(edge.y).toBeCloseTo(1, 12)
    expect([edge.z, edge.w]).toEqual([0.42, 1])
  })

  test('selection freezes source in-front depth-range choice and rejects invalid frames', () => {
    const options = { front: false }
    const frame = new RigGpuSelectionFrame(
      new PerspectiveCamera(),
      [],
      { width: 700, height: 400 },
      options,
    )
    options.front = true
    expect(frame.front).toBe(false)
    expect(
      new RigGpuSelectionFrame(new PerspectiveCamera(), [], { width: 700, height: 400 }).front,
    ).toBe(true)
    expect(
      () => new RigGpuSelectionFrame(new PerspectiveCamera(), [], { width: Infinity, height: 400 }),
    ).toThrow('viewport')
    expect(
      () =>
        new RigGpuSelectionFrame(
          new PerspectiveCamera(),
          [{ name: 'Camera', geometry: new BufferGeometry() }],
          { width: 700, height: 400 },
        ),
    ).toThrow('sourceRigClip')
    frame.dispose()
  })

  for (const webgpu of [false, true])
    test(`each widget gets a cleared depth pass and copied buffer; rear candidates survive (${webgpu ? 'WebGPU' : 'WebGL'})`, async () => {
      const pass = new RigGpuSelectionPass()
      const frame = new RigGpuSelectionFrame(
        new PerspectiveCamera(),
        [
          { name: 'Camera', geometry: geometry(0.2) },
          { name: 'Aim', geometry: geometry(0.8) },
        ],
        { width: 700, height: 400 },
      )
      const { renderer, raw, calls, pending } = rendererFixture(webgpu, true)
      const saved = WebGPU.RendererUtils.saveRendererState(renderer)
      const shaderContext = raw.contextNode
      const promise = pass.pick(renderer, frame, { x: 350, y: 200 })
      expect(calls).toEqual([
        'clear',
        'draw',
        'snapshot',
        'copy',
        'clear',
        'draw',
        'snapshot',
        'copy',
      ])
      expect(WebGPU.RendererUtils.saveRendererState(renderer)).toEqual(saved)
      expect(raw.contextNode).toBe(shaderContext)
      expect([raw.opaque, raw.transparent]).toEqual([false, false])
      expect(renderer.getClearDepth()).toBeCloseTo(0.7, 10)
      const front = pixels(webgpu),
        rear = pixels(webgpu)
      front.fill(14, 14, 0.2)
      rear.fill(14, 14, 0.8)
      pending[0]!.resolve(front.pixels)
      pending[1]!.resolve(rear.pixels)
      const hits = await promise
      expect(hits.map((hit) => hit.name)).toEqual(['Camera', 'Aim'])
      expect(hits[1]!.rigHits.map((hit) => hit.radius)).toEqual([14, 9, 5])
      expect(chooseRigGpuSelectionHit(hits, ['Camera'])?.name).toBe('Aim')
      expect(chooseRigGpuSelectionHit(hits, ['Aim'])?.name).toBe('Camera')
      frame.dispose()
      pass.dispose()
    })

  test('camera/geometry are frozen and disposal waits for pending readback', async () => {
    const camera = new PerspectiveCamera(),
      source = geometry()
    camera.position.set(2, 3, 4)
    camera.updateMatrixWorld()
    const frame = new RigGpuSelectionFrame(camera, [{ name: 'Camera', geometry: source }], {
      width: 700,
      height: 400,
    })
    const frozen = frame.widgets[0]!.geometry
    const disposeGeometry = spyOn(frozen, 'dispose')
    const pass = new RigGpuSelectionPass(),
      disposeTarget = spyOn(pass.target, 'dispose')
    const { renderer, pending } = rendererFixture()
    const promise = pass.pick(renderer, frame, { x: 350, y: 200 })
    source.getAttribute('sourceRigClip').setX(0, 99)
    source.index!.setX(0, 3)
    camera.position.x = 99
    expect(frame.camera.position.x).toBe(2)
    expect(frozen.getAttribute('sourceRigClip').getX(0)).toBeCloseTo(-0.1, 6)
    expect(frozen.index!.getX(0)).toBe(0)
    frame.dispose()
    pass.dispose()
    expect(disposeGeometry).not.toHaveBeenCalled()
    expect(disposeTarget).not.toHaveBeenCalled()
    pending[0]!.resolve(pixels(true).pixels)
    expect(await promise).toEqual([])
    expect(disposeGeometry).toHaveBeenCalledTimes(1)
    expect(disposeTarget).toHaveBeenCalledTimes(1)
    await expect(pass.pick(renderer, frame, { x: 350, y: 200 })).rejects.toThrow('disposed')
  })

  test('failed drawing restores renderer state and drains already submitted copies', async () => {
    const pass = new RigGpuSelectionPass()
    const frame = new RigGpuSelectionFrame(
      new PerspectiveCamera(),
      [
        { name: 'Camera', geometry: geometry() },
        { name: 'Aim', geometry: geometry() },
      ],
      { width: 700, height: 400 },
    )
    const { renderer, raw, pending } = rendererFixture()
    const saved = WebGPU.RendererUtils.saveRendererState(renderer)
    const originalContext = raw.contextNode
    let draws = 0
    raw.render = (scene) => {
      if (scene instanceof Scene && ++draws === 2) throw new Error('draw failure')
    }
    const promise = pass.pick(renderer, frame, { x: 350, y: 200 })
    expect(WebGPU.RendererUtils.saveRendererState(renderer)).toEqual(saved)
    expect(raw.contextNode).toBe(originalContext)
    expect(pending).toHaveLength(1)
    pending[0]!.resolve(pixels(true).pixels)
    await expect(promise).rejects.toThrow('draw failure')
    frame.dispose()
    pass.dispose()
  })

  test('aborting readback cannot return a stale selection', async () => {
    const pass = new RigGpuSelectionPass()
    const frame = new RigGpuSelectionFrame(
      new PerspectiveCamera(),
      [{ name: 'Camera', geometry: geometry() }],
      { width: 700, height: 400 },
    )
    const { renderer, pending } = rendererFixture()
    const controller = new AbortController(),
      reason = new Error('stale frame')
    const promise = pass.pick(renderer, frame, { x: 350, y: 200 }, controller.signal)
    controller.abort(reason)
    pending[0]!.resolve(pixels(true).pixels)
    await expect(promise).rejects.toBe(reason)
    frame.dispose()
    pass.dispose()
  })

  test('source aperture narrowing counts every candidate, including rear widgets', () => {
    const hits = [
      { name: 'Root', rigHits: [{ radius: 14 as const, depth: 0.1 }] },
      {
        name: 'Camera',
        rigHits: [
          { radius: 14 as const, depth: 0.2 },
          { radius: 9 as const, depth: 0.2 },
        ],
      },
      {
        name: 'Aim',
        rigHits: [
          { radius: 14 as const, depth: 0.8 },
          { radius: 9 as const, depth: 0.8 },
        ],
      },
    ]
    expect(chooseRigGpuSelectionHit(hits, ['Camera'])?.name).toBe('Aim')
    expect(chooseRigGpuSelectionHit(hits, ['Camera'], false)?.name).toBe('Aim')
  })

  test('D24 normalized samples retain the native UINT ordering and equal-depth bone order', () => {
    const nativeDepth = 0x800000
    // Sampling D24 returns normalized float values. GL UINT depth read scales the same stored
    // integers to UINT32; both conversions preserve their order, including exact stored ties.
    const near = Math.fround(nativeDepth / 0xffffff)
    const farther = Math.fround((nativeDepth + 1) / 0xffffff)
    expect(farther).toBeGreaterThan(near)
    const hits = [
      { name: 'Root', rigHits: [{ radius: 14 as const, depth: farther }] },
      { name: 'Camera', rigHits: [{ radius: 14 as const, depth: near }] },
      { name: 'Aim', rigHits: [{ radius: 14 as const, depth: near }] },
    ]
    expect(chooseRigGpuSelectionHit(hits, [])?.name).toBe('Camera')
    expect(chooseRigGpuSelectionHit(hits, ['Camera'])?.name).toBe('Aim')
    expect(hits.map((hit) => hit.name)).toEqual(['Root', 'Camera', 'Aim'])
  })
})

type ShaderBuilder = WebGPU.NodeBuilder & { scene: Scene; camera: PerspectiveCamera }
const builders = WebGPU as unknown as {
  WGSLNodeBuilder: new (mesh: Mesh, renderer: WebGPU.Renderer) => ShaderBuilder
  GLSLNodeBuilder: new (mesh: Mesh, renderer: WebGPU.Renderer) => ShaderBuilder
}
for (const webgpu of [true, false])
  for (const reversed of [false, true])
    test(`selection shader compiles source clips and snapshots actual stored depth (${webgpu}/${reversed})`, () => {
      const pass = new RigGpuSelectionPass(),
        camera = new PerspectiveCamera()
      let renderTarget = pass.target
      const renderer = {
        contextNode: context(),
        reversedDepthBuffer: reversed,
        coordinateSystem: webgpu ? WebGPU.WebGPUCoordinateSystem : WebGPU.WebGLCoordinateSystem,
        lighting: { enabled: false },
        currentSamples: 0,
        debug: { diagnostics: { keywords: false } },
        backend: {
          isWebGPUBackend: webgpu,
          extensions: { has: () => false, get: () => null },
          has: () => false,
          utils: { getTextureSampleData: () => ({ primarySamples: 1 }) },
        },
        library: { fromMaterial: (material: WebGPU.NodeMaterial) => material },
        getRenderTarget: () => renderTarget,
        getMRT: () => null,
        getOutputRenderTarget: () => null,
        getPixelRatio: () => 1,
        hasFeature: () => false,
        hasCompatibility: () => false,
      }
      const Builder = webgpu ? builders.WGSLNodeBuilder : builders.GLSLNodeBuilder
      const builder = new Builder(
        new Mesh(geometry(), pass.material),
        renderer as unknown as WebGPU.Renderer,
      )
      builder.scene = new Scene()
      builder.camera = camera
      builder.build()
      expect(builder.vertexShader).toContain('sourceRigClip')
      expect(builder.fragmentShader).toContain('discard;')
      expect(builder.fragmentShader).toContain(webgpu ? 'front_facing' : 'gl_FrontFacing')
      expect(builder.fragmentShader).toContain(webgpu ? 'frag_depth' : 'gl_FragDepth')
      expect(builder.fragmentShader).toContain(webgpu ? 'fragCoord.z' : 'gl_FragCoord.z')
      expect(builder.fragmentShader).toContain('0.01')
      renderTarget = pass.readbackTarget
      const snapshot = new Builder(
        new WebGPU.QuadMesh(pass.readbackMaterial),
        renderer as unknown as WebGPU.Renderer,
      )
      snapshot.scene = new Scene()
      snapshot.camera = camera
      snapshot.build()
      expect(snapshot.fragmentShader).toContain(webgpu ? 'texture_depth_2d' : 'sampler2D')
      expect(snapshot.fragmentShader).toContain(webgpu ? 'textureLoad' : 'texture( nodeUniform0,')
      expect(snapshot.fragmentShader).not.toContain('discard;')
      if (reversed) expect(snapshot.fragmentShader).toContain('1.0 - ')
      expect(pass.target.samples).toBe(0)
      expect(pass.target.depthTexture!.type).toBe(UnsignedIntType)
      expect(pass.readbackTarget.samples).toBe(0)
      expect(pass.readbackTarget.texture.type).toBe(FloatType)
      expect(pass.readbackTarget.depthBuffer).toBe(false)
      pass.dispose()
    })
