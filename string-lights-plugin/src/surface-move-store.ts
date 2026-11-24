import { create } from 'zustand'
export const useSurfaceMove = create<{ nodeId: string | null }>(() => ({ nodeId: null }))
