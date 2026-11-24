// SPDX-License-Identifier: GPL-2.0-or-later
import type { Camera, Vector3 } from 'three'
import { rigProjectCenter } from './rig-project-center'
import source from './rig-transform-cursor-source.json'

export function rigTransformCursor(
  canvas: HTMLCanvasElement,
  camera: Camera,
  center: () => Vector3,
  getRect = () => canvas.getBoundingClientRect(),
) {
  const document = canvas.ownerDocument
  if (!document) return { update: () => {}, hide: () => {} }
  const svgNS = 'http://www.w3.org/2000/svg'
  let overlay: SVGSVGElement | null = null
  let oldCursor: string | null = null
  const hide = () => {
    overlay?.remove()
    overlay = null
    if (oldCursor !== null) canvas.style.cursor = oldCursor
    oldCursor = null
  }
  return {
    hide,
    update: (
      point: { x: number; y: number },
      mode: 'translate' | 'rotate' | 'scale',
      appearance: 'source' | 'orbit' = 'source',
    ) => {
      if (mode === 'translate') {
        hide()
        return
      }
      if (!overlay) {
        overlay = document.createElementNS(svgNS, 'svg')
        overlay.setAttribute('aria-hidden', 'true')
        overlay.dataset.source = source.source
        Object.assign(overlay.style, {
          position: 'fixed',
          pointerEvents: 'none',
          zIndex: '100',
          overflow: 'hidden',
        })
        document.body.append(overlay)
        oldCursor = canvas.style.cursor
        canvas.style.cursor = 'none'
      }
      const rect = getRect()
      Object.assign(overlay.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      })
      overlay.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`)
      overlay.dataset.cameraCursor = appearance
      const projected = rigProjectCenter(camera, center(), true)
      const cx = ((projected.x + 1) * rect.width) / 2,
        cy = ((1 - projected.y) * rect.height) / 2
      const x = ((point.x + 1) * rect.width) / 2,
        y = ((1 - point.y) * rect.height) / 2
      const angle = Math.atan2(y - cy, x - cx)
      const line = document.createElementNS(svgNS, 'line')
      for (const [key, value] of Object.entries({
        x1: cx,
        y1: cy,
        x2: x,
        y2: y,
        stroke: '#000',
        'stroke-width': source.dashWidth,
        'stroke-dasharray': `${source.dashLength / 2} ${source.dashLength / 2}`,
      }))
        line.setAttribute(key, String(value))
      const arrows = document.createElementNS(svgNS, 'path')
      if (appearance === 'orbit' && mode === 'rotate') {
        arrows.setAttribute('d', 'M 8 -5 A 10 10 0 1 0 9 4 M 8 -5 L 8 -11 M 8 -5 L 2 -5')
        arrows.setAttribute('transform', `translate(${x} ${y})`)
        arrows.setAttribute('fill', 'none')
        arrows.setAttribute('stroke-linecap', 'round')
        arrows.setAttribute('stroke-linejoin', 'round')
        const outline = arrows.cloneNode(true) as SVGPathElement
        outline.setAttribute('stroke', '#000')
        outline.setAttribute('stroke-width', '3.5')
        arrows.setAttribute('stroke', '#fff')
        arrows.setAttribute('stroke-width', '1.5')
        overlay.replaceChildren(line, outline, arrows)
        return
      }
      const rotation = mode === 'rotate' ? angle : angle + Math.PI / 2
      const offset = mode === 'rotate' ? [Math.cos(angle), Math.sin(angle)] : [0, 0]
      const vertices = [...source.up, ...source.down]
      arrows.setAttribute(
        'd',
        vertices.map(([vx, vy], i) => `${i % 2 ? 'L' : 'M'} ${vx} ${-vy!}`).join(' '),
      )
      arrows.setAttribute(
        'transform',
        `translate(${x + offset[0]!} ${y + offset[1]!}) rotate(${(rotation * 180) / Math.PI})`,
      )
      arrows.setAttribute('fill', 'none')
      arrows.setAttribute('stroke', '#000')
      arrows.setAttribute('stroke-width', String(source.arrowWidth))
      overlay.replaceChildren(line, arrows)
    },
  }
}
