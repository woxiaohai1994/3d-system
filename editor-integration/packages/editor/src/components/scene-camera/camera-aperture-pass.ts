import {
  AddEquation,
  type Camera,
  Color,
  CustomBlending,
  Matrix4,
  OneFactor,
  type Scene,
} from 'three'
import { texture, uniform } from 'three/tsl'
import {
  type NodeBuilder,
  type NodeFrame,
  NodeMaterial,
  QuadMesh,
  RendererUtils,
} from 'three/webgpu'
import {
  CAMERA_PREVIEW_APERTURE_SAMPLES,
  cameraApertureMatrices,
  cameraApertureSample,
} from './camera-aperture'
import { CameraScenePass } from './camera-scene-pass'

export class CameraAperturePass extends CameraScenePass {
  apertureRadius = 0
  focusDistance = 1
  sampleCount = CAMERA_PREVIEW_APERTURE_SAMPLES
  viewCorrection = new Matrix4()
  private readonly samplePass: CameraScenePass
  private readonly weight = uniform(1)
  private readonly material = new NodeMaterial()
  private readonly quad = new QuadMesh(this.material)

  constructor(scene: Scene, camera: Camera) {
    super(scene, camera)
    this.samplePass = new CameraScenePass(scene, camera)
    this.material.fragmentNode = texture(this.samplePass.renderTarget.texture).mul(this.weight)
    this.material.transparent = true
    this.material.depthTest = false
    this.material.depthWrite = false
    this.material.toneMapped = false
    this.material.blending = CustomBlending
    this.material.blendEquation = AddEquation
    this.material.blendSrc = OneFactor
    this.material.blendDst = OneFactor
    this.material.name = 'Camera aperture accumulation'
  }

  override setup(builder: NodeBuilder) {
    const output = super.setup(builder)
    // Only scene samples need MSAA; the accumulation target must retain each sum.
    this.renderTarget.samples = 0
    this.samplePass.setup(builder)
    return output
  }

  override updateBefore(frame: NodeFrame) {
    if (!(this.apertureRadius > 0)) return super.updateBefore(frame)
    const renderer = frame.renderer!
    const camera = this.camera
    const saved = {
      world: camera.matrixWorld.clone(),
      inverse: camera.matrixWorldInverse.clone(),
      projection: camera.projectionMatrix.clone(),
      projectionInverse: camera.projectionMatrixInverse.clone(),
      autoUpdate: camera.matrixWorldAutoUpdate,
      layers: camera.layers.mask,
    }
    const rendererState = RendererUtils.saveRendererState(renderer)
    const sceneState = RendererUtils.saveSceneState(this.scene as Scene)
    const sceneName = this.scene.name
    const passState = {
      autoClearColor: renderer.autoClearColor,
      autoClearDepth: renderer.autoClearDepth,
      autoClearStencil: renderer.autoClearStencil,
      transparent: renderer.transparent,
      opaque: renderer.opaque,
      contextNode: renderer.contextNode,
    }
    const count = Math.max(2, Math.ceil(this.sampleCount / 2) * 2)
    this.samplePass.setOutputSize(this.renderTarget.width, this.renderTarget.height)
    this.weight.value = 1 / count
    camera.matrixWorldAutoUpdate = false
    try {
      renderer.setRenderTarget(this.renderTarget)
      renderer.setClearColor(new Color(0), 0)
      renderer.clear()
      renderer.setClearColor(rendererState.clearColor, rendererState.clearAlpha)
      for (let i = 0; i < count; i++) {
        const [x, y] = cameraApertureSample(i, count)
        const sample = cameraApertureMatrices(
          saved.world,
          saved.projection,
          this.viewCorrection,
          this.focusDistance,
          x * this.apertureRadius,
          y * this.apertureRadius,
        )
        camera.matrixWorld.copy(sample.world)
        camera.matrixWorldInverse.copy(sample.world).invert()
        camera.projectionMatrix.copy(sample.projection)
        camera.projectionMatrixInverse.copy(sample.projection).invert()
        this.samplePass.updateBefore(frame)
        renderer.setRenderTarget(this.renderTarget)
        renderer.setMRT(null)
        renderer.autoClear = false
        this.quad.render(renderer)
      }
    } finally {
      camera.matrixWorld.copy(saved.world)
      camera.matrixWorldInverse.copy(saved.inverse)
      camera.projectionMatrix.copy(saved.projection)
      camera.projectionMatrixInverse.copy(saved.projectionInverse)
      camera.matrixWorldAutoUpdate = saved.autoUpdate
      camera.layers.mask = saved.layers
      this.scene.name = sceneName
      Object.assign(renderer, passState)
      RendererUtils.restoreSceneState(this.scene as Scene, sceneState)
      RendererUtils.restoreRendererState(renderer, rendererState)
    }
  }

  override dispose() {
    this.samplePass.dispose()
    this.material.dispose()
    super.dispose()
  }
}
