import {
  BackSide,
  type BufferGeometry,
  type Camera,
  FloatType,
  FrontSide,
  Group,
  LessEqualDepth,
  Light,
  LinearSRGBColorSpace,
  type Material,
  NormalBlending,
  NoToneMapping,
  Object3D,
  type Scene,
  Vector4,
} from 'three'
import { RendererUtils, RenderTarget, type WebGPURenderer } from 'three/webgpu'
import type { SourcePanoramaRay, SourcePanoramaRayField } from './blender-camera-panorama-source'
import { SCENE_LAYER } from './layers'
import {
  createPanoramaGpuIntersection,
  type PanoramaGpuHit,
  panoramaGpuHitAt,
} from './panorama-gpu-intersection'
import { createPanoramaHitGeometry, type PanoramaPixelHit } from './panorama-hit-geometry'
import { createPanoramaMaterialBridge } from './panorama-material-bridge'
import { createPanoramaRayTraversal } from './panorama-ray-traversal'
import type { PanoramaSceneSnapshot } from './panorama-scene-snapshot'

export type PanoramaSceneForegroundOptions = {
  renderer: WebGPURenderer
  /** The original complete scene is also used by Three's original shadow pass. */
  scene: Scene
  camera: Camera
  /** A snapshot from the same sampled frame. Borrowed, so DOF samples can reuse it. */
  snapshot: PanoramaSceneSnapshot
  field: SourcePanoramaRayField
  /** Original rays at integer raster corners, using the same body and lens sample. */
  cornerRayAt: (x: number, y: number) => SourcePanoramaRay | null
  /** Opaque custom outputs must be known to produce alpha one or discard; zero alpha is not coverage. */
  opaqueFragmentMaterials?: ReadonlySet<Material>
  signal?: AbortSignal
  /** A short, synchronous source-scene capture scope; it must execute render exactly once. */
  renderScope?: (render: () => void) => void
}

export type PanoramaSceneForeground = {
  width: number
  height: number
  /** Bottom-left rows, linear sRGB, premultiplied RGBA. Background and DOF averaging are separate. */
  pixels: Float32Array
  layers: number
  shadedHits: number
}

/** Converts Three's padded WebGPU float readback without losing HDR values or row orientation. */
export function panoramaLinearPixels(
  input: Float32Array,
  width: number,
  height: number,
): Float32Array {
  if (![width, height].every((value) => Number.isInteger(value) && value > 0))
    throw new Error('全景浮点输出尺寸无效')
  const row = width * 4,
    padded = Math.ceil((row * 4) / 256) * 64,
    paddedLength = (height - 1) * padded + row,
    stride = input.length === row * height ? row : padded
  if (input.length !== row * height && input.length !== paddedLength)
    throw new Error('全景浮点读取的行填充或长度无效')
  const output = new Float32Array(row * height)
  for (let y = 0; y < height; y++) {
    const offset = (height - y - 1) * stride
    output.set(input.subarray(offset, offset + row), y * row)
  }
  if (!output.every(Number.isFinite)) throw new Error('全景原材质输出包含非有限数值')
  return output
}

function sourceRay(field: SourcePanoramaRayField, pixel: number): SourcePanoramaRay {
  const i = pixel * 12,
    values = field.rays
  return {
    origin: [values[i]!, values[i + 1]!, values[i + 2]!],
    direction: [values[i + 3]!, values[i + 4]!, values[i + 5]!],
    tmin: values[i + 6]!,
    tmax: values[i + 7]!,
    time: values[i + 8]!,
    differentialOrigin: values[i + 9]!,
    differentialDirection: values[i + 10]!,
    valid: values[i + 11] === 1,
  }
}

const busyRenderers = new WeakSet<WebGPURenderer>()

/**
 * Traces foreground layers and shades each hit with the original material graph.
 * This is a shared render primitive, not a complete camera preview or output pipeline.
 */
export async function renderPanoramaSceneForeground(
  options: PanoramaSceneForegroundOptions,
): Promise<PanoramaSceneForeground> {
  const { renderer, scene, camera, snapshot, field } = options
  if (busyRenderers.has(renderer)) throw new Error('同一渲染器的全景采样正在进行')
  if (!snapshot.complete) throw new Error('全景源场景快照不完整，不能输出遗漏物体的图像')
  if (scene.overrideMaterial) throw new Error('全景命中材质尚不支持场景的覆盖材质')
  if (
    scene.onBeforeRender !== Object3D.prototype.onBeforeRender ||
    scene.onAfterRender !== Object3D.prototype.onAfterRender
  )
    throw new Error('全景采样尚未适配场景自定义绘制回调')
  for (const { material } of snapshot.primitives) {
    if (material.blending !== NormalBlending)
      throw new Error('全景逐层合成尚不支持该材质的自定义混合方式')
    if (material.alphaToCoverage) throw new Error('全景逐像素材质采样尚不支持多重采样透明覆盖')
    if (
      !material.colorWrite ||
      !material.depthTest ||
      material.depthFunc !== LessEqualDepth ||
      material.stencilWrite ||
      material.polygonOffset
    )
      throw new Error('全景逐层合成尚不支持该材质的特殊深度、颜色或模板写入策略')
    if ('mrtNode' in material && material.mrtNode)
      throw new Error('全景命中层尚未适配源材质的多附件输出')
    if ('depthNode' in material && material.depthNode)
      throw new Error('全景逐层合成尚未适配源材质的自定义深度')
    if (
      !material.transparent &&
      (('fragmentNode' in material && material.fragmentNode) ||
        ('outputNode' in material && material.outputNode)) &&
      !options.opaqueFragmentMaterials?.has(material)
    )
      throw new Error(
        '全景不透明自定义片元需要确认输出 alpha 为一或真正丢弃，不能将零 alpha 当作覆盖信息',
      )
  }
  for (const { object } of snapshot.sources)
    for (let ancestor: Object3D | null = object; ancestor; ancestor = ancestor.parent) {
      if (ancestor.renderOrder !== 0) throw new Error('全景逐层合成尚未适配强制排序的源对象')
      if (
        'isClippingGroup' in ancestor &&
        ancestor.isClippingGroup &&
        'enabled' in ancestor &&
        ancestor.enabled &&
        'clippingPlanes' in ancestor &&
        Array.isArray(ancestor.clippingPlanes) &&
        ancestor.clippingPlanes.length
      )
        throw new Error('全景命中层尚未转移源物体祖先的裁切组')
    }
  const traversal = createPanoramaRayTraversal(field),
    target = new RenderTarget(field.width, field.height, {
      type: FloatType,
      depthBuffer: false,
      stencilBuffer: false,
    }),
    group = new Group(),
    sceneLights: Light[] = []
  group.name = '全景原材质命中层'
  scene.traverseVisible((object) => {
    if (object instanceof Light && object.layers.test(camera.layers)) sceneLights.push(object)
  })
  const intersection = snapshot.bvh
    ? createPanoramaGpuIntersection(snapshot.bvh, traversal.currentField)
    : null
  let layers = 0,
    shadedHits = 0
  const cancelled = () => {
    if (options.signal?.aborted) throw new Error('全景采样已取消')
  }
  busyRenderers.add(renderer)
  try {
    cancelled()
    await renderer.init()
    cancelled()
    const backend = renderer.backend as unknown as {
      isWebGPUBackend?: boolean
      device?: { features: { has(feature: string): boolean } }
    }
    if (!backend.isWebGPUBackend || !backend.device)
      throw new Error('全景命中层绘制需要实际 WebGPU 后端')
    if (
      snapshot.primitives.some(({ material }) => material.transparent) &&
      !backend.device.features.has('float32-blendable')
    )
      throw new Error('当前 GPU 不支持全景透明层所需的浮点混合功能')
    if (!intersection)
      return {
        width: field.width,
        height: field.height,
        pixels: traversal.premultipliedPixels,
        layers,
        shadedHits,
      }
    while (traversal.activeCount > 0) {
      cancelled()
      const current = traversal.currentField
      intersection.updateRays(current)
      await intersection.compute(renderer)
      cancelled()
      const gpu = await intersection.readback(renderer)
      cancelled()
      const hits: (PanoramaGpuHit | null)[] = [],
        buckets = new Map<number, Map<Material, PanoramaPixelHit[]>>(),
        geometries: BufferGeometry[] = [],
        bridges: ReturnType<typeof createPanoramaMaterialBridge>[] = []
      try {
        for (let pixel = 0; pixel < field.width * field.height; pixel++) {
          const hit = panoramaGpuHitAt(gpu, pixel)
          hits.push(hit)
          if (!hit) continue
          const primitive = snapshot.primitives[snapshot.triangleSourceIds[hit.triangleIndex]!]
          if (!primitive || (hit.side !== 1 && hit.side !== -1))
            throw new Error('全景 GPU 命中无法对应原场景三角形')
          if (
            (primitive.material.side === FrontSide && hit.side === -1) ||
            (primitive.material.side === BackSide && hit.side === 1)
          )
            continue
          const x = pixel % field.width,
            y = Math.floor(pixel / field.width),
            bottomLeft = options.cornerRayAt(x, y),
            bottomRight = options.cornerRayAt(x + 1, y),
            topLeft = options.cornerRayAt(x, y + 1),
            topRight = options.cornerRayAt(x + 1, y + 1)
          if (!bottomLeft || !bottomRight || !topLeft || !topRight)
            throw new Error(`全景像素 (${x}, ${y}) 的原角点射线无效`)
          const materials = buckets.get(primitive.sourceIndex) ?? new Map(),
            pixels = materials.get(primitive.material) ?? []
          pixels.push({
            x,
            y,
            primitive,
            barycentric: hit.barycentric,
            side: hit.side,
            centerRay: sourceRay(current, pixel),
            cornerRays: [bottomLeft, bottomRight, topLeft, topRight],
          })
          materials.set(primitive.material, pixels)
          buckets.set(primitive.sourceIndex, materials)
          shadedHits++
        }
        for (const [sourceIndex, materials] of buckets) {
          const data = snapshot.sources[sourceIndex]!
          for (const [material, pixels] of materials) {
            const geometry = createPanoramaHitGeometry(data, field.width, field.height, pixels)
            geometries.push(geometry)
            const bridge = createPanoramaMaterialBridge({
              source: data.object,
              material,
              geometry,
              matrixWorld: data.matrixWorld,
              instanceColor: data.instanceColor,
              renderer,
              lights: sceneLights,
            })
            bridges.push(bridge)
            if (bridge.notes.length)
              throw new Error(bridge.notes.map((note) => note.message).join('；'))
            // Original batched source meshes are not on the primary color layer.
            bridge.mesh.layers.set(SCENE_LAYER)
            group.add(bridge.mesh)
          }
        }
        let layerPixels: Float32Array = new Float32Array(field.width * field.height * 4)
        if (bridges.length) {
          const draw = () => {
            const savedRenderer = RendererUtils.saveRendererState(renderer),
              savedScene = RendererUtils.saveSceneState(scene),
              viewport = renderer.getViewport(new Vector4()),
              scissor = renderer.getScissor(new Vector4()),
              savedFlags = {
                contextNode: renderer.contextNode,
                opaque: renderer.opaque,
                transparent: renderer.transparent,
                lighting: renderer.lighting,
                autoClearColor: renderer.autoClearColor,
                autoClearDepth: renderer.autoClearDepth,
                autoClearStencil: renderer.autoClearStencil,
              },
              savedCameraLayers = camera.layers.mask,
              proxies = new Set<Object3D>(bridges.map((bridge) => bridge.mesh))
            try {
              scene.add(group)
              scene.background = null
              if ('backgroundNode' in scene) scene.backgroundNode = null
              camera.layers.enable(SCENE_LAYER)
              renderer.setMRT(null)
              renderer.setRenderObjectFunction((object, ...args) => {
                if (proxies.has(object)) renderer.renderObject(object, ...args)
              })
              renderer.toneMapping = NoToneMapping
              renderer.outputColorSpace = LinearSRGBColorSpace
              renderer.setClearColor(0, 0)
              renderer.autoClear = true
              renderer.autoClearColor = true
              renderer.autoClearDepth = true
              renderer.autoClearStencil = true
              renderer.opaque = true
              renderer.transparent = true
              renderer.setRenderTarget(target)
              renderer.setViewport(0, 0, field.width, field.height)
              renderer.setScissor(0, 0, field.width, field.height)
              renderer.setScissorTest(false)
              renderer.render(scene, camera)
            } finally {
              group.removeFromParent()
              camera.layers.mask = savedCameraLayers
              Object.assign(renderer, savedFlags)
              RendererUtils.restoreSceneState(scene, savedScene)
              RendererUtils.restoreRendererState(renderer, savedRenderer)
              renderer.setViewport(viewport)
              renderer.setScissor(scissor)
            }
          }
          let draws = 0,
            scopeOpen = true
          const render = () => {
            if (!scopeOpen) throw new Error('全景捕获范围必须同步完成绘制')
            if (++draws > 1) throw new Error('全景捕获范围重复调用绘制')
            draw()
          }
          try {
            if (options.renderScope) options.renderScope(render)
            else render()
          } finally {
            scopeOpen = false
          }
          if (draws !== 1) throw new Error('全景捕获范围必须同步完成一次绘制')
          // No source/renderer state remains modified while an asynchronous readback is pending.
          const raw = await renderer.readRenderTargetPixelsAsync(
            target,
            0,
            0,
            field.width,
            field.height,
          )
          if (!(raw instanceof Float32Array)) throw new Error('全景原材质未返回浮点线性像素')
          layerPixels = panoramaLinearPixels(raw, field.width, field.height)
          cancelled()
        }
        traversal.consume(hits, layerPixels)
        layers++
      } finally {
        group.clear()
        for (const bridge of bridges) bridge.dispose()
        for (const geometry of geometries) geometry.dispose()
      }
    }
    return {
      width: field.width,
      height: field.height,
      pixels: traversal.premultipliedPixels,
      layers,
      shadedHits,
    }
  } finally {
    group.removeFromParent()
    intersection?.dispose()
    target.dispose()
    busyRenderers.delete(renderer)
  }
}
