import type { BufferGeometry, Camera, Mesh } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import {
  chooseRigGpuSelectionHit,
  RigGpuSelectionFrame,
  RigGpuSelectionPass,
} from './rig-gpu-selection'

type Displayed = {
  camera: Camera
  geometry: Mesh['geometry']
  viewport: { width: number; height: number }
  front: boolean
}
type Entry = { mesh: Mesh; displayed?: Displayed }
const surfaces = new WeakMap<
  HTMLCanvasElement,
  { pass: RigGpuSelectionPass; rigs: Map<string, Map<string, Entry>> }
>()

export function registerRigWidgetSelection(
  canvas: HTMLCanvasElement,
  cameraId: string,
  name: string,
  mesh: Mesh,
) {
  let surface = surfaces.get(canvas)
  if (!surface) {
    surface = { pass: new RigGpuSelectionPass(), rigs: new Map() }
    surfaces.set(canvas, surface)
  }
  let rig = surface.rigs.get(cameraId)
  if (!rig) {
    rig = new Map()
    surface.rigs.set(cameraId, rig)
  }
  const entry: Entry = { mesh }
  rig.set(name, entry)
  return {
    publish(
      camera: Camera,
      viewport: { width: number; height: number },
      front: boolean,
      geometry: BufferGeometry = mesh.geometry,
    ) {
      if (!geometry.getAttribute('sourceRigClip')) return
      const last = entry.displayed
      if (last?.geometry === geometry && last.front === front) return
      entry.displayed = {
        camera: camera.clone(),
        geometry,
        viewport: { ...viewport },
        front,
      }
    },
    dispose() {
      if (rig.get(name) === entry) rig.delete(name)
      if (rig.size === 0 && surface.rigs.get(cameraId) === rig) surface.rigs.delete(cameraId)
      if (surface.rigs.size === 0) {
        if (surfaces.get(canvas) === surface) surfaces.delete(canvas)
        surface.pass.dispose()
      }
    },
  }
}

export async function pickDisplayedRigWidget(
  renderer: WebGPURenderer,
  canvas: HTMLCanvasElement,
  cameraId: string,
  names: readonly string[],
  selected: string[],
  nearest: boolean,
  pointer: Pick<PointerEvent, 'clientX' | 'clientY'>,
  signal?: AbortSignal,
): Promise<string | null> {
  const surface = surfaces.get(canvas),
    rig = surface?.rigs.get(cameraId)
  if (!surface || !rig) return null
  const selection = [...selected]
  const owners = names.map((name) => [name, rig.get(name)] as const)
  // Equal stored depths retain the source bone order, independent of React mount order.
  const widgets = names.flatMap((name) => {
    const entry = rig.get(name),
      shown = entry?.displayed
    return shown && entry.mesh.visible ? [{ name, geometry: shown.geometry }] : []
  })
  const shown = names.map((name) => rig.get(name)?.displayed).find(Boolean)
  if (!shown || !widgets.length) return null
  const frame = new RigGpuSelectionFrame(shown.camera, widgets, shown.viewport, {
    front: shown.front,
  })
  const rect = canvas.getBoundingClientRect()
  try {
    const hits = await surface.pass.pick(
      renderer,
      frame,
      {
        x: ((pointer.clientX - rect.left) * frame.viewport.width) / rect.width,
        y: ((pointer.clientY - rect.top) * frame.viewport.height) / rect.height,
      },
      signal,
    )
    if (
      surfaces.get(canvas) !== surface ||
      surface.rigs.get(cameraId) !== rig ||
      owners.some(([name, entry]) => rig.get(name) !== entry)
    )
      return null
    return chooseRigGpuSelectionHit(hits, selection, nearest)?.name ?? null
  } finally {
    frame.dispose()
  }
}
