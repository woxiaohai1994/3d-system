// SPDX-License-Identifier: GPL-3.0-or-later
// Port of Blender view3d_draw.cc drawviewborder_grid3 / drawviewborder_triangle, and UI_draw_safe_areas.
import type { RigGuide } from './rig-display'

export function rigGuideLines(guide: RigGuide, width: number, height: number) {
  const lines: [number, number, number, number][] = []
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    lines.push([x1, height - y1, x2, height - y2])
  const box = (x: number, y: number) => {
    line(x, y, width - x, y)
    line(width - x, y, width - x, height - y)
    line(width - x, height - y, x, height - y)
    line(x, height - y, x, y)
  }
  if (guide === 'safe') {
    for (const [x, y] of [
      [0.1, 0.05],
      [0.035, 0.035],
    ])
      box((width * x!) / 2, (height * y!) / 2)
  } else if (guide === 'center') {
    line(0, height / 2, width, height / 2)
    line(width / 2, 0, width / 2, height)
  } else if (guide === 'diagonal') {
    line(0, 0, width, height)
    line(0, height, width, 0)
  } else if (guide === 'thirds' || guide === 'golden') {
    const factor = guide === 'thirds' ? 1 / 3 : 1 - 0.618033988749895
    for (const f of [factor, 1 - factor]) {
      line(0, f * height, width, f * height)
      line(f * width, 0, f * width, height)
    }
  } else {
    // Blender passes golden=false for Golden Triangle and true for Harmony Triangle.
    const golden = guide.startsWith('harmony'),
      reverse = guide.endsWith('_b')
    let x1 = 0,
      x2 = width,
      y1 = 0,
      y2 = height
    if (width > height) {
      const offset = golden ? width * (1 - 0.618033988749895) : height * (height / width)
      if (reverse) [y1, y2] = [y2, y1]
      line(x1, y1, x2, y2)
      line(x2, y1, x1 + width - offset, y2)
      line(x1, y2, x1 + offset, y1)
    } else {
      const offset = golden ? height * (1 - 0.618033988749895) : width * (width / height)
      if (reverse) [x1, x2] = [x2, x1]
      line(x1, y1, x2, y2)
      line(x2, y1, x1, y1 + offset)
      line(x1, y2, x2, y1 + height - offset)
    }
  }
  return lines
}
