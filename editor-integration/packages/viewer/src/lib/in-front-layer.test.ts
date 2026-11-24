import { describe, expect, test } from 'bun:test'
import {
  Color,
  HalfFloatType,
  Layers,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Vector4,
} from 'three'
import ClippingContext from 'three/src/renderers/common/ClippingContext.js'
import { context, pass, vec4 } from 'three/tsl'
import * as WebGPU from 'three/webgpu'
import { inFrontContext, renderWithInFrontLayer } from './in-front-layer'
import { LayerPassIndex, LayerPassNode } from './layer-pass'
import { IN_FRONT_LAYER, OVERLAY_LAYER, SCENE_LAYER } from './layers'

function fixture(reversed = false) {
  const scene = new Scene()
  const nodeScene = scene as Scene & { backgroundNode: WebGPU.Node | null }
  const camera = new PerspectiveCamera()
  camera.layers.enable(OVERLAY_LAYER)
  camera.layers.enable(IN_FRONT_LAYER)
  scene.background = new Color('blue')
  nodeScene.backgroundNode = vec4(0, 0, 1, 1)
  scene.overrideMaterial = new MeshBasicMaterial()
  const meshes = [SCENE_LAYER, OVERLAY_LAYER, IN_FRONT_LAYER, IN_FRONT_LAYER].map((layer, i) => {
    const mesh = new Mesh()
    mesh.name = ['scene', 'overlay', 'near-front', 'rear-front'][i]!
    mesh.layers.set(layer)
    mesh.position.z = [0.1, 0.15, 0.2, 0.8][i]!
    scene.add(mesh)
    return mesh
  })
  const calls: string[] = []
  const rendered: { root: Scene; names: string[]; context: WebGPU.ContextNode }[] = []
  let target: unknown = { name: 'original-target' }
  let mrt: unknown = { name: 'original-MRT' }
  let clearDepth = 0.7
  let depth = 1
  let visible = ''
  let pixelRatio = 2
  let scissorTest = true
  const color = new Color('red')
  let clearAlpha = 0.6
  let renderObjectFunction: unknown = null
  const renderer = {
    contextNode: context(),
    reversedDepthBuffer: reversed,
    autoClear: true,
    toneMapping: WebGPU.NoToneMapping,
    toneMappingExposure: 1,
    outputColorSpace: WebGPU.SRGBColorSpace,
    getOutputRenderTarget: () => null,
    getDrawingBufferSize: (size: { set(x: number, y: number): void }) => size.set(100, 100),
    getRenderTarget: () => target,
    setRenderTarget: (value: unknown) => {
      target = value
    },
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getMRT: () => mrt,
    setMRT: (value: unknown) => {
      mrt = value
    },
    getRenderObjectFunction: () => renderObjectFunction,
    setRenderObjectFunction: (value: unknown) => {
      renderObjectFunction = value
    },
    getPixelRatio: () => pixelRatio,
    setPixelRatio: (value: number) => {
      pixelRatio = value
    },
    getScissorTest: () => scissorTest,
    setScissorTest: (value: boolean) => {
      scissorTest = value
    },
    getClearColor: (value: Color) => value.copy(color),
    getClearAlpha: () => clearAlpha,
    setClearColor: (value: Color | number, alpha: number) => {
      color.set(value)
      clearAlpha = alpha
    },
    getClearDepth: () => (reversed ? 1 - clearDepth : clearDepth),
    setClearDepth: (value: number) => {
      clearDepth = value
    },
    clear: (clearColor: boolean, clearDepth: boolean, clearStencil: boolean) => {
      calls.push(`clear:${clearColor}/${clearDepth}/${clearStencil}`)
      if (clearDepth) depth = 1
    },
    render: (root: Scene, viewCamera: PerspectiveCamera) => {
      const names: string[] = []
      root.traverseVisible((object) => {
        if (!(object instanceof Mesh && object.layers.test(viewCamera.layers))) return
        names.push(object.name)
        const candidate = Math.round(object.position.z * 0xff_ff_ff) / 0xff_ff_ff
        if (candidate <= depth) {
          depth = candidate
          visible = object.name
        }
      })
      calls.push(`render:${names.join(',')}`)
      rendered.push({ root, names, context: renderer.contextNode })
    },
  }
  const gpu = renderer as unknown as WebGPU.WebGPURenderer
  const original = {
    mask: camera.layers.mask,
    target,
    mrt,
    context: renderer.contextNode,
    background: scene.background,
    backgroundNode: nodeScene.backgroundNode,
    overrideMaterial: scene.overrideMaterial,
  }
  const checkRestored = () => {
    expect(camera.layers.mask).toBe(original.mask)
    expect(renderer.getRenderTarget()).toBe(original.target)
    expect(renderer.getMRT()).toBe(original.mrt)
    expect(renderer.contextNode).toBe(original.context)
    expect(scene.background).toBe(original.background)
    expect(nodeScene.backgroundNode).toBe(original.backgroundNode)
    expect(scene.overrideMaterial).toBe(original.overrideMaterial)
    expect(renderer.autoClear).toBe(true)
    expect(renderer.getClearColor(new Color())).toEqual(new Color('red'))
    expect(renderer.getClearAlpha()).toBe(0.6)
    expect(clearDepth).toBeCloseTo(0.7, 12)
    expect(renderer.getPixelRatio()).toBe(2)
    expect(renderer.getScissorTest()).toBe(true)
  }
  return {
    scene,
    nodeScene,
    camera,
    meshes,
    renderer,
    gpu,
    calls,
    rendered,
    checkRestored,
    visible: () => visible,
  }
}

describe('direct in-front layer', () => {
  for (const reversed of [false, true]) {
    test(`clears depth once between scene and the entire front layer (reversed: ${reversed})`, () => {
      const f = fixture(reversed)
      const render = f.renderer.render
      f.renderer.render = (root, camera) => {
        if (camera.layers.mask === 1 << IN_FRONT_LAYER) {
          expect(root.background).toBeNull()
          expect(f.nodeScene.backgroundNode).toBeNull()
          expect(root.overrideMaterial).toBeNull()
          expect(f.renderer.autoClear).toBe(false)
          expect(f.renderer.getMRT()).toBeNull()
          expect(f.renderer.getClearDepth()).toBe(reversed ? 0 : 1)
        }
        render(root, camera)
      }
      renderWithInFrontLayer(f.gpu, f.scene, f.camera)
      expect(f.calls).toEqual([
        'render:scene,overlay',
        'clear:false/true/false',
        'render:near-front,rear-front',
      ])
      expect(f.visible()).toBe('near-front')
      expect(f.rendered[1]?.context).toBe(inFrontContext)
      f.checkRestored()
    })
  }

  test('uses one ordinary render when the camera excludes front geometry', () => {
    const f = fixture()
    f.camera.layers.disable(IN_FRONT_LAYER)
    const mask = f.camera.layers.mask
    renderWithInFrontLayer(f.gpu, f.scene, f.camera)
    expect(f.calls).toEqual(['render:scene,overlay'])
    expect(f.camera.layers.mask).toBe(mask)
    expect(f.rendered[0]?.context).toBe(f.renderer.contextNode)
  })

  for (const failureAt of [1, 2]) {
    test(`restores all caller-owned state after render ${failureAt} throws`, () => {
      const f = fixture()
      const render = f.renderer.render
      let count = 0
      f.renderer.render = (root, camera) => {
        render(root, camera)
        if (++count !== failureAt) return
        f.renderer.setRenderTarget({ failed: true })
        f.renderer.setMRT({ failed: true })
        f.renderer.setClearColor(0, 0)
        f.renderer.setPixelRatio(3)
        f.renderer.setScissorTest(false)
        f.scene.background = null
        throw new Error('render failed')
      }
      expect(() => renderWithInFrontLayer(f.gpu, f.scene, f.camera)).toThrow('render failed')
      f.checkRestored()
    })
  }
})

test('front PassNode owns normal-range depth, keeps depth state, and restores transparent clear/background', () => {
  const f = fixture()
  f.scene.overrideMaterial = null
  const index = new LayerPassIndex(f.scene, [OVERLAY_LAYER, IN_FRONT_LAYER])
  const main = pass(f.scene, f.camera)
  main.updateBefore = () => undefined
  const ordinary = new LayerPassNode(index, f.camera, OVERLAY_LAYER, main)
  const front = new LayerPassNode(index, f.camera, IN_FRONT_LAYER, main)
  const frontLayers = new Layers()
  frontLayers.set(IN_FRONT_LAYER)
  front.setLayers(frontLayers)
  expect(front.renderTarget.depthTexture).not.toBe(main.renderTarget.depthTexture)
  expect(front.renderTarget.depthTexture).not.toBe(ordinary.renderTarget.depthTexture)
  expect(front.renderTarget.depthTexture?.type).toBe(WebGPU.UnsignedIntType)
  expect(front.contextNode).toBe(inFrontContext)
  const frame = new WebGPU.NodeFrame()
  frame.renderer = f.gpu
  const render = f.renderer.render
  f.renderer.render = (root, camera) => {
    expect(f.renderer.getRenderTarget()).toBe(front.renderTarget)
    expect(f.renderer.getClearColor(new Color())).toEqual(new Color(0))
    expect(f.renderer.getClearAlpha()).toBe(0)
    expect(f.renderer.getClearDepth()).toBe(1)
    expect(root.background).toBeNull()
    expect((root as Scene & { backgroundNode: unknown }).backgroundNode).toBeNull()
    render(root, camera)
  }
  try {
    front.updateBefore(frame)
    expect(f.rendered[0]?.names).toEqual(['near-front', 'rear-front'])
    for (const mesh of f.meshes.slice(2)) {
      const material = mesh.material as MeshBasicMaterial
      expect(material.depthTest).toBe(true)
      expect(material.depthWrite).toBe(true)
      expect(material.depthFunc).toBe(WebGPU.LessEqualDepth)
    }
    expect(f.renderer.getClearColor(new Color())).toEqual(new Color('red'))
    expect(f.renderer.getClearAlpha()).toBe(0.6)
    expect(f.scene.background).toEqual(new Color('blue'))
    expect(f.nodeScene.backgroundNode).not.toBeNull()
    expect(f.renderer.contextNode).not.toBe(inFrontContext)
    f.meshes[2]!.visible = false
    f.meshes[3]!.visible = false
    frame.frameId++
    front.updateBefore(frame)
    frame.frameId++
    front.updateBefore(frame)
    expect(f.calls.filter((call) => call.startsWith('clear:'))).toEqual(['clear:true/true/true'])
  } finally {
    index.dispose()
    front.dispose()
    ordinary.dispose()
    main.dispose()
  }
})

type ShaderBuilder = WebGPU.NodeBuilder & {
  scene: Scene
  camera: PerspectiveCamera
  uniforms: { fragment: WebGPU.NodeUniform<unknown, unknown>[] }
  clippingContext: ClippingContext | null
}
type BuilderConstructor = new (object: Mesh, renderer: WebGPU.Renderer) => ShaderBuilder
const builders = WebGPU as unknown as {
  WGSLNodeBuilder: BuilderConstructor
  GLSLNodeBuilder: BuilderConstructor
}

test('front pass shaders preserve alpha/clipping and hardware depth without the main-scene gate', () => {
  for (const webgpu of [false, true]) {
    const scene = new Scene()
    const camera = new PerspectiveCamera()
    const index = new LayerPassIndex(scene, [OVERLAY_LAYER, IN_FRONT_LAYER])
    const main = pass(scene, camera, { samples: 0 })
    const ordinary = new LayerPassNode(index, camera, OVERLAY_LAYER, main)
    const front = new LayerPassNode(index, camera, IN_FRONT_LAYER, main)
    try {
      for (const layer of [ordinary, front]) {
        const renderer = {
          contextNode: layer.contextNode,
          reversedDepthBuffer: false,
          coordinateSystem: webgpu ? WebGPU.WebGPUCoordinateSystem : WebGPU.WebGLCoordinateSystem,
          samples: 0,
          currentSamples: 1,
          lighting: { enabled: false },
          debug: { diagnostics: { keywords: false } },
          backend: {
            isWebGPUBackend: webgpu,
            isWebGLBackend: !webgpu,
            extensions: { has: () => false, get: () => null },
            has: () => false,
            utils: { getTextureSampleData: () => ({ primarySamples: 1 }) },
          },
          library: { fromMaterial: (material: WebGPU.NodeMaterial) => material },
          getRenderTarget: () => layer.renderTarget,
          getMRT: () => null,
          getOutputRenderTarget: () => null,
          getOutputBufferType: () => HalfFloatType,
          getPixelRatio: () => 1,
          hasFeature: () => false,
          hasCompatibility: () => false,
        }
        const material = new WebGPU.MeshBasicNodeMaterial({ transparent: true, alphaTest: 0.1 })
        material.vertexNode = vec4(0, 0, 0.6, 1)
        material.colorNode = vec4(1, 0, 0, 0.4)
        material.outputNode = vec4(0.3, 0.2, 0.1, 0.4)
        material.fog = false
        const Builder = webgpu ? builders.WGSLNodeBuilder : builders.GLSLNodeBuilder
        const builder = new Builder(
          new Mesh(undefined, material),
          renderer as unknown as WebGPU.Renderer,
        )
        builder.scene = scene
        builder.camera = camera
        builder.clippingContext = new ClippingContext()
        builder.clippingContext.unionPlanes.push(new Vector4(1, 0, 0, 0))
        builder.build()
        const shader = builder.fragmentShader!
        expect(shader).toContain('0.4')
        expect(shader).toContain('dot(')
        expect(shader.match(/discard;/g)).toHaveLength(layer === front ? 2 : 3)
        expect(
          builder.uniforms.fragment.some(
            (uniform) => uniform.node.value === main.renderTarget.depthTexture,
          ),
        ).toBe(layer !== front)
        expect(shader).not.toContain('gl_FragDepth =')
        expect(shader).not.toContain('output.depth =')
        expect(material.depthTest).toBe(true)
        expect(material.depthWrite).toBe(true)
      }
    } finally {
      index.dispose()
      ordinary.dispose()
      front.dispose()
      main.dispose()
    }
  }
})

test('front pass rendering failure restores its target, background, depth clear and camera mask', () => {
  const f = fixture(true)
  const index = new LayerPassIndex(f.scene, [IN_FRONT_LAYER])
  const main = pass(f.scene, f.camera)
  main.updateBefore = () => undefined
  const front = new LayerPassNode(index, f.camera, IN_FRONT_LAYER, main)
  const layers = new Layers()
  layers.set(IN_FRONT_LAYER)
  front.setLayers(layers)
  const frame = new WebGPU.NodeFrame()
  frame.renderer = f.gpu
  f.renderer.render = () => {
    expect(f.renderer.contextNode.getFlowContextData().getOutput).toBe(
      inFrontContext.getFlowContextData().getOutput,
    )
    expect(f.scene.background).toBeNull()
    expect(f.renderer.getClearDepth()).toBe(0)
    throw new Error('front render failed')
  }
  try {
    expect(() => front.updateBefore(frame)).toThrow('front render failed')
    f.checkRestored()
  } finally {
    index.dispose()
    front.dispose()
    main.dispose()
  }
})
