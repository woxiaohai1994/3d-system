import { create } from 'zustand'
import type { TransformPose } from '../schema/motion'

// Sampled animation is transient and must never enter scene history or autosave.
export const usePlaybackTransforms = create<{ poses: ReadonlyMap<string, TransformPose> }>(() => ({
  poses: new Map(),
}))
