import { expect, test } from 'bun:test'
import NodeFrame from 'three/src/nodes/core/NodeFrame.js'
import DirectionalLightNode from 'three/src/nodes/lighting/DirectionalLightNode.js'
import { type Color, DirectionalLight, type WebGPURenderer } from 'three/webgpu'
import { beginMotionRenderFrame } from './motion-render-frame'

test('offline captures refresh Three light uniforms even within the same browser animation tick', () => {
  const frame = new NodeFrame()
  frame.frameId = 1
  frame.time = 0.5
  const renderer = { _nodes: { nodeFrame: frame }, info: { frame: 1 } } as unknown as WebGPURenderer
  frame.renderer = renderer
  const light = new DirectionalLight('#ffffff', 0.4)
  const node = new DirectionalLightNode(light) as DirectionalLightNode & { color: Color }
  frame.updateNode(node)
  expect(node.color.r).toBeCloseTo(0.4)
  light.intensity = 2
  frame.updateNode(node)
  expect(node.color.r).toBeCloseTo(0.4)
  beginMotionRenderFrame(renderer)
  frame.updateNode(node)
  expect(node.color.r).toBeCloseTo(2)
  light.intensity = 0.1
  beginMotionRenderFrame(renderer)
  frame.updateNode(node)
  expect(node.color.r).toBeCloseTo(0.1)
  expect(frame.time).toBe(0.5)
  node.dispose()
  light.dispose()
})
