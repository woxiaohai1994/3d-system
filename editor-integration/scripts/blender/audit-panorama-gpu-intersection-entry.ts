import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Matrix4,
  Ray,
  Triangle,
  Vector3,
} from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { MeshBVH } from 'three-mesh-bvh'
import {
  type SourcePanoramaRayField,
  type SourcePanoramaType,
  sourcePanoramaRayField,
  sourcePanoramaTypes,
} from '../../packages/viewer/src/lib/blender-camera-panorama-source'
import {
  createPanoramaGpuIntersection,
  type PanoramaGpuHit,
  panoramaGpuHitAt,
} from '../../packages/viewer/src/lib/panorama-gpu-intersection'

export function createPanoramaGpuAuditCases() {
  const positions = [
    17, -2, -4, 24, -2, -4, 20, 5, -4, -3, -2, -5, 0.7, 5, -5, 4, -2, -5, -23, -2, -3, -16, -2, -3,
    -20, 5, -3, -3, -2, -2, 4, -2, -2, 0.7, 5, -2, 37, -2, -7, 44, -2, -7, 40, 5, -7, -43, -2, -6,
    -36, -2, -6, -40, 5, -6,
  ]
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(Array.from({ length: 18 }, (_, index) => index))
  const originalIndices = [...geometry.index!.array],
    bvh = new MeshBVH(geometry, { maxLeafSize: 1 }),
    identity = new Matrix4(),
    makeField = (
      parameters: Parameters<typeof sourcePanoramaRayField>[0],
      width = 3,
      height = 3,
      body = identity,
      lens: [number, number] = [0.5, 0.5],
    ) => {
      const field = sourcePanoramaRayField(
        { width: 65, height: 33, ...parameters },
        body,
        width,
        height,
        lens,
      )
      if (!field) throw new Error('原全景光线生成失败')
      return field
    }
  const cases = (Object.keys(sourcePanoramaTypes) as SourcePanoramaType[]).map((panoramaType) => ({
    name: `原投影 ${panoramaType}`,
    field: makeField({ panoramaType, width: 65, height: 33, clipStart: 0.25, clipEnd: 20 }),
  }))
  cases.push(
    {
      name: '近裁剪不重复：命中距离 1.9 米',
      field: makeField({ clipStart: 0.1, clipEnd: 20 }, 1, 1),
    },
    {
      name: '近裁剪越过前面：后面 2.5 米',
      field: makeField({ clipStart: 2.5, clipEnd: 20 }, 1, 1),
    },
    { name: '远裁剪距离不足', field: makeField({ clipStart: 0.1, clipEnd: 1.9998 }, 1, 1) },
    { name: '远裁剪距离足够', field: makeField({ clipStart: 0.1, clipEnd: 2.0002 }, 1, 1) },
    { name: '裁剪长度为零', field: makeField({ clipStart: 2, clipEnd: 2 }, 1, 1) },
    {
      name: '相机本体世界平移',
      field: makeField(
        { clipStart: 0.25, clipEnd: 20 },
        1,
        1,
        new Matrix4().makeTranslation(0.3, 0.4, 1),
      ),
    },
    {
      name: '非均匀父级和剪切',
      field: makeField(
        { clipStart: 0.25, clipEnd: 20 },
        3,
        3,
        new Matrix4().set(1.4, 0.2, 0.15, 0.3, 0.1, 0.8, 0.2, 0.4, 0.2, 0.1, 1.2, 1, 0, 0, 0, 1),
      ),
    },
    {
      name: '圆孔景深采样',
      field: makeField(
        {
          panoramaType: 'EQUIRECTANGULAR',
          useDof: true,
          apertureFstop: 1.4,
          focusDistance: 3,
          lens: 85,
          clipEnd: 20,
        },
        3,
        3,
        identity,
        [0.2, 0.8],
      ),
    },
    {
      name: '多边形椭圆光圈景深采样',
      field: makeField(
        {
          panoramaType: 'EQUIRECTANGULAR',
          useDof: true,
          apertureBlades: 7,
          apertureRatio: 2.3,
          apertureRotation: 0.7,
          focusDistance: 3,
          clipEnd: 20,
        },
        3,
        3,
        identity,
        [0.2, 0.8],
      ),
    },
    {
      name: '原鱼眼中心景深非有限光线',
      // An even full raster produces the exact source pole; the odd raster has float32 roundoff.
      field: makeField(
        { width: 64, height: 32, useDof: true, clipEnd: 20 },
        1,
        1,
        identity,
        [0.2, 0.8],
      ),
    },
    {
      name: '跨工作组 65 个像素',
      field: makeField({ panoramaType: 'EQUIRECTANGULAR', clipEnd: 20 }, 65, 1),
    },
  )
  const invalidFlag = makeField({ clipEnd: 20 }, 1, 1)
  invalidFlag.rays[11] = 0
  const nonfinite = makeField({ clipEnd: 20 }, 1, 1)
  nonfinite.rays[0] = NaN
  const zeroDirection = makeField({ clipEnd: 20 }, 1, 1)
  zeroDirection.rays.fill(0, 3, 6)
  const positiveTmin = makeField({ clipEnd: 20 }, 1, 1)
  positiveTmin.rays[6] = 3
  cases.push(
    { name: '无效标记禁止命中', field: invalidFlag },
    { name: '非有限起点禁止命中', field: nonfinite },
    { name: '零方向禁止命中', field: zeroDirection },
    { name: '显式 tmin 继续到后面', field: positiveTmin },
  )
  return { geometry, bvh, cases, originalIndices, reordered: [...geometry.index!.array] }
}

export function cpuPanoramaHit(
  bvh: MeshBVH,
  field: SourcePanoramaRayField,
  pixel: number,
): PanoramaGpuHit | null {
  const data = field.rays,
    offset = pixel * 12,
    tmin = data[offset + 6]!,
    tmax = data[offset + 7]!,
    origin = new Vector3().fromArray(data, offset),
    direction = new Vector3().fromArray(data, offset + 3)
  if (
    !(data[offset + 11]! > 0 && tmin >= 0 && tmax > tmin) ||
    ![...origin.toArray(), ...direction.toArray(), tmin, tmax].every(Number.isFinite) ||
    direction.lengthSq() <= 0
  )
    return null
  const ray = new Ray(origin, direction),
    hit = bvh.raycastFirst(ray, DoubleSide, tmin + 1e-5, tmax)
  if (!hit) return null
  const geometry = bvh.geometry,
    indices = geometry.index!,
    position = geometry.getAttribute('position'),
    triangleIndex = hit.faceIndex!,
    vertexIndices = [
      indices.getX(triangleIndex * 3),
      indices.getX(triangleIndex * 3 + 1),
      indices.getX(triangleIndex * 3 + 2),
    ] as [number, number, number],
    vertices = vertexIndices.map((index) => new Vector3().fromBufferAttribute(position, index)),
    normal = new Triangle(...(vertices as [Vector3, Vector3, Vector3])).getNormal(new Vector3()),
    side = -Math.sign(direction.dot(normal)),
    barycentric = Triangle.getBarycoord(
      hit.point,
      ...(vertices as [Vector3, Vector3, Vector3]),
      new Vector3(),
    )!
  return {
    distance: hit.distance,
    side,
    triangleIndex,
    vertexIndices,
    barycentric: barycentric.toArray(),
    normal: normal.multiplyScalar(side).toArray(),
  }
}

function compare(actual: PanoramaGpuHit | null, expected: PanoramaGpuHit | null) {
  if (!actual || !expected) return actual === expected ? null : 'GPU 和独立 CPU 的命中状态不一致'
  if (
    actual.triangleIndex !== expected.triangleIndex ||
    actual.side !== expected.side ||
    actual.vertexIndices.some((value, index) => value !== expected.vertexIndices[index])
  )
    return '三角形编号、顶点或面向不同'
  const values = [actual.distance, ...actual.barycentric, ...actual.normal],
    references = [expected.distance, ...expected.barycentric, ...expected.normal]
  return values.some(
    (value, index) =>
      !Number.isFinite(value) ||
      Math.abs(value - references[index]!) > 2e-5 * Math.max(1, Math.abs(references[index]!)),
  )
    ? '距离、重心或法线超出误差界'
    : null
}

/** Explicit known geometry prevents an accidentally invalid source ray from making CPU/GPU both miss. */
export function knownPanoramaCenterErrors(name: string, center: PanoramaGpuHit | null) {
  const errors: string[] = []
  const knownDistance =
    name.includes('命中距离 1.9') || name.includes('距离足够')
      ? 1.9
      : name.includes('后面 2.5')
        ? 2.5
        : name.includes('tmin 继续')
          ? 4.9
          : name.includes('世界平移')
            ? 2.75
            : name.includes('原投影')
              ? 1.75
              : null
  if (knownDistance !== null && (!center || Math.abs(center.distance - knownDistance) > 2e-5))
    errors.push(`已知三角必须命中，距离必须${knownDistance}米`)
  if ((name.includes('后面 2.5') || name.includes('tmin 继续')) && center?.side !== -1)
    errors.push('已知后面必须命中且面向-1')
  if (name.includes('原投影') && (!center || Math.floor(center.vertexIndices[0] / 3) !== 3))
    errors.push('原投影中心必须命中重排前第3号源三角')
  if (
    (name.includes('距离不足') ||
      name.includes('禁止命中') ||
      name.includes('裁剪长度为零') ||
      name.includes('非有限光线')) &&
    center
  )
    errors.push('已知无效或裁剪外光线必须不命中')
  return errors
}

export async function runPanoramaGpuAudit(onProgress?: (label: string) => void) {
  const canvas = document.createElement('canvas'),
    renderer = new WebGPURenderer({ canvas }),
    report = {
      status: '进行中',
      backend: '未初始化',
      device: null as unknown,
      source: 'Blender v4.3 原光线 + three-mesh-bvh 原 WGSL',
      sortedIndices: null as unknown,
      results: [] as unknown[],
      gpuErrors: [] as string[],
      passed: false,
    }
  const fixture = createPanoramaGpuAuditCases()
  let device: GPUDevice | undefined
  try {
    await renderer.init()
    const backend = renderer.backend as unknown as { isWebGPUBackend?: boolean; device?: GPUDevice }
    report.backend = renderer.backend.constructor.name
    if (!backend.isWebGPUBackend || !backend.device)
      throw new Error('当前浏览器没有可用 WebGPU 后端')
    device = backend.device
    report.device = {
      adapter: (device as GPUDevice & { adapterInfo?: unknown }).adapterInfo ?? null,
      maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
      maxComputeWorkgroupsPerDimension: device.limits.maxComputeWorkgroupsPerDimension,
    }
    device.addEventListener('uncapturederror', (event) =>
      report.gpuErrors.push(event.error.message),
    )
    device.pushErrorScope('validation')
    report.sortedIndices = {
      before: fixture.originalIndices,
      after: fixture.reordered,
      changed: fixture.originalIndices.some((value, index) => value !== fixture.reordered[index]),
    }
    for (const [caseIndex, item] of fixture.cases.entries()) {
      onProgress?.(`正在运行 GPU：${caseIndex + 1}/${fixture.cases.length} ${item.name}`)
      const intersection = createPanoramaGpuIntersection(fixture.bvh, item.field)
      try {
        await intersection.compute(renderer)
        const output = await intersection.readback(renderer),
          pixels = []
        for (let pixel = 0; pixel < item.field.width * item.field.height; pixel++) {
          const actual = panoramaGpuHitAt(output, pixel),
            expected = cpuPanoramaHit(fixture.bvh, item.field, pixel),
            error = compare(actual, expected)
          pixels.push({ pixel, actual, expected, error })
        }
        const center = panoramaGpuHitAt(
          output,
          Math.floor((item.field.width * item.field.height) / 2),
        )
        const geometricChecks = knownPanoramaCenterErrors(item.name, center)
        report.results.push({
          geometricChecks,
          name: item.name,
          width: item.field.width,
          height: item.field.height,
          passed: geometricChecks.length === 0 && pixels.every((pixel) => !pixel.error),
          pixels,
        })
        if (caseIndex === 0) {
          const invalid = { ...item.field, rays: item.field.rays.slice() }
          for (let pixel = 0; pixel < invalid.width * invalid.height; pixel++)
            invalid.rays[pixel * 12 + 11] = 0
          intersection.updateRays(invalid)
          await intersection.compute(renderer)
          const cleared = await intersection.readback(renderer)
          report.results.push({
            name: '同一 GPU 缓冲从命中改为无效后清除旧命中',
            passed:
              cleared.data.every((value) => value === 0) &&
              cleared.indices.every((value) => value === 0xffffffff),
          })
          intersection.updateRays(item.field)
          const position = fixture.geometry.getAttribute('position'),
            saved = new Float32Array(position.array)
          for (let vertex = 0; vertex < position.count; vertex++)
            position.setZ(vertex, position.getZ(vertex) - 1)
          fixture.bvh.refit()
          intersection.updateBVH(fixture.bvh)
          await intersection.compute(renderer)
          const changed = await intersection.readback(renderer),
            matches = []
          for (let pixel = 0; pixel < item.field.width * item.field.height; pixel++)
            matches.push(
              compare(
                panoramaGpuHitAt(changed, pixel),
                cpuPanoramaHit(fixture.bvh, item.field, pixel),
              ),
            )
          report.results.push({
            name: '同一 GPU BVH refit 后求交更新',
            passed:
              matches.every((error) => !error) &&
              Math.abs(
                (panoramaGpuHitAt(changed, Math.floor((item.field.width * item.field.height) / 2))
                  ?.distance ?? NaN) - 2.75,
              ) < 2e-5,
            errors: matches,
          })
          position.array.set(saved)
          fixture.bvh.refit()
        }
      } finally {
        intersection.dispose()
      }
    }
    const validation = await device.popErrorScope()
    if (validation) report.gpuErrors.push(validation.message)
    report.passed =
      report.gpuErrors.length === 0 &&
      report.results.every((item) => (item as { passed: boolean }).passed)
    report.status = report.passed ? '真实 GPU 数值验证通过' : '真实 GPU 数值验证失败'
  } catch (error) {
    report.status = '真实 GPU 执行失败'
    report.gpuErrors.push(error instanceof Error ? (error.stack ?? error.message) : String(error))
  } finally {
    fixture.geometry.dispose()
    await renderer.dispose()
  }
  return report
}

if (typeof document !== 'undefined') {
  document.body.innerHTML =
    '<main style="font:16px system-ui;padding:24px;max-width:1200px;margin:auto"><h1>全景原始光线 GPU 求交验证</h1><p>直接运行 WebGPU 求交，再读取真实 GPU 结果，与独立 CPU BVH 核对。此页只验证求交，不代表材质渲染完成。</p><button id="run" style="padding:12px 24px">运行真实 GPU 验证</button><p id="status">尚未运行 GPU</p><div id="pixels"></div><pre id="report" style="font:12px monospace;white-space:pre-wrap"></pre></main>'
  const button = document.querySelector<HTMLButtonElement>('#run')!,
    status = document.querySelector('#status')!,
    output = document.querySelector('#report')!,
    pixels = document.querySelector('#pixels')!
  button.addEventListener('click', async () => {
    button.disabled = true
    status.textContent = '正在初始化 WebGPU'
    try {
      const report = await runPanoramaGpuAudit((label) => (status.textContent = label))
      status.textContent = report.status
      output.textContent = JSON.stringify(report, null, 2)
      pixels.innerHTML = (
        report.results as {
          name: string
          passed: boolean
          width?: number
          height?: number
          pixels?: { actual: unknown; error: unknown }[]
        }[]
      )
        .map(
          (item) =>
            `<div style="display:inline-block;padding:10px;margin:4px;background:${item.passed ? '#dbf1df' : '#ffd5d5'}">${item.name}<div>${item.pixels?.map((pixel) => `<span style="display:inline-block;width:10px;height:10px;margin:1px;background:${pixel.error ? 'red' : pixel.actual ? '#306e42' : '#999'}"></span>`).join('') ?? ''}</div></div>`,
        )
        .join('')
      try {
        await fetch('/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(report),
        })
      } catch {}
    } finally {
      button.disabled = false
    }
  })
}
