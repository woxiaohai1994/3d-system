export function cameraPixels(pixels: Uint8Array, width: number, height: number, webGPU: boolean) {
  const rowBytes = width * 4
  const paddedRowBytes = Math.ceil(rowBytes / 256) * 256
  // WebGPU omits alignment padding after the final row.
  const paddedLength = (height - 1) * paddedRowBytes + rowBytes
  const stride = webGPU && pixels.length >= paddedLength ? paddedRowBytes : rowBytes
  const output = new Uint8ClampedArray(rowBytes * height)
  for (let row = 0; row < height; row++) {
    const source = (webGPU ? row : height - row - 1) * stride
    output.set(pixels.subarray(source, source + rowBytes), row * rowBytes)
  }
  return output
}

export function cameraOverlayPixels(
  pixels: Uint8Array,
  width: number,
  height: number,
  webGPU: boolean,
) {
  const output = cameraPixels(pixels, width, height, webGPU)
  // GPU blending over transparent black premultiplies RGB; ImageData expects straight alpha.
  for (let i = 0; i < output.length; i += 4) {
    const alpha = output[i + 3]!
    if (alpha === 0 || alpha === 255) continue
    for (let channel = 0; channel < 3; channel++)
      output[i + channel] = (output[i + channel]! * 255) / alpha
  }
  return output
}
