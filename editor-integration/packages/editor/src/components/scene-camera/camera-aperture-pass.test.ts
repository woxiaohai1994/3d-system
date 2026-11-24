import { expect, test } from 'bun:test'
import {
  type Camera,
  Color,
  HalfFloatType,
  type Object3D,
  PerspectiveCamera,
  RenderTarget,
  Scene,
  type Vector2,
} from 'three'
import { type NodeBuilder, NodeFrame, type Renderer } from 'three/webgpu'
import { CAMERA_OUTPUT_APERTURE_SAMPLES, CAMERA_PREVIEW_APERTURE_SAMPLES } from './camera-aperture'
import { CameraAperturePass } from './camera-aperture-pass'

for (const count of [CAMERA_PREVIEW_APERTURE_SAMPLES, CAMERA_OUTPUT_APERTURE_SAMPLES])
  for (const fail of [false, true])
    test(`aperture pass restores shared camera/renderer state (${count} samples, error=${fail})`, () => {
      const scene = new Scene(),
        camera = new PerspectiveCamera(50, 16 / 9)
      scene.name = 'Main editor scene'
      camera.position.set(2, 3, 4)
      camera.updateMatrixWorld()
      camera.projectionMatrix.elements[8] = 0.2
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
      const original = {
        world: camera.matrixWorld.toArray(),
        projection: camera.projectionMatrix.toArray(),
        inverse: camera.matrixWorldInverse.toArray(),
        projectionInverse: camera.projectionMatrixInverse.toArray(),
      }
      const target = new RenderTarget(1200, 800)
      let activeTarget = target,
        clearColor = new Color(0.2, 0.3, 0.4),
        clearAlpha = 0.7,
        mrt: null = null
      const samples: number[][] = [],
        outputSizes: number[][] = []
      let composites = 0
      const renderer = {
        samples: 4,
        reversedDepthBuffer: false,
        getOutputBufferType: () => HalfFloatType,
        toneMapping: 0,
        toneMappingExposure: 1.3,
        outputColorSpace: 'srgb',
        autoClear: true,
        autoClearColor: false,
        autoClearDepth: false,
        autoClearStencil: false,
        transparent: false,
        opaque: false,
        contextNode: null,
        getDrawingBufferSize: (v: Vector2) => v.set(2400, 1600),
        getOutputRenderTarget: () => null,
        getRenderTarget: () => activeTarget,
        setRenderTarget: (t: RenderTarget) => {
          activeTarget = t
        },
        getActiveCubeFace: () => 0,
        getActiveMipmapLevel: () => 0,
        getRenderObjectFunction: () => null,
        setRenderObjectFunction: () => {},
        getPixelRatio: () => 1,
        setPixelRatio: () => {},
        getMRT: () => mrt,
        setMRT: (v: null) => {
          mrt = v
        },
        getClearColor: (c: Color) => c.copy(clearColor),
        getClearAlpha: () => clearAlpha,
        setClearColor: (c: Color | number, alpha: number) => {
          clearColor = new Color(c)
          clearAlpha = alpha
        },
        getScissorTest: () => false,
        setScissorTest: () => {},
        clear: () => {},
        render: (object: Object3D, sampledCamera: Camera) => {
          if (object === scene) {
            samples.push(sampledCamera.matrixWorld.toArray())
            outputSizes.push([activeTarget.width, activeTarget.height])
            if (fail) throw new Error('GPU test failure')
          } else {
            expect(activeTarget).toBe(pass.renderTarget)
            expect(renderer.autoClear).toBe(false)
            composites++
          }
        },
      }
      const pass = new CameraAperturePass(scene, camera)
      expect(pass.sampleCount).toBe(8)
      pass.setup({ renderer } as unknown as NodeBuilder)
      expect(pass.renderTarget.samples).toBe(0)
      pass.setOutputSize(640, 360)
      pass.apertureRadius = 0.04
      pass.focusDistance = 5
      pass.sampleCount = count
      const frame = new NodeFrame()
      frame.renderer = renderer as unknown as Renderer
      try {
        if (fail) expect(() => pass.updateBefore(frame)).toThrow('GPU test failure')
        else {
          pass.updateBefore(frame)
          expect(samples).toHaveLength(count)
          expect(composites).toBe(count)
          expect(new Set(samples.map((m) => m.join(','))).size).toBe(count)
        }
        for (const size of outputSizes) expect(size).toEqual([640, 360])
        expect(camera.matrixWorld.toArray()).toEqual(original.world)
        expect(camera.matrixWorldInverse.toArray()).toEqual(original.inverse)
        expect(camera.projectionMatrix.toArray()).toEqual(original.projection)
        expect(camera.projectionMatrixInverse.toArray()).toEqual(original.projectionInverse)
        expect(camera.matrixWorldAutoUpdate).toBe(true)
        expect(scene.name).toBe('Main editor scene')
        expect(activeTarget).toBe(target)
        expect(clearColor.toArray()).toEqual([0.2, 0.3, 0.4])
        expect(clearAlpha).toBe(0.7)
        expect(renderer).toMatchObject({
          autoClear: true,
          autoClearColor: false,
          autoClearDepth: false,
          autoClearStencil: false,
          transparent: false,
          opaque: false,
        })
      } finally {
        pass.dispose()
        target.dispose()
      }
    })
