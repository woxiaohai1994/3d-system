import { expect, test } from 'bun:test'
import {
  cpuPanoramaHit,
  createPanoramaGpuAuditCases,
  knownPanoramaCenterErrors,
} from './audit-panorama-gpu-intersection-entry'

test('GPU audit known-hit cases retain full sensor dimensions and genuinely intersect before GPU use', () => {
  const fixture = createPanoramaGpuAuditCases()
  try {
    expect(fixture.cases).toHaveLength(22)
    expect(fixture.originalIndices).not.toEqual(fixture.reordered)
    for (const item of fixture.cases) {
      const pixel = Math.floor((item.field.width * item.field.height) / 2),
        center = cpuPanoramaHit(fixture.bvh, item.field, pixel)
      expect(knownPanoramaCenterErrors(item.name, center)).toEqual([])
      if (
        item.name.includes('命中距离') ||
        item.name.includes('后面 2.5') ||
        item.name.includes('距离足够') ||
        item.name.includes('世界平移') ||
        item.name.includes('tmin 继续')
      ) {
        expect(item.field.rays[pixel * 12 + 11]).toBe(1)
        expect(center).not.toBeNull()
        expect(knownPanoramaCenterErrors(item.name, null).length).toBeGreaterThan(0)
      }
      if (item.name.includes('原鱼眼中心景深')) {
        expect(item.field.rays[11]).toBe(0)
        expect(
          Array.from(item.field.rays.slice(0, 6)).some((value) => !Number.isFinite(value)),
        ).toBe(true)
      }
    }
  } finally {
    fixture.geometry.dispose()
  }
})
