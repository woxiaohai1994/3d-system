import { expect, test } from 'bun:test'
import { extend } from '@react-three/fiber'
import { create } from '@react-three/test-renderer'
import { act, type ComponentProps, useState } from 'react'
import { Object3D } from 'three'
import reference from '../../../../../tests/integration/fixtures/blender-number-events.json'
import { defaultSceneUnits } from './rig-numinput-units'
import type { RigPythonRunner } from './rig-python-runtime'
import { SourceNumber } from './rig-source-number'

class NumberHost extends Object3D {
  aria = { invalid: false, busy: false }
}
extend({ Span: NumberHost, Input: NumberHost, Svg: NumberHost, Polygon: NumberHost })

class InputBoundary extends EventTarget {
  tagName = 'INPUT'
  isContentEditable = false
  disabled = false
  focused = false
  value = ''
  selectionStart: number | null = 0
  selectionEnd: number | null = 0
  setRangeText(text: string, start: number, end: number) {
    this.value = this.value.slice(0, start) + text + this.value.slice(end)
    this.selectionStart = this.selectionEnd = start + text.length
  }
  dataset: Record<string, string> = {}
  selected = 0
  pointers = new Set<number>()
  onBlur = () => {}
  getBoundingClientRect() {
    return { left: 100, top: 0, width: 160, height: 24 } as DOMRect
  }
  matches() {
    return this.disabled
  }
  focus() {
    this.focused = true
  }
  blur() {
    if (!this.focused) return
    this.focused = false
    this.onBlur()
  }
  select() {
    this.selected++
  }
  setPointerCapture(id: number) {
    this.pointers.add(id)
  }
  hasPointerCapture(id: number) {
    return this.pointers.has(id)
  }
  releasePointerCapture(id: number) {
    this.pointers.delete(id)
    this.dispatchEvent(new Event('lostpointercapture'))
  }
}

function event(type: string, target: EventTarget, extra: Record<string, unknown> = {}) {
  const next = new Event(type, { cancelable: true, bubbles: true })
  for (const [key, value] of Object.entries({
    target,
    currentTarget: target,
    clientX: 180,
    pointerId: 1,
    button: 0,
    ctrlKey: false,
    shiftKey: false,
    isComposing: false,
    ...extra,
  }))
    Object.defineProperty(next, key, { value })
  return next
}

async function fixture({
  value = 47,
  min = -100,
  max = 100,
  softMin = -100,
  softMax = 100,
  step = 0.01,
  slider = false,
  disabled = false,
  subtype = 'NONE',
  integer = false,
  units = defaultSceneUnits,
  python = (async (text) => ({ success: true, value: Number(text) })) as RigPythonRunner,
} = {}) {
  const globals = Object.fromEntries(
    ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  )
  Object.assign(globalThis, {
    window: new EventTarget(),
    HTMLElement: InputBoundary,
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  Reflect.deleteProperty(globalThis, 'document')
  const element = new InputBoundary(),
    finishes: boolean[] = [],
    previews: number[] = [],
    history: number[] = []
  let committed = value,
    preview = value,
    begins = 0,
    available = true,
    unmounted = false
  function Host() {
    const [current, setCurrent] = useState(value)
    return (
      <SourceNumber
        field={{
          value: current,
          disabled,
          change(next) {
            history.push(committed)
            committed = preview = Number(next)
            setCurrent(committed)
          },
          beginDrag() {
            begins++
            return {
              change(next) {
                if (!available) return false
                preview = next
                previews.push(next)
                setCurrent(next)
                return true
              },
              finish(cancel) {
                finishes.push(cancel)
                if (!cancel && preview !== committed) {
                  history.push(committed)
                  committed = preview
                } else preview = committed
                setCurrent(preview)
              },
            }
          },
        }}
        subtype={subtype}
        integer={integer}
        units={units}
        python={python}
        label="焦距"
        precision={3}
        step={step}
        min={min}
        max={max}
        softMin={softMin}
        softMax={softMax}
        slider={slider}
      />
    )
  }
  const renderer = await create(<Host />),
    props = () =>
      renderer.scene.findByProps({ 'data-source-widget': slider ? 'NUM_SLIDER' : 'NUM' })
        .props as ComponentProps<'input'>
  const call = async (
    key: keyof ComponentProps<'input'>,
    type: string,
    extra: Record<string, unknown> = {},
  ) => {
    const next = event(type, element, extra),
      handler = props()[key]
    if (typeof handler !== 'function') throw new Error(`Missing handler ${key}`)
    await act(async () => (handler as (event: Event) => void)(next))
    return next
  }
  element.onBlur = () => {
    if (unmounted) return
    const handler = props().onBlur
    handler?.(event('blur', element) as unknown as Parameters<NonNullable<typeof handler>>[0])
  }
  const dispatch = async (type: string, extra: Record<string, unknown> = {}) => {
    const next = event(type, element, extra)
    await act(async () => window.dispatchEvent(next))
    return next
  }
  return {
    element,
    previews,
    history,
    finishes,
    props,
    call,
    dispatch,
    get committed() {
      return committed
    },
    get preview() {
      return preview
    },
    get begins() {
      return begins
    },
    invalidate() {
      available = false
    },
    async unmount() {
      if (unmounted) return
      unmounted = true
      await renderer.unmount()
    },
    async dispose() {
      await this.unmount()
      for (const [name, descriptor] of Object.entries(globals)) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      }
    },
  }
}

for (const slider of [false, true])
  for (const [kind, deltaY] of [
    ['wheel-up', -100],
    ['wheel-down', 100],
  ] as const)
    test(`mounted ${slider ? 'NUM_SLIDER' : 'NUM'} Ctrl ${kind} matches original C++ and commits once`, async () => {
      const sample = reference.cases.find(
        (entry) =>
          entry.label === kind &&
          entry.params[0] === 0.5 &&
          entry.params[1] === 0 &&
          entry.params[2] === 1 &&
          entry.params[7] === 0 &&
          Boolean(entry.params[11]) === slider,
      )!
      expect(sample).toBeDefined()
      const p = sample.params,
        f = await fixture({
          value: p[0]!,
          min: p[1]!,
          max: p[2]!,
          softMin: p[3]!,
          softMax: p[4]!,
          step: p[5]! / 100,
          slider,
        })
      try {
        await f.call('onPointerEnter', 'pointerenter')
        const handled = await f.dispatch('wheel', { deltaY, ctrlKey: true })
        expect(handled.defaultPrevented).toBe(true)
        expect(f.committed).toBe(sample.states[0]![0]!)
        expect(f.begins).toBe(1)
        expect(f.finishes).toEqual([false])
        expect(f.history).toEqual([0.5])
        expect(f.element.pointers.size).toBe(0)
        expect(f.element.focused).toBe(false)
      } finally {
        await f.dispose()
      }
    })

for (const slider of [false, true])
  test(`mounted ${slider ? 'NUM_SLIDER' : 'NUM'} hovered Minus matches the original sign branch`, async () => {
    const sample = reference.cases.find(
      (entry) =>
        entry.label === 'minus' && entry.params[0] === -2 && Boolean(entry.params[11]) === slider,
    )!
    const f = await fixture({ value: -2, min: -100, max: 100, softMin: -1, softMax: 1, slider })
    try {
      await f.call('onPointerEnter', 'pointerenter')
      const handled = await f.dispatch('keydown', { key: '-', code: 'Minus' })
      expect(handled.defaultPrevented).toBe(true)
      expect(f.committed).toBe(sample.states[0]![0]!)
      expect(f.finishes).toEqual([false])
      expect(f.history).toEqual([-2])
    } finally {
      await f.dispose()
    }
  })

test('focused Minus applies the property hard limits before committing the raw event result', async () => {
  const f = await fixture({ value: 24, min: 1, max: 1000, softMin: 1, softMax: 1000 })
  try {
    const handled = await f.call('onKeyDown', 'keydown', { key: '-', code: 'Minus' })
    expect(handled.defaultPrevented).toBe(true)
    expect(f.previews).toEqual([1])
    expect(f.committed).toBe(1)
    expect(f.history).toEqual([24])
    expect(f.finishes).toEqual([false])
  } finally {
    await f.dispose()
  }
})

for (const [label, ctrlKey] of [
  ['Enter', false],
  ['Ctrl Enter', true],
] as const)
  test(`hovered ${label} enters the original text state and text commit happens once`, async () => {
    const f = await fixture()
    try {
      await f.call('onPointerEnter', 'pointerenter')
      const handled = await f.dispatch('keydown', { key: 'Enter', code: 'Enter', ctrlKey })
      expect(handled.defaultPrevented).toBe(true)
      expect(f.element.selected).toBe(1)
      expect(f.element.focused).toBe(true)
      expect(f.props().value).toBe('47.0')
      expect(f.finishes).toEqual([false])
      expect(f.history).toEqual([])
      f.element.value = '70'
      await f.call('onChange', 'change')
      await f.call('onKeyDown', 'keydown', { key: 'Enter', code: 'Enter' })
      expect(f.committed).toBe(70)
      expect(f.history).toEqual([47])
      expect(f.element.pointers.size).toBe(0)
    } finally {
      await f.dispose()
    }
  })

test('focused Enter uses the original center activation without requiring a pointer hover', async () => {
  const f = await fixture()
  try {
    const handled = await f.call('onKeyDown', 'keydown', { key: 'Enter', code: 'NumpadEnter' })
    expect(handled.defaultPrevented).toBe(true)
    expect(f.element.selected).toBe(1)
    expect(f.history).toEqual([])
    expect(f.props().value).toBe('47.0')
  } finally {
    await f.dispose()
  }
})

for (const [label, x, ctrlKey] of [
  ['left arrow', 101, false],
  ['right arrow', 259, false],
  ['Ctrl Enter over arrow', 101, true],
] as const)
  test(`hover Enter on ${label} retains original arrow versus text dispatch`, async () => {
    const f = await fixture({ value: 0.5, min: 0, max: 1, softMin: 0, softMax: 1 })
    try {
      await f.call('onPointerEnter', 'pointerenter', { clientX: x })
      await f.dispatch('keydown', { key: 'Enter', code: 'Enter', ctrlKey })
      if (ctrlKey) {
        expect(f.element.selected).toBe(1)
        expect(f.history).toEqual([])
      } else {
        const sample = reference.cases.find(
          (entry) =>
            entry.label === (x === 101 ? 'left-arrow' : 'right-arrow') &&
            entry.params[0] === 0.5 &&
            entry.params[1] === 0 &&
            entry.params[2] === 1 &&
            entry.params[7] === 0 &&
            !entry.params[11],
        )!
        expect(f.committed).toBe(sample.states[1]![0]!)
        expect(f.element.selected).toBe(0)
        expect(f.history).toEqual([0.5])
      }
      expect(f.finishes).toEqual([false])
    } finally {
      await f.dispose()
    }
  })

test('plain wheel, exited hover, foreign editable target and consumed modal key do not start a property edit', async () => {
  const f = await fixture()
  try {
    await f.call('onPointerEnter', 'pointerenter')
    expect((await f.dispatch('wheel', { deltaY: -100 })).defaultPrevented).toBe(false)
    const foreign = new InputBoundary()
    expect(
      (await f.dispatch('keydown', { key: '-', code: 'Minus', target: foreign })).defaultPrevented,
    ).toBe(false)
    foreign.tagName = 'BUTTON'
    expect(
      (await f.dispatch('keydown', { key: 'Enter', code: 'Enter', target: foreign }))
        .defaultPrevented,
    ).toBe(false)
    const consumed = event('keydown', f.element, { key: '-', code: 'Minus' })
    consumed.preventDefault()
    await act(async () => window.dispatchEvent(consumed))
    await f.call('onPointerLeave', 'pointerleave')
    expect((await f.dispatch('keydown', { key: '-', code: 'Minus' })).defaultPrevented).toBe(false)
    expect(f.begins).toBe(0)
    expect(f.committed).toBe(47)
    expect(f.history).toEqual([])
  } finally {
    await f.dispose()
  }
})

for (const inherited of [false, true])
  test(`disabled ${inherited ? 'fieldset' : 'property'} rejects hover, focus and pointer activation`, async () => {
    const f = await fixture({ disabled: !inherited })
    f.element.disabled = inherited
    try {
      await f.call('onPointerEnter', 'pointerenter')
      await f.dispatch('wheel', { deltaY: -100, ctrlKey: true })
      await f.dispatch('keydown', { key: '-', code: 'Minus' })
      await f.call('onKeyDown', 'keydown', { key: 'Enter', code: 'Enter' })
      await f.call('onPointerDown', 'pointerdown')
      expect(f.begins).toBe(0)
      expect(f.history).toEqual([])
      expect(f.committed).toBe(47)
    } finally {
      await f.dispose()
    }
  })

test('mounted Control and Shift key transitions follow the independent native snap event trace', async () => {
  const sample = reference.cases.find(
      (entry) => entry.label === 'ctrl-snap' && entry.params[0] === 47 && !entry.params[11],
    )!,
    p = sample.params,
    f = await fixture({
      value: p[0]!,
      min: p[1]!,
      max: p[2]!,
      softMin: p[3]!,
      softMax: p[4]!,
      step: p[5]! / 100,
    })
  try {
    await f.call('onPointerDown', 'pointerdown')
    await f.dispatch('pointermove', { clientX: 185 })
    await f.dispatch('pointermove', { clientX: 212 })
    expect(f.preview).toBe(sample.states[2]![0]!)
    await f.dispatch('keydown', { key: 'Control', ctrlKey: true })
    expect(f.preview).toBe(sample.states[3]![0]!)
    await f.dispatch('keydown', { key: 'Shift', ctrlKey: true, shiftKey: true })
    expect(f.preview).toBe(sample.states[4]![0]!)
    await f.dispatch('pointerup', { clientX: 212, ctrlKey: true, shiftKey: true })
    expect(f.committed).toBe(sample.states[5]![0]!)
    expect(f.finishes).toEqual([false])
    expect(f.history).toEqual(sample.states[5]![0] === 47 ? [] : [47])
  } finally {
    await f.dispose()
  }
})

test('a captured numeric drag consumes wheel without changing its value or zooming the page', async () => {
  const f = await fixture()
  try {
    await f.call('onPointerDown', 'pointerdown')
    await f.dispatch('pointermove', { clientX: 185 })
    await f.dispatch('pointermove', { clientX: 205 })
    const previous = f.preview
    for (const ctrlKey of [false, true]) {
      const handled = await f.dispatch('wheel', { deltaY: -100, ctrlKey })
      expect(handled.defaultPrevented).toBe(true)
      expect(f.preview).toBe(previous)
      expect(f.finishes).toEqual([])
    }
    await f.dispatch('pointerup', { clientX: 205 })
    expect(f.committed).toBe(previous)
    expect(f.finishes).toEqual([false])
    expect(f.history).toEqual([47])
  } finally {
    await f.dispose()
  }
})

for (const end of ['release', 'escape', 'right', 'cancel', 'blur', 'lost', 'unmount'] as const)
  test(`mounted drag ${end} preserves original modifier/coalesced motion and ends once`, async () => {
    const sample = reference.cases.find(
        (entry) => entry.label === 'drag-release' && entry.params[0] === 47 && !entry.params[11],
      )!,
      p = sample.params,
      f = await fixture({
        value: p[0]!,
        min: p[1]!,
        max: p[2]!,
        softMin: p[3]!,
        softMax: p[4]!,
        step: p[5]! / 100,
      })
    try {
      await f.call('onPointerDown', 'pointerdown')
      expect(f.element.pointers.has(1)).toBe(true)
      await f.dispatch('pointermove', {
        clientX: 210,
        getCoalescedEvents: () => [
          { clientX: 185, ctrlKey: false, shiftKey: false },
          { clientX: 210, ctrlKey: false, shiftKey: false },
        ],
      })
      expect(f.preview).toBe(sample.states[2]![0]!)
      expect(f.committed).toBe(47)
      await f.dispatch('pointermove', { clientX: 220, shiftKey: true })
      expect(f.preview).toBe(sample.states[3]![0]!)
      await f.dispatch('pointerup', { pointerId: 2 })
      expect(f.finishes).toEqual([])
      if (end === 'release') await f.dispatch('pointerup', { clientX: 220, shiftKey: true })
      else if (end === 'escape') await f.dispatch('keydown', { key: 'Escape' })
      else if (end === 'right') await f.dispatch('pointerdown', { button: 2 })
      else if (end === 'cancel') await f.dispatch('pointercancel')
      else if (end === 'blur') await f.dispatch('blur')
      else if (end === 'lost') await act(async () => f.element.releasePointerCapture(1))
      else await f.unmount()
      expect(f.finishes).toEqual([end !== 'release'])
      expect(f.element.pointers.size).toBe(0)
      expect(f.element.dataset.sourceNumberDragging).toBeUndefined()
      expect(f.committed).toBe(end === 'release' ? sample.states[4]![0]! : 47)
      expect(f.history).toEqual(end === 'release' ? [47] : [])
      await f.dispatch('pointerup')
      await f.dispatch('keydown', { key: 'Escape' })
      expect(f.finishes).toHaveLength(1)
    } finally {
      await f.dispose()
    }
  })

test('rejected property ownership cancels the mounted drag before any late release can commit', async () => {
  const f = await fixture()
  try {
    await f.call('onPointerDown', 'pointerdown')
    await f.dispatch('pointermove', { clientX: 185 })
    f.invalidate()
    await f.dispatch('pointermove', { clientX: 205 })
    expect(f.finishes).toEqual([true])
    expect(f.committed).toBe(47)
    expect(f.element.pointers.size).toBe(0)
    await f.dispatch('pointerup', { clientX: 205 })
    expect(f.finishes).toEqual([true])
    expect(f.history).toEqual([])
  } finally {
    await f.dispose()
  }
})

test('unmount removes hovered keyboard and wheel handlers', async () => {
  const f = await fixture()
  try {
    await f.call('onPointerEnter', 'pointerenter')
    await f.unmount()
    expect((await f.dispatch('wheel', { deltaY: -100, ctrlKey: true })).defaultPrevented).toBe(
      false,
    )
    expect((await f.dispatch('keydown', { key: '-', code: 'Minus' })).defaultPrevented).toBe(false)
    expect(f.begins).toBe(0)
  } finally {
    await f.dispose()
  }
})

function delayedPython() {
  const expressions: string[] = []
  let finish!: (result: Awaited<ReturnType<RigPythonRunner>>) => void
  const python: RigPythonRunner = (expression) => {
    expressions.push(expression)
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  return {
    python,
    expressions,
    async resolve(result: Awaited<ReturnType<RigPythonRunner>>) {
      await act(async () => finish(result))
    },
  }
}

async function editText(f: Awaited<ReturnType<typeof fixture>>, text: string) {
  f.element.focus()
  f.element.value = text
  await f.call('onChange', 'change')
  await f.call('onKeyDown', 'keydown', { key: 'Enter', code: 'Enter' })
}

test('property text passes the complete expression to Python and commits a single frozen transaction', async () => {
  const delayed = delayedPython(),
    f = await fixture({ python: delayed.python })
  try {
    await editText(f, '2+3')
    expect(f.props().type).toBe('text')
    expect(f.props()['aria-busy']).toBe(true)
    expect(f.props().readOnly).toBe(true)
    expect(delayed.expressions).toEqual(['2+3'])
    expect(f.begins).toBe(1)
    expect(f.history).toEqual([])
    await f.call('onBlur', 'blur')
    expect(delayed.expressions).toEqual(['2+3'])
    await delayed.resolve({ success: true, value: 5 })
    expect(f.committed).toBe(5)
    expect(f.history).toEqual([47])
    expect(f.finishes).toEqual([false])
    expect(f.props()['aria-busy']).toBe(false)
    expect(f.props().value).toBe('5')
  } finally {
    await f.dispose()
  }
})

for (const cancel of ['escape', 'blur', 'unmount', 'ownership', 'disabled'] as const)
  test(`pending property Python ${cancel} cannot commit a late result or add an Undo`, async () => {
    const delayed = delayedPython(),
      f = await fixture({ python: delayed.python })
    try {
      await editText(f, 'sqrt(25)')
      if (cancel === 'escape') {
        const handled = await f.dispatch('keydown', { key: 'Escape' })
        expect(handled.defaultPrevented).toBe(true)
      } else if (cancel === 'blur') await f.dispatch('blur')
      else if (cancel === 'unmount') await f.unmount()
      else if (cancel === 'ownership') f.invalidate()
      else f.element.disabled = true
      await delayed.resolve({ success: true, value: 5 })
      expect(f.committed).toBe(47)
      expect(f.history).toEqual([])
      expect(f.finishes).toEqual([true])
      await f.dispatch('keydown', { key: 'Escape' })
      expect(f.finishes).toEqual([true])
    } finally {
      await f.dispose()
    }
  })

test('a failed property expression restores the old value and exposes a Chinese error without an Undo', async () => {
  const f = await fixture({
    python: async () => ({ success: false, value: 0, error: 'ZeroDivisionError' }),
  })
  try {
    await editText(f, '1/0')
    expect(f.committed).toBe(47)
    expect(f.history).toEqual([])
    expect(f.finishes).toEqual([true])
    expect(f.props()['aria-invalid']).toBe(true)
    expect(f.props().title).toBe('表达式或单位无效，请重新输入')
    expect(f.props().value).toBe('47')
  } finally {
    await f.dispose()
  }
})

test('empty property text follows source zero, integer rounding and hard range instead of the drag soft range', async () => {
  const calls: string[] = [],
    f = await fixture({
      value: 3,
      min: 1,
      max: 10,
      softMin: 2,
      softMax: 5,
      python: async (text) => {
        calls.push(text)
        return { success: true, value: 7.5 }
      },
      integer: true,
    })
  try {
    await editText(f, '')
    expect(calls).toEqual([])
    expect(f.committed).toBe(1)
    expect(f.history).toEqual([3])
    await editText(f, '7.5')
    expect(f.committed).toBe(8)
    expect(f.history).toEqual([3, 1])
    expect(f.finishes).toEqual([false, false])
  } finally {
    await f.dispose()
  }
})

test('Euler displays degrees and evaluates unitless property text into raw radians', async () => {
  const f = await fixture({
    value: 0,
    subtype: 'EULER',
    step: 1,
    min: -1000,
    max: 1000,
    softMin: -1000,
    softMax: 1000,
  })
  try {
    expect(f.props().value).toBe('0°')
    await editText(f, '90')
    expect(f.committed).toBe(Math.PI / 2)
    expect(f.props().value).toBe('90°')
    expect(f.history).toEqual([0])
  } finally {
    await f.dispose()
  }
})

test('radians scene preference bypasses degree conversion and preserves raw Euler radians', async () => {
  const f = await fixture({
    value: 0,
    subtype: 'EULER',
    units: { ...defaultSceneUnits, system_rotation: 2 },
  })
  try {
    await editText(f, '1.5')
    expect(f.committed).toBe(1.5)
    expect(f.props().value).toBe('1.5')
  } finally {
    await f.dispose()
  }
})

test('moving inside a remounted number restores hover ownership without requiring an artificial pointerenter', async () => {
  const f = await fixture()
  try {
    await f.call('onPointerMove', 'pointermove')
    expect((await f.dispatch('keydown', { key: '-', code: 'Minus' })).defaultPrevented).toBe(true)
    expect(f.committed).toBe(-47)
    expect(f.history).toEqual([47])
  } finally {
    await f.dispose()
  }
})

for (const delimiter of ['\n', '\r', '\r\n', '\0'])
  test(`property text paste inserts only the native first line for ${JSON.stringify(delimiter)}`, async () => {
    const calls: string[] = [],
      f = await fixture({
        python: async (text) => {
          calls.push(text)
          return { success: true, value: 5 }
        },
      })
    try {
      await f.call('onKeyDown', 'keydown', { key: 'Enter' })
      f.element.value = String(f.props().value)
      f.element.selectionStart = 0
      f.element.selectionEnd = f.element.value.length
      const paste = await f.call('onPaste', 'paste', {
        clipboardData: {
          getData: (type: string) => {
            expect(type).toBe('text/plain')
            return `2+3${delimiter}100`
          },
        },
      })
      expect(paste.defaultPrevented).toBe(true)
      expect(f.props().value).toBe('2+3')
      expect(f.element.selectionStart).toBe(3)
      expect(f.element.selectionEnd).toBe(3)
      await f.call('onKeyDown', 'keydown', { key: 'Enter' })
      expect(calls).toEqual(['2+3'])
      expect(f.committed).toBe(5)
      expect(f.history).toEqual([47])
    } finally {
      await f.dispose()
    }
  })

test('paste replaces the active text selection and preserves the remaining expression', async () => {
  const f = await fixture()
  try {
    f.element.focus()
    f.element.value = '12+34'
    await f.call('onChange', 'change')
    f.element.selectionStart = 3
    f.element.selectionEnd = 5
    await f.call('onPaste', 'paste', { clipboardData: { getData: () => '5\nignored' } })
    expect(f.props().value).toBe('12+5')
    expect(f.element.selectionStart).toBe(4)
    expect(f.history).toEqual([])
    await f.call('onKeyDown', 'keydown', { key: 'Escape' })
    expect(f.committed).toBe(47)
    expect(f.history).toEqual([])
  } finally {
    await f.dispose()
  }
})

test('source text initialization keeps six significant digits and uses the original alternate angle suffix', async () => {
  const numeric = await fixture({ value: 1.23456789 })
  try {
    expect(numeric.props().value).toBe('1.235')
    await numeric.call('onKeyDown', 'keydown', { key: 'Enter' })
    expect(numeric.props().value).toBe('1.23457')
    expect(numeric.history).toEqual([])
  } finally {
    await numeric.dispose()
  }
  const angle = await fixture({ value: Math.PI / 2, subtype: 'EULER' })
  try {
    expect(angle.props().value).toBe('90°')
    await angle.call('onKeyDown', 'keydown', { key: 'Enter' })
    expect(angle.props().value).toBe('90d')
    expect(angle.history).toEqual([])
  } finally {
    await angle.dispose()
  }
})
