// @ts-expect-error — viewer tests run in Bun without adding its types to the published package.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  AmbientLight,
  BackSide,
  BatchedMesh,
  BufferGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SkinnedMesh,
  Vector3,
  Vector4,
  WebGPUCoordinateSystem,
} from 'three'
import {
  attribute,
  color,
  float,
  lights,
  normalGeometry,
  positionLocal,
  positionWorld,
  tangentGeometry,
  texture,
  uniform,
  uv,
  vec4,
} from 'three/tsl'
import * as webgpu from 'three/webgpu'
import {
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  type NodeBuilder,
  type NodeMaterial,
  WebGPURenderer,
} from 'three/webgpu'
import { createMaterial } from './materials'
import {
  createPanoramaMaterialBridge,
  PanoramaMaterialBridgeError,
  panoramaMaterialAttributes,
} from './panorama-material-bridge'

const WGSLNodeBuilder = (
  webgpu as unknown as {
    WGSLNodeBuilder: new (
      object: Mesh,
      renderer: WebGPURenderer,
    ) => NodeBuilder & { camera: PerspectiveCamera; scene: Scene }
  }
).WGSLNodeBuilder

function renderer() {
  const canvas = {
    width: 32,
    height: 16,
    style: {},
    addEventListener() {},
    removeEventListener() {},
  } as unknown as HTMLCanvasElement
  const result = new WebGPURenderer({ canvas })
  result.hasFeature = () => false
  return result
}

function fixture(material: Material, tangent = false) {
  const original = new PlaneGeometry(1, 1).translate(0, 0, -4)
  if (tangent) {
    original.setAttribute(
      'tangent',
      new Float32BufferAttribute(
        Array.from({ length: original.getAttribute('position').count }, () => [1, 0, 0, -1]).flat(),
        4,
      ),
    )
  }
  const source = new Mesh(original, material)
  source.matrixWorld.set(-2, 0.3, 0, 1, 0, 3, 0.2, 2, 0, 0, 0.7, -1, 0, 0, 0, 1)
  const geometry = new BufferGeometry()
  const points = [
    [-0.1, -0.1, -4],
    [0.1, -0.1, -4],
    [0.1, 0.1, -4],
    [-0.1, -0.1, -4],
    [0.1, 0.1, -4],
    [-0.1, 0.1, -4],
  ]
  geometry.setAttribute('position', new Float32BufferAttribute(points.flat(), 3))
  geometry.setAttribute(
    'normal',
    new Float32BufferAttribute(
      points.flatMap(() => [0, 0, 1]),
      3,
    ),
  )
  geometry.setAttribute(
    'uv',
    new Float32BufferAttribute(
      points.flatMap(([x, y]) => [x! + 0.5, y! + 0.5]),
      2,
    ),
  )
  if (tangent)
    geometry.setAttribute(
      'tangent',
      new Float32BufferAttribute(
        points.flatMap(() => [1, 0, 0, -1]),
        4,
      ),
    )
  const clips = [
    [-0.25, -0.25, 0.4, 1],
    [0.25, -0.25, 0.4, 1],
    [0.25, 0.25, 0.4, 1],
    [-0.25, -0.25, 0.4, 1],
    [0.25, 0.25, 0.4, 1],
    [-0.25, 0.25, 0.4, 1],
  ]
  geometry.setAttribute(
    panoramaMaterialAttributes.clipPosition,
    new Float32BufferAttribute(clips.flat(), 4),
  )
  geometry.setAttribute(
    panoramaMaterialAttributes.rayDirection,
    new Float32BufferAttribute(
      points.flatMap((point) =>
        new Vector3(...point).applyMatrix4(source.matrixWorld).normalize().toArray(),
      ),
      3,
    ),
  )
  const directional = new DirectionalLight(new Color('#ffffff'), 2)
  const ambient = new AmbientLight(new Color('#bfc9df'), 0.2)
  const scene = new Scene()
  scene.add(directional, ambient)
  const bridge = createPanoramaMaterialBridge({
    source,
    material,
    geometry,
    lights: [directional, ambient],
  })
  scene.add(bridge.mesh)
  return {
    source,
    geometry,
    bridge,
    scene,
    directional,
    ambient,
    dispose() {
      bridge.dispose()
      geometry.dispose()
      original.dispose()
    },
  }
}

function build(f: ReturnType<typeof fixture>) {
  const camera = new PerspectiveCamera(50, 2, 0.1, 100)
  camera.coordinateSystem = WebGPUCoordinateSystem
  camera.updateProjectionMatrix()
  const builder = new WGSLNodeBuilder(f.bridge.mesh, renderer())
  builder.camera = camera
  builder.scene = f.scene
  builder.build()
  return { vertex: builder.vertexShader, fragment: builder.fragmentShader, builder }
}

function rayAssignment(fragment: string) {
  const assignment = fragment.match(
    /^\s*(\w+) = normalize\( \( render\.cameraViewMatrix \* vec4<f32>\( \( - (\w+) \), 0\.0 \) \)\.xyz \);$/m,
  )
  expect(assignment).not.toBeNull()
  return { name: assignment![1]!, index: fragment.indexOf(assignment![0]) }
}

describe('panorama source material bridge', () => {
  test('uses true corner attributes and source shear/reflection without owning source assets', () => {
    const material = new MeshStandardNodeMaterial()
    material.colorNode = positionWorld.abs()
    material.opacityNode = uv().y
    material.normalNode = normalGeometry
    material.envNode = color('#557799')
    material.maskNode = uv().x.greaterThan(0.2)
    const f = fixture(material)
    f.source.receiveShadow = true
    const second = createPanoramaMaterialBridge({
      source: f.source,
      material,
      geometry: f.geometry,
    })
    let sourceDisposed = 0,
      geometryDisposed = 0,
      cloneDisposed = 0
    material.addEventListener('dispose', () => sourceDisposed++)
    f.geometry.addEventListener('dispose', () => geometryDisposed++)
    second.material.addEventListener('dispose', () => cloneDisposed++)
    expect(second.mesh.geometry).toBe(f.geometry)
    expect(second.material).not.toBe(material)
    for (const key of ['colorNode', 'opacityNode', 'normalNode', 'envNode', 'maskNode'] as const)
      expect(second.material[key]).toBe(material[key])
    expect(second.material.positionNode).toBeNull()
    expect(second.material.vertexNode).toBeNull()
    expect(second.mesh.matrixWorld.equals(f.source.matrixWorld)).toBe(true)
    expect(second.mesh.matrix.equals(f.source.matrixWorld)).toBe(true)
    expect(second.mesh.matrixWorld.determinant()).toBeLessThan(0)
    expect(second.mesh.receiveShadow).toBe(true)
    expect(second.mesh.castShadow).toBe(false)
    expect(second.mesh.matrixAutoUpdate).toBe(false)
    expect(second.mesh.matrixWorldAutoUpdate).toBe(false)
    const position = second.mesh.geometry.getAttribute('position')
    expect(position.getX(0)).not.toBe(position.getX(1))
    expect(position.getY(1)).not.toBe(position.getY(2))
    expect(second.mesh.geometry.getAttribute('uv').getX(0)).not.toBe(
      second.mesh.geometry.getAttribute(panoramaMaterialAttributes.clipPosition).getX(0),
    )
    second.dispose()
    second.dispose()
    expect(cloneDisposed).toBe(1)
    expect(sourceDisposed).toBe(0)
    expect(geometryDisposed).toBe(0)
    f.dispose()
    material.dispose()
  })

  test('normal-map WGSL keeps hit-position/UV derivatives and injects the source view ray before GGX', () => {
    const material = new MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0.3 })
    material.colorNode = positionWorld.abs()
    material.normalMap = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, RGBAFormat)
    const f = fixture(material)
    const { vertex, fragment } = build(f)
    expect(vertex).toContain('panoramaClipPosition')
    expect(vertex).toMatch(/positionLocal = position/)
    expect(vertex).toMatch(
      /v_positionView = \( modelViewMatrix \* vec4<f32>\( positionLocal, 1\.0 \) \)\.xyz/,
    )
    expect(vertex).toMatch(
      /v_positionWorld = \( object\.\w+ \* vec4<f32>\( positionLocal, 1\.0 \) \)\.xyz/,
    )
    expect(vertex).toContain('panoramaRayDirection')
    expect(fragment).not.toContain('cameraProjectionMatrixInverse')
    expect(fragment).toMatch(/dpdx\( v_positionView \)/)
    expect(fragment).toMatch(/dpdy\( v_positionView \)/)
    expect(fragment).toMatch(/dpdx\( nodeVarying\d+ \)/)
    const ray = rayAssignment(fragment)
    expect(fragment.indexOf(`dot( normalView, ${ray.name} )`, ray.index)).toBeGreaterThan(ray.index)
    expect(fragment).toContain('V_GGX_SmithCorrelated(')
    expect(f.bridge.material.normalMap).toBe(material.normalMap)
    f.dispose()
    material.normalMap.dispose()
    material.dispose()
  })

  test('flat normals use original corner plane derivatives while retaining source side and reflection', () => {
    const material = new MeshStandardNodeMaterial({ flatShading: true, side: DoubleSide })
    const f = fixture(material)
    const { fragment } = build(f)
    expect(fragment).toMatch(/dpdx\( v_positionView \)/)
    expect(fragment).toMatch(/dpdy\( v_positionView \)/)
    expect(fragment).toMatch(/normalize\( cross\(/)
    expect(f.bridge.material.side).toBe(DoubleSide)
    expect(f.bridge.mesh.matrixWorld.determinant()).toBeLessThan(0)
    rayAssignment(fragment)
    f.dispose()
    material.dispose()
  })

  test('original app glass evaluates its existing Fresnel opacity after the ray-view assignment', () => {
    const material = createMaterial({ preset: 'glass' }, 'rendered') as MeshStandardNodeMaterial
    expect(material.opacityNode).not.toBeNull()
    const f = fixture(material)
    const { fragment } = build(f)
    const ray = rayAssignment(fragment)
    const alpha = fragment.indexOf('DiffuseColor.w =', ray.index)
    expect(alpha).toBeGreaterThan(ray.index)
    expect(fragment.slice(ray.index, alpha)).toContain(ray.name)
    expect(fragment).toMatch(new RegExp(`dot\\( normalView, ${ray.name} \\)`))
    expect(f.bridge.material.opacityNode).toBe(material.opacityNode)
    expect(f.bridge.material.transparent).toBe(material.transparent)
    f.dispose()
  })

  test('direct original app UV opacity reads uv independently from atlas clip coordinates', () => {
    const source = readFileSync(
      new URL('../components/viewer/glb-scene.tsx', import.meta.url),
      'utf8',
    )
    const start = source.indexOf('function createZoneWallMaterial(zoneColor: string) {')
    expect(start).toBeGreaterThanOrEqual(0)
    const bodyStart = source.indexOf('{', start) + 1
    const end = source.indexOf('\n}', bodyStart)
    const factory = new Function(
      'MeshBasicNodeMaterial',
      'float',
      'uv',
      'THREE',
      'color',
      'zoneColor',
      'uniform',
      source.slice(bodyStart, end),
    )
    const material = factory(
      MeshBasicNodeMaterial,
      float,
      uv,
      { Color, DoubleSide },
      color,
      '#77aaff',
      uniform,
    ) as MeshBasicNodeMaterial
    const f = fixture(material)
    const { vertex, fragment } = build(f)
    expect(vertex).toMatch(/varyings\.nodeVarying\d+ = uv/)
    expect(vertex).toContain('panoramaClipPosition')
    expect(fragment).toMatch(/DiffuseColor\.w =.*nodeVarying\d+\.y/)
    expect(f.bridge.material.opacityNode).toBe(material.opacityNode)
    rayAssignment(fragment)
    f.dispose()
    material.dispose()
  })

  test('direct normal, tangent handedness and color attributes remain available to source node graphs', () => {
    const material = new MeshBasicNodeMaterial({ side: BackSide, vertexColors: true })
    material.colorNode = normalGeometry
      .abs()
      .add(tangentGeometry.abs())
      .add(attribute('color', 'vec3'))
    material.opacityNode = attribute('tangent', 'vec4').w.abs()
    const f = fixture(material, true)
    f.geometry.setAttribute(
      'color',
      new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0], 3),
    )
    const { vertex, fragment } = build(f)
    expect(vertex).toContain('normal')
    expect(vertex).toContain('tangent')
    expect(vertex).toContain('color')
    expect(fragment).toContain('.w')
    expect(f.bridge.material.side).toBe(BackSide)
    expect(f.bridge.mesh.geometry.getAttribute('tangent').getW(0)).toBe(-1)
    rayAssignment(fragment)
    f.dispose()
    material.dispose()
  })

  test('actual app custom fragment expression retains texture/UV output and receives the ray assignment', () => {
    const material = new MeshBasicNodeMaterial()
    const map = new DataTexture(new Uint8Array([100, 120, 160, 255]), 1, 1, RGBAFormat)
    const source = readFileSync(
      new URL('../../../editor/src/lib/export-texture-utils.ts', import.meta.url),
      'utf8',
    )
    const expression = source.match(/^\s*material\.fragmentNode = (.+)$/m)?.[1]
    expect(expression).toBeDefined()
    material.fragmentNode = new Function('textureNode', 'texture', 'uv', `return ${expression}`)(
      texture,
      map,
      uv,
    )
    const f = fixture(material)
    const { vertex, fragment } = build(f)
    expect(f.bridge.material.fragmentNode).toBe(material.fragmentNode)
    expect(vertex).toMatch(/varyings\.nodeVarying\d+ = uv/)
    expect(fragment).toContain('textureLoad(')
    const ray = rayAssignment(fragment)
    expect(fragment.indexOf('output.color =', ray.index)).toBeGreaterThan(ray.index)
    f.dispose()
    map.dispose()
    material.dispose()
  })

  test('actual batched RGBA color uses original multiplication before opacity and alpha rejection', () => {
    const material = new MeshBasicNodeMaterial({
      transparent: true,
      alphaTest: 0.2,
      vertexColors: true,
    })
    material.colorNode = vec4(0.7, 0.6, 0.5, 0.8)
    material.opacityNode = uv().y
    const f = fixture(material)
    f.geometry.setAttribute(
      'color',
      new Float32BufferAttribute(Array.from({ length: 6 }, () => [0.2, 0.4, 0.6, 0.9]).flat(), 4),
    )
    const source = new BatchedMesh(1, 4, 6, material)
    const geometryId = source.addGeometry(f.source.geometry)
    const instanceId = source.addInstance(geometryId)
    source.setColorAt(instanceId, new Vector4(0.3, 0.5, 0.7, 0.4))
    const value = source.getColorAt(instanceId, new Vector4()).toArray() as [
      number,
      number,
      number,
      number,
    ]
    const bridge = createPanoramaMaterialBridge({
      source,
      material,
      geometry: f.geometry,
      matrixWorld: f.source.matrixWorld,
      instanceColor: value,
    })
    const { vertex, fragment } = build({ ...f, bridge })
    expect(vertex).toContain('panoramaInstanceColor : vec4<f32>')
    expect(vertex).toContain('varyings.vBatchColor = object.panoramaInstanceColor;')
    expect(
      (
        bridge.material as NodeMaterial & { _panoramaInstanceColor: Vector4 }
      )._panoramaInstanceColor.toArray(),
    ).toEqual(value)
    const multiplication = fragment.indexOf('DiffuseColor = ( vBatchColor *')
    const opacity = fragment.indexOf('DiffuseColor.w =', multiplication)
    const rejection = fragment.indexOf('discard;', opacity)
    expect(multiplication).toBeGreaterThanOrEqual(0)
    expect(opacity).toBeGreaterThan(multiplication)
    expect(rejection).toBeGreaterThan(opacity)
    expect(fragment.slice(opacity, rejection)).toContain('DiffuseColor.w <=')
    expect(fragment.slice(multiplication, opacity)).toMatch(/nodeVarying\d+/)
    expect(bridge.material.colorNode).toBe(material.colorNode)
    expect(bridge.material.opacityNode).toBe(material.opacityNode)
    expect((bridge.mesh as Mesh & { isBatchedMesh?: boolean }).isBatchedMesh).toBeUndefined()
    expect(bridge.notes).toEqual([])
    expect(vertex).not.toContain('_matricesTexture')
    bridge.dispose()
    source.dispose()
    f.dispose()
    material.dispose()
  })

  test('actual instance RGB keeps its native color branch without another instance transform', () => {
    const material = new MeshBasicNodeMaterial({ transparent: true })
    material.colorNode = vec4(0.7, 0.6, 0.5, 0.8)
    material.opacityNode = float(0.4)
    const f = fixture(material)
    const source = new InstancedMesh(f.source.geometry, material, 1)
    source.setColorAt(0, new Color(0.3, 0.5, 0.7))
    expect(() => createPanoramaMaterialBridge({ source, material, geometry: f.geometry })).toThrow(
      '需要传入该实例快照的颜色',
    )
    const bridge = createPanoramaMaterialBridge({
      source,
      material,
      geometry: f.geometry,
      matrixWorld: f.source.matrixWorld,
      instanceColor: [0.3, 0.5, 0.7, 1],
    })
    const { vertex, fragment } = build({ ...f, bridge })
    expect(vertex).toContain('varyings.vInstanceColor = object.panoramaInstanceColor.xyz;')
    expect(fragment).toMatch(/DiffuseColor = \( vec4<f32>\( vInstanceColor, 1\.0 \) \*/)
    expect(fragment).not.toMatch(/DiffuseColor = \( vBatchColor \*/)
    expect(vertex).not.toContain('instanceMatrix')
    expect(bridge.material.colorNode).toBe(material.colorNode)
    expect(bridge.material.opacityNode).toBe(material.opacityNode)
    bridge.dispose()
    source.dispose()
    f.dispose()
    material.dispose()
  })

  test('shared material-reference uniforms follow the rendered instance without compiling each color', () => {
    const material = new MeshBasicNodeMaterial({ transparent: true })
    material.colorNode = vec4(0.7, 0.6, 0.5, 0.8)
    const f = fixture(material)
    const a = createPanoramaMaterialBridge({
      source: f.source,
      material,
      geometry: f.geometry,
      instanceColor: [1, 0, 0, 0.2],
    })
    const b = createPanoramaMaterialBridge({
      source: f.source,
      material,
      geometry: f.geometry,
      instanceColor: [0, 1, 0, 0.9],
    })
    expect(a.material.customProgramCacheKey()).toBe(b.material.customProgramCacheKey())
    expect(a.material.customProgramCacheKey()).not.toBe(f.bridge.material.customProgramCacheKey())
    const { builder } = build({ ...f, bridge: a })
    const reference = builder.updateNodes.find(
      (node) => 'property' in node && node.property === '_panoramaInstanceColor',
    ) as unknown as {
      updateReference(frame: { material: NodeMaterial }): void
      update(): void
      node: { value: Vector4 }
    }
    expect(reference).toBeDefined()
    reference.updateReference({ material: a.material })
    reference.update()
    expect(reference.node.value.toArray()).toEqual([1, 0, 0, 0.2])
    reference.updateReference({ material: b.material })
    reference.update()
    expect(reference.node.value.toArray()).toEqual([0, 1, 0, 0.9])
    reference.updateReference({ material: a.material })
    reference.update()
    expect(reference.node.value.toArray()).toEqual([1, 0, 0, 0.2])
    a.dispose()
    b.dispose()
    f.dispose()
    material.dispose()
  })

  test('smooth DoubleSide normals use GPU front-facing while preserving material and matrix side', () => {
    const material = new MeshStandardNodeMaterial({ side: DoubleSide })
    const f = fixture(material)
    const { fragment } = build(f)
    expect(fragment).toContain('@builtin( front_facing ) isFront : bool')
    expect(f.bridge.material.side).toBe(DoubleSide)
    expect(f.bridge.mesh.matrixWorld.determinant()).toBeLessThan(0)
    f.dispose()
    material.dispose()
  })

  test('already baked skin and morph corners are shaded once by an ordinary mesh proxy', () => {
    const material = new MeshStandardNodeMaterial()
    const f = fixture(material)
    const original = f.source.geometry
    original.setAttribute('skinIndex', new Float32BufferAttribute(new Float32Array(16), 4))
    original.setAttribute('skinWeight', new Float32BufferAttribute(new Float32Array(16), 4))
    original.morphAttributes.position = [original.getAttribute('position').clone()]
    const source = new SkinnedMesh(original, material)
    const bridge = createPanoramaMaterialBridge({
      source,
      material,
      geometry: f.geometry,
      matrixWorld: f.source.matrixWorld,
    })
    const { vertex } = build({ ...f, bridge })
    expect(vertex).toMatch(/positionLocal = position/)
    expect(vertex).not.toContain('boneMatrices')
    expect(vertex).not.toContain('morphTargets')
    expect((bridge.mesh as SkinnedMesh).isSkinnedMesh).toBeUndefined()
    expect(bridge.mesh.geometry.morphAttributes).toEqual({})
    f.geometry.morphAttributes.position = [f.geometry.getAttribute('position').clone()]
    expect(() => createPanoramaMaterialBridge({ source, material, geometry: f.geometry })).toThrow(
      '已烘焙的几何属性',
    )
    bridge.dispose()
    f.dispose()
    material.dispose()
  })

  test('classic materials use the current Three material library and source selective lighting takes precedence', () => {
    const legacy = new MeshStandardMaterial({ color: '#123456', roughness: 0.2, alphaTest: 0.2 })
    const node = new MeshStandardNodeMaterial()
    const f = fixture(node)
    const classic = createPanoramaMaterialBridge({
      source: f.source,
      material: legacy,
      geometry: f.geometry,
      renderer: renderer(),
    })
    expect(classic.material).toBeInstanceOf(MeshStandardNodeMaterial)
    expect((classic.material as MeshStandardNodeMaterial).color.getHexString()).toBe('123456')
    expect((classic.material as MeshStandardNodeMaterial).roughness).toBe(0.2)
    expect(classic.material.alphaTest).toBe(legacy.alphaTest)
    node.lightsNode = lights([f.ambient])
    const selected = createPanoramaMaterialBridge({
      source: f.source,
      material: node,
      geometry: f.geometry,
      lights: [f.directional],
    })
    expect(selected.material.lightsNode).toBe(node.lightsNode)
    expect(f.directional.shadow.autoUpdate).toBe(true)
    expect(f.directional.shadow.needsUpdate).toBe(false)
    classic.dispose()
    selected.dispose()
    f.dispose()
    legacy.dispose()
    node.dispose()
  })

  test('unsupported shader deformation and physical refraction fail explicitly without changing source graphs', () => {
    const material = new MeshStandardNodeMaterial()
    const f = fixture(material)
    const create = (value: Material) =>
      createPanoramaMaterialBridge({
        source: f.source,
        material: value,
        geometry: f.geometry,
        renderer: renderer(),
      })
    for (const key of ['positionNode', 'vertexNode', 'geometryNode'] as const) {
      material[key] = key === 'vertexNode' ? vec4(0, 0, 0, 1) : positionLocal
      expect(() => create(material)).toThrow(PanoramaMaterialBridgeError)
      try {
        create(material)
      } catch (error) {
        expect((error as PanoramaMaterialBridgeError).code).toBe('shader-deformation')
      }
      expect(material[key]).not.toBeNull()
      material[key] = null
    }
    const physical = new MeshPhysicalNodeMaterial({ transmission: 0.5 })
    expect(() => create(physical)).toThrow('物理透射')
    physical.transmission = 0
    physical.transmissionNode = float(0.5)
    expect(() => create(physical)).toThrow('物理透射')
    material.displacementMap = new DataTexture()
    expect(() => create(material)).toThrow('着色器形变')
    expect(() => create(new ShaderMaterial())).toThrow(PanoramaMaterialBridgeError)
    material.displacementMap.dispose()
    physical.dispose()
    f.dispose()
    material.dispose()
  })

  test('requires individual corner attributes and reports unknown source render callbacks', () => {
    const material = new MeshBasicNodeMaterial()
    const f = fixture(material)
    f.geometry.deleteAttribute('uv')
    expect(() =>
      createPanoramaMaterialBridge({ source: f.source, material, geometry: f.geometry }),
    ).toThrow('缺少属性：uv')
    f.geometry.setAttribute('uv', new InstancedBufferAttribute(new Float32Array(12), 2))
    expect(() =>
      createPanoramaMaterialBridge({ source: f.source, material, geometry: f.geometry }),
    ).toThrow('尺寸或数量不匹配：uv')
    f.geometry.setAttribute('uv', new Float32BufferAttribute(new Float32Array(12), 2))
    f.source.onBeforeRender = () => {}
    const bridge = createPanoramaMaterialBridge({
      source: f.source,
      material,
      geometry: f.geometry,
    })
    expect(bridge.notes.map((note) => note.code)).toEqual(['source-render-callback'])
    expect(bridge.mesh.onBeforeRender).toBe(Mesh.prototype.onBeforeRender)
    bridge.dispose()
    f.dispose()
    material.dispose()
  })
})
