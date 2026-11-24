import { expect, test } from 'bun:test'
import { CameraMotion, CameraMotionPoint, CameraRig, MotionSegment } from '@pascal-app/core'
import fixtures from '../../../../tests/integration/fixtures/add-camera-rigs-object-animation.json'
import { cameraRigsSource } from './add-camera-rigs-source'
import { createCameraMotionEvaluator } from './camera-motion'

function motion(item: (typeof fixtures.cases)[number]) {
  const type = item.type as CameraRig['type']
  const points = item.endpoints.map((endpoint, index) =>
    CameraMotionPoint.parse({
      time: index * 2,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      verticalFov: 50,
      orthographicHeight: 20,
      orbitDistance: 5,
      rig: CameraRig.parse({
        type,
        native: {
          source: 'add-camera-rigs@1.9.0',
          bones: structuredClone(cameraRigsSource[type].defaults),
          placement: endpoint.placement,
          objectTransform: endpoint.object,
          sensorWidth: 36,
        },
      }),
    }),
  )
  return CameraMotion.parse({
    points,
    segments: [
      MotionSegment.parse({
        fromId: points[0]!.id,
        toId: points[1]!.id,
        path: 'line',
        look: 'free',
        rhythm: 'linear',
      }),
    ],
  })
}

for (const item of fixtures.cases)
  test(`native ${item.type} ${item.parentKind} author channel animation at ${item.time} preserves the evaluated matrix`, () => {
    const data = motion(item),
      frozen = structuredClone(data),
      evaluator = createCameraMotionEvaluator(data)
    const rig = evaluator.sample(item.time)!.rig!
    for (const channel of ['location', 'rotation', 'scale'] as const)
      item.object[channel].forEach((value, axis) => {
        expect(rig.native!.objectTransform![channel][axis]!).toBeCloseTo(value, 5)
      })
    item.placement.forEach((value, index) => {
      expect(rig.native!.placement[index]!).toBeCloseTo(value, 5)
    })
    evaluator.sample(2)
    evaluator.sample(0)
    expect(evaluator.sample(item.time)!.rig).toEqual(rig)
    expect(data).toEqual(frozen)
  })

for (const boundary of ['legacy', 'mixed', 'parent-inverse'] as const)
  test(`${boundary} animation retains the original matrix interpolation and never exposes incompatible author channels`, () => {
    const data = motion(fixtures.cases[0]!),
      first = data.points[0]!.rig!.native!,
      last = data.points[1]!.rig!.native!
    if (boundary === 'legacy') delete first.objectTransform
    if (boundary !== 'parent-inverse') delete last.objectTransform
    else last.objectTransform!.parentInverse[12]! += 3
    const evaluator = createCameraMotionEvaluator(data),
      middle = evaluator.sample(1)!.rig!.native!
    expect(middle.objectTransform).toBeUndefined()
    first.placement.forEach((value, index) => {
      expect(middle.placement[index]!).toBeCloseTo((value + last.placement[index]!) / 2, 10)
    })
    expect(evaluator.sample(0)!.rig!.native!.objectTransform).toEqual(first.objectTransform)
    expect(evaluator.sample(2)!.rig!.native!.objectTransform).toEqual(last.objectTransform)
  })

test('held Object author channels stay on the first key until the exact next boundary', () => {
  const data = motion(fixtures.cases[0]!)
  data.segments[0]!.rhythm = 'hold'
  const evaluator = createCameraMotionEvaluator(data)
  for (const time of [0, 0.5, 1, 1.999]) {
    const native = evaluator.sample(time)!.rig!.native!
    expect(native.placement).toEqual(data.points[0]!.rig!.native!.placement)
    expect(native.objectTransform).toEqual(data.points[0]!.rig!.native!.objectTransform)
  }
  expect(evaluator.sample(2)!.rig!.native!.objectTransform).toEqual(
    data.points[1]!.rig!.native!.objectTransform,
  )
})
