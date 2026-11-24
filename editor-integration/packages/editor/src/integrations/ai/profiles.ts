import { z } from 'zod'

export const thinkingSchema = z.enum(['auto', 'off', 'on', 'low', 'medium', 'high', 'max'])
export type AIThinking = z.infer<typeof thinkingSchema>

export const protocolSchema = z.enum(['openai-chat', 'anthropic', 'gemini'])
export type AIProtocol = z.infer<typeof protocolSchema>
export const profileSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(80),
  presetId: z.string().max(80).optional(),
  modelName: z.string().trim().max(80).optional(),
  thinking: thinkingSchema.optional(),
  protocol: protocolSchema,
  baseUrl: z
    .string()
    .trim()
    .url()
    .max(2048)
    .refine((value) => {
      const url = new URL(value)
      return (
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        (url.protocol === 'https:' ||
          (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      )
    }),
  model: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[a-zA-Z0-9._:/-]+$/),
})
export type AIProfile = z.infer<typeof profileSchema>
export type PublicAIProfile = AIProfile & { hasKey: boolean }
export const profileActionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('list') }),
  z.strictObject({
    action: z.literal('save'),
    revision: z.number().int().nonnegative(),
    profile: profileSchema,
    apiKey: z.string().trim().max(4096).optional(),
  }),
  z.strictObject({
    action: z.literal('delete'),
    revision: z.number().int().nonnegative(),
    id: z.string().max(100),
  }),
  z.strictObject({ action: z.literal('test'), id: z.string().max(100) }),
  z.strictObject({
    action: z.literal('models'),
    presetId: z.string().min(1).max(80),
    profileId: z.string().max(100).optional(),
    apiKey: z.string().trim().max(4096).optional(),
  }),
])
export const AI_PRESETS: {
  id: string
  name: string
  protocol: AIProtocol
  baseUrl: string
  billing?: 'subscription'
  docsUrl?: string
  note?: string
}[] = [
  { id: 'openai', name: 'OpenAI', protocol: 'openai-chat', baseUrl: 'https://api.openai.com/v1' },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'openai-chat',
    baseUrl: 'https://api.deepseek.com',
  },
  {
    id: 'qwen',
    name: 'Alibaba Cloud (Beijing)',
    protocol: 'openai-chat',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  {
    id: 'mimo',
    name: 'Xiaomi MiMo',
    protocol: 'openai-chat',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    docsUrl:
      'https://platform.xiaomimimo.com/docs/en-US/usage-guide/passing-back-reasoning_content',
  },
  {
    id: 'zhipu',
    name: 'Zhipu GLM',
    protocol: 'openai-chat',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    docsUrl: 'https://docs.bigmodel.cn/cn/guide/develop/openai/introduction',
  },
  {
    id: 'kimi',
    name: 'Kimi (China)',
    protocol: 'openai-chat',
    baseUrl: 'https://api.moonshot.cn/v1',
    docsUrl: 'https://platform.moonshot.cn/docs/api/chat',
  },
  {
    id: 'kimi-global',
    name: 'Kimi (Global)',
    protocol: 'openai-chat',
    baseUrl: 'https://api.moonshot.ai/v1',
    docsUrl: 'https://platform.moonshot.ai/docs/api/chat',
  },
  {
    id: 'runninghub-global',
    name: 'RunningHub (Global)',
    protocol: 'openai-chat',
    baseUrl: 'https://llm.runninghub.ai/v1',
    docsUrl: 'https://www.runninghub.ai/runninghub-api-doc-en/doc-8287463',
    note: 'RunningHub Global LLM requires an Enterprise-Shared API key. Enter an LLM model ID, not a workflow or AI App ID.',
  },
  {
    id: 'doubao',
    name: 'Doubao / Volcengine',
    protocol: 'openai-chat',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    docsUrl: 'https://www.volcengine.com/docs/82379/1494384',
    note: 'Use an API model ID or endpoint ID from Volcengine Ark.',
  },
  {
    id: 'minimax',
    name: 'MiniMax (China)',
    protocol: 'openai-chat',
    baseUrl: 'https://api.minimax.cn/v1',
    docsUrl: 'https://platform.minimax.cn/docs/api-reference/text-openai-api',
  },
  {
    id: 'baidu',
    name: 'Baidu Qianfan',
    protocol: 'openai-chat',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    docsUrl: 'https://cloud.baidu.com/doc/qianfan-docs/s/qm8qxemze',
  },
  {
    id: 'hunyuan',
    name: 'Tencent Hunyuan',
    protocol: 'openai-chat',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    docsUrl: 'https://cloud.tencent.com/document/product/1729/111007',
  },
  {
    id: 'stepfun',
    name: 'StepFun',
    protocol: 'openai-chat',
    baseUrl: 'https://api.stepfun.com/v1',
    docsUrl: 'https://platform.stepfun.com/docs/overview/concept',
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow (China)',
    protocol: 'openai-chat',
    baseUrl: 'https://api.siliconflow.cn/v1',
    docsUrl: 'https://docs.siliconflow.cn/docs/api/chat-completions-post',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  {
    id: 'mimo-plan-cn',
    name: 'Xiaomi MiMo Token Plan (China)',
    protocol: 'openai-chat',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    billing: 'subscription',
    docsUrl: 'https://mimo.mi.com/docs/zh-CN/tokenplan/Token%20Plan/quick-access',
    note: 'Use the Token Plan key (tp-), not the pay-as-you-go key (sk-). Match the cluster shown in your console.',
  },
  {
    id: 'mimo-plan-sgp',
    name: 'Xiaomi MiMo Token Plan (Singapore)',
    protocol: 'openai-chat',
    baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
    billing: 'subscription',
    docsUrl: 'https://mimo.mi.com/docs/zh-CN/tokenplan/Token%20Plan/quick-access',
    note: 'Use the Token Plan key (tp-), not the pay-as-you-go key (sk-). Match the cluster shown in your console.',
  },
  {
    id: 'mimo-plan-ams',
    name: 'Xiaomi MiMo Token Plan (Europe)',
    protocol: 'openai-chat',
    baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1',
    billing: 'subscription',
    docsUrl: 'https://mimo.mi.com/docs/zh-CN/tokenplan/Token%20Plan/quick-access',
    note: 'Use the Token Plan key (tp-), not the pay-as-you-go key (sk-). Match the cluster shown in your console.',
  },
  {
    id: 'minimax-plan',
    name: 'MiniMax Token Plan (China)',
    protocol: 'openai-chat',
    baseUrl: 'https://api.minimax.cn/v1',
    billing: 'subscription',
    docsUrl: 'https://platform.minimax.cn/docs/token-plan/other-tools',
    note: 'MiniMax uses the same endpoint for both modes. Use the subscription key for plan quota; a regular API key charges your API balance.',
  },
  { id: 'custom', name: 'Custom provider', protocol: 'openai-chat', baseUrl: '' },
]

export const modelOptionSchema = z.object({
  id: profileSchema.shape.model,
  name: z.string().trim().min(1).max(80),
})
export type AIModelOption = z.infer<typeof modelOptionSchema>
export const modelListSchema = z.array(modelOptionSchema).min(1).max(500)

type ModelCatalog = {
  models: AIModelOption[]
  source?: 'api' | 'zhipu-docs' | 'minimax-docs'
}
const modelOptions = (...ids: string[]): AIModelOption[] => ids.map((id) => ({ id, name: id }))
const mimoCatalog: ModelCatalog = {
  models: modelOptions('mimo-v2.5-pro', 'mimo-v2.5'),
  source: 'api',
}
const kimiCatalog: ModelCatalog = {
  models: modelOptions('kimi-k3', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k2.6'),
  source: 'api',
}
const minimaxCatalog: ModelCatalog = {
  models: modelOptions('MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5'),
  source: 'minimax-docs',
}
export const AI_MODEL_CATALOGS: Record<string, ModelCatalog> = {
  openai: { models: modelOptions('gpt-4.1', 'gpt-4.1-mini'), source: 'api' },
  anthropic: { models: modelOptions('claude-sonnet-5', 'claude-opus-5'), source: 'api' },
  gemini: { models: modelOptions('gemini-2.5-flash', 'gemini-2.5-pro'), source: 'api' },
  stepfun: { models: modelOptions('step-3.7-flash', 'step-3.5-flash'), source: 'api' },
  hunyuan: { models: modelOptions('hunyuan-turbos-latest', 'hunyuan-a13b') },
  baidu: { models: modelOptions('ernie-5.1', 'ernie-5.0', 'ernie-4.5-turbo-128k') },
  deepseek: { models: modelOptions('deepseek-flash', 'deepseek-v4-pro'), source: 'api' },
  mimo: mimoCatalog,
  'mimo-plan-cn': mimoCatalog,
  'mimo-plan-sgp': mimoCatalog,
  'mimo-plan-ams': mimoCatalog,
  kimi: kimiCatalog,
  'kimi-global': kimiCatalog,
  zhipu: {
    models: modelOptions('glm-5.3', 'glm-5.3-flash', 'glm-5.3-flashx', 'glm-5.2', 'glm-4.7-flash'),
    source: 'zhipu-docs',
  },
  minimax: minimaxCatalog,
  'minimax-plan': minimaxCatalog,
  qwen: { models: modelOptions('qwen3.8-max', 'qwen3.8-flash', 'qwen3.5-plus') },
}
export function getProfileModelName(profile: AIProfile) {
  return profile.modelName || profile.model
}

export function thinkingAdapter(profile: Pick<AIProfile, 'protocol' | 'baseUrl' | 'model'>) {
  let host: string
  try {
    host = new URL(profile.baseUrl).hostname
  } catch {
    return 'default'
  }
  const model = profile.model.toLowerCase()
  if (profile.protocol === 'openai-chat') {
    if (host === 'api.deepseek.com' && /^(deepseek-flash|deepseek-v4-pro)$/.test(model))
      return 'deepseek'
    if (['api.moonshot.cn', 'api.moonshot.ai'].includes(host) && model === 'kimi-k3')
      return 'kimi-k3'
    if (
      [
        'api.xiaomimimo.com',
        'token-plan-cn.xiaomimimo.com',
        'token-plan-sgp.xiaomimimo.com',
        'token-plan-ams.xiaomimimo.com',
      ].includes(host) &&
      /^mimo-v2\.5(?:-pro)?$/.test(model)
    )
      return 'toggle'
    if (['api.moonshot.cn', 'api.moonshot.ai'].includes(host) && model === 'kimi-k2.6')
      return 'toggle'
  }
  if (profile.protocol === 'gemini' && /^gemini-2\.5-(flash|pro)(?:-|$)/.test(model))
    return model.includes('-pro') ? 'gemini-pro' : 'gemini-flash'
  return 'default'
}

export function getThinkingOptions(
  profile: Pick<AIProfile, 'protocol' | 'baseUrl' | 'model'>,
): AIThinking[] {
  switch (thinkingAdapter(profile)) {
    case 'deepseek':
    case 'kimi-k3':
      return ['auto', 'off', 'low', 'high', 'max']
    case 'toggle':
      return ['auto', 'off', 'on']
    case 'gemini-pro':
      return ['auto', 'low', 'medium', 'high']
    case 'gemini-flash':
      return ['auto', 'off', 'low', 'medium', 'high']
    default:
      return ['auto']
  }
}
