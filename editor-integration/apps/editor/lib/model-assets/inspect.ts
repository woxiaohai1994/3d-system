import { Box3, Mesh, Vector3 } from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MODEL_MAX_BYTES, type ModelFacts } from './contracts'

export async function inspectModel(bytes: Buffer): Promise<ModelFacts> {
  if (
    bytes.length < 20 ||
    bytes.length > MODEL_MAX_BYTES ||
    bytes.toString('ascii', 0, 4) !== 'glTF' ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length
  )
    throw new Error('请选择完整的 GLB 2.0 文件（最大 200 MB）。')
  let json: any, binary: Buffer | undefined
  for (let offset = 12; offset < bytes.length; ) {
    if (offset + 8 > bytes.length) throw new Error('模型文件已损坏。')
    const size = bytes.readUInt32LE(offset),
      type = bytes.readUInt32LE(offset + 4)
    if (size % 4 || offset + 8 + size > bytes.length) throw new Error('模型数据块不完整。')
    if (type === 0x4e4f534a)
      json = JSON.parse(bytes.subarray(offset + 8, offset + 8 + size).toString('utf8'))
    if (type === 0x004e4942) binary = bytes.subarray(offset + 8, offset + 8 + size)
    offset += 8 + size
  }
  if (!json || !binary || json.asset?.version !== '2.0') throw new Error('模型缺少几何数据。')
  if (
    (json.buffers ?? []).some((b: any) => b.uri) ||
    (json.images ?? []).some((i: any) => i.uri && !i.uri.startsWith('data:'))
  )
    throw new Error('模型含外部依赖，请先将纹理和缓冲数据打包到 GLB。')
  if ((json.extensionsRequired ?? []).includes('KHR_draco_mesh_compression'))
    throw new Error('请将 Draco 模型导出为普通 GLB 后导入。')
  if ((json.nodes?.length ?? 0) > 50000 || (json.meshes?.length ?? 0) > 20000)
    throw new Error('模型部件过多，请先精简模型。')
  const materials = (json.materials ?? []).map((m: any, i: number) =>
    String(m.name || `Material ${i + 1}`).slice(0, 120),
  )
  const meshNames = (json.nodes ?? [])
    .filter((n: any) => n.mesh !== undefined)
    .map((n: any) => String(n.name || json.meshes?.[n.mesh]?.name || 'Mesh').slice(0, 120))
  const warnings: string[] = []
  if (json.animations?.length || json.skins?.length)
    warnings.push('模型含动画或骨骼；本次按初始姿态测量。')
  if (!materials.some((n: string) => /^slot_/i.test(n)))
    warnings.push('材质尚未标记可更换部位；导入后保留原材质。')
  // Geometry inspection never fetches textures or external URLs on the server.
  const geometry = structuredClone(json)
  geometry.buffers = [{ byteLength: binary.length }]
  delete geometry.images
  delete geometry.textures
  delete geometry.materials
  delete geometry.animations
  for (const mesh of geometry.meshes ?? [])
    for (const primitive of mesh.primitives ?? []) delete primitive.material
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const jsonBytes = Buffer.from(JSON.stringify(geometry))
  const jsonLength = Math.ceil(jsonBytes.length / 4) * 4
  const sanitized = Buffer.alloc(28 + jsonLength + binary.length)
  sanitized.write('glTF', 0)
  sanitized.writeUInt32LE(2, 4)
  sanitized.writeUInt32LE(sanitized.length, 8)
  sanitized.writeUInt32LE(jsonLength, 12)
  sanitized.writeUInt32LE(0x4e4f534a, 16)
  sanitized.fill(32, 20, 20 + jsonLength)
  jsonBytes.copy(sanitized, 20)
  sanitized.writeUInt32LE(binary.length, 20 + jsonLength)
  sanitized.writeUInt32LE(0x004e4942, 24 + jsonLength)
  binary.copy(sanitized, 28 + jsonLength)
  const gltf = await loader.parseAsync(
    sanitized.buffer.slice(sanitized.byteOffset, sanitized.byteOffset + sanitized.byteLength),
    '',
  )
  const box = new Box3().setFromObject(gltf.scene, true)
  const dimensions = box.getSize(new Vector3()).toArray() as [number, number, number]
  let vertexCount = 0,
    triangleCount = 0
  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return
    vertexCount += object.geometry.getAttribute('position')?.count ?? 0
    triangleCount +=
      (object.geometry.index?.count ?? object.geometry.getAttribute('position')?.count ?? 0) / 3
  })
  if (box.isEmpty() || dimensions.some((d) => !Number.isFinite(d) || d <= 0))
    throw new Error('无法测得有效的三维尺寸。')
  if (Math.max(...dimensions) > 30 || Math.max(...dimensions) < 0.01)
    warnings.push('尺寸可能异常，请核对单位或输入实际宽度。')
  gltf.scene.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose()
      for (const m of Array.isArray(object.material) ? object.material : [object.material])
        m.dispose()
    }
  })
  return {
    min: box.min.toArray() as ModelFacts['min'],
    max: box.max.toArray() as ModelFacts['max'],
    dimensions,
    vertexCount,
    triangleCount: Math.round(triangleCount),
    materials,
    meshNames,
    warnings,
  }
}
