export function viewportFrameRect(
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  crop = false,
) {
  const scale = (crop ? Math.max : Math.min)(width / sourceWidth, height / sourceHeight)
  const drawnWidth = sourceWidth * scale
  const drawnHeight = sourceHeight * scale
  return {
    x: (width - drawnWidth) / 2,
    y: (height - drawnHeight) / 2,
    width: drawnWidth,
    height: drawnHeight,
  }
}
