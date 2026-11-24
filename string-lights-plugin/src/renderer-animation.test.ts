import { expect, test } from 'bun:test'
import { useViewer } from '@pascal-app/viewer'
import { create } from '@react-three/test-renderer'
import { createElement } from 'react'
import { Color, InstancedMesh } from 'three'
import { LightVisual } from './renderer'
import { StringLightNode } from './schema'
import type { LightDisplayMaterial } from './shading'
import { previewBulbEmission, readEffectPlayback } from './effect-playback'

test('mounted lamps keep looping for multiple cycles without selection, panels or input, at every playback rate', async () => {
  const saved = useViewer.getState()
  const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const savedAct = actGlobal.IS_REACT_ACT_ENVIRONMENT
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true
  const periods = {
    steady: 1,
    twinkle: (2 * Math.PI) / 3,
    'slow-fade': 4,
    pulse: Math.PI,
    waves: Math.PI,
    chase: 1.2,
    sequential: 2,
    combination: 56,
  } as const
  try {
    useViewer.setState({ shading: 'solid', textures: true })
    for (const [effect, period] of Object.entries(periods)) {
      for (const playbackRate of [0.1, 1, 4]) {
        const node = StringLightNode.parse({
          effect,
          playbackRate,
          effectSpeed: 0.8,
          distribution: 'count',
          count: 6,
          colors: ['#ff3030', '#2864ff', '#ffffff'],
          colorRule: 'sequence',
        })
        const renderer = await create(createElement(LightVisual, { node }))
        try {
          let bulb: InstancedMesh | undefined
          renderer.scene.instance.traverse((object) => {
            if (object instanceof InstancedMesh && object.geometry.hasAttribute('lightEmission'))
              bulb = object
          })
          expect(bulb).toBeDefined()
          expect((bulb!.material as LightDisplayMaterial).emissiveNode).toBeTruthy()
          const values = () => Array.from(bulb!.geometry.getAttribute('lightEmission').array)
          const original = values(),
            originalColors = Array.from(bulb!.instanceColor!.array)
          const quarter = period / (node.effectSpeed * playbackRate) / 4
          const comparePreview = () => {
            const frame = readEffectPlayback(node.id, node)!
            expect(frame).toBeDefined()
            const actual = values()
            frame.bulbs.forEach((lamp, i) => {
              const expected = new Color(lamp.color)
                .multiplyScalar(previewBulbEmission(node, lamp, i, frame.time))
                .toArray()
              expected.forEach((v, channel) => expect(actual[i * 3 + channel]!).toBeCloseTo(v, 5))
            })
          }
          comparePreview()
          for (let cycle = 0; cycle < 3; cycle++) {
            await renderer.advanceFrames(8, quarter / 8)
            if (effect !== 'steady') expect(values()).not.toEqual(original)
            comparePreview()
            await renderer.advanceFrames(24, quarter / 8)
            values().forEach((v, i) => expect(v).toBeCloseTo(original[i]!, 5))
            comparePreview()
          }
          expect(Array.from(bulb!.instanceColor!.array)).toEqual(originalColors)
        } finally {
          await renderer.unmount()
          expect(readEffectPlayback(node.id, node)).toBeUndefined()
        }
      }
    }
  } finally {
    useViewer.setState({ shading: saved.shading, textures: saved.textures })
    actGlobal.IS_REACT_ACT_ENVIRONMENT = savedAct
  }
})
