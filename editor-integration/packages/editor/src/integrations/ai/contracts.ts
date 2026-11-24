import { z } from 'zod'
import { fullToolNames, validateToolArguments } from '../../components/ai/tool-validation'
import { profileSchema, thinkingSchema } from './profiles'

export const AI_TIMEOUT_MS = 180_000
export const AI_MAX_BYTES = 1_048_576
const id = z.string().min(1).max(256)
const text = z.string().max(16_000)
const position = z.tuple([z.number(), z.number(), z.number()])
const reason = text.optional()

export const toolSchemas = {
  add_item: z.strictObject({
    catalogSlug: id,
    position,
    rotationY: z.number(),
    levelId: id.optional(),
    description: reason,
  }),
  remove_item: z.strictObject({ nodeId: id, reason }),
  move_item: z.strictObject({
    nodeId: id,
    position,
    rotationY: z.number().optional(),
    levelId: id.optional(),
    reason,
  }),
  update_item: z.strictObject({
    nodeId: id,
    scale: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
    reason,
  }),
  ask_user: z.strictObject({ question: text.min(1), suggestions: z.array(text).max(6).optional() }),
} as const

export const toolNames = Object.keys(toolSchemas) as (keyof typeof toolSchemas)[]
export const toolCallSchema = z
  .strictObject({
    id,
    name: z.enum(fullToolNames as [string, ...string[]]),
    arguments: z.record(z.string(), z.unknown()),
  })
  .superRefine((call, ctx) => {
    if (!validateToolArguments(call.name, call.arguments))
      ctx.addIssue({ code: 'custom', message: 'INVALID_TOOL' })
  })
export type ToolCall = z.infer<typeof toolCallSchema>
export type ToolArguments<K extends keyof typeof toolSchemas> = z.infer<(typeof toolSchemas)[K]>

export const messageSchema = z
  .strictObject({
    role: z.enum(['user', 'assistant', 'tool']),
    content: z.string().max(64_000),
    reasoning_content: z.string().max(128_000).optional(),
    tool_call_id: id.optional(),
    tool_calls: z
      .array(z.strictObject({ id, name: z.string(), arguments: z.record(z.string(), z.unknown()) }))
      .max(50)
      .optional(),
  })
  .superRefine((message, ctx) => {
    if (message.role === 'tool' && !message.tool_call_id)
      ctx.addIssue({ code: 'custom', message: 'INVALID_TOOL_MESSAGE' })
    if (message.role !== 'assistant' && message.reasoning_content !== undefined)
      ctx.addIssue({ code: 'custom', message: 'INVALID_TOOL_MESSAGE' })
    if (message.role !== 'assistant' && message.tool_calls)
      ctx.addIssue({ code: 'custom', message: 'INVALID_TOOL_MESSAGE' })
  })
export const requestContextSchema = z.strictObject({
  requestId: id,
  projectId: id,
  sceneRevision: z.number().int().nonnegative(),
})
export const chatRequestSchema = requestContextSchema.extend({
  profileId: id,
  model: profileSchema.shape.model.optional(),
  thinking: thinkingSchema.optional(),
  locale: z.enum(['zh-CN', 'en']),
  messages: z.array(messageSchema).min(1).max(100),
  sceneContext: z.string().max(256_000),
  catalogSummary: z.string().max(64_000),
  roomPresetSummary: z.string().max(16_000).optional(),
})
export const summarizeRequestSchema = requestContextSchema.extend({
  profileId: id,
  model: profileSchema.shape.model.optional(),
  thinking: thinkingSchema.optional(),
  locale: z.enum(['zh-CN', 'en']),
  messages: z.array(messageSchema).min(1).max(100),
})
export type ChatRequest = z.infer<typeof chatRequestSchema>
export type ChatMessage = z.infer<typeof messageSchema>
export const completionSchema = z
  .strictObject({
    text: z.string().max(128_000),
    reasoning_content: z.string().max(128_000).optional(),
    calls: z.array(toolCallSchema).max(50),
  })
  .superRefine(({ calls }, ctx) => {
    if (
      calls.length > 1 &&
      calls.some((call) =>
        [
          'ask_user',
          'confirm_preview',
          'reject_preview',
          'propose_placement',
          'enter_walkthrough',
          'save_room_preset',
          'insert_room_preset',
        ].includes(call.name),
      )
    )
      ctx.addIssue({ code: 'custom', message: 'INVALID_TOOL' })
    if (new Set(calls.map((call) => call.id)).size !== calls.length)
      ctx.addIssue({ code: 'custom', message: 'INVALID_TOOL' })
  })
export type Completion = z.infer<typeof completionSchema>
export const streamEventSchema = z.discriminatedUnion('type', [
  requestContextSchema.extend({ type: z.literal('text'), text: z.string().max(128_000) }),
  requestContextSchema.extend({ type: z.literal('complete'), result: completionSchema }),
  requestContextSchema.extend({ type: z.literal('error'), code: z.string().max(100) }),
])

export class AIError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'AIError'
  }
}
