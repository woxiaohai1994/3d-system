// SPDX-License-Identifier: GPL-2.0-or-later
import {
  type BufferGeometry,
  type Camera,
  Color,
  DepthTexture,
  DoubleSide,
  FloatType,
  LessEqualDepth,
  Matrix4,
  Mesh,
  NoBlending,
  NoColorSpace,
  NoToneMapping,
  Scene,
  UnsignedIntType,
} from 'three'
import {
  attribute,
  builtin,
  context,
  Fn,
  frontFacing,
  screenUV,
  texture,
  uniform,
  vec4,
} from 'three/tsl'
import {
  MeshBasicNodeMaterial,
  type Node,
  type NodeBuilder,
  QuadMesh,
  RendererUtils,
  RenderTarget,
  type WebGPURenderer,
} from 'three/webgpu'
import { sourceHitDepthCompare, sourcePickBone, sourcePickRadius } from './rig-picking-source'

export const rigGpuPickRadii = [14, 9, 5] as const
const diameter = rigGpuPickRadii[0] * 2
export type RigGpuSelectionSample = { radius: (typeof rigGpuPickRadii)[number]; depth: number }
export type RigGpuSelectionHit = { name: string; rigHits: RigGpuSelectionSample[] }
export type RigGpuSelectionWidget = { name: string; geometry: BufferGeometry }
type Viewport = { width: number; height: number }
type Cursor = { x: number; y: number }

export class RigGpuSelectionFrame {
  readonly camera: Camera
  readonly widgets: readonly RigGpuSelectionWidget[]
  readonly viewport: Readonly<Viewport>
  readonly front: boolean
  private references = 0
  private disposed = false

  constructor(
    camera: Camera,
    widgets: readonly RigGpuSelectionWidget[],
    viewport: Viewport,
    options: { front?: boolean } = {},
  ) {
    if (
      !(
        Number.isFinite(viewport.width) &&
        Number.isFinite(viewport.height) &&
        viewport.width > 0 &&
        viewport.height > 0
      )
    ) {
      throw new RangeError('Invalid pick viewport')
    }
    for (const { geometry } of widgets) {
      if (geometry.getAttribute('sourceRigClip')?.itemSize !== 4) {
        throw new TypeError('Picking requires frozen sourceRigClip vec4 geometry')
      }
    }
    this.camera = camera.clone()
    this.camera.layers.enableAll()
    this.camera.matrixWorldAutoUpdate = false
    this.viewport = { ...viewport }
    this.front = options.front ?? true
    this.widgets = widgets.map(({ name, geometry }) => ({ name, geometry: geometry.clone() }))
  }

  acquire() {
    if (this.disposed) throw new Error('The pick frame has been disposed')
    this.references++
    let released = false
    return () => {
      if (released) return
      released = true
      this.references--
      if (this.disposed && this.references === 0) this.releaseGeometry()
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    if (this.references === 0) this.releaseGeometry()
  }

  private releaseGeometry() {
    for (const { geometry } of this.widgets) geometry.dispose()
  }
}

export function rigGpuPickProjection(viewport: Viewport, cursor: Cursor) {
  if (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y))
    throw new RangeError('Invalid pick cursor')
  const x = Math.floor(cursor.x),
    y = Math.floor(cursor.y)
  return new Matrix4()
    .makeScale(viewport.width / diameter, viewport.height / diameter, 1)
    .multiply(
      new Matrix4().makeTranslation(1 - (2 * x) / viewport.width, (2 * y) / viewport.height - 1, 0),
    )
}

export function rigGpuSelectionSamples(
  pixels: Float32Array,
  webgpu: boolean,
): RigGpuSelectionSample[] {
  // r186 WebGPU readback keeps 256-byte row padding, except after the final row.
  const rowFloats = webgpu ? Math.ceil((diameter * 16) / 256) * 64 : diameter * 4
  if (pixels.length < (diameter - 1) * rowFloats + diameter * 4) {
    throw new RangeError('Incomplete pick readback')
  }
  const result: RigGpuSelectionSample[] = []
  for (const radius of rigGpuPickRadii) {
    const start = rigGpuPickRadii[0] - radius
    let depth = 1
    for (let y = start; y < diameter - start; y++) {
      for (let x = start; x < diameter - start; x++) {
        const offset = y * rowFloats + x * 4
        const sample = pixels[offset]!
        if (pixels[offset + 3]! > 0 && sample >= 0 && sample < depth) depth = sample
      }
    }
    // Blender's DEPTH_MAX is the clear/far value and never contributes a hit.
    if (depth < 1) result.push({ radius, depth })
  }
  return result
}

export function chooseRigGpuSelectionHit(
  hits: RigGpuSelectionHit[],
  selected: string[],
  nearest = true,
) {
  const radius = sourcePickRadius(
    rigGpuPickRadii.map(
      (radius) =>
        hits.filter((hit) => hit.rigHits.some((sample) => sample.radius === radius)).length,
    ) as [number, number, number],
  )
  const candidates = hits
    .flatMap((hit) => {
      const sample = hit.rigHits.find((sample) => sample.radius === radius)
      return sample ? [{ name: hit.name, depth: sample.depth, hit }] : []
    })
    .sort(sourceHitDepthCompare)
  return sourcePickBone(candidates, selected, nearest)?.hit ?? null
}

export class RigGpuSelectionPass {
  readonly target = new RenderTarget(diameter, diameter, {
    samples: 0,
    depthBuffer: true,
    // draw_manager_c.cc's select_depth uses GPU_DEPTH_COMPONENT24.
    // Three maps this to DEPTH_COMPONENT24 on GL and implementation-defined depth24plus on GPU.
    depthTexture: new DepthTexture(diameter, diameter, UnsignedIntType),
  })
  readonly readbackTarget = new RenderTarget(diameter, diameter, {
    type: FloatType,
    samples: 0,
    depthBuffer: false,
  })
  readonly scene = new Scene()
  readonly material = new MeshBasicNodeMaterial({
    blending: NoBlending,
    depthTest: true,
    depthWrite: true,
    depthFunc: LessEqualDepth,
    side: DoubleSide,
    toneMapped: false,
  })
  private readonly mesh = new Mesh(undefined, this.material)
  readonly readbackMaterial = new MeshBasicNodeMaterial({
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  private readonly readbackQuad = new QuadMesh(this.readbackMaterial)
  private readonly crop = uniform(new Matrix4())
  private readonly front = uniform(true)
  private readonly bbone = uniform(false)
  private readonly inverted = uniform(false)
  private readonly shaderContext = context()
  private active = 0
  private disposed = false

  constructor() {
    this.target.texture.colorSpace = NoColorSpace
    this.readbackTarget.texture.colorSpace = NoColorSpace
    const clip = attribute('sourceRigClip', 'vec4') as unknown as Node<'vec4'>
    this.material.vertexNode = this.crop.mul(clip)
    this.material.fragmentNode = Fn(() => {
      this.bbone
        .and(this.inverted.and(frontFacing).or(this.inverted.not().and(frontFacing.not())))
        .discard()
      return vec4(1)
    })()
    this.material.depthNode = Fn((_: unknown, builder: NodeBuilder) => {
      const z = builtin(builder.getFragCoord().replace(/\.xy$/, '.z')) as unknown as Node<'float'>
      // Legacy in-front armatures use GPU_depth_range(0, 0.01). Preserve its D24 ties.
      const ranged = builder.renderer.reversedDepthBuffer
        ? z.oneMinus().mul(0.01).oneMinus()
        : z.mul(0.01)
      return this.front.select(ranged, z)
    })()
    const storedDepth = texture(this.target.depthTexture!).sample(screenUV).r
    this.readbackMaterial.fragmentNode = Fn((_: unknown, builder: NodeBuilder) => {
      // Read the depth actually stored after hardware quantization, not unquantized fragCoord.z.
      // A normalized D24 sample preserves exactly the order/ties of Blender's UINT depth read.
      const z = storedDepth
      return vec4(builder.renderer.reversedDepthBuffer ? z.oneMinus() : z, 0, 0, 1)
    })()
    this.mesh.frustumCulled = false
    this.mesh.matrixAutoUpdate = false
    this.scene.add(this.mesh)
  }

  async pick(
    renderer: WebGPURenderer,
    frame: RigGpuSelectionFrame,
    cursor: Cursor,
    signal?: AbortSignal,
  ): Promise<RigGpuSelectionHit[]> {
    if (this.disposed) throw new Error('The selection pass has been disposed')
    signal?.throwIfAborted()
    const crop = rigGpuPickProjection(frame.viewport, cursor)
    const release = frame.acquire()
    this.active++
    const reads: Promise<RigGpuSelectionHit | null>[] = []
    const backend = renderer.backend
    const webgpu = 'isWebGPUBackend' in backend && backend.isWebGPUBackend === true
    try {
      const saved = RendererUtils.saveRendererState(renderer)
      const originalContext = renderer.contextNode
      const originalOpaque = renderer.opaque,
        originalTransparent = renderer.transparent
      const originalClearDepth = renderer.reversedDepthBuffer
        ? 1 - renderer.getClearDepth()
        : renderer.getClearDepth()
      let failed = false,
        failure: unknown
      try {
        this.crop.value.copy(crop)
        this.front.value = frame.front
        renderer.contextNode = this.shaderContext
        renderer.setRenderObjectFunction(null)
        renderer.setMRT(null)
        renderer.setScissorTest(false)
        renderer.setClearColor(new Color(1, 0, 0), 0)
        renderer.setClearDepth(1)
        renderer.toneMapping = NoToneMapping
        renderer.autoClear = false
        renderer.opaque = true
        renderer.transparent = true
        for (const { name, geometry } of frame.widgets) {
          this.mesh.geometry = geometry
          const inverted = geometry.getAttribute('sourceBboneInverted')
          this.bbone.value = !!inverted
          this.inverted.value = (inverted?.getX(0) ?? 0) > 0.5
          // GPU_SELECT_PICK_ALL clears each ID's depth, including behind nearer IDs.
          renderer.setRenderTarget(this.target)
          renderer.clear(true, true, true)
          renderer.render(this.scene, frame.camera)
          // Sampling an attached depth texture would be a framebuffer feedback loop on GL.
          renderer.setRenderTarget(this.readbackTarget)
          this.readbackQuad.render(renderer)
          // Both backends submit the copy before awaiting its asynchronous completion.
          reads.push(
            renderer
              .readRenderTargetPixelsAsync(this.readbackTarget, 0, 0, diameter, diameter)
              .then((pixels) => {
                if (!(pixels instanceof Float32Array))
                  throw new TypeError('Expected Float32 pick readback')
                const rigHits = rigGpuSelectionSamples(pixels, webgpu)
                return rigHits.length ? { name, rigHits } : null
              }),
          )
        }
      } catch (error) {
        failed = true
        failure = error
      } finally {
        renderer.contextNode = originalContext
        renderer.opaque = originalOpaque
        renderer.transparent = originalTransparent
        renderer.setClearDepth(originalClearDepth)
        RendererUtils.restoreRendererState(renderer, saved)
      }
      const settled = await Promise.allSettled(reads)
      if (failed) throw failure
      signal?.throwIfAborted()
      const hits: RigGpuSelectionHit[] = []
      for (const read of settled) {
        if (read.status === 'rejected') throw read.reason
        if (read.value) hits.push(read.value)
      }
      return hits
    } finally {
      release()
      this.active--
      if (this.disposed && this.active === 0) this.releaseResources()
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    if (this.active === 0) this.releaseResources()
  }

  private releaseResources() {
    this.scene.remove(this.mesh)
    this.target.dispose()
    this.readbackTarget.dispose()
    this.material.dispose()
    this.readbackMaterial.dispose()
  }
}
