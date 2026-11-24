import type { FilmFrameResult, FilmSample } from '@pascal-app/core'

export async function compositeFilmFrame(
  frame: FilmFrameResult,
  size: { width: number; height: number },
  render: (sample: FilmSample) => Promise<CanvasImageSource>,
) {
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('无法创建成片画布')
  context.fillStyle = '#000'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.globalCompositeOperation = 'lighter'
  for (const sample of frame.samples) {
    if (sample.black || sample.weight <= 0) continue
    // Consume each readback before sampling the next time in the shared world.
    const source = await render(sample)
    context.globalAlpha = sample.weight
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
  }
  context.globalAlpha = 1
  context.globalCompositeOperation = 'source-over'
  return canvas
}
