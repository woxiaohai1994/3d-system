'use client'

import { MessageCircleQuestion, RefreshCw, RotateCcw, Send, Trash2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import {
  type KeyboardEvent,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { cn } from '../../lib/utils'
import {
  answerPendingQuestion,
  confirmOperationsFromUI,
  rejectOperationsFromUI,
  retryLastAgentRun,
  runAgentLoop,
  stopAI,
} from './ai-agent-loop'
import { useAIChat } from './ai-chat-store'
import { confirmActiveProposal, rejectAllProposals, switchToProposal } from './ai-proposal-manager'
import { AutoApplyControl } from './chat-ui/auto-apply-control'
import { MessageBubble } from './chat-ui/message-bubble'
import { OperationHistoryPanel, PendingOperationCard } from './chat-ui/operation-cards'
import { ProposalTabs } from './chat-ui/proposal-cards'
import { StreamingIndicator } from './chat-ui/streaming-indicator'
import { useAIText } from './copy'
import { getAIRuntime } from './runtime'
import type { ChatMessage } from './types'

// ============================================================================
// Chat Panel Component
// ============================================================================

export function AIChatPanel({
  configured = true,
  draft,
  onDraftChange,
  onConfigure,
  composerControls,
}: {
  composerControls?: ReactNode
  configured?: boolean
  draft?: string
  onDraftChange?: (value: string) => void
  onConfigure?: () => void
}) {
  const t = useAIText()
  // Fine-grained selectors — each selector only re-renders when its
  // specific slice changes. streamingContent updates dozens of times per second
  // during streaming; isolating it in StreamingIndicator prevents the entire
  // panel (message list, input area, etc.) from re-rendering on every chunk.
  const messages = useAIChat((s) => s.messages)
  const isStreaming = useAIChat((s) => s.isStreaming)
  const isAIProcessing = useAIChat((s) => s.isAIProcessing)
  const error = useAIChat((s) => s.error)
  const proposals = useAIChat((s) => s.proposals)
  const activeProposalId = useAIChat((s) => s.activeProposalId)
  const pendingQuestion = useAIChat((s) => s.pendingQuestion)
  const operationLog = useAIChat((s) => s.operationLog)
  const addUserMessage = useAIChat((s) => s.addUserMessage)
  const clearChat = useAIChat((s) => s.clearChat)
  const clearError = useAIChat((s) => s.clearError)
  const undoOperation = useAIChat((s) => s.undoOperation)

  const [localInput, setLocalInput] = useState('')
  const input = draft ?? localInput
  const setInput = onDraftChange ?? setLocalInput
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [resourceStatus, setResourceStatus] = useState<number | null>(null)
  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isStreaming])

  // Keep focus on textarea after React re-renders (message sent, streaming, operations, etc.)
  useEffect(() => {
    const timer = setTimeout(() => textareaRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [messages])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [input])

  // Listen for placement option selections (debounced to prevent double-fire)
  const lastOptionSentRef = useRef('')
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent).detail as string
      if (configured && text && !isAIProcessing && text !== lastOptionSentRef.current) {
        lastOptionSentRef.current = text
        addUserMessage(text)
        runAgentLoop({
          userMessage: text,
          catalogSummary: getAIRuntime().catalog.generateSummary(),
        })
        // Reset after a short delay to allow same option in future
        setTimeout(() => {
          lastOptionSentRef.current = ''
        }, 2000)
      }
    }
    window.addEventListener('ai-select-option', handler)
    return () => window.removeEventListener('ai-select-option', handler)
  }, [addUserMessage, isAIProcessing, configured])

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming || (isAIProcessing && !pendingQuestion)) return
    if (!configured) {
      onConfigure?.()
      return
    }

    // If there's a pending question, answer it instead of starting a new loop
    if (pendingQuestion) {
      setInput('')
      answerPendingQuestion(trimmed)
      textareaRef.current?.focus()
      return
    }

    setInput('')
    addUserMessage(trimmed)

    // Start the agentic loop — all business logic is in ai-agent-loop.ts
    runAgentLoop({
      userMessage: trimmed,
      catalogSummary: getAIRuntime().catalog.generateSummary(),
    })

    // Keep textarea focused after sending
    textareaRef.current?.focus()
  }, [
    input,
    configured,
    isStreaming,
    isAIProcessing,
    pendingQuestion,
    addUserMessage,
    setInput,
    onConfigure,
  ])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const handleProposalConfirm = useCallback(() => {
    const ops = confirmActiveProposal()
    if (ops) {
      const pendingMsg = [...messages]
        .reverse()
        .find((m) => m.operationStatus === 'pending' && m.operations?.length)
      if (pendingMsg) {
        void confirmOperationsFromUI(pendingMsg.id, ops)
      }
    }
  }, [messages])

  const handleProposalReject = useCallback(() => {
    rejectAllProposals()
    const pendingMsg = [...messages]
      .reverse()
      .find((m) => m.operationStatus === 'pending' && m.operations?.length)
    if (pendingMsg) {
      rejectOperationsFromUI(pendingMsg.id)
    }
  }, [messages])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Messages Area */}
      <div
        role="log"
        className="subtle-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-4"
      >
        {messages.length === 0 && !isStreaming ? (
          <EmptyState onSuggestionClick={(text) => setInput(text)} />
        ) : (
          <div className="flex flex-col gap-3">
            {/* MessageList renders only when messages array changes */}
            <MessageList messages={messages} />

            {/* StreamingIndicator has its own subscription to
                streamingContent and isStreaming, so high-frequency chunk
                updates only re-render this small component. */}
            <StreamingIndicator messagesEndRef={messagesEndRef} />

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Error Banner */}
      <AnimatePresence>
        {error && (
          <motion.div
            animate={{ height: 'auto', opacity: 1 }}
            className="overflow-hidden border-destructive/30 border-t bg-destructive/10 px-3 py-2"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-barlow text-destructive text-xs">{t(error)}</p>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  className="flex items-center gap-1 rounded border border-destructive/30 px-1.5 py-0.5 font-barlow text-[11px] text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => {
                    clearError()
                    retryLastAgentRun()
                  }}
                  type="button"
                >
                  <RotateCcw className="h-3 w-3" />
                  {t('Retry')}
                </button>
                <button
                  className="text-destructive/60 hover:text-destructive"
                  aria-label={t('Close')}
                  onClick={clearError}
                  type="button"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Operation History */}
      {operationLog.length > 0 && (
        <OperationHistoryPanel logs={operationLog} onUndo={undoOperation} />
      )}

      <div className="shrink-0" aria-live="polite">
        {/* Proposal Tabs (multi-proposal comparison mode) */}
        {proposals.length > 1 && (
          <ProposalTabs
            activeProposalId={activeProposalId}
            onConfirm={handleProposalConfirm}
            onReject={handleProposalReject}
            onSwitch={switchToProposal}
            proposals={proposals}
          />
        )}

        {proposals.length < 2 && (
          <PendingOperationCard
            messages={messages}
            onConfirm={confirmOperationsFromUI}
            onReject={rejectOperationsFromUI}
          />
        )}
        {pendingQuestion && (
          <div className="px-3 pt-2.5 pb-1">
            <PendingQuestionCard
              question={pendingQuestion.question}
              suggestions={pendingQuestion.suggestions}
              onSuggestionClick={(answer) => {
                answerPendingQuestion(answer)
                textareaRef.current?.focus()
              }}
            />
          </div>
        )}
      </div>
      <div className="shrink-0 space-y-2 border-border/50 border-t px-3 pb-3 pt-2.5">
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <button
            type="button"
            className="flex items-center gap-1.5 transition-colors hover:text-foreground disabled:opacity-40"
            disabled={isAIProcessing || isStreaming || !!pendingQuestion}
            title={t('Refresh resources after adding models')}
            onClick={() => {
              const count = getAIRuntime().catalog.refresh?.()
              setResourceStatus(typeof count === 'number' ? count : 0)
            }}
          >
            <RefreshCw className="h-3 w-3" />
            {t('Refresh model resources')}
          </button>
          <AutoApplyControl />
          {resourceStatus !== null && (
            <span role="status">
              {resourceStatus
                ? t('{count} models loaded', { count: resourceStatus })
                : t('Resources refreshed')}
            </span>
          )}
        </div>
        <div
          data-ai-composer
          className="overflow-hidden rounded-xl border border-input bg-accent/30 shadow-xs transition-colors focus-within:border-sidebar-primary/60 focus-within:ring-1 focus-within:ring-sidebar-primary/20"
        >
          <textarea
            ref={textareaRef}
            className="subtle-scrollbar block max-h-[min(160px,25dvh)] min-h-[64px] w-full resize-none bg-transparent px-3 pt-3 pb-2 font-barlow text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/60"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label={t('Describe your design changes...')}
            placeholder={t(
              pendingQuestion ? 'Answer AI question...' : 'Describe your design changes...',
            )}
            title={t('Enter to send · Shift+Enter for new line')}
            rows={2}
            value={input}
          />
          <div className="flex min-h-10 items-center justify-between gap-2 px-2.5 pb-2">
            {composerControls ?? (
              <span className="text-[10px] text-muted-foreground/70">
                {t('Enter to send · Shift+Enter for new line')}
              </span>
            )}
            {isStreaming || (isAIProcessing && !pendingQuestion) ? (
              <button
                className="flex h-8 shrink-0 items-center rounded-lg bg-accent px-3 text-xs text-foreground hover:bg-muted"
                onClick={stopAI}
                type="button"
              >
                {t('Stop')}
              </button>
            ) : (
              <button
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-primary',
                  input.trim()
                    ? 'bg-sidebar-primary text-white hover:bg-sidebar-primary/90'
                    : 'bg-accent text-muted-foreground/40',
                )}
                aria-label={t('Send')}
                title={t(configured ? 'Send' : 'Configure API to send')}
                disabled={!input.trim()}
                onClick={handleSend}
                type="button"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          {!configured ? (
            <button className="text-left hover:text-foreground" type="button" onClick={onConfigure}>
              {t('Configure API to send · Your draft is kept')}
            </button>
          ) : (
            <span />
          )}
          {messages.length > 0 && (
            <button
              className="ml-auto flex shrink-0 items-center gap-1 transition-colors hover:text-foreground"
              onClick={clearChat}
              type="button"
            >
              <Trash2 className="h-3 w-3" />
              {t('Clear chat')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// MessageList — only re-renders when messages array reference changes
// ============================================================================

const MessageList = memo(function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <>
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
    </>
  )
})

// ============================================================================
// Empty State
// ============================================================================

const SUGGESTION_CHIPS = [
  'Place a sofa and coffee table in the living room',
  'Help me furnish a bedroom',
  'Add lighting fixtures',
  'Rearrange the furniture',
]

function EmptyState({ onSuggestionClick }: { onSuggestionClick: (text: string) => void }) {
  const t = useAIText()
  return (
    <div className="flex h-full flex-col items-center justify-center px-4">
      <div className="grid w-full grid-cols-1 gap-1.5">
        {SUGGESTION_CHIPS.map((text) => (
          <button
            className="rounded-lg border border-border/50 bg-accent/30 px-3 py-2 text-left font-barlow text-xs transition-colors hover:bg-accent/60"
            key={text}
            onClick={() => onSuggestionClick(t(text))}
            type="button"
          >
            {t(text)}
          </button>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Pending Question Card (AI asks user a question)
// ============================================================================

function PendingQuestionCard({
  question,
  suggestions,
  onSuggestionClick,
}: {
  question: string
  suggestions?: string[]
  onSuggestionClick: (suggestion: string) => void
}) {
  const t = useAIText()
  return (
    <motion.div
      role="region"
      aria-label={t('Waiting for your answer')}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-2"
      initial={{ opacity: 0, y: 8 }}
    >
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-yellow-500/20">
        <MessageCircleQuestion className="h-3.5 w-3.5 text-yellow-500" />
      </div>
      <div className="min-w-0 flex-1 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-3 py-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <strong className="text-xs text-yellow-500">{t('Waiting for your answer')}</strong>
          <button
            type="button"
            onClick={stopAI}
            className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
          >
            {t('Stop')}
          </button>
        </div>
        <p className="subtle-scrollbar max-h-[min(160px,22dvh)] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6">
          {question}
        </p>
        {suggestions && suggestions.length > 0 && (
          <div className="subtle-scrollbar mt-2 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
            {suggestions.map((s) => (
              <button
                className="rounded-md border border-border/50 bg-accent/30 px-2 py-1 font-barlow text-[11px] transition-colors hover:bg-accent/60"
                key={s}
                onClick={() => onSuggestionClick(s)}
                type="button"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}
