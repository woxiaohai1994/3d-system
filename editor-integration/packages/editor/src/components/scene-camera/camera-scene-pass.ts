import type { Camera, Scene } from 'three'
import { PassNode } from 'three/webgpu'

export class CameraScenePass extends PassNode {
  private outputWidth = 1280
  private outputHeight = 720

  constructor(scene: Scene, camera: Camera) {
    super(PassNode.COLOR, scene, camera)
  }

  setOutputSize(width: number, height: number) {
    this.outputWidth = width
    this.outputHeight = height
    this.setSize(width, height)
  }

  override setSize(_width: number, _height: number) {
    // PassNode otherwise reuses the main viewport dimensions on every draw.
    super.setSize(this.outputWidth, this.outputHeight)
  }
}
