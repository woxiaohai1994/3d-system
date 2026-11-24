import type { TransformPose } from '@pascal-app/core'
import { create } from 'zustand'

export const useObjectMotion = create<{
  nodeId: string | null
  draft: TransformPose | null
}>(() => ({ nodeId: null, draft: null }))
