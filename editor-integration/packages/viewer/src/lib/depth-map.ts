import {
  type Camera,
  Color,
  DoubleSide,
  LinearSRGBColorSpace,
  NoBlending,
  NoToneMapping,
  type Scene,
} from 'three'
import { positionView, uniform, vec4 } from 'three/tsl'
import { MeshBasicNodeMaterial, type WebGPURenderer } from 'three/webgpu'
import { DEFAULT_DEPTH_RANGE, type DepthRange } from './depth-range'
import { SCENE_LAYER } from './layers'

export class DepthMapRenderer {
  readonly near = uniform(DEFAULT_DEPTH_RANGE.near)
  readonly far = uniform(DEFAULT_DEPTH_RANGE.far)
  readonly material = new MeshBasicNodeMaterial({
    blending: NoBlending,
    depthWrite: true,
    fog: false,
    side: DoubleSide,
    forceSinglePass: true,
    toneMapped: false,
  })
  private readonly clearColor = Object.assign(new Color(), { a: 1 })

  constructor() {
    // View-space Z is linear for both perspective and orthographic cameras.
    // A fragment override also excludes vertex/instance colours and emission.
    const gray = positionView.z
      .negate()
      .sub(this.near)
      .div(this.far.sub(this.near))
      .clamp()
      .oneMinus()
    this.material.fragmentNode = vec4(gray, gray, gray, 1)
    this.material.lights = false
  }

  render(renderer: WebGPURenderer, scene: Scene, camera: Camera, range: DepthRange) {
    this.near.value = range.near
    this.far.value = range.far
    const { overrideMaterial, background, backgroundNode, fog, fogNode } = scene
    const { toneMapping, outputColorSpace } = renderer
    const shadowEnabled = renderer.shadowMap.enabled
    const layerMask = camera.layers.mask
    const clearAlpha = renderer.getClearAlpha()
    const renderObject = renderer.getRenderObjectFunction()
    renderer.getClearColor(this.clearColor)

    try {
      renderer.setRenderObjectFunction((...args) => {
        const material = args[4]
        // Invisible picking surfaces must not become opaque under the override.
        if (
          !material.visible ||
          !material.colorWrite ||
          (material.transparent && material.opacity <= 0)
        ) {
          return
        }
        ;(renderObject ?? renderer.renderObject).call(renderer, ...args)
      })
      scene.overrideMaterial = this.material
      scene.background = null
      scene.backgroundNode = null
      scene.fog = null
      scene.fogNode = null
      camera.layers.set(SCENE_LAYER)
      renderer.shadowMap.enabled = false
      renderer.toneMapping = NoToneMapping
      renderer.outputColorSpace = LinearSRGBColorSpace
      renderer.setClearColor(0, 1)
      renderer.render(scene, camera)
    } finally {
      renderer.setRenderObjectFunction(renderObject)
      scene.overrideMaterial = overrideMaterial
      scene.background = background
      scene.backgroundNode = backgroundNode
      scene.fog = fog
      scene.fogNode = fogNode
      camera.layers.mask = layerMask
      renderer.shadowMap.enabled = shadowEnabled
      renderer.toneMapping = toneMapping
      renderer.outputColorSpace = outputColorSpace
      renderer.setClearColor(this.clearColor, clearAlpha)
    }
  }

  dispose() {
    this.material.dispose()
  }
}
