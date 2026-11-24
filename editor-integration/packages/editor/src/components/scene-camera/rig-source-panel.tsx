// SPDX-License-Identifier: GPL-3.0-or-later
import type { MouseEvent, ReactNode } from 'react'
import { useI18n } from '../../i18n'
import { CameraPanelTabs, type CameraSettingsTab } from './camera-panel-tabs'
import type { SourceNumberEdit } from './rig-number-drag'
import { SourceDecorator, type SourceDecoratorAction } from './rig-property-decorator'
import { rigSourcePropertyText, rigSourceText } from './rig-source-i18n'
import { SourceNumber, sourceInputStyle } from './rig-source-number'
import { rigSourceUI, type SourceLayout, type SourceUIEntry } from './rig-source-ui'
import icons from './rig-ui-icons-source.json'

function SourceIcon({ name }: { name?: string }) {
  if (!name) return null
  const src = icons.icons[name as keyof typeof icons.icons]
  if (!src) throw new Error(`Missing upstream icon ${name}`)
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      data-source-icon={name}
      className="inline-block size-4 shrink-0 align-middle"
    />
  )
}

export type SourceField = {
  value: number | boolean | string
  change: (value: number | boolean | string) => void
  choices?: { value: string; label: string; disabled?: boolean }[]
  disabled?: boolean
  reason?: string
  min?: number
  max?: number
  arrayRange?: readonly [number, number]
  beginDrag?: () => SourceNumberEdit
}
export type SourceBindings = {
  property: (layout: SourceLayout) => SourceField
  operator: (id: string) => {
    run: (event?: MouseEvent<HTMLButtonElement>) => void
    disabled?: boolean
    reason?: string
  }
  decorate?: (layout: SourceLayout) => SourceDecoratorAction | undefined
}

function SourceTree({
  tree,
  bindings,
  entries,
}: {
  tree: SourceLayout
  bindings: SourceBindings
  entries: SourceUIEntry[]
}): ReactNode {
  const zh = useI18n().locale === 'zh-CN'
  const text = (value: string | undefined) => rigSourceText(value, zh)
  const o = tree.options
  const children = tree.children.map((child, i) => (
    <SourceTree key={i} tree={child} bindings={bindings} entries={entries} />
  ))
  if (['layout', 'column', 'row'].includes(tree.kind))
    return (
      <fieldset
        disabled={o.enabled === false || o.active === false}
        className={`${tree.kind === 'row' ? 'flex items-center gap-1' : 'min-w-0 space-y-1'} flex-1 border-0 p-0 disabled:opacity-50`}
      >
        {o.heading && <div className="pt-1 text-xs text-[#aaa]">{text(o.heading)}</div>}
        {children}
      </fieldset>
    )
  if (tree.kind === 'separator') return <div className="h-2" />
  if (tree.kind === 'label')
    return (
      <p className="flex items-center gap-1 text-xs">
        <SourceIcon name={o.icon} />
        {text(o.text)}
      </p>
    )
  if (tree.kind === 'decorator') return <SourceDecorator tree={tree} bindings={bindings} />
  if (tree.kind === 'operator') {
    const action = bindings.operator(o.operator!)
    return (
      <button
        type="button"
        data-source-operator={o.operator}
        disabled={action.disabled}
        title={text(action.reason ?? o.description)}
        onClick={(event) => {
          action.run(event)
          const menu = event.currentTarget.closest('details[data-source-menu]')
          if (menu) menu.removeAttribute('open')
        }}
        className="h-6 w-full rounded-[3px] border border-[#222] bg-[#545454] px-2 text-xs hover:bg-[#626262] disabled:opacity-40"
      >
        <SourceIcon name={o.icon} /> {text(o.text ?? o.label)}
      </button>
    )
  }
  if (tree.kind === 'menu' || tree.kind === 'popover') {
    const content =
      tree.kind === 'popover'
        ? rigSourceUI.composition
        : rigSourceUI.trees[entries.find((entry) => entry.menu === o.menu)!.body]!
    return (
      <details data-source-menu className="relative text-xs">
        <summary
          aria-label={text(o.menu ? 'Camera Rig Lens Specials' : o.text)}
          className="cursor-pointer list-none rounded-[3px] border border-[#222] bg-[#545454] px-2 py-1"
        >
          {o.icon ? <SourceIcon name={o.icon} /> : text(o.text) || '▾'}
        </summary>
        <div className="absolute right-0 z-50 w-60 rounded border border-[#222] bg-[#303030] p-2 shadow-xl">
          <SourceTree tree={content} bindings={bindings} entries={entries} />
        </div>
      </details>
    )
  }
  if (tree.kind === 'prop' || tree.kind === 'search') {
    if (o.rna?.type === 'MISSING') return null
    const field = bindings.property(tree)
    const label = rigSourcePropertyText(tree, zh)
    const accessible = label || text(o.rna!.name)
    const id = `${o.owner}.${o.path}.${o.property}`
    const control = field.choices ? (
      <select
        aria-label={accessible}
        className={sourceInputStyle}
        disabled={field.disabled}
        value={String(field.value)}
        onChange={(e) => field.change(e.target.value)}
      >
        {field.choices.map((choice) => (
          <option key={choice.value} value={choice.value} disabled={choice.disabled}>
            {choice.label}
          </option>
        ))}
      </select>
    ) : typeof field.value === 'boolean' ? (
      <input
        type="checkbox"
        aria-label={accessible}
        disabled={field.disabled}
        checked={field.value}
        onChange={(e) => field.change(e.target.checked)}
      />
    ) : (
      <SourceNumber
        field={field}
        label={accessible}
        subtype={o.rna?.subtype}
        integer={o.rna?.type === 'INT'}
        precision={o.rna?.precision ?? 3}
        step={(o.rna?.step ?? 1) / 100}
        min={field.min ?? o.rna?.min ?? o.rna?.hard_min}
        max={field.max ?? o.rna?.max ?? o.rna?.hard_max}
        softMin={o.rna?.soft_min}
        softMax={o.rna?.soft_max}
        slider={['FACTOR', 'PERCENTAGE'].includes(o.rna?.subtype ?? '')}
      />
    )
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <label
          data-source-property={id}
          title={text(field.reason ?? o.rna?.description)}
          className={`flex min-w-0 items-center gap-2 text-xs ${typeof field.value === 'boolean' ? 'flex-row-reverse justify-end' : 'flex-1'}`}
        >
          {label && (
            <span className={typeof field.value === 'boolean' ? '' : 'w-[44%] shrink-0 text-right'}>
              {label}
            </span>
          )}
          {control}
        </label>
        {o.decorate && <SourceDecorator tree={tree} bindings={bindings} />}
      </div>
    )
  }
  throw new Error(`Unsupported source layout ${tree.kind}`)
}

export function RigSourceLayout({
  tree,
  bindings,
}: {
  tree: SourceLayout
  bindings: SourceBindings
}) {
  return <SourceTree tree={tree} bindings={bindings} entries={[]} />
}

export function RigSourcePanel({
  entries,
  bindings,
  framingControls,
  rigControls,
  defaultTab = 'framing',
  disabled = false,
  onTabChange,
}: {
  entries: SourceUIEntry[]
  bindings: SourceBindings
  framingControls?: ReactNode
  rigControls?: ReactNode
  defaultTab?: CameraSettingsTab
  disabled?: boolean
  onTabChange?: (tab: string) => void
}) {
  const zh = useI18n().locale === 'zh-CN'
  const groups = [
    {
      id: 'framing',
      label: zh ? '构图' : 'Framing',
      panel: 'ADD_CAMERA_RIGS_PT_camera_rig_ui',
      controls: framingControls,
    },
    { id: 'focus', label: zh ? '景深' : 'Focus', panel: 'ADD_CAMERA_RIGS_PT_camera_rig_ui_dof' },
    {
      id: 'rig',
      label: zh ? '相机架' : 'Rig',
      panel: 'ADD_CAMERA_RIGS_PT_camera_rig_ui_visibility',
      controls: rigControls,
    },
    {
      id: 'display',
      label: zh ? '显示' : 'Display',
      panel: 'ADD_CAMERA_RIGS_PT_camera_rig_ui_viewport',
    },
  ]
  return (
    <section
      aria-label={rigSourceText('Camera Rig', zh)}
      data-camera-rig-source={rigSourceUI.source.commit}
    >
      <CameraPanelTabs
        label={zh ? '相机设置分类' : 'Camera settings'}
        defaultTab={defaultTab}
        onTabChange={onTabChange}
        tabs={groups.map((group) => {
          const entry = entries.find((item) => item.panel === group.panel)!
          const panel = rigSourceUI.panels.find((item) => item.id === group.panel)!
          return {
            id: group.id,
            label: group.label,
            content: (
              <fieldset disabled={disabled} className="min-w-0 space-y-3 disabled:opacity-50">
                {group.controls}
                <section
                  aria-label={rigSourceText(panel.label, zh)}
                  className="space-y-2 rounded border border-[#222] bg-[#303030] p-2 text-[#ddd]"
                >
                  {entry.header !== undefined && (
                    <div className="flex items-center gap-2 border-b border-[#555] pb-2 text-xs">
                      <SourceTree
                        tree={rigSourceUI.trees[entry.header]!}
                        bindings={bindings}
                        entries={entries}
                      />
                      <span>{rigSourceText(panel.label, zh)}</span>
                    </div>
                  )}
                  <SourceTree
                    tree={rigSourceUI.trees[entry.body]!}
                    bindings={bindings}
                    entries={entries}
                  />
                </section>
              </fieldset>
            ),
          }
        })}
      />
    </section>
  )
}
