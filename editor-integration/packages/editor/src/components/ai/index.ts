// OPENAI_TOOLS intentionally NOT re-exported here — the schema is server-only
// (used by app/api/ai/chat/route.ts via the './ai/prompt' subpath). Keeping it
// out of the main index avoids bundling the full tool catalog into the client.

export {
  answerPendingQuestion,
  confirmOperationsFromUI,
  rejectOperationsFromUI,
  runAgentLoop,
} from './ai-agent-loop'
export { generateCatalogSummary, resolveCatalogSlug } from './ai-catalog-resolver'
export { AIChatPanel } from './ai-chat-panel'
export { useAIChat } from './ai-chat-store'
export { buildToolResult, validateAllToolCalls } from './ai-mutation-executor'
export type { ExecutionPlan, PlanStep } from './ai-planner'
export { buildPlanningContext, generateExecutionPlan, isComplexInstruction } from './ai-planner'
export {
  applyGhostPreview,
  clearGhostPreview,
  confirmGhostPreview,
  isGhostPreviewActive,
} from './ai-preview-manager'
export { buildSystemPrompt, SUMMARIZE_SYSTEM_PROMPT } from './ai-prompt'
export {
  confirmActiveProposal,
  createProposals,
  isProposalModeActive,
  rejectAllProposals,
  switchToProposal,
} from './ai-proposal-manager'
export { executeRoomPresetToolCalls, isRoomPresetToolCall } from './ai-room-preset-executor'
export { serializeSceneContext } from './ai-scene-serializer'
export type { BuildingTemplate, RoomTemplate } from './building-templates'
export {
  detectBuildingRequest,
  findTemplate,
  generatePlanFromTemplate,
  getAvailableTemplates,
} from './building-templates'
export type {
  AIRuntime,
  AITelemetry,
  AllowedChatRole,
  CatalogProvider,
  CatalogResolveResult,
  ChatMessageInput,
  ChatPersistence,
  ChatRequestBody,
  ChatRequestError,
  ChatTransport,
  LoopExitReason,
  RoomPresetProvider,
  RoomPresetSummaryEntry,
  StreamCallbacks,
  StreamUsage,
} from './contracts'
export {
  AI_INPUT_LIMITS,
  ALLOWED_CHAT_ROLES,
  describeChatRequestError,
  validateChatRequest,
} from './contracts'
export type { FurniturePlacementMeta, PlacementType } from './furniture-placement-metadata'
export {
  getAgainstWallCategories,
  getPlacementMeta,
  isAgainstWall,
} from './furniture-placement-metadata'
export { getPendingGhostRemovalIds } from './preview/ghost-node-helpers'
export type { RoomAnalysis, RoomType } from './room-analyzer'
export { analyzeRoom, formatRoomAnalysis } from './room-analyzer'
export {
  createDefaultAIRuntime,
  getAIRuntime,
  getRoomPresetProvider,
  setAIRuntime,
} from './runtime'
export {
  createDefaultRoomPresetProvider,
  formatRoomPresetSummary,
} from './runtime/default-room-presets'
export type {
  AIToolCall,
  ChatMessage,
  Proposal,
  SceneContext,
  ValidatedOperation,
} from './types'
