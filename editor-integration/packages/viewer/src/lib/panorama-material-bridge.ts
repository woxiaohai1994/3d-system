import {
  BatchedMesh,
  type BufferGeometry,
  type Light,
  Material,
  type Matrix4,
  Mesh,
  Vector4,
} from 'three'
import * as tsl from 'three/tsl'
import {
  attribute,
  cameraViewMatrix,
  lights,
  materialReference,
  positionViewDirection,
  varying,
  vec4,
} from 'three/tsl'
import { type Node, type NodeBuilder, NodeMaterial, type WebGPURenderer } from 'three/webgpu'

export const panoramaMaterialAttributes = {
  clipPosition: 'panoramaClipPosition',
  rayDirection: 'panoramaRayDirection',
} as const

export type PanoramaMaterialBridgeErrorCode =
  | 'unsupported-material'
  | 'shader-deformation'
  | 'physical-transmission'
  | 'unbaked-geometry'
  | 'missing-corner-attribute'
  | 'invalid-corner-attribute'
  | 'invalid-source-matrix'
  | 'missing-instance-color'
  | 'invalid-instance-color'

export class PanoramaMaterialBridgeError extends Error {
  constructor(
    readonly code: PanoramaMaterialBridgeErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PanoramaMaterialBridgeError'
  }
}

export type PanoramaMaterialBridgeNote = {
  code: 'source-render-callback' | 'material-render-callback'
  message: string
}

export type PanoramaMaterialBridgeOptions = {
  source: Mesh
  material: Material
  /** Per-corner hit attributes in source/instance local space, with true hit-side quad winding. */
  geometry: BufferGeometry
  /** The transform used when intersecting this source primitive, including an instance transform. */
  matrixWorld?: Matrix4
  /** Snapshot color for this source instance; BatchedMesh alpha must remain included. */
  instanceColor?: readonly [number, number, number, number] | null
  renderer?: Pick<WebGPURenderer, 'library'>
  /** Existing scene lights; a source material's selective lightsNode takes precedence. */
  lights?: Light[]
}

function bridgeInstanceColor(material: NodeMaterial, options: PanoramaMaterialBridgeOptions) {
  const source = options.source as Mesh & {
    instanceColor?: unknown
    isInstancedMesh?: boolean
    isBatchedMesh?: boolean
    _colorsTexture?: unknown
  }
  const color = options.instanceColor
  if (!color) {
    if (source.instanceColor || (source.isBatchedMesh && source._colorsTexture))
      throw new PanoramaMaterialBridgeError(
        'missing-instance-color',
        '全景源实例包含颜色，需要传入该实例快照的颜色',
      )
    return 'none'
  }
  if (color.length !== 4 || !color.every(Number.isFinite))
    throw new PanoramaMaterialBridgeError('invalid-instance-color', '全景源实例颜色包含无效数值')

  // These original r186 varying helpers are absent from the pinned r184 declarations.
  const { instanceColor, batchColor } = tsl as unknown as {
    instanceColor: Node<'vec3'>
    batchColor: Node<'vec4'>
  }
  ;(material as NodeMaterial & { _panoramaInstanceColor: Vector4 })._panoramaInstanceColor =
    new Vector4(...color)
  const value = materialReference('_panoramaInstanceColor', 'vec4') as unknown as Node<'vec4'> & {
    setName(name: string): Node<'vec4'>
  }
  value.setName('panoramaInstanceColor')
  const setupPosition = material.setupPosition
  material.setupPosition = function (builder) {
    const position = setupPosition.call(this, builder)
    instanceColor.assign(value.rgb).toStack()
    batchColor.assign(value).toStack()
    return position
  }
  const setupDiffuseColor = material.setupDiffuseColor
  material.setupDiffuseColor = function (builder) {
    const object = builder.object
    // Only the original color branch sees these flags; baked positions must never be batched twice.
    builder.object = Object.assign(Object.create(object), {
      instanceColor: source.isInstancedMesh ? true : null,
      isBatchedMesh: !source.isInstancedMesh,
      _colorsTexture: !source.isInstancedMesh,
    })
    try {
      return setupDiffuseColor.call(this, builder)
    } finally {
      builder.object = object
    }
  }
  return source.isInstancedMesh ? 'rgb' : 'rgba'
}

export type PanoramaMaterialBridge = {
  mesh: Mesh<BufferGeometry, NodeMaterial>
  material: NodeMaterial
  notes: readonly PanoramaMaterialBridgeNote[]
  /** Releases only the owned material; hit geometry, source graphs and textures remain borrowed. */
  dispose: () => void
}

function nodeMaterial(options: PanoramaMaterialBridgeOptions): NodeMaterial {
  const source = (options.material as NodeMaterial).isNodeMaterial
    ? (options.material as NodeMaterial)
    : options.renderer?.library.fromMaterial(options.material)
  if (!source?.isNodeMaterial)
    throw new PanoramaMaterialBridgeError(
      'unsupported-material',
      '全景材质需要节点材质，或通过当前渲染器的原材质库转换',
    )
  if (
    source.positionNode ||
    source.vertexNode ||
    source.geometryNode ||
    source.setupPosition !== NodeMaterial.prototype.setupPosition ||
    source.setupVertex !== NodeMaterial.prototype.setupVertex ||
    source.setupPositionView !== NodeMaterial.prototype.setupPositionView ||
    source.setupModelViewProjection !== NodeMaterial.prototype.setupModelViewProjection ||
    ('displacementMap' in source && source.displacementMap)
  )
    throw new PanoramaMaterialBridgeError(
      'shader-deformation',
      '该材质包含着色器形变，尚不能保证全景求交几何与实际着色几何一致',
    )
  if (
    ('transmission' in source && Number(source.transmission) > 0) ||
    ('transmissionNode' in source && source.transmissionNode)
  )
    throw new PanoramaMaterialBridgeError(
      'physical-transmission',
      '物理透射依赖屏幕背景采样，尚未适配全景折射',
    )
  return source
}

function validateGeometry(source: Mesh, geometry: BufferGeometry) {
  if (Object.values(geometry.morphAttributes).some((attributes) => attributes?.length))
    throw new PanoramaMaterialBridgeError('unbaked-geometry', '全景命中角点需要已烘焙的几何属性')
  const position = geometry.getAttribute('position')
  const required = new Map([
    ['position', 3],
    [panoramaMaterialAttributes.clipPosition, 4],
    [panoramaMaterialAttributes.rayDirection, 3],
  ])
  for (const [name, value] of Object.entries(source.geometry.attributes)) {
    if (name === 'skinIndex' || name === 'skinWeight') continue
    required.set(name, value.itemSize)
  }
  for (const [name, size] of required) {
    const value = geometry.getAttribute(name)
    if (!value)
      throw new PanoramaMaterialBridgeError(
        'missing-corner-attribute',
        `全景命中角点缺少属性：${name}`,
      )
    if (
      value.itemSize !== size ||
      value.count !== position?.count ||
      ('isInstancedBufferAttribute' in value && value.isInstancedBufferAttribute)
    )
      throw new PanoramaMaterialBridgeError(
        'invalid-corner-attribute',
        `全景命中角点属性尺寸或数量不匹配：${name}`,
      )
  }
}

/** Preserves source shading; the caller owns ray traversal, winding and the real-scene shadow pass. */
export function createPanoramaMaterialBridge(
  options: PanoramaMaterialBridgeOptions,
): PanoramaMaterialBridge {
  const sourceMaterial = nodeMaterial(options)
  validateGeometry(options.source, options.geometry)
  const matrixWorld = options.matrixWorld ?? options.source.matrixWorld
  if (!matrixWorld.elements.every(Number.isFinite))
    throw new PanoramaMaterialBridgeError('invalid-source-matrix', '全景源对象变换包含无效数值')

  const material = sourceMaterial.clone()
  // r186 NodeMaterial.copy skips Material's inherited alphaTest accessor and its private storage.
  material.alphaTest = options.material.alphaTest
  const ray = varying<'vec3'>(attribute<'vec3'>(panoramaMaterialAttributes.rayDirection, 'vec3'))
  const viewDirection = cameraViewMatrix.mul(vec4(ray.negate(), 0)).xyz.normalize()
  material.setupModelViewProjection = () =>
    attribute<'vec4'>(panoramaMaterialAttributes.clipPosition, 'vec4')
  const setupClipping = material.setupClipping
  material.setupClipping = function (builder: NodeBuilder) {
    // r186's StackNode.addToStack is absent from the pinned r184 type declarations.
    const stack = builder.stack as typeof builder.stack & {
      addToStack: (node: unknown) => void
    }
    stack.addToStack(positionViewDirection.assign(viewDirection))
    return setupClipping.call(this, builder)
  }
  let colorMode: string
  try {
    colorMode = bridgeInstanceColor(material, options)
  } catch (error) {
    material.dispose()
    throw error
  }
  const programCacheKey = material.customProgramCacheKey
  material.customProgramCacheKey = function () {
    // RGB and RGBA use different original branches; tint values are per-material uniforms.
    return `${programCacheKey.call(this)}|panorama-hit:${colorMode}`
  }
  if (!material.lightsNode && options.lights) material.lightsNode = lights(options.lights)

  const mesh = new Mesh(options.geometry, material)
  mesh.matrixAutoUpdate = false
  mesh.matrixWorldAutoUpdate = false
  mesh.matrix.copy(matrixWorld)
  mesh.matrixWorld.copy(matrixWorld)
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.receiveShadow = options.source.receiveShadow
  mesh.layers.mask = options.source.layers.mask
  mesh.visible = options.source.visible && options.material.visible

  const notes: PanoramaMaterialBridgeNote[] = []
  if (
    options.source.onBeforeRender !== Mesh.prototype.onBeforeRender &&
    options.source.onBeforeRender !== BatchedMesh.prototype.onBeforeRender
  )
    notes.push({
      code: 'source-render-callback',
      message: '源对象有自定义绘制回调；回调未转移到全景代理，调用方需确认几何与节点参数已更新',
    })
  if (options.material.onBeforeRender !== Material.prototype.onBeforeRender)
    notes.push({
      code: 'material-render-callback',
      message: '源材质有自定义绘制回调；调用方需确认回调不依赖原光栅对象或改变求交几何',
    })
  let disposed = false
  return {
    mesh,
    material,
    notes,
    dispose() {
      if (disposed) return
      disposed = true
      material.dispose()
    },
  }
}
