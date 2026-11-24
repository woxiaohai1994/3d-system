import { createAIHandler } from '@/lib/integration-ai/provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const POST = createAIHandler('summarize')
