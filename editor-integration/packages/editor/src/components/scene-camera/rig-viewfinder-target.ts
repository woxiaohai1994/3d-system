export type RigViewfinderOverlayTarget = {
  nodeId: string
  canvas: HTMLCanvasElement
  pick?: (x: number, y: number, nearest?: boolean, signal?: AbortSignal) => Promise<string | null>
  releasePick?: () => void
}
const targets = new WeakMap<HTMLCanvasElement, RigViewfinderOverlayTarget>()

export function registerRigViewfinderOverlay(
  canvas: HTMLCanvasElement,
  target: RigViewfinderOverlayTarget,
) {
  const previous = targets.get(canvas)
  if (previous && previous !== target) previous.releasePick?.()
  targets.set(canvas, target)
  return () => {
    if (targets.get(canvas) === target) {
      targets.delete(canvas)
      target.releasePick?.()
    }
  }
}

export function getRigViewfinderOverlay(canvas: HTMLCanvasElement, nodeId: string) {
  const target = targets.get(canvas)
  return target?.nodeId === nodeId && !target.canvas.hidden ? target : null
}
