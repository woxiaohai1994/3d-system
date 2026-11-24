import { expect, test } from 'bun:test'
import { BufferGeometry, Float32BufferAttribute, PlaneGeometry, Vector3 } from 'three'
import { createMeshPointAttachmentProvider, type AttachmentMesh } from './mesh-point-attachment'

const provider = createMeshPointAttachmentProvider<AttachmentMesh>((node) => node)

test('triangle attachment follows deformation and rotation while retaining its physical offset', () => {
  const geometry = new PlaneGeometry(4, 4, 5, 5)
  const indices = Array.from(geometry.index!.array)
  const source = { geometry, scale: 2, key: 'panel' }
  const capture = provider.capture(source, [0.73, -0.54, 0.04], {})!
  expect(capture.distance).toBeCloseTo(0.04, 7)
  expect(Array.from(geometry.index!.array)).toEqual(indices)
  expect(
    new Vector3(...provider.resolve(source, capture.parameters, {})!).distanceTo(
      new Vector3(0.73, -0.54, 0.04),
    ),
  ).toBeLessThan(1e-9)
  const deformed = geometry
    .clone()
    .scale(1.8, 0.6, 1)
    .rotateY(Math.PI / 2)
    .translate(3, 1, 2)
  const point = provider.resolve(
    { ...source, geometry: deformed },
    JSON.parse(JSON.stringify(capture.parameters)),
    {},
  )!
  expect(
    new Vector3(...point).distanceTo(new Vector3(6.04, 2 - 0.54 * 0.6, 4 - 0.73 * 1.8)),
  ).toBeLessThan(1e-6)
  const doubled = provider.resolve({ ...source, scale: 4 }, capture.parameters, {})!
  expect(new Vector3(...doubled).distanceTo(new Vector3(1.46, -1.08, 0.04))).toBeLessThan(1e-7)
  expect(provider.resolve({ ...source, key: 'replacement' }, capture.parameters, {})).toBeNull()
  deformed.index!.setX(0, deformed.index!.getX(1))
  deformed.index!.needsUpdate = true
  expect(provider.resolve({ ...source, geometry: deformed }, capture.parameters, {})).toBeNull()
})

test('nearest-point and topology caches observe buffer revisions, nonindexed and degenerate meshes', () => {
  const geometry = new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute([0, 0, 0, 2, 0, 0, 0, 2, 0], 3),
  )
  const source = { geometry, scale: 1, key: 'triangle' }
  const capture = provider.capture(source, [0.3, 0.4, 0.05], {})!
  const positions = geometry.getAttribute('position')
  for (let i = 0; i < positions.count; i++) positions.setZ(i, 3)
  positions.needsUpdate = true
  expect(provider.capture(source, [0.3, 0.4, 3.05], {})!.distance).toBeCloseTo(0.05, 7)
  expect(provider.resolve(source, capture.parameters, {})![2]).toBeCloseTo(3.05, 7)
  expect(geometry.index).toBeNull()
  expect(provider.resolve(source, { ...capture.parameters, face: 10 }, {})).toBeNull()
  expect(provider.capture({ ...source, scale: 0 }, [0, 0, 0], {})).toBeNull()
  positions.setXYZ(2, 0, 0, 3)
  positions.needsUpdate = true
  expect(provider.resolve(source, capture.parameters, {})).toBeNull()
})

test('semantic triangles survive unrelated topology edits and vertex/triangle reordering', () => {
  const build = (
    entries: { faceId: string; ids: [string, string, string]; points: number[] }[],
  ): AttachmentMesh => ({
    geometry: new BufferGeometry().setAttribute(
      'position',
      new Float32BufferAttribute(
        entries.flatMap((e) => e.points),
        3,
      ),
    ),
    scale: 1,
    key: 'semantic-panel',
    triangles: entries.map((e) => ({ faceId: e.faceId, vertexIds: e.ids })),
  })
  const source = build([
    { faceId: 'front', ids: ['a', 'b', 'c'], points: [0, 0, 0, 2, 0, 0, 0, 2, 0] },
  ])
  const binding = provider.capture(source, [0.4, 0.6, 0.04], {})!
  const edge = provider.capture(source, [0.4, -0.2, 0.04], {})!
  const front = {
    faceId: 'front',
    ids: ['c', 'a', 'b'] as [string, string, string],
    points: [0, 6, 5, 0, 0, 5, 4, 0, 5],
  }
  const other = {
    faceId: 'back',
    ids: ['p', 'q', 'r'] as [string, string, string],
    points: [0, 0, -1, 2, 0, -1, 0, 2, -1],
  }
  const next = build([other, front])
  expect(
    new Vector3(
      ...provider.resolve(next, JSON.parse(JSON.stringify(binding.parameters)), {})!,
    ).distanceTo(new Vector3(0.8, 1.8, 5.04)),
  ).toBeLessThan(1e-7)
  expect(
    new Vector3(...provider.resolve(next, edge.parameters, {})!).distanceTo(
      new Vector3(0.8, -0.2, 5.04),
    ),
  ).toBeLessThan(1e-7)
  expect(provider.resolve(build([other]), binding.parameters, {})).toBeNull()
  expect(
    provider.resolve(build([{ ...front, ids: ['c', 'a', 'new-b'] }]), binding.parameters, {}),
  ).toBeNull()
  expect(provider.resolve(build([front, front]), binding.parameters, {})).toBeNull()
  expect(provider.capture(build([front, front]), [0.8, 1.8, 5.04], {})).toBeNull()
  expect(provider.resolve({ ...next, triangles: undefined }, binding.parameters, {})).toBeNull()
})
