import {
  BackSide,
  Color,
  DoubleSide,
  FrontSide,
  InstancedMesh,
  LinearSRGBColorSpace,
  Matrix4,
  Mesh,
  NoToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Vector3,
} from 'three'
import { float, frontFacing, uv, vec3, vec4 } from 'three/tsl'
import { MeshBasicNodeMaterial, RendererUtils, WebGPURenderer } from 'three/webgpu'
import {
  type SourcePanoramaRay,
  sourcePanoramaRay,
  sourcePanoramaRayField,
} from '../../packages/viewer/src/lib/blender-camera-panorama-source'
import { renderPanoramaSceneForeground } from '../../packages/viewer/src/lib/panorama-scene-foreground'
import { createPanoramaSceneSnapshot } from '../../packages/viewer/src/lib/panorama-scene-snapshot'

const width = 64,
  height = 32,
  parameters = {
    panoramaType: 'EQUIRECTANGULAR' as const,
    width,
    height,
    clipStart: 0.1,
    clipEnd: 40,
  },
  names = [
    '原颜色节点与 UV',
    '原自定义片元节点与 UV',
    '双面材质真实背面',
    '镜像物体与原背面材质',
    '原透明裁剪与透明度节点',
    '同材质两个实例各自的颜色',
    '透明洞后方的真实物体',
    '十层透明物体与后方实物',
    '首个表面背对相机时查询后方',
  ]

function fieldRay(rays: Float32Array, pixel: number): SourcePanoramaRay {
  const i = pixel * 12
  return {
    origin: [rays[i]!, rays[i + 1]!, rays[i + 2]!],
    direction: [rays[i + 3]!, rays[i + 4]!, rays[i + 5]!],
    tmin: rays[i + 6]!,
    tmax: rays[i + 7]!,
    time: rays[i + 8]!,
    differentialOrigin: rays[i + 9]!,
    differentialDirection: rays[i + 10]!,
    valid: rays[i + 11] === 1,
  }
}

type Reference = { color: [number, number, number] | 'uv'; alpha: number; alphaTest: boolean }
async function renderCase(renderer: WebGPURenderer, index: number) {
  const back = index === 2 || index === 3,
    mirrored = index === 3,
    alphaTest = index === 4 || index === 6,
    instanced = index === 5,
    layered = index === 7,
    scene = new Scene(),
    material = new MeshBasicNodeMaterial({
      side: back ? (mirrored ? BackSide : DoubleSide) : FrontSide,
    }),
    source = instanced
      ? new InstancedMesh(new PlaneGeometry(8, 12), material, 2)
      : new Mesh(new PlaneGeometry(16, 12), material),
    body = back ? new Matrix4().makeRotationY(Math.PI) : new Matrix4(),
    camera = new PerspectiveCamera(50, width / height, 0.1, 40),
    references = new Map<Mesh, Reference>(),
    sources: Mesh[] = [source]
  material.toneMapped = false
  if (index === 0 || alphaTest || instanced) material.colorNode = vec3(uv(), 0.25)
  else if (index === 1) material.fragmentNode = vec4(uv(), 0.6, 1)
  else if (!layered) material.fragmentNode = vec4(uv(), float(frontFacing), 1)
  if (alphaTest) {
    material.opacityNode = uv().x
    material.alphaTest = 0.5
  }
  if (source instanceof InstancedMesh) {
    source.setMatrixAt(0, new Matrix4().makeTranslation(-4, 0, 0))
    source.setMatrixAt(1, new Matrix4().makeTranslation(4, 0, 0))
    source.setColorAt(0, new Color(1, 0.35, 0.7))
    source.setColorAt(1, new Color(0.25, 1, 0.5))
  }
  source.position.z = back ? 4 : -4
  if (mirrored) source.scale.x = -1
  if (index === 8) source.rotation.y = Math.PI
  references.set(source, { color: 'uv', alpha: 1, alphaTest })
  scene.add(source)
  if (layered) {
    const color: [number, number, number] = [0.15, 0.65, 0.25]
    material.colorNode = vec3(...color)
    material.transparent = true
    material.opacity = 0.12
    references.set(source, { color, alpha: material.opacity, alphaTest: false })
    for (let layer = 1; layer < 10; layer++) {
      const color: [number, number, number] = [layer / 12, 0.2, 1 - layer / 12],
        value = new MeshBasicNodeMaterial({ transparent: true, opacity: 0.12 }),
        mesh = new Mesh(new PlaneGeometry(16, 12), value)
      value.colorNode = vec3(...color)
      value.toneMapped = false
      mesh.position.z = -4 - layer * 0.02
      scene.add(mesh)
      sources.push(mesh)
      references.set(mesh, { color, alpha: value.opacity, alphaTest: false })
    }
  }
  if (index === 6 || layered || index === 8) {
    const color: [number, number, number] = [0.2, 0.4, 1],
      value = new MeshBasicNodeMaterial(),
      mesh = new Mesh(new PlaneGeometry(16, 12), value)
    value.colorNode = vec3(...color)
    value.toneMapped = false
    mesh.position.z = -6
    scene.add(mesh)
    sources.push(mesh)
    references.set(mesh, { color, alpha: 1, alphaTest: false })
  }
  scene.updateMatrixWorld(true)
  body.decompose(camera.position, camera.quaternion, new Vector3())
  camera.updateMatrixWorld(true)
  const snapshot = createPanoramaSceneSnapshot(scene, { strict: true }),
    field = sourcePanoramaRayField(parameters, body, width, height)!,
    raycaster = new Raycaster(),
    referenceColor = new Color(),
    expected = new Float32Array(width * height * 4)
  if (!snapshot.bvh || !field) throw new Error('全景源快照或射线生成失败')
  try {
    for (let pixel = 0; pixel < width * height; pixel++) {
      const ray = fieldRay(field.rays, pixel)
      raycaster.ray.origin.fromArray(ray.origin)
      raycaster.ray.direction.fromArray(ray.direction)
      raycaster.near = ray.tmin
      raycaster.far = ray.tmax
      let remaining = 1
      const seen = new Map<string, number>()
      for (const hit of ray.valid ? raycaster.intersectObjects(sources, false) : []) {
        const ref = references.get(hit.object as Mesh)!,
          uv = hit.uv,
          key = `${hit.object.uuid}:${hit.instanceId ?? -1}`
        if (!uv || (seen.has(key) && Math.abs(seen.get(key)! - hit.distance) < 1e-8)) continue
        seen.set(key, hit.distance)
        if (ref.alphaTest && uv.x <= 0.5) continue
        let color: [number, number, number] =
          ref.color === 'uv'
            ? [uv.x, uv.y, index === 0 || alphaTest || instanced ? 0.25 : index === 1 ? 0.6 : 0]
            : ref.color
        if (hit.object instanceof InstancedMesh && hit.instanceId !== undefined) {
          hit.object.getColorAt(hit.instanceId, referenceColor)
          color = [
            color[0] * referenceColor.r,
            color[1] * referenceColor.g,
            color[2] * referenceColor.b,
          ]
        }
        for (let c = 0; c < 3; c++) expected[pixel * 4 + c] += remaining * color[c]! * ref.alpha
        remaining *= 1 - ref.alpha
        if (remaining === 0) break
      }
      expected[pixel * 4 + 3] = 1 - remaining
    }
    const before = RendererUtils.saveRendererAndSceneState(renderer, scene),
      originalChildren = scene.children.slice()
    let scopes = 0
    const result = await renderPanoramaSceneForeground({
        renderer,
        scene,
        camera,
        snapshot,
        field,
        cornerRayAt: (x, y) => sourcePanoramaRay(parameters, body, [x / width, y / height]),
        opaqueFragmentMaterials: new Set([material]),
        renderScope(render) {
          scopes++
          render()
        },
      }),
      after = RendererUtils.saveRendererAndSceneState(renderer, scene),
      stateRestored =
        Object.keys(before).every((key) => {
          const a = (before as Record<string, unknown>)[key],
            b = (after as Record<string, unknown>)[key]
          return a instanceof Color && b instanceof Color ? a.equals(b) : a === b
        }) &&
        scene.children.length === originalChildren.length &&
        scene.children.every((child, i) => child === originalChildren[i]),
      errors: unknown[] = [],
      output = new Uint8ClampedArray(width * height * 4)
    let hitCount = 0,
      maxError = 0
    for (let pixel = 0; pixel < width * height; pixel++) {
      if (expected[pixel * 4 + 3]! > 0) hitCount++
      for (let channel = 0; channel < 4; channel++) {
        const actual = result.pixels[pixel * 4 + channel]!,
          value = expected[pixel * 4 + channel]!,
          error = Math.abs(actual - value)
        maxError = Math.max(maxError, error)
        if (error > 0.00002)
          errors.push({
            x: pixel % width,
            y: Math.floor(pixel / width),
            channel,
            actual,
            expected: value,
          })
        const display =
          ((height - Math.floor(pixel / width) - 1) * width + (pixel % width)) * 4 + channel
        output[display] = channel === 3 ? 255 : Math.round(actual * 255)
      }
    }
    const image = document.createElement('canvas')
    image.width = width
    image.height = height
    image.getContext('2d')!.putImageData(new ImageData(output, width, height), 0, 0)
    const card = document.createElement('figure')
    card.innerHTML = `<figcaption>${names[index]}</figcaption>`
    card.style.margin = '6px'
    image.style.width = '192px'
    image.style.imageRendering = 'pixelated'
    card.appendChild(image)
    document.querySelector('#images')!.appendChild(card)
    return {
      name: names[index],
      passed:
        errors.length === 0 && hitCount > 100 && stateRestored && (!layered || result.layers >= 10),
      hitCount,
      maxError,
      layers: result.layers,
      shadedHits: result.shadedHits,
      scopes,
      stateRestored,
      errors: errors.slice(0, 20),
      image: image.toDataURL('image/png'),
    }
  } finally {
    snapshot.dispose()
    for (const mesh of sources) {
      mesh.geometry.dispose()
      const values = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const value of values) value.dispose()
    }
  }
}

async function run() {
  const renderer = new WebGPURenderer({ canvas: document.createElement('canvas') }),
    report = {
      passed: false,
      status: '进行中',
      backend: '',
      features: [] as string[],
      results: [] as unknown[],
      gpuErrors: [] as string[],
    }
  let scoped = false
  try {
    await renderer.init()
    report.backend = renderer.backend.constructor.name
    const backend = renderer.backend as unknown as { isWebGPUBackend?: boolean; device?: GPUDevice }
    if (!backend.isWebGPUBackend || !backend.device) throw new Error('实际全景材质验证需要 WebGPU')
    report.features = Array.from(backend.device.features)
    renderer.outputColorSpace = LinearSRGBColorSpace
    renderer.toneMapping = NoToneMapping
    backend.device.pushErrorScope('validation')
    scoped = true
    for (let index = 0; index < names.length; index++) {
      document.querySelector('#status')!.textContent = `正在绘制原材质 ${index + 1}/${names.length}`
      report.results.push(await renderCase(renderer, index))
    }
    report.passed = report.results.every((item) => (item as { passed: boolean }).passed)
    report.status = report.passed ? '真实逐层求交与原材质绘制通过' : '真实材质绘制验证失败'
  } catch (error) {
    report.status = '真实材质绘制执行失败'
    report.gpuErrors.push(error instanceof Error ? (error.stack ?? error.message) : String(error))
  } finally {
    const backend = renderer.backend as unknown as { device?: GPUDevice }
    if (scoped && backend.device) {
      const error = await backend.device.popErrorScope()
      if (error) {
        report.gpuErrors.push(error.message)
        report.passed = false
        report.status = 'GPU 验证失败'
      }
    }
    await renderer.dispose()
  }
  return report
}

document.title = '全景原射线与原材质验证'
document.body.innerHTML =
  '<main style="font:16px system-ui;padding:24px"><h1>全景原射线与原材质绘制</h1><p>真实 GPU 连续求交、源属性、原材质和浮点像素读取。仍未接入产品取景器。</p><button id="run">运行材质绘制验证</button><p id="status">尚未运行</p><div id="images" style="display:flex;flex-wrap:wrap"></div><pre id="report" style="white-space:pre-wrap"></pre></main>'
document.querySelector<HTMLButtonElement>('#run')!.addEventListener('click', async () => {
  const button = document.querySelector<HTMLButtonElement>('#run')!
  button.disabled = true
  document.querySelector('#images')!.replaceChildren()
  const report = await run()
  document.querySelector('#status')!.textContent = report.status
  document.querySelector('#report')!.textContent = JSON.stringify(
    report,
    (_, value) =>
      typeof value === 'string' && value.startsWith('data:image/') ? '[图像已在页面显示]' : value,
    2,
  )
  await fetch('/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  })
  button.disabled = false
})
