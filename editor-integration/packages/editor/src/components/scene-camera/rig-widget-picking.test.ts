import { expect, test } from 'bun:test'
import {
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
  WebGLCoordinateSystem,
  WebGPUCoordinateSystem,
} from 'three'
import { sourcePickBone, sourcePickRadius } from './rig-picking-source'
import { chooseRigWidgetHit, pickRigWidget } from './rig-widget-picking'

const widget = {
  vertices: [
    [-1, 0, 0],
    [1, 0, 0],
  ] as [number, number, number][],
  edges: [[0, 1]] as [number, number][],
}
for (const projection of ['perspective', 'orthographic']) {
  for (const distance of [5, 50]) {
    test(`${projection} source 14 window-pixel aperture at 2x pixel ratio, distance ${distance}`, () => {
      const camera =
        projection === 'perspective'
          ? new PerspectiveCamera(50, 2, 0.1, 100)
          : new OrthographicCamera(-10, 10, 5, -5, 0.1, 100)
      camera.position.z = distance
      camera.updateMatrixWorld()
      const mesh = new Mesh()
      mesh.updateMatrixWorld()
      const ray = new Raycaster()
      ray.setFromCamera(new Vector2(0, 6 / 250), camera)
      expect(
        pickRigWidget(mesh, widget, ray, camera, { width: 1000, height: 500, pixelRatio: 2 })
          ?.object,
      ).toBe(mesh)
      ray.setFromCamera(new Vector2(0, 8 / 250), camera)
      expect(
        pickRigWidget(mesh, widget, ray, camera, { width: 1000, height: 500, pixelRatio: 2 }),
      ).toBeNull()
      mesh.position.z = distance + 1
      mesh.updateMatrixWorld()
      ray.setFromCamera(new Vector2(0, 0), camera)
      expect(pickRigWidget(mesh, widget, ray, camera, { width: 1000, height: 500 })).toBeNull()
    })
  }
}

for (const coordinateSystem of [WebGLCoordinateSystem, WebGPUCoordinateSystem])
  for (const projection of ['perspective', 'orthographic'])
    test(`${projection}/${coordinateSystem}: visible segments crossing near/far planes remain selectable`, () => {
      const camera =
        projection === 'perspective'
          ? new PerspectiveCamera(60, 1, 0.1, 10)
          : new OrthographicCamera(-2, 2, 2, -2, 0.1, 10)
      camera.coordinateSystem = coordinateSystem
      camera.updateProjectionMatrix()
      camera.updateMatrixWorld()
      const mesh = new Mesh(),
        ray = new Raycaster()
      const size = { width: 500, height: 500, pixelRatio: 1 }
      for (const vertices of [
        [
          [-0.02, 0, 0.05],
          [1, 0, -5],
        ],
        [
          [-1, 0, -1],
          [1, 0, -20],
        ],
      ] as [number, number, number][][]) {
        const shape = { vertices, edges: [[0, 1]] as [number, number][] }
        const visible = new Vector3(...vertices[0]!)
          .lerp(new Vector3(...vertices[1]!), 0.25)
          .project(camera)
        ray.setFromCamera(new Vector2(visible.x, visible.y), camera)
        const hit = pickRigWidget(mesh, shape, ray, camera, size)
        expect(hit).not.toBeNull()
        const projected = hit!.point.clone().project(camera)
        expect(projected.z).toBeGreaterThanOrEqual(
          coordinateSystem === WebGPUCoordinateSystem ? -1e-6 : -1.000001,
        )
        expect(projected.z).toBeLessThanOrEqual(1.000001)
      }
      for (const z of [0.1, -0.075, -11]) {
        ray.setFromCamera(new Vector2(0, 0), camera)
        const shape = {
          vertices: [
            [-1, 0, z],
            [1, 0, z],
          ] as [number, number, number][],
          edges: [[0, 1]] as [number, number][],
        }
        expect(pickRigWidget(mesh, shape, ray, camera, size)).toBeNull()
      }
    })

test('source nested rectangles narrow ambiguous hits and keep a lone wider hit', () => {
  expect(sourcePickRadius([1, 0, 0])).toBe(14)
  expect(sourcePickRadius([3, 1, 0])).toBe(9)
  expect(sourcePickRadius([3, 2, 1])).toBe(5)
  expect(sourcePickRadius([3, 2, 2])).toBe(5)
  expect(sourcePickRadius([3, 2, 0])).toBe(9)
  expect(sourcePickRadius([3, 0, 0])).toBe(14)
  expect(sourcePickRadius([0, 0, 0])).toBe(0)
})

test('source prioritizes an unselected bone and uses depth within each selection group', () => {
  const hits = [
    { name: 'Root', depth: 0.1 },
    { name: 'Camera', depth: 0.2 },
    { name: 'Aim', depth: 0.3 },
  ]
  expect(sourcePickBone(hits, ['Root'], true)?.name).toBe('Camera')
  expect(sourcePickBone(hits, ['Root', 'Camera'], true)?.name).toBe('Aim')
  expect(
    sourcePickBone(
      hits,
      hits.map((hit) => hit.name),
      true,
    )?.name,
  ).toBe('Root')
  expect(sourcePickBone(hits, ['Camera'], false)?.name).toBe('Aim')
})

test('pose widgets bypass ordinary-object event depth while retaining actual bone depth', () => {
  const camera = new PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.z = 10
  camera.updateMatrixWorld()
  const ray = new Raycaster()
  ray.setFromCamera(new Vector2(0, 0), camera)
  const meshes = ['Camera', 'Aim'].map((name, i) => {
    const mesh = new Mesh()
    mesh.userData.rigWidget = name
    mesh.position.z = -i
    mesh.updateMatrixWorld()
    return mesh
  })
  const hits = meshes.map(
    (mesh) => pickRigWidget(mesh, widget, ray, camera, { width: 500, height: 500 })!,
  )
  expect(hits.every((hit) => hit.distance === 0)).toBe(true)
  expect(hits[0]!.rigHits[0]!.depth).toBeLessThan(hits[1]!.rigHits[0]!.depth)
  expect(chooseRigWidgetHit(hits, ['Camera'], ['Camera', 'Aim'])?.object).toBe(meshes[1]!)
  expect(chooseRigWidgetHit(hits, ['Aim'], ['Camera', 'Aim'])?.object).toBe(meshes[0]!)
})

test('default Blender 4.3 cycling follows depth order before source bone priority', () => {
  const names = ['Root', 'Aim', 'Camera']
  const hits = names.map((name, index) => {
    const mesh = new Mesh()
    mesh.userData.rigWidget = name
    const depth = [0.9, 0.5, 0.1][index]!
    return {
      object: mesh,
      point: new Vector3(),
      distance: 0,
      rigHits: [14, 9, 5].map((radius) => ({
        radius,
        depth,
        point: new Vector3(),
        distance: depth,
      })),
    }
  })
  expect(chooseRigWidgetHit(hits, ['Aim'], names, false)?.object.userData.rigWidget).toBe('Root')
  expect(chooseRigWidgetHit(hits, ['Aim'], names)?.object.userData.rigWidget).toBe('Camera')
})
