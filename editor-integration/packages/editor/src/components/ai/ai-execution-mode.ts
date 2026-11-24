import { create } from 'zustand'

// Consent is session-only: reopening or changing projects always starts manually.
export const useAIExecutionMode = create<{ autoApply: boolean }>(() => ({ autoApply: false }))
export function resetAIExecutionMode() {
  useAIExecutionMode.setState({ autoApply: false })
}
