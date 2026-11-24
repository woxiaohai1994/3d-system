/**
 * Public AI contracts surface — technical primitives only.
 *
 * No SaaS concepts (auth/quota/billing/rate-limit/MCP). Anything that
 * appears here must be meaningful on a standalone OSS deployment too.
 */

export type {
  AllowedChatRole,
  ChatMessageInput,
  ChatRequestBody,
  ChatRequestError,
} from './chat-request'
export {
  AI_INPUT_LIMITS,
  ALLOWED_CHAT_ROLES,
  describeChatRequestError,
  validateChatRequest,
} from './chat-request'
export type {
  AIRuntime,
  AITelemetry,
  CatalogProvider,
  CatalogResolveResult,
  ChatPersistence,
  ChatTransport,
  LoopExitReason,
  RoomPresetProvider,
  RoomPresetSummaryEntry,
  StreamCallbacks,
  StreamUsage,
} from './runtime'
