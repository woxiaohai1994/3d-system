import type { Camera, Scene } from 'three'
import { context } from 'three/tsl'
import { type Node, RendererUtils, type WebGPURenderer } from 'three/webgpu'
import { IN_FRONT_LAYER } from './layers'

export const inFrontContext = context({ getOutput: (output: Node) => output })

type NodeScene = Scene & { backgroundNode?: Node | null }

export function renderWithInFrontLayer(renderer: WebGPURenderer, scene: Scene, camera: Camera) {
  if (!camera.layers.isEnabled(IN_FRONT_LAYER)) {
    renderer.render(scene, camera)
    return
  }
  const savedRenderer = RendererUtils.saveRendererState(renderer)
  const savedScene = RendererUtils.saveSceneState(scene)
  const mask = camera.layers.mask
  const previousContext = renderer.contextNode
  const clearDepth = renderer.getClearDepth()
  try {
    renderer.setMRT(null)
    camera.layers.disable(IN_FRONT_LAYER)
    renderer.render(scene, camera)
    camera.layers.set(IN_FRONT_LAYER)
    scene.background = null
    ;(scene as NodeScene).backgroundNode = null
    scene.overrideMaterial = null
    renderer.contextNode = inFrontContext
    renderer.autoClear = false
    renderer.setClearDepth(1)
    // Clear once for the whole layer so front objects still occlude one another.
    renderer.clear(false, true, false)
    renderer.render(scene, camera)
  } finally {
    camera.layers.mask = mask
    renderer.contextNode = previousContext
    renderer.setClearDepth(renderer.reversedDepthBuffer ? 1 - clearDepth : clearDepth)
    RendererUtils.restoreRendererState(renderer, savedRenderer)
    RendererUtils.restoreSceneState(scene, savedScene)
  }
}
