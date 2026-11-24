import { expect, test } from 'bun:test'
import { PerspectiveCamera, Scene } from 'three'
import { CameraScenePass } from './camera-scene-pass'

test('camera pass keeps output dimensions when the main viewport changes', () => {
  const pass = new CameraScenePass(new Scene(), new PerspectiveCamera())
  for (const [width, height] of [
    [1280, 720],
    [720, 1280],
    [720, 720],
    [960, 720],
  ] as const) {
    pass.setOutputSize(width, height)
    pass.setSize(2860, 1500)
    expect([pass.renderTarget.width, pass.renderTarget.height]).toEqual([width, height])
    expect(pass.renderTarget.viewport.toArray()).toEqual([0, 0, width, height])
    expect(pass.renderTarget.scissor.toArray()).toEqual([0, 0, width, height])
  }
  pass.dispose()
})
