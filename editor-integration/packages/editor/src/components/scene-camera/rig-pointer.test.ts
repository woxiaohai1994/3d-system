import { afterEach, expect, test } from 'bun:test'
import { bindRigPickMotion, resetRigPickMotion, rigPickNearest } from './rig-pointer'

afterEach(resetRigPickMotion)

function surface(left = 0) {
  const canvas = new EventTarget() as HTMLCanvasElement
  canvas.getBoundingClientRect = () => ({ left, top: 0, height: 500 }) as DOMRect
  return canvas
}

test('cursor cycling uses the previous pick and resets after leaving or changing regions', () => {
  resetRigPickMotion()
  const canvas = surface(),
    other = surface(600)
  const unbind = bindRigPickMotion(canvas)
  const position = { clientX: 100, clientY: 100 }
  expect(rigPickNearest(canvas, position)).toBe(true)
  expect(rigPickNearest(canvas, position)).toBe(false)
  expect(rigPickNearest(canvas, { clientX: 102, clientY: 100 })).toBe(false)
  expect(rigPickNearest(canvas, { clientX: 103, clientY: 102 })).toBe(true)
  canvas.dispatchEvent(new Event('pointerleave'))
  expect(rigPickNearest(canvas, { clientX: 103, clientY: 102 })).toBe(true)
  expect(rigPickNearest(other, { clientX: 703, clientY: 102 })).toBe(true)
  expect(rigPickNearest(canvas, { clientX: 103, clientY: 102 })).toBe(true)
  unbind()
})
