export function modelGlbFixture(external = false) {
  const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 4])
  const bin = Buffer.from(positions.buffer)
  const json = Buffer.from(
    JSON.stringify({
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: 'Test cabinet', translation: [5, 2, -3] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      buffers: [
        { byteLength: bin.length, ...(external ? { uri: 'https://example.com/mesh.bin' } : {}) },
      ],
      bufferViews: [{ buffer: 0, byteLength: bin.length }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [0, 0, 0],
          max: [2, 3, 4],
        },
      ],
    }),
  )
  const length = Math.ceil(json.length / 4) * 4
  const bytes = Buffer.alloc(28 + length + bin.length)
  bytes.write('glTF')
  bytes.writeUInt32LE(2, 4)
  bytes.writeUInt32LE(bytes.length, 8)
  bytes.writeUInt32LE(length, 12)
  bytes.writeUInt32LE(0x4e4f534a, 16)
  bytes.fill(32, 20, 20 + length)
  json.copy(bytes, 20)
  bytes.writeUInt32LE(bin.length, 20 + length)
  bytes.writeUInt32LE(0x004e4942, 24 + length)
  bin.copy(bytes, 28 + length)
  return bytes
}
