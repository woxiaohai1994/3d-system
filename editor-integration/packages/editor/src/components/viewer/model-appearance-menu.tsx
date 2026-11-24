'use client'

import { useViewer } from '@pascal-app/viewer'
import { Box, Contrast, Palette } from 'lucide-react'
import { useI18n } from '../../i18n'
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '../ui/primitives/dropdown-menu'

const MODES = [
  { id: 'materials', label: 'With materials', icon: Palette },
  { id: 'clay', label: 'No materials (clay)', icon: Box },
  { id: 'depth', label: 'Depth map', icon: Contrast },
] as const

export function ModelAppearanceMenu() {
  const { t } = useI18n()
  const textures = useViewer((s) => s.textures)
  const depthMode = useViewer((s) => s.depthMode)
  const depthRange = useViewer((s) => s.depthRange)
  const mode = depthMode ? 'depth' : textures ? 'materials' : 'clay'
  const active = MODES.find((option) => option.id === mode)!

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <active.icon className="h-4 w-4" />
        <span>{t('Model appearance')}</span>
        <span className="ml-auto text-muted-foreground text-xs">{t(active.label)}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-60 rounded-xl border-border/45 bg-popover/95 backdrop-blur-xl">
        <DropdownMenuRadioGroup
          onValueChange={(value) => {
            if (value === 'materials' || value === 'clay' || value === 'depth') {
              useViewer.getState().setModelAppearance(value)
            }
          }}
          value={mode}
        >
          {MODES.map((option) => (
            <DropdownMenuRadioItem
              key={option.id}
              onSelect={(event) => event.preventDefault()}
              value={option.id}
            >
              <option.icon className="h-4 w-4" />
              {t(option.label)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {depthMode && (
          <>
            <DropdownMenuSeparator />
            <div className="space-y-2 px-2 py-2 text-xs">
              <p className="text-muted-foreground">{t('Near is white, far is black')}</p>
              <p>{t('Depth range (m)')}</p>
              <div className="flex gap-2">
                {(['near', 'far'] as const).map((edge) => (
                  <label className="flex min-w-0 flex-1 flex-col gap-1" key={edge}>
                    {t(edge === 'near' ? 'Near distance' : 'Far distance')}
                    <input
                      className="w-full rounded border border-border bg-background px-2 py-1 text-foreground"
                      defaultValue={depthRange[edge]}
                      key={depthRange[edge]}
                      max={10000}
                      min={0}
                      onBlur={(event) => {
                        const value = event.currentTarget.valueAsNumber
                        if (Number.isFinite(value)) {
                          useViewer.getState().setDepthRange({ ...depthRange, [edge]: value })
                        }
                        event.currentTarget.value = String(useViewer.getState().depthRange[edge])
                      }}
                      onKeyDown={(event) => {
                        event.stopPropagation()
                        if (event.key === 'Enter') event.currentTarget.blur()
                      }}
                      step={0.1}
                      type="number"
                    />
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
