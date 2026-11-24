import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import {
  AmbientLight,
  Color,
  DataTexture,
  DirectionalLight,
  InstancedBufferGeometry,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  Vector3,
  WebGPUCoordinateSystem,
} from 'three'
import {
  cameraViewMatrix,
  color,
  float,
  instanceIndex,
  lights,
  positionViewDirection,
  positionWorld,
  storage,
  texture as textureNode,
  uniform,
  uv,
  varying,
  vec4,
} from 'three/tsl'
import * as webgpu from 'three/webgpu'
import {
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  type NodeBuilder,
  type NodeMaterial,
  StorageBufferAttribute,
  WebGPURenderer,
} from 'three/webgpu'
import {
  sourcePanoramaCameraMatrix,
  sourcePanoramaDirection,
} from '../../packages/viewer/src/lib/blender-camera-panorama-source'
import { createMaterial } from '../../packages/viewer/src/lib/materials'

// Installed @types/three is r184; these r186 runtime APIs are checked by this audit.
const WGSLNodeBuilder = (
  webgpu as unknown as {
    WGSLNodeBuilder: new (
      object: Mesh,
      renderer: WebGPURenderer,
    ) => NodeBuilder & { camera: PerspectiveCamera; scene: Scene }
  }
).WGSLNodeBuilder
assert.equal(typeof WGSLNodeBuilder, 'function')
const root = new URL('../../', import.meta.url)
const output = new URL('.integration-audit/panorama-material-bridge/', root)
await mkdir(output, { recursive: true })

const sourcePaths = [
  'packages/viewer/src/lib/materials.ts',
  'packages/viewer/src/lib/blender-camera-panorama-source.json',
  'packages/viewer/src/components/viewer/glb-scene.tsx',
  'packages/editor/src/lib/export-texture-utils.ts',
  'node_modules/three/src/materials/nodes/NodeMaterial.js',
  'node_modules/three/src/nodes/accessors/Position.js',
  'node_modules/three/src/nodes/accessors/Normal.js',
  'node_modules/three/src/nodes/accessors/TangentUtils.js',
  'node_modules/three/src/nodes/lighting/ShadowNode.js',
] as const
const sources = new Map<string, string>()
const hashes: Record<string, string> = {}
for (const path of sourcePaths) {
  const contents = await readFile(new URL(path, root), 'utf8')
  sources.set(path, contents)
  hashes[path] = createHash('sha256').update(contents).digest('hex')
}

// Invoke the existing private app factory, rather than a separately transcribed UV graph.
const zoneSource = sources.get('packages/viewer/src/components/viewer/glb-scene.tsx')!
const zoneStart = zoneSource.indexOf('function createZoneWallMaterial(zoneColor: string) {')
assert(zoneStart >= 0, 'Original app UV material factory was not found')
const zoneBodyStart = zoneSource.indexOf('{', zoneStart) + 1
const zoneBodyEnd = zoneSource.indexOf('\n}', zoneBodyStart)
assert(zoneBodyEnd > zoneBodyStart, 'Original app UV material factory terminator was not found')
const zoneFactory = new Function(
  'MeshBasicNodeMaterial',
  'float',
  'uv',
  'THREE',
  'color',
  'zoneColor',
  'uniform',
  zoneSource.slice(zoneBodyStart, zoneBodyEnd),
) as (...values: unknown[]) => MeshBasicNodeMaterial
const appUv = zoneFactory(MeshBasicNodeMaterial, float, uv, THREE, color, '#77aaff', uniform)
assert(appUv.opacityNode !== null)

const fragmentSource = sources.get('packages/editor/src/lib/export-texture-utils.ts')!
const fragmentExpression = fragmentSource.match(/^\s*material\.fragmentNode = (.+)$/m)?.[1]
assert(fragmentExpression, 'Original app custom fragment assignment was not found')
const map = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, RGBAFormat)
map.needsUpdate = true
const appFragment = new MeshBasicNodeMaterial()
appFragment.fragmentNode = new Function(
  'textureNode',
  'texture',
  'uv',
  `return ${fragmentExpression}`,
)(textureNode, map, uv)

const appGlass = createMaterial({ preset: 'glass' }, 'rendered')
assert(appGlass instanceof MeshStandardNodeMaterial)
assert(appGlass.opacityNode !== null, 'Actual app glass Fresnel graph was not installed')

const standard = new MeshStandardNodeMaterial({ color: '#b3c9de', roughness: 0.4, metalness: 0.3 })
standard.map = map
standard.normalMap = map
standard.colorNode = positionWorld.abs()

const canvas = {
  width: 32,
  height: 16,
  style: {},
  addEventListener() {},
  removeEventListener() {},
} as unknown as HTMLCanvasElement
const renderer = new WebGPURenderer({ canvas })
// Shader graph construction needs feature queries; this audit never requests a GPU device.
renderer.hasFeature = () => false
const camera = new PerspectiveCamera(50, 2, 0.1, 100)
camera.coordinateSystem = WebGPUCoordinateSystem
camera.updateProjectionMatrix()
const scene = new Scene()
const directional = new DirectionalLight(new Color('#ffffff'), 2)
const ambient = new AmbientLight(new Color('#bfc9df'), 0.2)
scene.add(directional, ambient)

const sourceCamera = sourcePanoramaCameraMatrix(
  { panoramaType: 'EQUIRECTANGULAR' },
  camera.matrixWorld,
)
assert(sourceCamera)
const directions = [
  [0.2, 0.4],
  [0.6, 0.7],
].map((sample) => {
  const direction = sourcePanoramaDirection(
    { panoramaType: 'EQUIRECTANGULAR' },
    sample as [number, number],
  )
  assert(direction)
  return new Vector3(...direction).transformDirection(sourceCamera)
})
const hitAttribute = new StorageBufferAttribute(new Float32Array([1, 2, -4, 1, -2, 1, -3, 1]), 4)
const rayAttribute = new StorageBufferAttribute(
  new Float32Array(directions.flatMap((direction) => [...direction.toArray(), 1])),
  4,
)
const hitLocal = storage(hitAttribute, 'vec4', directions.length)
const sourceRay = storage(rayAttribute, 'vec4', directions.length)
const sourceRayVarying = varying(sourceRay.element(instanceIndex).xyz)
const rayViewDirection = cameraViewMatrix.mul(vec4(sourceRayVarying.negate(), 0)).xyz.normalize()

type Case = {
  name: string
  source: NodeMaterial
  appSource?: string
  checks: string[]
}
const cases: Case[] = [
  {
    name: 'standard-hit-position-normal-map',
    source: standard,
    checks: [
      'world-hit-position',
      'view-hit-position',
      'ray-before-ggx',
      'derivative-dependencies',
    ],
  },
  {
    name: 'app-glass-fresnel',
    source: appGlass,
    appSource: 'packages/viewer/src/lib/materials.ts:createMaterial/applyGlassFresnel',
    checks: ['view-hit-position', 'ray-before-opacity', 'ray-before-ggx'],
  },
  {
    name: 'app-direct-uv-opacity',
    source: appUv,
    appSource: 'packages/viewer/src/components/viewer/glb-scene.tsx:createZoneWallMaterial',
    checks: ['view-hit-position', 'ray-before-custom-output', 'direct-uv-attribute'],
  },
  {
    name: 'app-custom-fragment-node',
    source: appFragment,
    appSource: 'packages/editor/src/lib/export-texture-utils.ts:decompress fragmentNode',
    checks: ['view-hit-position', 'ray-before-custom-output', 'custom-fragment-preserved'],
  },
]

const results = []
for (const item of cases) {
  const plane = new PlaneGeometry(1, 1)
  const geometry = new InstancedBufferGeometry()
  geometry.setIndex(plane.index)
  for (const [name, attribute] of Object.entries(plane.attributes)) {
    geometry.setAttribute(name, attribute)
  }
  geometry.instanceCount = directions.length
  const material = item.source.clone()
  assert.notEqual(material, item.source)
  assert.equal(material.fragmentNode, item.source.fragmentNode)
  assert.equal(material.opacityNode, item.source.opacityNode)
  assert.equal(material.colorNode, item.source.colorNode)
  assert.equal(material.normalNode, item.source.normalNode)
  material.positionNode = hitLocal.element(instanceIndex).xyz
  material.lightsNode = lights([directional, ambient])
  material.vertexNode = null
  material.setupModelViewProjection = () => vec4(uv().mul(2).sub(1), 0, 1)
  const originalClipping = material.setupClipping
  material.setupClipping = function (builder: NodeBuilder) {
    const fragmentStack = builder.stack as unknown as { addToStack(node: unknown): void }
    assert.equal(typeof fragmentStack.addToStack, 'function')
    fragmentStack.addToStack(positionViewDirection.assign(rayViewDirection))
    return originalClipping.call(this, builder)
  }
  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false
  const builder = new WGSLNodeBuilder(mesh, renderer)
  builder.camera = camera
  builder.scene = scene
  builder.build()
  const vertex = builder.vertexShader
  const fragment = builder.fragmentShader
  assert.equal(material.vertexNode, null)
  assert.match(vertex, /positionLocal = NodeBuffer_\d+\.value\[ instanceIndex \]\.xyz/)
  assert.match(
    vertex,
    /v_positionView = \( modelViewMatrix \* vec4<f32>\( positionLocal, 1\.0 \) \)\.xyz/,
  )
  assert(!fragment.includes('cameraProjectionMatrixInverse'))
  const rayAssignment = fragment.match(
    /^\s*(\w+) = normalize\( \( render\.cameraViewMatrix \* vec4<f32>\( \( - (\w+) \), 0\.0 \) \)\.xyz \);$/m,
  )
  assert(rayAssignment, 'Source ray direction assignment was absent from generated fragment shader')
  const rayName = rayAssignment[1]!
  const assignIndex = fragment.indexOf(rayAssignment[0])
  const fragmentMain = fragment.slice(fragment.indexOf('fn main('))
  if (item.checks.includes('world-hit-position')) {
    assert.match(
      vertex,
      /v_positionWorld = \( object\.\w+ \* vec4<f32>\( positionLocal, 1\.0 \) \)\.xyz/,
    )
  }
  if (item.checks.includes('ray-before-opacity')) {
    const alphaIndex = fragment.indexOf('DiffuseColor.w =')
    assert(alphaIndex > assignIndex)
    assert(fragment.slice(assignIndex, alphaIndex).includes(rayName))
    assert.match(fragment, new RegExp(`dot\\( normalView, ${rayName} \\)`))
  }
  if (item.checks.includes('ray-before-ggx')) {
    const directViewDot = fragment.indexOf(`dot( normalView, ${rayName} )`, assignIndex)
    assert(directViewDot > assignIndex)
    assert.match(fragment, /V_GGX_SmithCorrelated\(/)
  }
  if (item.checks.includes('derivative-dependencies')) {
    assert.match(fragmentMain, /dpdx\( v_positionView \)/)
    assert.match(fragmentMain, /dpdy\( v_positionView \)/)
    assert.match(fragmentMain, /dpdx\( nodeVarying\d+ \)/)
  }
  if (item.checks.includes('direct-uv-attribute')) {
    assert.match(vertex, /varyings\.nodeVarying\d+ = uv/)
    assert.match(fragmentMain, /DiffuseColor\.w =.*nodeVarying\d+\.y/)
  }
  if (item.checks.includes('custom-fragment-preserved')) {
    assert.equal(material.fragmentNode, item.source.fragmentNode)
    assert.match(fragmentMain, /textureLoad\(/)
  }
  if (item.checks.includes('ray-before-custom-output')) {
    assert(fragment.indexOf('output.color =', assignIndex) > assignIndex)
  }
  assert.equal(item.source.positionNode, null, 'Audit mutated the original material')
  await writeFile(new URL(`${item.name}.vertex.wgsl`, output), vertex)
  await writeFile(new URL(`${item.name}.fragment.wgsl`, output), fragment)
  results.push({
    name: item.name,
    appSource: item.appSource ?? null,
    materialType: item.source.type,
    checks: item.checks,
    vertexLength: vertex.length,
    fragmentLength: fragment.length,
    rayDirectionVariable: rayName,
    vertexNode: material.vertexNode,
    preserved: {
      fragmentNode: material.fragmentNode === item.source.fragmentNode,
      colorNode: material.colorNode === item.source.colorNode,
      opacityNode: material.opacityNode === item.source.opacityNode,
      normalNode: material.normalNode === item.source.normalNode,
    },
  })
  geometry.dispose()
  plane.dispose()
  material.dispose()
}

const report = {
  scope: 'Node graph / WGSL generation only; not GPU validation, intersection, image or browser QA',
  threeRevision: THREE.REVISION,
  featureQuery: 'Uninitialized renderer.hasFeature returns false; no GPU device is requested',
  rayFixture:
    'Two Blender 4.3 source EQUIRECTANGULAR directions transformed by source camera matrix',
  hitFixture: 'Two supplied local positions; no BVH intersection is executed',
  pixelQuadFixture:
    'Instanced PlaneGeometry; actual atlas placement and corner attributes are absent',
  sourceHashes: hashes,
  privateSourceExtraction: { zoneFactory: 'Unmodified function body', fragmentExpression },
  cases: results,
  missing: [
    'Actual GPU BVH scene packaging, hit metadata and radial clipping',
    'Actual atlas placement and hit corner attributes / ray differentials',
    'Hit-side winding and first-hit rejection for side / alpha / clipping',
    'Transparent layer traversal and compositing',
    'Shared real-scene shadow-map lifecycle',
    'Per-object material grouping and GPU indirect compaction',
    'Dynamic geometry / instances / displacement / source callbacks',
    'Runtime preview, photo, video and film output wiring',
  ],
}
await writeFile(new URL('report.json', output), `${JSON.stringify(report, null, 2)}\n`)
console.log(
  JSON.stringify({
    cases: results.length,
    status: 'WGSL graph assertions passed',
    output: fileURLToPath(output),
  }),
)
