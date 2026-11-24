import { expect, test } from 'bun:test'
import { cameraOverlayPixels, cameraPixels } from './pixels'

test('GPU padded rows are stripped without flipping; WebGL rows are flipped', () => {
  const gpu = new Uint8Array(512)
  gpu.set([1, 2, 3, 255], 0)
  gpu.set([4, 5, 6, 255], 256)
  expect([...cameraPixels(gpu, 1, 2, true)]).toEqual([1, 2, 3, 255, 4, 5, 6, 255])
  expect([...cameraPixels(new Uint8Array([4, 5, 6, 255, 1, 2, 3, 255]), 1, 2, false)]).toEqual([
    1, 2, 3, 255, 4, 5, 6, 255,
  ])
})
test('GPU tightly packed readbacks remain supported', () => {
  expect([...cameraPixels(new Uint8Array([1, 2, 3, 255]), 1, 1, true)]).toEqual([1, 2, 3, 255])
})

test('arbitrary viewport widths decode WebGPU buffers without last-row padding', () => {
  const width = 892,
    height = 3
  const rowBytes = width * 4
  const stride = Math.ceil(rowBytes / 256) * 256
  const pixels = new Uint8Array((height - 1) * stride + rowBytes)
  for (let row = 0; row < height; row++) pixels.fill(row + 1, row * stride, row * stride + rowBytes)
  const output = cameraPixels(pixels, width, height, true)
  for (let row = 0; row < height; row++) {
    expect(
      output.slice(row * rowBytes, (row + 1) * rowBytes).every((value) => value === row + 1),
    ).toBe(true)
  }
})

test('transparent widget edges retain their color when composited by the browser', () => {
  const pixels = new Uint8Array([32, 64, 128, 128, 0, 0, 0, 0, 64, 128, 255, 255])
  expect([...cameraOverlayPixels(pixels, 3, 1, true)]).toEqual([
    64, 128, 255, 128, 0, 0, 0, 0, 64, 128, 255, 255,
  ])
  expect([...cameraPixels(pixels, 3, 1, true)]).toEqual([...pixels])
})
