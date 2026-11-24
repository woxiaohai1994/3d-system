import { expect, test } from 'bun:test'
import { Vector4 } from 'three'
import { uniform } from 'three/tsl'
import * as WebGPU from 'three/webgpu'
import { compositePremultiplied } from './overlay-composite'

type Value = number | number[]
function evaluate(node: WebGPU.Node): Value {
  if (node instanceof WebGPU.VarNode) return evaluate(node.node)
  if (node instanceof WebGPU.ConstNode && typeof node.value === 'number') return node.value
  if (node instanceof WebGPU.UniformNode && node.value instanceof Vector4)
    return node.value.toArray()
  if (node instanceof WebGPU.JoinNode) return node.nodes.flatMap((child) => evaluate(child))
  if (node instanceof WebGPU.SplitNode) {
    const value = evaluate(node.node)
    if (!Array.isArray(value)) return value
    const selected = [...node.components].map((component) => value['xyzw'.indexOf(component)]!)
    return selected.length === 1 ? selected[0]! : selected
  }
  if (node instanceof WebGPU.MathNode && node.method === WebGPU.MathNode.ONE_MINUS) {
    const value = evaluate(node.aNode)
    return Array.isArray(value) ? value.map((component) => 1 - component) : 1 - value
  }
  if (node instanceof WebGPU.OperatorNode) {
    const a = evaluate(node.aNode),
      b = evaluate(node.bNode)
    const operation = (x: number, y: number) => {
      if (node.op === '+') return x + y
      if (node.op === '-') return x - y
      if (node.op === '*') return x * y
      throw new Error(`Unexpected shader operation ${node.op}`)
    }
    if (typeof a === 'number' && typeof b === 'number') return operation(a, b)
    const vector = Array.isArray(a) ? a : (b as number[])
    return vector.map((_, i) =>
      operation(Array.isArray(a) ? a[i]! : a, Array.isArray(b) ? b[i]! : b),
    )
  }
  throw new Error(`Unexpected shader node ${node.constructor.name}`)
}

function rgba(r: number, g: number, b: number, a: number) {
  return uniform(new Vector4(r, g, b, a))
}

test('a blended overlay is composited once above an opaque background', () => {
  const result = evaluate(
    compositePremultiplied(rgba(0.5, 0, 0, 0.5), rgba(0.2, 0.2, 0.2, 1)),
  ) as number[]
  for (const [i, expected] of [0.6, 0.1, 0.1, 1].entries())
    expect(result[i]).toBeCloseTo(expected, 12)
})

test('front and ordinary overlay alpha remain correct above a translucent scene', () => {
  const overlays = compositePremultiplied(rgba(0, 0.25, 0, 0.25), rgba(0.5, 0, 0, 0.5))
  const result = evaluate(compositePremultiplied(overlays, rgba(0, 0, 0.2, 0.2))) as number[]
  for (const [i, expected] of [0.375, 0.25, 0.075, 0.7].entries())
    expect(result[i]).toBeCloseTo(expected, 12)
})

test('transparent padding preserves the scene and an opaque front pixel replaces it', () => {
  const scene = rgba(0.2, 0.3, 0.4, 0.6)
  expect(evaluate(compositePremultiplied(rgba(0, 0, 0, 0), scene))).toEqual([0.2, 0.3, 0.4, 0.6])
  expect(evaluate(compositePremultiplied(rgba(0.7, 0.8, 0.9, 1), scene))).toEqual([
    0.7, 0.8, 0.9, 1,
  ])
})
