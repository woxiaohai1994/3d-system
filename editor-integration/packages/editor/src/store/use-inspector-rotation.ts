import { create } from 'zustand'

export const useInspectorRotation = create<{
  nodeId: string | null
  available: boolean
  request: { nodeId: string; serial: number } | null
  report: (nodeId: string | null, available: boolean) => void
  open: (nodeId: string) => void
}>((set) => ({
  nodeId: null,
  available: false,
  request: null,
  report: (nodeId, available) =>
    set((s) => ({ nodeId, available, request: s.nodeId === nodeId ? s.request : null })),
  open: (nodeId) => set((s) => ({ request: { nodeId, serial: (s.request?.serial ?? 0) + 1 } })),
}))
