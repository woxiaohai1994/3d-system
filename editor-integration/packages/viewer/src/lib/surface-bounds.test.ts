import { expect, test } from 'bun:test'
import {
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three'
import { getSurfaceBounds } from './surface-query'

function triangleGeometry() {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([0, 0, 0, 2, 0, 0, 0, 1, 0, 10, 10, 10, 11, 10, 10, 10, 11, 10], 3),
  )
  geometry.setIndex([0, 1, 2, 3, 4, 5])
  return geometry
}

test('surface bounds fit drawn vertices after rotation, excluding unused and hidden triangles', () => {
  const geometry = triangleGeometry()
  geometry.addGroup(0, 3, 0)
  geometry.addGroup(3, 3, 1)
  const visible = new MeshBasicMaterial(),
    hidden = new MeshBasicMaterial({ visible: false })
  const mesh = new Mesh(geometry, [visible, hidden])
  mesh.rotation.z = Math.PI / 4
  mesh.position.set(3, 2, 1)
  mesh.updateWorldMatrix(true, false)
  const frame = new Matrix4().makeTranslation(-1, 4, 0)
  const matrix = frame.clone().multiply(mesh.matrixWorld)
  const expected = new Box3().setFromPoints(
    [new Vector3(0, 0, 0), new Vector3(2, 0, 0), new Vector3(0, 1, 0)].map((point) =>
      point.applyMatrix4(matrix),
    ),
  )
  const targets = [{ id: 'model', object: mesh }]
  const actual = getSurfaceBounds(targets, {}, frame)!
  expect(actual.min.distanceTo(expected.min)).toBeLessThan(1e-6)
  expect(actual.max.distanceTo(expected.max)).toBeLessThan(1e-6)
  hidden.visible = true
  geometry.setDrawRange(0, 3)
  expect(getSurfaceBounds(targets, {}, frame)!.equals(expected)).toBe(true)
  geometry.setDrawRange(3, 0)
  expect(getSurfaceBounds(targets)).toBeNull()
  geometry.dispose()
  visible.dispose()
  hidden.dispose()
})

test('surface bounds transform each active instance before fitting its visible vertices', () => {
  const geometry = triangleGeometry()
  geometry.setDrawRange(0, 3)
  const material = new MeshBasicMaterial()
  const mesh = new InstancedMesh(geometry, material, 3)
  mesh.count = 2
  mesh.rotation.z = Math.PI / 4
  mesh.setMatrixAt(0, new Matrix4().makeTranslation(0, 2, 0))
  mesh.setMatrixAt(1, new Matrix4().makeTranslation(3, 0, 0))
  mesh.setMatrixAt(2, new Matrix4().makeTranslation(100, 100, 100))
  mesh.updateWorldMatrix(true, false)
  const expected = new Box3()
  for (const offset of [new Vector3(0, 2, 0), new Vector3(3, 0, 0)])
    for (const vertex of [new Vector3(), new Vector3(2, 0, 0), new Vector3(0, 1, 0)])
      expected.expandByPoint(vertex.add(offset).applyMatrix4(mesh.matrixWorld))
  const actual = getSurfaceBounds([{ id: 'batch', object: mesh }])!
  expect(actual.min.distanceTo(expected.min)).toBeLessThan(1e-6)
  expect(actual.max.distanceTo(expected.max)).toBeLessThan(1e-6)
  expect(geometry.index!.array).toEqual(new Uint16Array([0, 1, 2, 3, 4, 5]))
  geometry.dispose()
  material.dispose()
})
