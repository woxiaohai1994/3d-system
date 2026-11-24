import { Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene } from 'three'
import { pass } from 'three/tsl'
import { RenderPipeline, RenderTarget, WebGPURenderer } from 'three/webgpu'
import { mergedOutline } from '../src/lib/merged-outline-node'

export async function runOutlineMotionChecks() {
  const rows: { backend: string; group: string; action: string; pass: boolean }[] = []
  for (const forceWebGL of [false, true]) {
    const renderer = new WebGPURenderer({ forceWebGL, antialias: true })
    await renderer.init()
    renderer.setSize(128, 128)
    const backend =
      'isWebGPUBackend' in renderer.backend && renderer.backend.isWebGPUBackend
        ? 'WebGPU'
        : 'WebGL2'
    const camera = new OrthographicCamera(-2, 2, 2, -2, 0.1, 20)
    camera.position.z = 5
    const geometry = new PlaneGeometry(0.5, 0.5)
    const material = new MeshBasicMaterial()
    const silentMaterial = new MeshBasicMaterial({ colorWrite: false, depthWrite: false })
    const scene = new Scene()
    const surface = new Mesh(geometry, material)
    const silentDraw = new Mesh(geometry, silentMaterial)
    silentDraw.position.x = 10
    silentDraw.frustumCulled = false
    silentDraw.renderOrder = 100
    scene.add(surface, silentDraw)
    const producer = pass(scene, camera, { samples: 0 })
    const outline = mergedOutline(scene, camera, {
      primaryObjects: [],
      secondaryObjects: [],
      sceneDepthNode: producer.getTextureNode('depth'),
    })
    const internals = outline as any
    const pipeline = new RenderPipeline(renderer)
    pipeline.outputNode = outline.primaryVisibleEdge.add(outline.secondaryVisibleEdge)
    const drawFrame = () =>
      new Promise<void>((resolve, reject) => {
        renderer.setAnimationLoop(() => {
          renderer.setAnimationLoop(null)
          try {
            pipeline.render()
            resolve()
          } catch (error) {
            reject(error)
          }
        })
      })
    const silentScene = new Scene()
    const silentMesh = new Mesh(geometry, silentMaterial)
    silentScene.add(silentMesh)
    const silentTarget = new RenderTarget(128, 128)
    const leaveColorWriteDisabled = () => {
      const target = renderer.getRenderTarget()
      renderer.setRenderTarget(silentTarget)
      renderer.render(silentScene, camera)
      renderer.setRenderTarget(target)
    }
    const pixel = async (target: RenderTarget, x: number, y: number) =>
      renderer.readRenderTargetPixelsAsync(target, x, y, 1, 1)
    try {
      for (const group of ['选中', '悬停']) {
        const objects = group === '选中' ? outline.primaryObjects : outline.secondaryObjects
        const targets = group === '选中' ? internals._groupA : internals._groupB
        objects.push(surface)
        surface.position.x = -1
        camera.position.x = 0
        await drawFrame()
        const initial = await pixel(targets.maskBuffer, 32, 64)
        rows.push({ backend, group, action: '初始位置', pass: initial[0] === 0 })

        surface.position.x = 1
        await drawFrame()
        const old = await pixel(targets.maskBuffer, 32, 64)
        const moved = await pixel(targets.maskBuffer, 96, 64)
        rows.push({
          backend,
          group,
          action: '模型移动后旧位置清空',
          pass: old[0] === 255 && moved[0] === 0,
        })

        camera.position.x = 1
        await drawFrame()
        const previousView = await pixel(targets.maskBuffer, 96, 64)
        const currentView = await pixel(targets.maskBuffer, 64, 64)
        rows.push({
          backend,
          group,
          action: '视角移动后旧位置清空',
          pass: previousView[0] === 255 && currentView[0] === 0,
        })

        objects.length = 0
        leaveColorWriteDisabled()
        await drawFrame()
        const cleared = await renderer.readRenderTargetPixelsAsync(
          targets.composite,
          0,
          0,
          128,
          128,
        )
        rows.push({
          backend,
          group,
          action: '取消高亮后清空整张轮廓',
          pass: cleared.every((value, index) => index % 4 === 3 || value === 0),
        })
      }
    } finally {
      renderer.setAnimationLoop(null)
      pipeline.dispose()
      outline.dispose()
      producer.dispose()
      silentTarget.dispose()
      geometry.dispose()
      material.dispose()
      silentMaterial.dispose()
      renderer.dispose()
    }
  }
  return rows
}
