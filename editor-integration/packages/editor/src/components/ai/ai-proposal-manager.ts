import { nanoid } from 'nanoid'
import { useAIChat } from './ai-chat-store'
import { applyGhostPreview, clearGhostPreview } from './ai-preview-manager'
import type { Proposal, ValidatedOperation } from './types'

export function createProposals(
  operationSets: { label: string; operations: ValidatedOperation[] }[],
): Proposal[] {
  const proposals = operationSets.map((set) => ({
    id: nanoid(),
    ...set,
    nodeSnapshot: {},
    userAdjustments: [],
  }))
  useAIChat.getState().setProposals(proposals)
  if (proposals[0]) switchToProposal(proposals[0].id)
  return proposals
}
export function switchToProposal(id: string) {
  const proposal = useAIChat.getState().proposals.find((entry) => entry.id === id)
  if (!proposal) return
  applyGhostPreview(proposal.operations)
  useAIChat.getState().setActiveProposal(id)
}
export function confirmActiveProposal() {
  const state = useAIChat.getState()
  const proposal = state.proposals.find((entry) => entry.id === state.activeProposalId)
  if (!proposal) return null
  // The UI's shared confirmation path owns the single commit.
  state.clearProposals()
  return proposal.operations
}
export function rejectAllProposals() {
  clearGhostPreview()
  useAIChat.getState().clearProposals()
}
export function isProposalModeActive() {
  return useAIChat.getState().proposals.length > 0
}
export function cleanupProposalManager() {
  rejectAllProposals()
}
