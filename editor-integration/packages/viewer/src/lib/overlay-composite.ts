import { vec4 } from 'three/tsl'
import type { Node } from 'three/webgpu'

export function compositePremultiplied(above: Node<'vec4'>, below: Node<'vec4'>) {
  const remaining = above.a.oneMinus()
  return vec4(above.rgb.add(below.rgb.mul(remaining)), above.a.add(below.a.mul(remaining)))
}
