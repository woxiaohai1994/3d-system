// SPDX-License-Identifier: GPL-2.0-or-later
import { useI18n } from '../../i18n'
import source from './rig-property-decorator-source.json'
import { rigSourcePropertyText, rigSourceText } from './rig-source-i18n'
import type { SourceBindings } from './rig-source-panel'
import type { SourceLayout } from './rig-source-ui'

export type SourceDecoratorAction = {
  keyed: boolean
  animated: boolean
  overridden?: boolean
  run: (operation: 'insert' | 'delete', all: boolean) => void
}

export function sourceDecoratorState(
  flags: {
    animated?: boolean
    keyed?: boolean
    driven?: boolean
    overridden?: boolean
    disabled?: boolean
    inactive?: boolean
  },
  index = -1,
) {
  const mask = [
    flags.animated,
    flags.keyed,
    flags.driven,
    flags.overridden,
    flags.disabled,
    flags.inactive,
  ].reduce((value, flag, bit) => value | (flag ? 1 << bit : 0), 0)
  const state = source.states[mask]!
  return { ...state, all: state.all[index === -1 ? 0 : 1]! }
}

export function SourceDecorator({
  tree,
  bindings,
}: {
  tree: SourceLayout
  bindings: SourceBindings
}) {
  const zh = useI18n().locale === 'zh-CN'
  const o = tree.options,
    rna = o.rna
  if (!rna?.is_animatable) return <span aria-hidden="true" className="inline-block w-5 shrink-0" />
  const field = bindings.property(tree)
  const action = bindings.decorate?.(tree)
  const driven = rna.driven_indices?.some((index) => o.index === undefined || o.index === index)
  const state = sourceDecoratorState(
    {
      animated: action?.animated,
      keyed: action?.keyed,
      overridden: action?.overridden,
      driven,
      disabled: field.disabled || rna.is_readonly,
      inactive: o.ui_enabled === false,
    },
    rna.is_array ? (o.index ?? -1) : 0,
  )
  const operation = state.action
  const text = (value: string) => rigSourceText(value, zh)
  const label = text(
    driven ? 'Driven property' : operation === 'delete' ? 'Delete Keyframe' : 'Insert Keyframe',
  )
  const property = rigSourcePropertyText(tree, zh) || text(rna.name)
  return (
    <button
      type="button"
      data-source-decorator={`${o.owner}.${o.path}.${o.property}`}
      data-animation-state={state.icon}
      aria-label={`${property} · ${label}`}
      title={text(
        driven
          ? 'Property is driven'
          : !action
            ? 'Property keyframes are not connected yet'
            : 'Animate property',
      )}
      disabled={state.disabled || !action}
      onClick={() => {
        if (operation === 'insert' || operation === 'delete') action?.run(operation, state.all)
      }}
      className="inline-flex h-6 w-5 shrink-0 items-center justify-center disabled:opacity-30"
    >
      <img
        alt=""
        width={16}
        height={16}
        src={source.icons[state.icon as keyof typeof source.icons]}
      />
    </button>
  )
}
