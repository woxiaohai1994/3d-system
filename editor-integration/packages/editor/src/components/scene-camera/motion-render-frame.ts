import type { WebGPURenderer } from 'three/webgpu'

export function beginMotionRenderFrame(renderer: WebGPURenderer) {
  // Three r186 updates light nodes once per animation frame. Offline frames can share
  // one browser tick, so each capture needs its own frame identity before drawing.
  const internal = renderer as unknown as {
    _nodes: { nodeFrame: { frameId: number } }
    info: { frame: number }
  }
  internal._nodes.nodeFrame.frameId += 1
  internal.info.frame = internal._nodes.nodeFrame.frameId
}
