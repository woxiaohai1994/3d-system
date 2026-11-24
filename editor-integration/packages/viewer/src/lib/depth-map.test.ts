// @ts-expect-error — Bun test types are not part of the viewer declaration build.
import { describe, expect, test } from 'bun:test'
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  Color,
  Fog,
  Mesh,
  MeshStandardMaterial,
  NoToneMapping,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
} from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import useViewer from '../store/use-viewer'
import { DepthMapRenderer } from './depth-map'
import { normalizeDepthRange } from './depth-range'
import { GRID_LAYER, OVERLAY_LAYER, SCENE_LAYER } from './layers'

describe('depth view', () => {
  for (const CameraType of [PerspectiveCamera, OrthographicCamera]) {
    for (const fail of [false, true]) {
      test(`${CameraType.name} restores shared render state after ${fail ? 'failure' : 'drawing'}`, () => {
        const scene = new Scene()
        const material = new MeshStandardMaterial({ color: 'red' })
        const mesh = new Mesh(new BoxGeometry(), material)
        scene.add(mesh)
        const background = new Color('blue')
        const fog = new Fog('green', 1, 100)
        scene.background = background
        scene.fog = fog
        const camera = new CameraType()
        camera.layers.enable(GRID_LAYER)
        camera.layers.enable(OVERLAY_LAYER)
        const mask = camera.layers.mask
        const depth = new DepthMapRenderer()
        const clearColor = new Color('yellow')
        let clearAlpha = 0.4
        let draws = 0
        const pickingMaterial = new MeshStandardMaterial({ colorWrite: false })
        const hiddenMaterial = new MeshStandardMaterial({ transparent: true, opacity: 0 })
        const translucentMaterial = new MeshStandardMaterial({ transparent: true, opacity: 0.5 })
        const renderedMaterials: MeshStandardMaterial[] = []
        const originalRenderObject: NonNullable<
          ReturnType<WebGPURenderer['getRenderObjectFunction']>
        > = (...args) => {
          renderedMaterials.push(args[4] as MeshStandardMaterial)
        }
        let renderObject: ReturnType<WebGPURenderer['getRenderObjectFunction']> =
          originalRenderObject
        const renderer = {
          getRenderObjectFunction: () => renderObject,
          setRenderObjectFunction: (callback: typeof renderObject) => {
            renderObject = callback
          },
          toneMapping: ACESFilmicToneMapping,
          outputColorSpace: SRGBColorSpace,
          shadowMap: { enabled: true },
          getClearAlpha: () => clearAlpha,
          getClearColor: (target: Color) => target.copy(clearColor),
          setClearColor: (value: Color | number, alpha: number) => {
            clearColor.set(value)
            clearAlpha = alpha
          },
          render: () => {
            draws++
            expect(scene.overrideMaterial).toBe(depth.material)
            expect(scene.background).toBeNull()
            expect(scene.fog).toBeNull()
            expect(camera.layers.mask).toBe(1 << SCENE_LAYER)
            expect(renderer.shadowMap.enabled).toBe(false)
            expect(renderer.toneMapping).toBe(NoToneMapping)
            expect(clearColor.getHex()).toBe(0)
            expect(clearAlpha).toBe(1)
            for (const source of [material, pickingMaterial, hiddenMaterial, translucentMaterial]) {
              const args = [
                mesh,
                scene,
                camera,
                mesh.geometry,
                source,
                null,
                undefined,
                undefined,
              ] as unknown as Parameters<typeof originalRenderObject>
              renderObject?.(...args)
            }
            expect(renderedMaterials).toEqual([material, translucentMaterial])
            if (fail) throw new Error('draw failed')
          },
        }
        const draw = () =>
          depth.render(renderer as unknown as WebGPURenderer, scene, camera, { near: 2, far: 30 })
        if (fail) expect(draw).toThrow('draw failed')
        else draw()
        expect(draws).toBe(1)
        expect(depth.near.value).toBe(2)
        expect(depth.far.value).toBe(30)
        expect(mesh.material).toBe(material)
        expect(material.color.getHex()).toBe(0xff0000)
        expect(scene.overrideMaterial).toBeNull()
        expect(scene.background).toBe(background)
        expect(scene.fog).toBe(fog)
        expect(camera.layers.mask).toBe(mask)
        expect(renderer.shadowMap.enabled).toBe(true)
        expect(renderer.toneMapping).toBe(ACESFilmicToneMapping)
        expect(renderer.outputColorSpace).toBe(SRGBColorSpace)
        expect(clearColor.getHex()).toBe(0xffff00)
        expect(clearAlpha).toBe(0.4)
        expect(renderObject).toBe(originalRenderObject)
        depth.dispose()
        material.dispose()
        pickingMaterial.dispose()
        hiddenMaterial.dispose()
        translucentMaterial.dispose()
        mesh.geometry.dispose()
      })
    }
  }

  test('rejects corrupt preferences and keeps a finite nonzero depth interval', () => {
    expect(normalizeDepthRange(undefined)).toEqual({ near: 0, far: 50 })
    expect(normalizeDepthRange({ near: NaN, far: Infinity })).toEqual({ near: 0, far: 50 })
    expect(normalizeDepthRange({ near: -3, far: 0 })).toEqual({ near: 0, far: 0.1 })
    const range = normalizeDepthRange({ near: 20, far: 10 })
    expect(range.far).toBeGreaterThan(range.near)
    expect(normalizeDepthRange({ near: 20000, far: 30000 })).toEqual({ near: 9999, far: 10000 })
  })

  test('mode changes preserve lighting, scene selection, and the previous texture preference', () => {
    const original = useViewer.getState()
    try {
      original.setModelAppearance('clay')
      original.setModelAppearance('depth')
      expect(useViewer.getState()).toMatchObject({ depthMode: true, textures: false })
      original.setDepthMode(false)
      expect(useViewer.getState()).toMatchObject({ depthMode: false, textures: false })
      original.setModelAppearance('depth')
      original.setModelAppearance('materials')
      expect(useViewer.getState()).toMatchObject({ depthMode: false, textures: true })
      expect(useViewer.getState().selection).toBe(original.selection)
      expect(useViewer.getState().shading).toBe(original.shading)
      expect(useViewer.getState().shadows).toBe(original.shadows)
      expect(useViewer.getState().edges).toBe(original.edges)
    } finally {
      useViewer.setState(original)
    }
  })
})
