import { BlenderRigRequest, CameraRig } from '../packages/core/src/schema/camera-rig'
import { SceneCameraNode } from '../packages/core/src/schema/nodes/scene-camera'
import { evaluateSourceCameraRig } from '../packages/viewer/src/lib/add-camera-rigs-runtime'
import { applyBlenderRigResult } from '../packages/viewer/src/lib/blender-camera-rig'
import {
  applySceneCameraProjection,
  sceneCameraWorldPose,
} from '../packages/editor/src/components/scene-camera/camera-math'
import { cameraApertureRadius } from '../packages/editor/src/components/scene-camera/camera-aperture'
import { CameraAperturePass } from '../packages/editor/src/components/scene-camera/camera-aperture-pass'
import { cameraPixels } from '../packages/editor/src/components/scene-camera/pixels'
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NoToneMapping,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
} from 'three'
import { RenderPipeline, RenderTarget, WebGPURenderer } from 'three/webgpu'

type Case = {
  name: string
  request: unknown
  width: number
  height: number
  cards: { vertices: number[][]; indices: number[]; reference: string; expectedEdgeWidth: number }[]
}
const fixtures: Case[] = await fetch('/cases.json').then((r) => r.json())
const button = document.querySelector<HTMLButtonElement>('#run')!
const status = document.querySelector<HTMLElement>('#status')!
const select = document.querySelector<HTMLSelectElement>('#case')!
const sampleSelect = document.querySelector<HTMLSelectElement>('#samples')!
const output = document.querySelector<HTMLElement>('#output')!
for (const fixture of fixtures) {
  const option = document.createElement('option')
  option.value = fixture.name
  option.textContent = fixture.name
  select.appendChild(option)
}

function edgeWidth(pixels: Uint8ClampedArray, width: number, height: number) {
  const profile = new Array<number>(width).fill(0)
  const row = Math.floor(height / 2)
  for (let y = row - 24; y < row + 24; y++)
    for (let x = 0; x < width; x++) {
      const srgb = pixels[(y * width + x) * 4]! / 255
      profile[x]! += (srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4) / 48
    }
  const crossing = (level: number) => {
    let nearest = NaN,
      distance = Infinity
    for (let x = 0; x < width - 1; x++)
      if (profile[x]! >= level && profile[x + 1]! < level && Math.abs(x - width / 2) < distance) {
        distance = Math.abs(x - width / 2)
        nearest = x + (profile[x]! - level) / (profile[x]! - profile[x + 1]!)
      }
    if (!Number.isFinite(nearest)) throw new Error(`画面亮度不足以测量 ${level} 边缘`)
    return nearest
  }
  return crossing(0.1) - crossing(0.9)
}

button.onclick = async () => {
  const apertureSamples = Number(sampleSelect.value)
  button.disabled = true
  output.replaceChildren()
  const renderer = new WebGPURenderer({ antialias: true })
  renderer.toneMapping = NoToneMapping
  renderer.setPixelRatio(1)
  const results = []
  try {
    await renderer.init()
    const chosen = fixtures.filter((f) => !select.value || f.name === select.value)
    let completed = 0
    for (const fixture of chosen) {
      // Inputs contain authored bones and shared card geometry, never evaluated Blender matrices.
      const request = BlenderRigRequest.parse(fixture.request)
      const rig = CameraRig.parse({
        type: request.type,
        tracking: request.tracking,
        native: {
          source: 'add-camera-rigs@1.9.0',
          placement: new Matrix4().toArray(),
          sensorWidth: request.sensorWidth,
          bones: request.bones,
        },
      })
      const evaluated = evaluateSourceCameraRig(request)
      const pose = applyBlenderRigResult(
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          verticalFov: 50,
          orthographicHeight: request.orthographicHeight,
          orbitDistance: 10,
        },
        rig,
        evaluated,
      )
      const frame = SceneCameraNode.parse({
        ...pose,
        projection: request.projection,
        frameAspect: request.aspect,
        focalLength: evaluated.lens,
        aperture: evaluated.aperture,
        near: 0.1,
        far: 1000,
      })
      const camera =
        request.projection === 'perspective' ? new PerspectiveCamera() : new OrthographicCamera()
      camera.coordinateSystem = renderer.coordinateSystem
      const world = sceneCameraWorldPose(pose)
      camera.position.copy(world.position)
      camera.quaternion.copy(world.quaternion)
      camera.updateMatrixWorld()
      applySceneCameraProjection(camera, { ...frame, viewCorrection: world.viewCorrection })
      const scene = new Scene()
      scene.background = new Color(0)
      const pass = new CameraAperturePass(scene, camera)
      pass.setOutputSize(fixture.width, fixture.height)
      pass.viewCorrection.fromArray(world.viewCorrection)
      pass.focusDistance = evaluated.focusDistance
      pass.apertureRadius = cameraApertureRadius(
        request.projection,
        evaluated.lens,
        evaluated.aperture,
      )
      pass.sampleCount = apertureSamples
      const pipeline = new RenderPipeline(renderer, pass.getTextureNode())
      const target = new RenderTarget(fixture.width, fixture.height, { depthBuffer: false })
      renderer.setSize(fixture.width, fixture.height)
      try {
        for (const [index, card] of fixture.cards.entries()) {
          const geometry = new BufferGeometry()
          geometry.setAttribute('position', new Float32BufferAttribute(card.vertices.flat(), 3))
          geometry.setIndex(card.indices)
          const material = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide })
          const mesh = new Mesh(geometry, material)
          scene.add(mesh)
          const start = performance.now()
          renderer.setRenderTarget(target)
          pipeline.render()
          const pixels = await renderer.readRenderTargetPixelsAsync(
            target,
            0,
            0,
            fixture.width,
            fixture.height,
          )
          const rgba = cameraPixels(
            new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
            fixture.width,
            fixture.height,
            (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend === true,
          )
          const canvas = document.createElement('canvas')
          canvas.width = fixture.width
          canvas.height = fixture.height
          canvas
            .getContext('2d')!
            .putImageData(new ImageData(rgba, fixture.width, fixture.height), 0, 0)
          const measured = edgeWidth(rgba, fixture.width, fixture.height)
          const result = {
            name: fixture.name,
            index,
            apertureSamples,
            measuredEdgeWidth: measured,
            expectedEdgeWidth: card.expectedEdgeWidth,
            pixelError: Math.abs(measured - card.expectedEdgeWidth),
            milliseconds: performance.now() - start,
            backend: renderer.backend.constructor.name,
          }
          results.push(result)
          const row = document.createElement('section')
          const label = document.createElement('h2')
          label.textContent = `${fixture.name} · ${['近处', '焦平面', '远处'][index]} · ${apertureSamples} 个光圈样本 · 宽度误差 ${result.pixelError.toFixed(3)} px`
          const image = document.createElement('img')
          image.src = card.reference
          image.alt = 'Blender 原生景深'
          canvas.setAttribute('aria-label', '系统实际 GPU 景深')
          row.append(label, image, canvas)
          output.appendChild(row)
          const saved = await fetch('/result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...result, png: canvas.toDataURL('image/png') }),
          })
          if (!saved.ok) throw new Error('保存对照结果失败')
          scene.remove(mesh)
          geometry.dispose()
          material.dispose()
          status.textContent = `已完成 ${++completed}/${chosen.length * 3} · ${apertureSamples} 个光圈样本 · ${result.backend}`
          await new Promise(requestAnimationFrame)
        }
      } finally {
        renderer.setRenderTarget(null)
        pipeline.dispose()
        pass.dispose()
        target.dispose()
      }
    }
    const max = Math.max(...results.map((r) => r.pixelError))
    status.textContent = `对照完成：${results.length} 项，${apertureSamples} 个光圈样本，最大宽度误差 ${max.toFixed(3)} px。结果已保存到 samples-${apertureSamples}。`
    status.dataset.pass = String(max < 2)
  } catch (error) {
    status.textContent = `渲染失败：${error instanceof Error ? error.message : String(error)}`
    status.dataset.pass = 'false'
    console.error(error)
  } finally {
    renderer.dispose()
    button.disabled = false
  }
}
