import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { BlenderRigRequest, CameraRig } from '@pascal-app/core'
import { applySourceRigOperator, evaluateSourceCameraRig } from '@pascal-app/viewer'
import {
  Matrix4,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGPUCoordinateSystem,
} from 'three'
import { context, Fn, float, uniform } from 'three/tsl'
import * as ThreeWebGPU from 'three/webgpu'
import { GLSLNodeBuilder, type Node, WebGPURenderer } from 'three/webgpu'
import poses from '../../../../../tests/integration/fixtures/add-camera-rigs-parity.json'
import native from '../../../../../tests/integration/fixtures/blender-rig-relations.json'
import shader from '../../../../../tests/integration/fixtures/blender-rig-relations-shader.json'
import metadata from './rig-relations-metadata.json'
import {
  sourceRigRelationScreen,
  sourceRigRelationStipple,
  sourceRigRelationStyle,
  sourceRigRelations,
  sourceRigRelationVisible,
} from './rig-relations-source'
import source from './rig-relations-source.json'
import {
  createSourceRigRelationFrame,
  createSourceRigRelationMaterial,
  SourceRigRelationsOverlay,
} from './rig-source-relations'
import type { SourceRigClip } from './rig-wire-source'

const { WGSLNodeBuilder } = ThreeWebGPU as typeof ThreeWebGPU & {
  WGSLNodeBuilder: typeof GLSLNodeBuilder
}
function rig(input: unknown, offset?: Matrix4): CameraRig {
  const request = BlenderRigRequest.parse(input)
  return CameraRig.parse({
    type: request.type,
    native: {
      source: 'add-camera-rigs@1.9.0',
      placement: new Matrix4().toArray(),
      sensorWidth: 36,
      bones: request.bones,
      cameraOffsetMatrix: offset?.toArray(),
    },
  })
}

test('relation source retains unmodified C++/shader bytes and native metadata export hashes', () => {
  const bytes = Uint8Array.from(atob(source.wasm), (char) => char.charCodeAt(0))
  expect(WebAssembly.Module.imports(new WebAssembly.Module(bytes))).toEqual([])
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.wasmHash)
  expect(source.hashes).toEqual(shader.hashes)
  expect(metadata.hashes).toEqual(native.hashes)
  for (const [path, hash] of Object.entries({ ...source.hashes, ...metadata.hashes }))
    expect(
      createHash('sha256')
        .update(readFileSync(new URL(`../../../../../${path}`, import.meta.url)))
        .digest('hex'),
    ).toBe(hash)
  expect(sourceRigRelationStyle.dashWidth).toBe(6)
  expect(sourceRigRelationStyle.dashFactor).toBe(0.5)
  expect(sourceRigRelationStyle.color).toEqual([0, 0, 0])
  for (const definition of Object.values(metadata.types)) expect(definition.fromHead).toBe(false)
})

test('original relation selection and fragment stipple policies match 960 independently native-compiled cases', () => {
  expect(shader.cases).toHaveLength(960)
  for (const { params: p, expected } of shader.cases) {
    expect(
      Number(sourceRigRelationVisible(p[0] as 0 | 1 | 2, !!p[1], !!p[2], !!p[3], !!p[4])),
    ).toBe(expected[0]!)
    expect(Number(sourceRigRelationStipple(p[5]!, !!p[6]))).toBe(expected[1]!)
  }
  expect(sourceRigRelationStipple(3)).toBe(true)
  expect(sourceRigRelationStipple(3.01)).toBe(false)
  expect(sourceRigRelationStipple(6)).toBe(true)
})

test('target guides connect the actual lens to Aim across independently exported Blender poses', () => {
  for (const fixture of poses) {
    const request = BlenderRigRequest.parse(fixture.request)
    let data = evaluateSourceCameraRig(request),
      cameraRig = rig(request)
    if (request.operation) {
      cameraRig = applySourceRigOperator(cameraRig, data, request.operation, request.lens)
      data = evaluateSourceCameraRig({ ...request, bones: cameraRig.native!.bones })
    }
    const saved = structuredClone(data),
      actual = sourceRigRelations(cameraRig, data, ['Camera'], { poseMode: true })
    expect(actual.map((relation) => [relation.name, relation.parent])).toEqual([['Camera', 'Aim']])
    for (const [key, expected] of [
      ['start', fixture.expected.cameraMatrix.slice(12, 15)],
      ['end', fixture.controls.Aim.boneMatrix.slice(12, 15)],
    ] as const)
      actual[0]![key].forEach((value, axis) => {
        expect(Math.abs(value - expected[axis]!)).toBeLessThan(3e-5)
      })
    expect(data).toEqual(saved)
    expect(sourceRigRelations(cameraRig, data, ['Camera'], { poseMode: false })).toEqual([])
  }
})

test('target guides follow independent camera-body translation and rotation while Aim stays fixed', () => {
  for (const type of ['dolly', 'crane', '2d'] as const) {
    const fixture = poses.find((fixture) => fixture.request.type === type)!,
      offset = new Matrix4().makeRotationY(0.3).setPosition(2, 0.5, -1),
      request = BlenderRigRequest.parse(fixture.request),
      cameraRig = rig(request, offset),
      data = evaluateSourceCameraRig({
        ...request,
        cameraOffsetMatrix: offset.toArray(),
      }),
      expected = new Vector3().setFromMatrixPosition(
        new Matrix4().fromArray(fixture.expected.cameraMatrix).multiply(offset),
      ),
      relations = sourceRigRelations(cameraRig, data, ['Camera'], { poseMode: true })
    expect(relations).toHaveLength(1)
    expect(new Vector3(...relations[0]!.start).distanceTo(expected)).toBeLessThan(3e-5)
    expect(
      new Vector3(...relations[0]!.end).distanceTo(
        new Vector3().fromArray(fixture.controls.Aim.boneMatrix, 12),
      ),
    ).toBeLessThan(3e-5)
  }
})

test('offset guides appear only during separate offset editing and join baseline center to the actual lens', () => {
  for (const type of ['dolly', 'crane'] as const) {
    const fixture = poses.find((fixture) => fixture.request.type === type)!,
      request = BlenderRigRequest.parse(fixture.request),
      offset = new Matrix4().makeTranslation(3, 0, 0),
      cameraRig = rig(request, offset)
    request.bones!.Camera_Offset!.location = [2, 0, 0]
    request.cameraOffsetMatrix = offset.toArray()
    const data = evaluateSourceCameraRig(request),
      baseline = new Vector3().fromArray(fixture.controls.Camera.boneMatrix, 12),
      lens = new Vector3().fromArray(fixture.expected.cameraMatrix, 12)
    baseline.x += 3
    lens.x += 5
    for (const selected of [['Camera'], ['Aim'], ['Root'], ['Camera', 'Camera_Offset']]) {
      const guides = sourceRigRelations(cameraRig, data, selected, { poseMode: true })
      expect(guides).toHaveLength(1)
      expect(guides[0]!.parent).toBe('Aim')
    }
    const guides = sourceRigRelations(cameraRig, data, ['Camera_Offset'], { poseMode: true })
    expect(guides).toHaveLength(2)
    expect(guides[1]!.name).toBe('Camera_Offset')
    expect(new Vector3(...guides[1]!.start).distanceTo(baseline)).toBeLessThan(3e-5)
    expect(new Vector3(...guides[1]!.end).distanceTo(lens)).toBeLessThan(3e-5)
    expect(guides[1]!.end).toEqual(guides[0]!.start)
  }
})

test('coincident centers and rotation-only offsets never produce a second guide', () => {
  for (const type of ['dolly', 'crane'] as const) {
    const fixture = poses.find((fixture) => fixture.request.type === type)!
    for (const rotated of [false, true]) {
      const request = BlenderRigRequest.parse(fixture.request),
        offset = new Matrix4().makeRotationY(0.4).setPosition(3, 1, -2),
        cameraRig = rig(request, offset)
      if (rotated) request.bones!.Camera_Offset!.rotation = [0.1, 0.2, 0.3]
      request.cameraOffsetMatrix = offset.toArray()
      const data = evaluateSourceCameraRig(request)
      expect(
        sourceRigRelations(cameraRig, data, ['Camera_Offset'], { poseMode: true }),
      ).toHaveLength(1)
    }
  }
})

test('frozen relation quads keep one physical pixel coverage, reverse source line phase and GL/GPU projection', () => {
  const relation = {
      name: 'child',
      parent: 'parent',
      start: [-0.7, 0.2, -4],
      end: [0.7, -0.2, -8],
    } as const,
    viewport = { width: 1000, height: 600 },
    placement = new Matrix4()
  for (const camera of [
    new PerspectiveCamera(50, 5 / 3, 0.1, 100),
    new OrthographicCamera(-2, 2, 1.2, -1.2, 0.1, 100),
  ]) {
    camera.updateMatrixWorld()
    const gl = createSourceRigRelationFrame(
      [
        structuredClone(relation) as unknown as Parameters<
          typeof createSourceRigRelationFrame
        >[0][number],
      ],
      camera,
      placement,
      viewport,
    )
    camera.coordinateSystem = WebGPUCoordinateSystem
    camera.updateProjectionMatrix()
    const gpu = createSourceRigRelationFrame(
      [
        structuredClone(relation) as unknown as Parameters<
          typeof createSourceRigRelationFrame
        >[0][number],
      ],
      camera,
      placement,
      viewport,
    )
    const a = gl.getAttribute('sourceRigClip'),
      b = gpu.getAttribute('sourceRigClip'),
      start = gl.getAttribute('sourceRigStippleStart'),
      coord = gl.getAttribute('sourceRigStippleCoord')
    expect(a.count).toBe(4)
    expect([...gl.index!.array]).toEqual([0, 1, 2, 2, 1, 3])
    const p = new Vector3(...relation.start).project(camera)
    expect(start.getX(0)).toBeCloseTo((p.x * 0.5 + 0.5) * viewport.width, 3)
    expect(start.getY(0)).toBeCloseTo((p.y * 0.5 + 0.5) * viewport.height, 3)
    for (let index = 0; index < 4; index++) {
      expect(a.getX(index)).toBe(b.getX(index))
      expect(a.getY(index)).toBe(b.getY(index))
      expect((a.getZ(index) + a.getW(index)) / 2).toBeCloseTo(b.getZ(index), 6)
      expect(start.getX(index)).toBe(start.getX(0))
      expect(start.getY(index)).toBe(start.getY(0))
    }
    expect(coord.getX(0)).toBeCloseTo(start.getX(0), 3)
    expect(coord.getY(0)).toBeCloseTo(start.getY(0), 3)
    const width = Math.hypot(
      ((a.getX(1) / a.getW(1) - a.getX(0) / a.getW(0)) * viewport.width) / 2,
      ((a.getY(1) / a.getW(1) - a.getY(0) / a.getW(0)) * viewport.height) / 2,
    )
    expect(width).toBeCloseTo(1, 4)
    const screen = sourceRigRelationScreen([1, 2, 0, 2] as SourceRigClip, viewport)
    expect(screen).toEqual([750, 600])
    gl.dispose()
    gpu.dispose()
  }
})

test('relation material compiles on both backends with noperspective stipple and scene depth gating', () => {
  for (const webgl of [false, true]) {
    const canvas = {
        width: 800,
        height: 600,
        style: {},
        addEventListener() {},
        removeEventListener() {},
      } as unknown as HTMLCanvasElement,
      renderer = new WebGPURenderer({ canvas, forceWebGL: webgl }),
      camera = new PerspectiveCamera()
    camera.updateMatrixWorld()
    const geometry = createSourceRigRelationFrame(
        [{ name: 'a', parent: 'b', start: [-1, 0, -4], end: [1, 0, -6] }],
        camera,
        new Matrix4(),
        { width: 800, height: 600 },
      ),
      material = createSourceRigRelationMaterial()
    expect(material.depthTest).toBe(true)
    expect(material.depthWrite).toBe(true)
    let gates = 0
    const depth = uniform(0.75).setName('source_relation_scene_depth')
    renderer.contextNode = context({
      getOutput(output: Node<'vec4'>) {
        gates++
        return Fn(() => {
          float(0.5).greaterThan(depth).discard()
          return output
        })()
      },
    })
    const mesh = new Mesh(geometry, material),
      builder = webgl ? new GLSLNodeBuilder(mesh, renderer) : new WGSLNodeBuilder(mesh, renderer)
    Object.assign(builder, { camera, scene: new Scene() })
    builder.build()
    expect(gates).toBe(1)
    expect(builder.fragmentShader).toContain('source_relation_scene_depth')
    expect(builder.fragmentShader).toContain('fract')
    expect(builder.fragmentShader).toContain('6.0')
    expect(builder.fragmentShader).toContain('discard')
    if (!webgl) expect(builder.fragmentShader).toContain('@interpolate( linear )')
    geometry.dispose()
    material.dispose()
  }
})

test('relation overlay follows current source selection, hides Object display and owns no raycast target', () => {
  const fixture = native.cases[0]!,
    data = evaluateSourceCameraRig(BlenderRigRequest.parse(fixture.request)),
    overlay = new SourceRigRelationsOverlay(),
    camera = new PerspectiveCamera(),
    placement = new Matrix4(),
    viewport = { width: 1000, height: 1000 }
  camera.position.set(20, 15, 20)
  camera.lookAt(0, 2, 0)
  camera.updateMatrixWorld()
  overlay.update(rig(fixture.request), data, ['Camera'], true, camera, placement, viewport)
  expect(overlay.mesh.visible).toBe(true)
  expect(overlay.mesh.geometry.getAttribute('sourceRigClip').count).toBeGreaterThan(0)
  const first = overlay.mesh.geometry
  overlay.update(rig(fixture.request), data, ['Camera'], true, camera, placement, viewport)
  expect(overlay.mesh.geometry).toBe(first)
  const hits: never[] = []
  overlay.mesh.raycast({} as never, hits)
  expect(hits).toEqual([])
  overlay.update(rig(fixture.request), data, [], true, camera, placement, viewport)
  expect(overlay.mesh.visible).toBe(false)
  expect(overlay.mesh.geometry.getAttribute('sourceRigClip').count).toBe(0)
  overlay.update(rig(fixture.request), data, ['Camera'], false, camera, placement, viewport)
  expect(overlay.mesh.visible).toBe(false)
  overlay.dispose()
})
