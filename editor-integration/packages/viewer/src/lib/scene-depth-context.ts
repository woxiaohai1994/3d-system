import {
  EqualDepth,
  GreaterDepth,
  GreaterEqualDepth,
  LessDepth,
  LessEqualDepth,
  NeverDepth,
  NotEqualDepth,
} from 'three'
import { builtin, context, Fn, float, materialReference, screenUV, texture } from 'three/tsl'
import type { Node, NodeBuilder, PassNode } from 'three/webgpu'

export function sceneDepthContext(mainPass: PassNode) {
  const sceneDepthNode = mainPass.getTextureNode('depth')
  return context({
    getOutput: (outputNode: Node, builder: NodeBuilder) => {
      const reversed = builder.renderer.reversedDepthBuffer
      const backend = builder.renderer.backend
      const samples =
        'isWebGPUBackend' in backend && backend.isWebGPUBackend === true
          ? Math.max(1, mainPass.renderTarget.samples)
          : 1
      return outputNode.bypass(
        Fn(() => {
          let sceneDepth = sceneDepthNode.sample(screenUV).r
          let offset: Node<'float'> = float(0)
          for (let i = 1; i < samples; i++) {
            offset = offset.add(texture(sceneDepthNode, screenUV, i).r.sub(sceneDepth))
          }
          if (samples > 1) sceneDepth = sceneDepth.add(offset.div(samples))
          // Compare the actual raster depth without an outline-style allowance.
          // These Three declarations omit the scalar generic of returned nodes.
          const fragmentDepth = builtin(
            builder.getFragCoord().replace(/\.xy$/, '.z'),
          ) as unknown as Node<'float'>
          const separation = reversed
            ? sceneDepth.sub(fragmentDepth)
            : fragmentDepth.sub(sceneDepth)
          const depthTest = materialReference('depthTest', 'bool') as unknown as Node<'bool'>
          const depthFunc = materialReference('depthFunc', 'int') as unknown as Node<'int'>
          const rejected = depthFunc
            .equal(NeverDepth)
            .or(depthFunc.equal(LessDepth).and(separation.greaterThanEqual(0)))
            .or(depthFunc.equal(LessEqualDepth).and(separation.greaterThan(0)))
            .or(depthFunc.equal(EqualDepth).and(separation.notEqual(0)))
            .or(depthFunc.equal(GreaterEqualDepth).and(separation.lessThan(0)))
            .or(depthFunc.equal(GreaterDepth).and(separation.lessThanEqual(0)))
            .or(depthFunc.equal(NotEqualDepth).and(separation.equal(0)))
          depthTest.and(rejected).discard()
        })(),
      )
    },
  })
}
