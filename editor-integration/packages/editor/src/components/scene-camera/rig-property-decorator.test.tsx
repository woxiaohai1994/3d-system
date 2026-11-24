import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { SourceDecorator, sourceDecoratorState } from './rig-property-decorator'
import source from './rig-property-decorator-source.json'
import type { SourceBindings } from './rig-source-panel'
import { rigSourceUI, type SourceLayout } from './rig-source-ui'

test('decorator source and SVG assets match the fixed Blender files', () => {
  for (const [name, hash] of Object.entries(source.hashes)) {
    const file = readFileSync(
      new URL(`../../../../../vendor/blender-property-decorators/${name}`, import.meta.url),
    )
    expect(createHash('sha256').update(file).digest('hex')).toBe(hash)
    if (name.endsWith('.svg'))
      expect(source.icons[name.slice(0, -4) as keyof typeof source.icons]).toBe(
        `data:image/svg+xml;base64,${file.toString('base64')}`,
      )
  }
})

test('source callback priority distinguishes drivers, current keys, other keys and overrides', () => {
  expect(sourceDecoratorState({})).toMatchObject({ icon: 'decorate', action: 'insert', all: true })
  expect(sourceDecoratorState({ animated: true })).toMatchObject({
    icon: 'decorate_animate',
    action: 'insert',
  })
  expect(sourceDecoratorState({ animated: true, keyed: true })).toMatchObject({
    icon: 'decorate_keyframe',
    action: 'delete',
  })
  expect(sourceDecoratorState({ driven: true, animated: true, keyed: true })).toMatchObject({
    icon: 'decorate_driver',
    action: 'none',
  })
  expect(sourceDecoratorState({ overridden: true })).toMatchObject({
    icon: 'decorate_override',
    action: 'insert',
  })
  expect(sourceDecoratorState({ animated: true, overridden: true }).icon).toBe('decorate_animate')
  for (const index of [0, 1, 2]) {
    expect(sourceDecoratorState({}, index).all).toBe(false)
    expect(sourceDecoratorState({ keyed: true }, index).all).toBe(false)
  }
  expect(sourceDecoratorState({ disabled: true }).disabled).toBe(true)
  expect(sourceDecoratorState({ inactive: true }).disabled).toBe(true)
})

const flatten = (tree: SourceLayout): SourceLayout[] => [tree, ...tree.children.flatMap(flatten)]
const entries = (key: string) =>
  rigSourceUI.variants[key]!.flatMap((entry) => [
    ...flatten(rigSourceUI.trees[entry.body]!),
    ...(entry.header === undefined ? [] : flatten(rigSourceUI.trees[entry.header]!)),
  ])
const property = (nodes: SourceLayout[], name: string, kind = 'prop') =>
  nodes.find((n) => n.kind === kind && n.options.property === name)!

test('layout captures flags when children are created, not the final parent flags', () => {
  const nodes = entries('dolly:PERSP:0:1:manual:1:1')
  expect(property(nodes, '["lens"]').options.decorate).toBe(true)
  expect(property(nodes, 'show_in_front').options.decorate).toBe(true)
  expect(property(nodes, 'influence').options.decorate).toBe(true)
  // The parent enables splitting only after this column has already been drawn.
  expect(property(nodes, 'hide_select').options.decorate).toBe(false)
  expect(property(nodes, 'use_dof').options.decorate).toBe(false)
  expect(property(nodes, 'passepartout_alpha').options.decorate).toBe(false)
  expect(property(nodes, 'passepartout_alpha', 'decorator').options.rna?.is_animatable).toBe(true)
  expect(property(nodes, 'acr_focus_object', 'search').options.decorate).toBeUndefined()
  expect(property(nodes, 'acr_focus_object', 'search').options.rna?.is_animatable).toBe(false)
})

test('RNA driver paths, array indices and the attached property disabled state survive export', () => {
  const nodes = entries('crane:PERSP:1:1:manual:1:0')
  expect(property(nodes, 'lens').options.rna).toMatchObject({
    data_path: 'lens',
    driven_indices: [0],
  })
  expect(property(nodes, 'scale').options).toMatchObject({ index: 1, decorate: true })
  expect(property(nodes, 'passepartout_alpha', 'decorator').options.ui_enabled).toBe(false)
  const enabled = entries('crane:PERSP:1:1:manual:1:1')
  expect(property(enabled, 'passepartout_alpha', 'decorator').options.ui_enabled).toBe(true)
})

test('decorators render source icons, a Chinese property label and native disabled states', () => {
  const tree = property(entries('dolly:PERSP:0:1:manual:1:1'), '["lens"]')
  const bindings: SourceBindings = {
    property: () => ({ value: 50, change: () => {} }),
    operator: () => ({ run: () => {} }),
    decorate: () => ({ keyed: true, animated: true, run: () => {} }),
  }
  const markup = renderToStaticMarkup(<SourceDecorator tree={tree} bindings={bindings} />)
  expect(markup).toContain('焦距 · 删除关键帧')
  expect(markup).toContain('data-animation-state="decorate_keyframe"')
  expect(markup).not.toContain('disabled=""')
  const inactive = property(
    entries('dolly:PERSP:0:1:manual:1:0'),
    'passepartout_alpha',
    'decorator',
  )
  expect(renderToStaticMarkup(<SourceDecorator tree={inactive} bindings={bindings} />)).toContain(
    'disabled=""',
  )
  const unavailable = { ...bindings, decorate: undefined }
  const pending = renderToStaticMarkup(<SourceDecorator tree={tree} bindings={unavailable} />)
  expect(pending).toContain('属性关键帧尚未接入')
  expect(pending).toContain('disabled=""')
})
