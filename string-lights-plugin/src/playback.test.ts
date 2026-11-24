import { expect, test } from 'bun:test'
import { InstancedMesh } from 'three'
import { buildLightGeometry } from './geometry'
import { parseLightSettings } from './schema'

test('fixed-time light samples survive reverse seeking and ignore edit color transitions', () => {
  const geometry = buildLightGeometry(parseLightSettings({ effect: 'twinkle', sway: 0.2 }))
  const snapshot = () => geometry.group.children.filter((m): m is InstancedMesh => m instanceof InstancedMesh).map(m => ({
    transform: Array.from(m.instanceMatrix.array),
    emission: Array.from(m.geometry.getAttribute('lightEmission')?.array ?? []),
  }))
  geometry.animate(2, 2, true)
  const expected = snapshot()
  geometry.transitionColors(geometry.colors().map(() => '#ff0000'), 50)
  geometry.animate(8, 8, true)
  geometry.animate(0, 0, true)
  geometry.animate(2, 2, true)
  expect(snapshot()).toEqual(expected)
  geometry.dispose()
})
