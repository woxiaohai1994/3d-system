'use client'

import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { Zap } from 'lucide-react'
import { useState } from 'react'
import { useAIExecutionMode } from '../ai-execution-mode'
import { useAIText } from '../copy'

export function AutoApplyControl() {
  const t = useAIText()
  const enabled = useAIExecutionMode((s) => s.autoApply)
  const [confirming, setConfirming] = useState(false)
  return (
    <AlertDialog.Root open={confirming} onOpenChange={setConfirming}>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={t('Auto-apply changes')}
        title={t(
          enabled
            ? 'Auto-apply is on. Click to turn off.'
            : 'Review each preview before applying changes.',
        )}
        className={`ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-sidebar-primary/40 ${enabled ? 'bg-sidebar-primary/10 text-sidebar-primary' : 'text-muted-foreground'}`}
        onClick={() =>
          enabled ? useAIExecutionMode.setState({ autoApply: false }) : setConfirming(true)
        }
      >
        <Zap className="h-3 w-3" />
        {t(enabled ? 'Auto-apply on' : 'Auto-apply off')}
        <span
          aria-hidden
          className={`relative h-3.5 w-6 rounded-full transition-colors ${enabled ? 'bg-sidebar-primary' : 'bg-muted-foreground/30'}`}
        >
          <span
            className={`absolute left-0 top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-3' : 'translate-x-0.5'}`}
          />
        </span>
      </button>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[110] bg-black/55 backdrop-blur-sm" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[111] w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-popover p-5 text-foreground shadow-2xl">
          <AlertDialog.Title className="text-base font-semibold">
            {t('Enable automatic application?')}
          </AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">
              <p>
                {t(
                  'Future validated previews will be applied directly, without asking you to confirm each round. AI may add, modify or delete scene objects, and continued requests may use more API credits.',
                )}
              </p>
              <p>
                {t(
                  'Save your scene first. You can turn this off or stop AI at any time. Already applied changes remain until you undo them in operation history.',
                )}
              </p>
              <p>
                {t(
                  'AI questions still wait for your answer. Any preview already awaiting confirmation still needs your approval. This setting resets when you reload or switch projects.',
                )}
              </p>
            </div>
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">
              {t('Keep manual review')}
            </AlertDialog.Cancel>
            <AlertDialog.Action
              className="rounded-lg bg-sidebar-primary px-4 py-2 text-sm text-white hover:bg-sidebar-primary/90"
              onClick={() => useAIExecutionMode.setState({ autoApply: true })}
            >
              {t('Confirm and enable')}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
