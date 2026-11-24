// SPDX-License-Identifier: GPL-2.0-or-later
import source from './rig-bbone-source.json'
import type { SourceRigClip } from './rig-wire-source'

type V3 = readonly [number, number, number]
type API = WebAssembly.Exports & {
  memory: WebAssembly.Memory
  bbone_input(): number
  bbone_result(): number
  bbone_outline(width: number, height: number, perspective: number, inverted: number): number
  bbone_shade(...values: number[]): number
  bbone_wire_color(r: number, g: number, b: number, offset: number): number
}
let instance: API | undefined
function api() {
  if (!instance) {
    const bytes = Uint8Array.from(atob(source.wasm), (char) => char.charCodeAt(0))
    instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports as API
  }
  return instance
}

export const sourceBboneBatch = source.arrays
export const sourceBboneHashes = source.hashes
export const sourceBbonePoseFillAlpha = source.poseFillAlpha

export function sourceBoneWireColor(color: readonly number[], offset = -50): number[] {
  const wasm = api()
  const pointer = wasm.bbone_wire_color(color[0]!, color[1]!, color[2]!, offset)
  return [...new Float32Array(wasm.memory.buffer, pointer, 3)]
}

export function sourceBboneShade(normal: V3, hint: V3, solid: V3): number[] {
  const wasm = api()
  const pointer = wasm.bbone_shade(...normal, ...hint, ...solid)
  return [...new Float32Array(wasm.memory.buffer, pointer, 3)]
}

export function sourceBboneOutline(
  points: { view: V3; clip: SourceRigClip }[],
  viewport: { width: number; height: number },
  perspective: boolean,
  inverted: boolean,
): [SourceRigClip, SourceRigClip] | null {
  if (points.length !== 4) throw new RangeError('BBONE outline requires four adjacent vertices')
  const wasm = api()
  new Float32Array(wasm.memory.buffer, wasm.bbone_input(), 28).set(
    points.flatMap((point) => [...point.view, ...point.clip]),
  )
  if (!wasm.bbone_outline(viewport.width, viewport.height, Number(perspective), Number(inverted)))
    return null
  const values = [...new Float32Array(wasm.memory.buffer, wasm.bbone_result(), 8)]
  return values.every(Number.isFinite)
    ? [values.slice(0, 4) as unknown as SourceRigClip, values.slice(4) as unknown as SourceRigClip]
    : null
}
