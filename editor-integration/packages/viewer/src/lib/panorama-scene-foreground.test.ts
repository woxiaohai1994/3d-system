import { describe, expect, test } from 'bun:test'
import { Matrix4, Mesh, PerspectiveCamera, PlaneGeometry, Scene } from 'three'
import { vec4 } from 'three/tsl'
import { MeshBasicNodeMaterial, type WebGPURenderer } from 'three/webgpu'
import { sourcePanoramaRayField } from './blender-camera-panorama-source'
import { panoramaLinearPixels, renderPanoramaSceneForeground } from './panorama-scene-foreground'
import { createPanoramaSceneSnapshot } from './panorama-scene-snapshot'

describe('原全景浮点层像素读取', () => {
  test('按 Blender 从下到上的行序保留 HDR 与 alpha', () => {
    const raw = new Float32Array([4, 0.25, 0, 0.5, 0, 8, 0.75, 1])
    expect(Array.from(panoramaLinearPixels(raw, 1, 2))).toEqual([0, 8, 0.75, 1, 4, 0.25, 0, 0.5])
    expect(Array.from(raw)).toEqual([4, 0.25, 0, 0.5, 0, 8, 0.75, 1])
  })
  test('读取真实 WebGPU 256 字节行填充，最后一行没有尾部填充', () => {
    const raw = new Float32Array(64 * 2 + 12).fill(Number.NaN)
    raw.set([1, 2, 3, 1, 4, 5, 6, 1, 7, 8, 9, 1], 0)
    raw.set([10, 11, 12, 1, 13, 14, 15, 1, 16, 17, 18, 1], 64)
    raw.set([19, 20, 21, 1, 22, 23, 24, 1, 25, 26, 27, 1], 128)
    expect(Array.from(panoramaLinearPixels(raw, 3, 3))).toEqual([
      19, 20, 21, 1, 22, 23, 24, 1, 25, 26, 27, 1, 10, 11, 12, 1, 13, 14, 15, 1, 16, 17, 18, 1, 1,
      2, 3, 1, 4, 5, 6, 1, 7, 8, 9, 1,
    ])
  })
  test('对齐行无需猜测 stride', () => {
    const raw = new Float32Array(64 * 2)
    raw[0] = 11
    raw[64] = 22
    const output = panoramaLinearPixels(raw, 16, 2)
    expect(output[0]).toBe(22)
    expect(output[64]).toBe(11)
  })
  test('拒绝无效尺寸、错误行长度和非有限实际像素', () => {
    expect(() => panoramaLinearPixels(new Float32Array(4), 0, 1)).toThrow('尺寸')
    expect(() => panoramaLinearPixels(new Float32Array(8), 1.5, 1)).toThrow('尺寸')
    expect(() => panoramaLinearPixels(new Float32Array(7), 1, 2)).toThrow('行填充')
    expect(() => panoramaLinearPixels(new Float32Array([0, 0, 0, Number.NaN]), 1, 1)).toThrow(
      '非有限',
    )
  })
})

test('不透明零 alpha 片元不能伪装成未覆盖的透明洞', async () => {
  const material = new MeshBasicNodeMaterial(),
    mesh = new Mesh(new PlaneGeometry(2, 2), material),
    scene = new Scene()
  material.fragmentNode = vec4(0)
  mesh.position.z = -2
  scene.add(mesh)
  const snapshot = createPanoramaSceneSnapshot(scene, { strict: true })
  try {
    await expect(
      renderPanoramaSceneForeground({
        renderer: {} as WebGPURenderer,
        scene,
        camera: new PerspectiveCamera(),
        snapshot,
        field: sourcePanoramaRayField({ width: 65, height: 33 }, new Matrix4(), 1, 1)!,
        cornerRayAt: () => null,
      }),
    ).rejects.toThrow('不能将零 alpha 当作覆盖信息')
  } finally {
    snapshot.dispose()
    mesh.geometry.dispose()
    material.dispose()
  }
})

test('只写深度的不透明物体不能当作 RGBA 零层继续穿透', async () => {
  const material = new MeshBasicNodeMaterial({ colorWrite: false }),
    mesh = new Mesh(new PlaneGeometry(2, 2), material),
    scene = new Scene()
  scene.add(mesh)
  const snapshot = createPanoramaSceneSnapshot(scene, { strict: true })
  try {
    await expect(
      renderPanoramaSceneForeground({
        renderer: {} as WebGPURenderer,
        scene,
        camera: new PerspectiveCamera(),
        snapshot,
        field: sourcePanoramaRayField({ width: 65, height: 33 }, new Matrix4(), 1, 1)!,
        cornerRayAt: () => null,
      }),
    ).rejects.toThrow('特殊深度、颜色或模板写入策略')
  } finally {
    snapshot.dispose()
    mesh.geometry.dispose()
    material.dispose()
  }
})
