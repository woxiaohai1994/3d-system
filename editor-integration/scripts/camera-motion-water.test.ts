import { afterEach, expect, test } from 'bun:test'
import { sampleScenePlayback } from '@pascal-app/core'
import type { Mesh, NodeMaterial, RenderTarget, WebGPURenderer } from 'three/webgpu'
import { PoolWaterEffect } from '../node_modules/@pascal-app/plugin-pool/src/shader/water-effect'
import { WaterfallBubbleCloudEffect } from '../node_modules/@pascal-app/plugin-pool/src/shader/waterfall-effect'

afterEach(() => sampleScenePlayback(null))

function solverProbe(effect: PoolWaterEffect) {
  const state = effect as unknown as {
    clearMaterial: NodeMaterial
    dropMaterial: NodeMaterial
    dropCenter: { value: { toArray(): number[] } }
    dropRadius: { value: number }
    dropStrength: { value: number }
    time: { value: number }
    motionTime: { value: number }
  }
  let target: RenderTarget | null = null
  const passes: Array<string | number[]> = []
  const renderer = {
    autoClear: false,
    getRenderTarget: () => target,
    setRenderTarget: (value: RenderTarget | null) => {
      target = value
    },
    render: (mesh: Mesh) =>
      passes.push(
        mesh.material === state.clearMaterial
          ? 'clear'
          : mesh.material === state.dropMaterial
            ? [
                ...state.dropCenter.value.toArray(),
                state.dropRadius.value,
                state.dropStrength.value,
              ]
            : 'step',
      ),
  } as unknown as WebGPURenderer
  return { renderer, passes, state }
}

test('water replays identical solver passes and seeded disturbances at 24/30 fps and backwards seeks', () => {
  const effect = new PoolWaterEffect({ rain: 0.8, breeze: 0.6 }, 16)
  const { renderer, passes, state } = solverProbe(effect)
  try {
    effect.update(renderer, 0.04)
    const ordinaryTexture = effect.stateNode.value
    const ordinaryTime = state.time.value
    passes.length = 0
    sampleScenePlayback(0)
    for (let frame = 0; frame <= 144; frame++) effect.sample(renderer, frame / 24)
    const first = [...passes]
    const finalTime = state.motionTime.value
    expect(first.filter(Array.isArray).length).toBeGreaterThan(100)
    expect(effect.stateNode.value).not.toBe(ordinaryTexture)
    const count = passes.length
    effect.update(renderer, 99)
    effect.sample(renderer, 6)
    expect(passes).toHaveLength(count)
    passes.length = 0
    for (let frame = 0; frame <= 180; frame++) effect.sample(renderer, frame / 30)
    expect(passes).toEqual(first)
    expect(state.time.value).toBe(6)
    expect(state.motionTime.value).toBe(finalTime)
    effect.sample(renderer, null)
    expect(effect.stateNode.value).toBe(ordinaryTexture)
    expect(state.time.value).toBe(ordinaryTime)
    expect(renderer.autoClear).toBe(false)
    expect(renderer.getRenderTarget()).toBeNull()
  } finally {
    effect.dispose()
  }
})

test('water releases replay targets when restoring and both target pairs on disposal', () => {
  const effect = new PoolWaterEffect({}, 16)
  const { renderer } = solverProbe(effect)
  const state = effect as unknown as { read: RenderTarget; write: RenderTarget }
  let disposed = 0
  state.read.addEventListener('dispose', () => disposed++)
  state.write.addEventListener('dispose', () => disposed++)
  effect.sample(renderer, 1)
  state.read.addEventListener('dispose', () => disposed++)
  state.write.addEventListener('dispose', () => disposed++)
  effect.sample(renderer, null)
  expect(disposed).toBe(2)
  effect.dispose()
  expect(disposed).toBe(4)
})

test('bubble instances seek directly, hold through ordinary ticks, and restore their ordinary phase', () => {
  const effect = new WaterfallBubbleCloudEffect({}, 1, 'foam', 1)
  effect.addParticle({
    x: 0,
    surfaceY: 0,
    z: 0,
    radius: 0.2,
    phase: 0.1,
    driftX: 0.1,
    driftZ: 0.2,
    shapeX: 1,
    shapeY: 1,
    shapeZ: 1,
    wobble: 0.1,
    frequency: 1,
    speedJitter: 1,
    tint: 0.2,
  })
  try {
    effect.update(0.03)
    const ordinary = Array.from(effect.mesh.instanceMatrix.array)
    sampleScenePlayback(4)
    effect.sample(4)
    const frame = Array.from(effect.mesh.instanceMatrix.array)
    expect(frame).not.toEqual(ordinary)
    effect.update(10)
    expect(Array.from(effect.mesh.instanceMatrix.array)).toEqual(frame)
    effect.sample(0.5)
    expect(Array.from(effect.mesh.instanceMatrix.array)).not.toEqual(frame)
    effect.sample(4)
    expect(Array.from(effect.mesh.instanceMatrix.array)).toEqual(frame)
    effect.sample(null)
    expect(Array.from(effect.mesh.instanceMatrix.array)).toEqual(ordinary)
  } finally {
    effect.dispose()
    effect.mesh.geometry.dispose()
    effect.mesh.dispose()
  }
})
