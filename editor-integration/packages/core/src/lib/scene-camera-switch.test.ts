import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import fixtures from '../../../../tests/integration/fixtures/blender-scene-camera-switch.json'
import { SceneAnimation } from '../schema/scene-animation'
import { SceneCameraMarker } from '../schema/scene-camera-marker'
import { sceneCameraSourceHash } from './blender-scene-camera-source'
import { sceneCameraAtFrame } from './scene-camera-switch'

test('camera-switch program retains upstream source provenance', () => {
  const source = readFileSync(
    new URL('../../../../vendor/blender-scene-camera/scene.cc', import.meta.url),
  )
  expect(createHash('sha256').update(source).digest('hex')).toBe(sceneCameraSourceHash)
})

for (const [index, sample] of fixtures.samples.entries())
  test(`Blender scene camera switch ${index}: frame ${sample.frame}`, () => {
    const animation = SceneAnimation.parse({
      activeCameraId: 'A',
      cameraMarkers: sample.markers.map((marker) =>
        SceneCameraMarker.parse({ ...marker, name: 'cam_' + marker.frame }),
      ),
    })
    expect(sceneCameraAtFrame(animation, sample.frame, ['A', 'B', 'C'])).toBe(sample.expected)
    expect(
      sceneCameraAtFrame(
        SceneAnimation.parse(JSON.parse(JSON.stringify(animation))),
        sample.frame,
        ['A', 'B', 'C'],
      ),
    ).toBe(sample.expected)
  })

test('missing camera references cannot select deleted cameras', () => {
  const animation = SceneAnimation.parse({
    activeCameraId: 'A',
    cameraMarkers: [{ name: 'deleted', frame: 2, cameraId: 'B' }],
  })
  expect(sceneCameraAtFrame(animation, 4, ['A'])).toBe('A')
  expect(sceneCameraAtFrame(animation, 4, [])).toBeNull()
  expect(sceneCameraAtFrame(SceneAnimation.parse({}), 0, ['A'])).toBeNull()
})
