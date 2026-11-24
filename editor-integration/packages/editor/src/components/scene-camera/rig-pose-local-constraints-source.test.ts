import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { CameraRig } from '@pascal-app/core'
import {
  blenderRigRequest,
  cameraRigsSource,
  createSourceCameraRig,
  evaluateSourceCameraRig,
} from '@pascal-app/viewer'
import { Matrix3, Matrix4, Object3D, Vector3 } from 'three'
import blenderFixture from '../../../../../tests/integration/fixtures/add-camera-rigs-pose-local-multi.json'
import fixture from '../../../../../tests/integration/fixtures/blender-rig-pose-local-constraints.json'
import {
  sourcePoseConstraintAxes,
  sourcePoseConstraintRotation,
  sourcePoseConstraintSize,
  sourcePoseConstraintVector,
  sourcePoseLocalConstraintHashes,
} from './rig-pose-local-constraints-source'
import source from './rig-pose-local-constraints-source.json'
import { sourcePoseLocalOrientation } from './rig-pose-local-orientation-source'
import { sourcePoseTransformSelection } from './rig-pose-selection-source'
import { transformRigControl } from './rig-transform'

function matrix(values: number[]) {
  return new Matrix4().setFromMatrix3(new Matrix3().fromArray(values))
}

function components(value: Matrix4) {
  return new Matrix3().setFromMatrix4(value).elements
}

test('per-TransData constraint callbacks and math compile unchanged pinned source without host imports', () => {
  expect(sourcePoseLocalConstraintHashes).toEqual(fixture.hashes)
  const original = Object.keys(sourcePoseLocalConstraintHashes)
    .filter((path) => path.startsWith('vendor/'))
    .map((path) => readFileSync(new URL(`../../../../../${path}`, import.meta.url), 'utf8'))
  for (const [path, hash] of Object.entries(sourcePoseLocalConstraintHashes))
    expect(
      createHash('sha256')
        .update(readFileSync(new URL(`../../../../../${path}`, import.meta.url)))
        .digest('hex'),
    ).toBe(hash)
  for (const block of Object.values(source.sourceBlocks))
    expect(original.some((text) => text.includes(block))).toBe(true)
  for (const name of [
    'applyObjectConstraintVec',
    'applyObjectConstraintSize',
    'applyObjectConstraintRot',
    'constraints_rotation_impl',
    'normalize_m3',
    'invert_m3_m3',
  ])
    expect(source.sourceBlocks).toHaveProperty(name)
  const bytes = Uint8Array.from(atob(source.wasm), (value) => value.charCodeAt(0))
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.wasmHash)
  expect(WebAssembly.Module.imports(new WebAssembly.Module(bytes))).toEqual([])
})

for (const operation of [0, 1, 2, 3])
  test(`original float32 native C++ operation ${operation} agrees with WASM through shear, mirror, zero axes and singular matrices`, () => {
    const cases = fixture.cases.filter((item) => item.operation === operation)
    expect(cases.length).toBeGreaterThan(5)
    for (const item of cases) {
      const bone = matrix(item.bone)
      const space = matrix(item.space)
      let actual: number[]
      if (operation === 0) actual = components(sourcePoseConstraintAxes(bone))
      else if (operation === 1)
        actual = sourcePoseConstraintVector(bone, space, new Vector3(...item.vector)).toArray()
      else if (operation === 2)
        actual = components(
          sourcePoseConstraintSize(bone, space, matrix(item.sharedSize), item.mask),
        )
      else {
        const result = sourcePoseConstraintRotation(bone, item.mask, item.angle, {
          numeric: item.numeric,
          applyViewFlip: item.setup,
          viewVector: new Vector3(...item.viewVector),
        })
        actual = [...result.axis.toArray(), result.angle]
      }
      actual.forEach((value, index) => {
        expect(value).toBeCloseTo(item.expected[index]!, 5)
      })
    }
  })

test('normalize_m3 retains zero columns and shear instead of filling or orthogonalizing axes', () => {
  const zero = sourcePoseConstraintAxes(new Matrix4().makeScale(0, 2, 3))
  expect(components(zero)).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 1])
  const sheared = sourcePoseConstraintAxes(
    new Matrix4().set(2, 0.6, -0.4, 3, 0, 0.5, 0.3, 4, 0, 0, 1.5, 5, 0, 0, 0, 1),
  )
  const x = new Vector3().setFromMatrixColumn(sheared, 0)
  const y = new Vector3().setFromMatrixColumn(sheared, 1)
  expect(x.length()).toBeCloseTo(1, 6)
  expect(y.length()).toBeCloseTo(1, 6)
  expect(x.dot(y)).toBeGreaterThan(0.7)
})

test('singular bone and shared-space inverses retain Blender adjoints', () => {
  const zeroZ = new Matrix4().makeScale(1, 1, 0)
  expect(sourcePoseConstraintVector(new Matrix4(), zeroZ, new Vector3(2, 3, 4)).toArray()).toEqual([
    0, 0, 4,
  ])
  const flatPlane = matrix([1, 0, 0, 0, 1, 0, 0.5, 0.5, 0])
  const size = sourcePoseConstraintSize(
    flatPlane,
    new Matrix4(),
    new Matrix4().makeScale(1, 1, 2),
    4,
  )
  expect(components(size)).toEqual([0, 0, 0, 0, 0, 0, 0.5, 0.5, 0])
  expect(size.elements.every(Number.isFinite)).toBe(true)
})

test('pointer setup flips one shared angle while each TransData selects its own axis; numeric input never flips', () => {
  const a = new Matrix4()
  const b = new Matrix4().makeRotationY(Math.PI)
  const viewVector = new Vector3(1, 0, 0)
  const first = sourcePoseConstraintRotation(a, 1, 0.4, {
    numeric: false,
    applyViewFlip: true,
    viewVector,
  })
  expect(first.angle).toBeCloseTo(-0.4, 6)
  const second = sourcePoseConstraintRotation(b, 1, first.angle, {
    numeric: false,
    applyViewFlip: false,
    viewVector,
  })
  expect(second.angle).toBe(first.angle)
  expect(second.axis.dot(first.axis)).toBeCloseTo(-1, 6)
  expect(
    sourcePoseConstraintRotation(a, 1, 0.4, {
      numeric: true,
      applyViewFlip: true,
      viewVector,
    }).angle,
  ).toBeCloseTo(0.4, 6)
  for (const [mask, column] of [
    [1, 0],
    [6, 0],
    [2, 1],
    [5, 1],
    [4, 2],
    [3, 2],
  ] as const)
    expect(
      sourcePoseConstraintRotation(a, mask, 0.4, {
        numeric: true,
        applyViewFlip: false,
      }).axis.toArray(),
    ).toEqual(new Vector3().setFromMatrixColumn(a, column).toArray())
})

test('source results and host matrices remain frozen across subsequent calls', () => {
  const bone = sourcePoseConstraintAxes(new Matrix4().makeRotationX(0.4))
  const space = new Matrix4().makeRotationY(0.3)
  const delta = new Vector3(1, 2, 3)
  const size = new Matrix4().makeScale(1.3, 1, 1)
  const initial = [bone.toArray(), space.toArray(), delta.toArray(), size.toArray()]
  const vector = sourcePoseConstraintVector(bone, space, delta)
  const scale = sourcePoseConstraintSize(bone, space, size, 1)
  const rotation = sourcePoseConstraintRotation(bone, 1, 0.4, {
    numeric: true,
    applyViewFlip: false,
  })
  const stored = [vector.toArray(), scale.toArray(), rotation.axis.toArray(), rotation.angle]
  sourcePoseConstraintAxes(new Matrix4().makeScale(0, 0, 0))
  expect([vector.toArray(), scale.toArray(), rotation.axis.toArray(), rotation.angle]).toEqual(
    stored,
  )
  expect([bone.toArray(), space.toArray(), delta.toArray(), size.toArray()]).toEqual(initial)
})

test('source per-bone G/R/S plus existing channel and pivot solvers reproduce all 37 actual Blender operators', () => {
  const failures: Array<{ case: string; error: number; channel: string }> = []
  for (const item of blenderFixture.cases) {
    const mode = item.mode as 'translate' | 'rotate' | 'scale'
    const pose = {
      position: [0, 2, 10] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      verticalFov: 42,
      orthographicHeight: 10,
      orbitDistance: 10,
    }
    const rig = createSourceCameraRig(item.type as CameraRig['type'], pose)
    rig.native!.bones = structuredClone(item.before) as unknown as NonNullable<
      CameraRig['native']
    >['bones']
    rig.native!.placement = [...item.placement]
    const snapshot = evaluateSourceCameraRig(
      blenderRigRequest(rig, { aspect: 16 / 9, projection: 'perspective' }, pose),
    )
    const armature = new Matrix4().fromArray(item.placement)
    const entries = sourcePoseTransformSelection(
      cameraRigsSource[rig.type].bones,
      snapshot.widgets.map((widget) => widget.name),
      item.selected,
      item.requestedMode,
      item.pivot,
    ).map((entry) => {
      const widget = snapshot.widgets.find((widget) => widget.name === entry.name)!
      const local = new Matrix4().fromArray(widget.boneMatrix)
      const world = armature.clone().multiply(local)
      const expected = item.boneWorldMatrices[entry.name as 'Camera' | 'Aim' | 'Crane_Height']!
      expect(
        Math.max(...world.elements.map((value, i) => Math.abs(value - expected[i]!))),
      ).toBeLessThan(2e-5)
      return {
        ...entry,
        widget,
        local,
        world,
        axes: sourcePoseConstraintAxes(world),
        edit: armature.clone().multiply(new Matrix4().fromArray(widget.editMatrix)),
        location: armature.clone().multiply(new Matrix4().fromArray(widget.locationMatrix)),
      }
    })
    // U cancels in per-TransData constraints; use a frozen nontrivial basis to test that mapping.
    const shared =
      entries.length === 1
        ? sourcePoseLocalOrientation(armature, entries[0]!.world, entries[0]!.local)
        : new Matrix4().makeRotationY(0.61).multiply(new Matrix4().makeRotationX(-0.37))
    const values = new Vector3(
      mode === 'scale' ? 1 : 0,
      mode === 'scale' ? 1 : 0,
      mode === 'scale' ? 1 : 0,
    ).setComponent(item.axis, item.value)
    const delta = values.clone().applyMatrix3(new Matrix3().setFromMatrix4(shared))
    const sharedSize = shared
      .clone()
      .multiply(new Matrix4().makeScale(values.x, values.y, values.z))
      .multiply(shared.clone().invert())
    const center = entries
      .reduce(
        (point, entry) => point.add(new Vector3().setFromMatrixPosition(entry.world)),
        new Vector3(),
      )
      .divideScalar(entries.length)
    let result = rig
    for (const entry of entries) {
      const start = new Object3D()
      start.position.setFromMatrixPosition(entry.world)
      const current = start.clone()
      let matrix = new Matrix4()
      let rotation: { axis: Vector3; angle: number; numeric: boolean } | null = null
      if (mode === 'translate')
        current.position.add(
          entries.length > 1 ? sourcePoseConstraintVector(entry.axes, shared, delta) : delta,
        )
      else if (mode === 'rotate') {
        rotation = {
          ...sourcePoseConstraintRotation(entry.axes, 1 << item.axis, item.value, {
            numeric: true,
            applyViewFlip: false,
          }),
          numeric: true,
        }
        matrix.makeRotationAxis(rotation.axis, rotation.angle)
      } else {
        matrix =
          entries.length > 1
            ? sourcePoseConstraintSize(entry.axes, shared, sharedSize, 1 << item.axis)
            : sharedSize
        const columns = [0, 1, 2].map((i) => new Vector3().setFromMatrixColumn(entry.axes, i))
        const transformed = columns.map((axis) =>
          axis.clone().applyMatrix3(new Matrix3().setFromMatrix4(matrix)),
        )
        const negative = transformed[0]!.dot(transformed[1]!.clone().cross(transformed[2]!)) < 0
        transformed.forEach((axis, i) => {
          let length = axis.length() * (negative ? -1 : 1)
          if (axis.dot(columns[i]!) * (negative ? -1 : 1) < 0) length = -length
          current.scale.setComponent(i, length)
        })
      }
      result = transformRigControl(
        result,
        entry.name,
        mode,
        entry.location,
        start,
        current,
        entry.widget.locks[
          mode === 'translate' ? 'location' : mode === 'rotate' ? 'rotation' : 'scale'
        ],
        mode !== 'translate' && item.pivot !== 'INDIVIDUAL_ORIGINS' && !entry.noLocation
          ? {
              center,
              boneCenter: new Vector3().setFromMatrixPosition(entry.world),
              transform: matrix,
              edit: entry.edit,
              armature,
              locationLocks: entry.widget.locks.location,
            }
          : undefined,
        rotation
          ? {
              basis: entry.edit,
              previous: rig.native!.bones[entry.name]!.rotation,
              input: rotation,
            }
          : undefined,
      )
    }
    let error = 0,
      channel = ''
    for (const [name, bone] of Object.entries(item.after))
      for (const field of ['location', 'rotation', 'scale'] as const) {
        const actual = result.native!.bones[name]![field]
        const maximum = Math.max(...actual.map((value, i) => Math.abs(value - bone[field][i]!)))
        if (maximum > error) {
          error = maximum
          channel = `${name}.${field}`
        }
      }
    if (error > 2e-4)
      failures.push({ case: `${item.type}/${item.pivot}/${mode}/${item.axis}`, error, channel })
  }
  expect(failures).toEqual([])
  expect(blenderFixture.cases.length).toBe(37)
})
