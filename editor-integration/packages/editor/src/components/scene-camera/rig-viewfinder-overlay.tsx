import { type SceneCameraNode, useScene } from '@pascal-app/core'
import { useLayoutEffect, useRef } from 'react'
import { useSceneAnimation } from '../scene-animation/store'
import { useObjectMotion } from './motion-object-store'
import { bindRigPickMotion } from './rig-pointer'
import { useRigEditor } from './rig-state'
import { registerRigViewfinderOverlay } from './rig-viewfinder-target'
import { useCameraStudio } from './store'
import { canShowRigViewfinder } from './viewfinder-navigation'

export function RigViewfinderOverlay({ node }: { node: SceneCameraNode }) {
  const studio = useCameraStudio()
  useSceneAnimation()
  useScene((state) => state.readOnly)
  useObjectMotion((state) => state.nodeId)
  useRigEditor((state) => state.poseCameraId)
  const ref = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const canvas = studio.canvas,
      overlay = ref.current
    if (!canvas || !overlay) return
    const unregister = registerRigViewfinderOverlay(canvas, { nodeId: node.id, canvas: overlay }),
      unbind = bindRigPickMotion(canvas)
    return () => {
      unregister()
      unbind()
    }
  }, [studio.canvas, node.id])
  return (
    <canvas
      ref={ref}
      data-rig-viewfinder-controls={node.id}
      aria-hidden="true"
      tabIndex={-1}
      hidden={!canShowRigViewfinder(node)}
      className="pointer-events-none absolute inset-0 h-full w-full object-contain"
    />
  )
}
