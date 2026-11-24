import { create } from 'zustand'

export const useSupportSelection = create<{
  nodeId: string | null
  index: number
  select: (nodeId: string, index: number) => void
}>((set) => ({
  nodeId: null,
  index: 0,
  select: (nodeId, index) => set({ nodeId, index }),
}))
