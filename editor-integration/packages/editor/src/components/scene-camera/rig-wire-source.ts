// SPDX-FileCopyrightText: 2024 Blender Authors, 2026 Pascal Authors
// SPDX-License-Identifier: GPL-2.0-or-later
import source from './rig-wire-source.json'

export type SourceRigClip = readonly [number, number, number, number]
export type SourceRigWireStyle = {
  wireWidth: number
  pixelSize: number
  themeEdgeWidth?: number
  smooth?: boolean
}
export type SourceRigWireViewport = { width: number; height: number }
export type SourceRigWireQuad = {
  clip: Float32Array
  edge: Float32Array
  width: number
}

type Exports = {
  memory: WebAssembly.Memory
  wire_quad: (...args: number[]) => number
  wire_result: () => number
  wire_width: (...args: number[]) => number
  wire_alpha: (...args: number[]) => number
  wire_smooth_start: () => number
  wire_smooth_end: () => number
}
let instance: Exports | undefined
function api() {
  instance ??= new WebAssembly.Instance(
    new WebAssembly.Module(Uint8Array.from(atob(source.wasm), (c) => c.charCodeAt(0))),
  ).exports as unknown as Exports
  return instance
}

function styleArguments(style: SourceRigWireStyle) {
  const values = [style.wireWidth, style.pixelSize, style.themeEdgeWidth ?? 1] as const
  if (!values.every(Number.isFinite) || style.wireWidth < 0 || style.pixelSize <= 0)
    throw new RangeError('Invalid Blender wire width or pixel size')
  return values
}

export const sourceRigWireHashes = source.hashes
export function sourceRigWireWidth(style: SourceRigWireStyle) {
  return api().wire_width(...styleArguments(style))
}

export function sourceRigWireQuad(
  a: SourceRigClip,
  b: SourceRigClip,
  viewport: SourceRigWireViewport,
  style: SourceRigWireStyle,
): SourceRigWireQuad | null {
  if (
    ![...a, ...b, viewport.width, viewport.height].every(Number.isFinite) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    throw new RangeError('Invalid Blender wire clip coordinates or viewport')
  const source = api()
  const count = source.wire_quad(
    ...a,
    ...b,
    ...styleArguments(style),
    viewport.width,
    viewport.height,
    Number(style.smooth !== false),
  )
  if (!count) return null
  // Every call reuses the WASM scratch buffer; frozen frames must own their samples.
  const values = new Float32Array(source.memory.buffer, source.wire_result(), 21).slice()
  if (!values.every(Number.isFinite)) return null
  return { clip: values.slice(0, 16), edge: values.slice(16, 20), width: values[20]! }
}

export function sourceRigWireAlpha(edge: number, width: number, smooth = true, opacity = 1) {
  return api().wire_alpha(edge, width, Number(smooth), opacity)
}

export function sourceRigWireSmoothRange() {
  return [api().wire_smooth_start(), api().wire_smooth_end()] as const
}
