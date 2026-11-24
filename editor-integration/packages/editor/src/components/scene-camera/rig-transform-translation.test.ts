import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import fixtures from '../../../../../tests/integration/fixtures/blender-transform-translation.json'
import {
  ED_view3d_calc_zfac_ex,
  InputVector,
  type Mat4,
  sourceTranslationHashes,
  type TranslationContext,
  type Vec2,
  type Vec3,
} from './rig-transform-translation-source'
import {
  constrainRigTranslation,
  rigPointerTranslation,
  rigTranslationContext,
} from './rig-translation'

test('translation input and constraints match unchanged Blender C++ in perspective and orthographic views', () => {
  expect(fixtures.hashes).toEqual(sourceTranslationHashes)
  for (const [path, hash] of Object.entries(sourceTranslationHashes)) {
    const source = readFileSync(new URL(`../../../../../vendor/${path}`, import.meta.url))
    expect(createHash('sha256').update(source).digest('hex')).toBe(hash)
  }
  let worst = 0
  for (const [index, entry] of fixtures.cases.entries()) {
    const view = {
      persmat: entry.persmat.map((column) => column.map(Math.fround)) as Mat4,
      persinv: entry.persinv.map((column) => column.map(Math.fround)) as Mat4,
    }
    const context: TranslationContext = {
      region: { winx: entry.size[0]!, winy: entry.size[1]!, regiondata: view },
      zfac: ED_view3d_calc_zfac_ex(view, entry.center.map(Math.fround) as Vec3, null),
      center_global: entry.center.map(Math.fround) as Vec3,
      viewinv: entry.viewinv.map((column) =>
        column.slice(0, 3).map(Math.fround),
      ) as TranslationContext['viewinv'],
      persp: entry.persp,
      spacetype: 1,
    }
    expect(context.zfac).toBeCloseTo(entry.zfac, 4)
    const delta: Vec3 = [0, 0, 0]
    InputVector(
      context,
      { imval: entry.origin.map(Math.fround) as Vec2 },
      entry.point as Vec2,
      delta,
    )
    delta.forEach((v, i) => {
      expect(v).toBeCloseTo(entry.input[i]!, 4)
    })
    const normal = new Vector3(...(entry.axis.map(Math.fround) as Vec3))
    const tangent = new Vector3(1, 0, 0)
    if (Math.abs(normal.x) > 0.8) tangent.set(0, 1, 0)
    tangent.cross(normal).normalize()
    const axes =
      entry.kind === 0
        ? [normal, tangent, new Vector3()]
        : entry.kind === 1
          ? [normal]
          : [tangent, new Vector3().crossVectors(normal, tangent).normalize()]
    const result = constrainRigTranslation(context, delta, axes)
    result.forEach((value, i) => {
      const error = Math.abs(value - entry.output[i]!) / Math.max(1, Math.abs(entry.output[i]!))
      worst = Math.max(worst, error)
      expect(error, `case ${index} component ${i}: ${value} vs ${entry.output[i]}`).toBeLessThan(
        0.0002,
      )
    })
  }
  expect(worst).toBeLessThan(0.0002)
})

test('camera adapter maps canvas motion to depth-correct movement in both projections', () => {
  for (const camera of [
    new PerspectiveCamera(50, 4 / 3, 0.1, 100),
    new OrthographicCamera(-8, 8, 6, -6, 0.1, 100),
  ]) {
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    const context = rigTranslationContext(camera, new Vector3(2, 1, 0), [800, 600])
    const result = rigPointerTranslation(context, [300, 200], [420, 270], 'XYZ')
    const height = camera instanceof PerspectiveCamera ? 20 * Math.tan((25 * Math.PI) / 180) : 12
    expect(result.x).toBeCloseTo((120 * height) / 600, 5)
    expect(result.y).toBeCloseTo((70 * height) / 600, 5)
    expect(result.z).toBeCloseTo(0)
    const depth = rigPointerTranslation(context, [300, 200], [300, 270], 'Z')
    expect(depth.z).toBeCloseTo(-((((70 * height) / 600) * 2) ** 2), 4)
    expect(depth.x).toBeCloseTo(0)
    expect(depth.y).toBeCloseTo(0)
  }
})
