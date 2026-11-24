import { expect, test } from 'bun:test'
import { SceneCameraNode, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { createSourceCameraRig, sceneCameraRigPose, useViewer } from '@pascal-app/viewer'
import { extend } from '@react-three/fiber'
import { create } from '@react-three/test-renderer'
import { act, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Matrix4, Object3D, Vector3 } from 'three'
import { getLocale, setLocale } from '../../i18n'
import { initialSceneAnimationState, useSceneAnimation } from '../scene-animation/store'
import { readRigCameraAuthorTransform } from './rig-camera-transform'
import { RigObjectNumberControls } from './rig-object-number-controls'
import type { RigPythonRunner } from './rig-python-runtime'
import { rigPose, useRigEditor } from './rig-state'

class NumberHost extends Object3D {
  aria = { label: '', invalid: false, busy: false }
}
extend({
  Details: NumberHost,
  Summary: NumberHost,
  Div: NumberHost,
  P: NumberHost,
  Label: NumberHost,
  Span: NumberHost,
  Input: NumberHost,
  Svg: NumberHost,
  Polygon: NumberHost,
})

class InputBoundary extends EventTarget {
  tagName = 'INPUT'
  isContentEditable = false
  disabled = false
  focused = true
  dataset: Record<string, string> = {}
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
  select() {}
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

const nativePython: RigPythonRunner = async (expression) => {
  const process = Bun.spawn(
    [
      'python3',
      '-c',
      'import json,math,sys\ntry:\n v=eval(sys.argv[1],dict(vars(math),__builtins__=__builtins__)) if sys.argv[1] else 0\n v=sum(float(x) for x in v) if isinstance(v,tuple) else float(v)\n print(json.dumps(dict(success=True,value=v if math.isfinite(v) else 0)))\nexcept Exception as e:\n print(json.dumps(dict(success=False,value=0,error=type(e).__name__)))',
      expression,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const result = JSON.parse(await new Response(process.stdout).text())
  if (await process.exited) throw new Error(await new Response(process.stderr).text())
  return result
}

async function fixture(python = nativePython) {
  const globals = Object.fromEntries(
    [
      'window',
      'document',
      'HTMLElement',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'IS_REACT_ACT_ENVIRONMENT',
    ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  )
  const saved = {
    scene: useScene.getState(),
    animation: useSceneAnimation.getState(),
    live: useLiveNodeOverrides.getState(),
    editor: useRigEditor.getState(),
    viewer: useViewer.getState(),
    temporal: useScene.temporal.getState(),
    locale: getLocale(),
  }
  Object.assign(globalThis, {
    window: new EventTarget(),
    HTMLElement: InputBoundary,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  Reflect.deleteProperty(globalThis, 'document')
  setLocale('zh-CN')
  const node = SceneCameraNode.parse({})
  node.rig = createSourceCameraRig('dolly', sceneCameraRigPose(node))
  useLiveNodeOverrides.setState({ overrides: new Map() })
  useScene.setState({ nodes: { [node.id]: node }, rootNodeIds: [node.id], readOnly: false })
  useSceneAnimation.setState({ ...initialSceneAnimationState, cameraId: node.id })
  useRigEditor.setState({ ...saved.editor, poseCameraId: null, gesture: null })
  useViewer.getState().setSelection({ selectedIds: [node.id] })
  useScene.temporal.getState().clear()
  const calls: string[] = [],
    pending: ReturnType<RigPythonRunner>[] = []
  const run: RigPythonRunner = (expression) => {
    calls.push(expression)
    const job = python(expression)
    pending.push(job)
    return job
  }
  function NumberControlsHost() {
    const current = useScene((state) => state.nodes[node.id]) as SceneCameraNode
    return <RigObjectNumberControls node={current} python={run} />
  }
  const renderer = await create(<NumberControlsHost />)
  const props = (label: string) =>
    renderer.scene.findByProps({ 'aria-label': label }).props as ComponentProps<'input'>
  const current = () => useScene.getState().nodes[node.id] as SceneCameraNode
  const call = async (
    label: string,
    element: InputBoundary,
    key: keyof ComponentProps<'input'>,
    type: string,
    extra: Record<string, unknown> = {},
  ) => {
    const handler = props(label)[key]
    if (typeof handler !== 'function') throw new Error(`Missing handler ${key}`)
    await act(async () => (handler as (next: Event) => void)(event(type, element, extra)))
  }
  return {
    node,
    renderer,
    props,
    calls,
    current,
    call,
    author: () => readRigCameraAuthorTransform(rigPose(current()).rig!),
    history: () => useScene.temporal.getState().pastStates.length,
    async text(label: string, value: string) {
      const element = new InputBoundary()
      await call(label, element, 'onChange', 'change', { target: { value } })
      await call(label, element, 'onBlur', 'blur')
      await act(async () => {
        await Promise.all(pending)
        await Promise.resolve()
      })
    },
    async emit(element: InputBoundary, type: string, extra: Record<string, unknown> = {}) {
      await act(async () => window.dispatchEvent(event(type, element, extra)))
    },
    async dispose() {
      await renderer.unmount()
      setLocale(saved.locale)
      useScene.setState(saved.scene, true)
      useSceneAnimation.setState(saved.animation, true)
      useLiveNodeOverrides.setState(saved.live, true)
      useRigEditor.setState(saved.editor, true)
      useViewer.setState(saved.viewer, true)
      useScene.temporal.setState(saved.temporal, true)
      for (const [key, descriptor] of Object.entries(globals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    },
  }
}

test('Object numeric labels expose only Chinese camera body location and rotation fields', async () => {
  const f = await fixture()
  try {
    const markup = renderToStaticMarkup(<RigObjectNumberControls node={f.node} />)
    expect(markup).toContain('相机本体微调')
    expect(markup).toContain('相机本体 位置 X')
    expect(markup).toContain('相机本体 旋转 Y')
    expect(markup).not.toContain('缩放')
    expect(markup).not.toContain('相机架对象')
    expect(markup.match(/<input /g)).toHaveLength(6)
    expect(f.props('相机本体 位置 X').step).toBe(0.01)
    expect(f.props('相机本体 旋转 Z').step).toBe(1)
    expect(f.props('相机本体 位置 X').min).toBe(-3.4028234663852886e38)
    expect(f.props('相机本体 位置 X').max).toBe(3.4028234663852886e38)
    expect(f.props('相机本体 旋转 Z').value).toBe('0°')
    expect(f.history()).toBe(0)
    await act(async () => useRigEditor.setState({ poseCameraId: f.node.id }))
    expect(f.renderer.scene.children).toHaveLength(0)
  } finally {
    await f.dispose()
  }
})

test('mounted Object text evaluates CPython expressions, stores radians and undoes once', async () => {
  const f = await fixture()
  try {
    const original = structuredClone(f.node.rig!)
    await f.text('相机本体 位置 X', '2+3')
    expect(f.author().location[0]).toBe(5)
    expect(f.props('相机本体 位置 X').value).toBe('5')
    expect(f.calls).toEqual(['2+3'])
    expect(f.history()).toBe(1)
    await f.text('相机本体 旋转 Y', '90')
    expect(f.author().rotation[1]).toBeCloseTo(Math.PI / 2, 12)
    expect(f.current().rig!.native!.placement).toEqual(original.native!.placement)
    expect(f.current().rig!.native!.objectTransform).toEqual(original.native!.objectTransform)
    expect(f.current().rig!.native!.bones).toEqual(original.native!.bones)
    expect(f.current().rig!.target).toEqual(original.target)
    expect(f.current().rig!.focus).toEqual(original.focus)
    expect(f.history()).toBe(2)
    await act(async () => useScene.temporal.getState().undo())
    expect(f.author().rotation[1]).toBe(0)
    expect(f.author().location[0]).toBe(5)
    await act(async () => useScene.temporal.getState().undo())
    expect(f.current().rig).toEqual(original)
  } finally {
    await f.dispose()
  }
})

test('Object numeric axes directly author camera local XYZ without Blender axis swaps', async () => {
  const f = await fixture()
  try {
    const original = structuredClone(f.node.rig!)
    await f.text('相机本体 位置 Y', '2')
    await f.text('相机本体 位置 Z', '3')
    const offset = new Matrix4().fromArray(f.current().rig!.native!.cameraOffsetMatrix!)
    expect(new Vector3().setFromMatrixPosition(offset).toArray()).toEqual([0, 2, 3])
    expect(f.author().location).toEqual([0, 2, 3])
    await f.text('相机本体 旋转 Z', '90')
    expect(
      new Vector3(1, 0, 0)
        .transformDirection(new Matrix4().fromArray(f.current().rig!.native!.cameraOffsetMatrix!))
        .toArray()[1],
    ).toBeCloseTo(1, 6)
    expect(f.author().rotation[2]).toBeCloseTo(Math.PI / 2, 12)
    expect(f.current().rig!.native!.placement).toEqual(original.native!.placement)
    expect(f.current().rig!.native!.bones).toEqual(original.native!.bones)
    expect(f.current().rig!.target).toEqual(original.target)
  } finally {
    await f.dispose()
  }
})

test('mounted zero body fields leave legacy scenes unchanged and no-op adds no undo', async () => {
  const f = await fixture()
  try {
    const original = structuredClone(f.node)
    for (const axis of ['X', 'Y', 'Z']) await f.text(`相机本体 位置 ${axis}`, 'sqrt(0)')
    for (const axis of ['X', 'Y', 'Z']) await f.text(`相机本体 旋转 ${axis}`, '0')
    expect(f.author().location).toEqual([0, 0, 0])
    expect(f.author().rotation).toEqual([0, 0, 0])
    expect(f.current()).toEqual(original)
    expect(f.current().rig!.native!.cameraOffsetMatrix).toBeUndefined()
    expect(f.history()).toBe(0)
  } finally {
    await f.dispose()
  }
})

test('mounted source NUM drag previews without history, commits once and Escape cancels', async () => {
  const f = await fixture()
  try {
    const label = '相机本体 位置 X',
      element = new InputBoundary(),
      original = structuredClone(f.node.rig!)
    await f.call(label, element, 'onPointerDown', 'pointerdown')
    await f.emit(element, 'pointermove', { clientX: 220 })
    await f.emit(element, 'pointermove', { clientX: 250 })
    expect(f.author().location[0]).not.toBe(0)
    expect(f.current().rig).toEqual(original)
    expect(f.history()).toBe(0)
    await f.emit(element, 'pointerup', { clientX: 250 })
    expect(f.history()).toBe(1)
    await act(async () => useScene.temporal.getState().undo())
    expect(f.current().rig).toEqual(original)
    await f.call(label, element, 'onPointerDown', 'pointerdown')
    await f.emit(element, 'pointermove', { clientX: 260 })
    await f.emit(element, 'keydown', { key: 'Escape' })
    expect(f.current().rig).toEqual(original)
    expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBeUndefined()
    expect(f.history()).toBe(0)
  } finally {
    await f.dispose()
  }
})

test('pending mounted Object text cannot commit after entering Pose mode', async () => {
  let resolve: ((result: { success: boolean; value: number }) => void) | undefined
  const f = await fixture(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  try {
    const label = '相机本体 位置 X',
      element = new InputBoundary(),
      original = structuredClone(f.node.rig!)
    await f.call(label, element, 'onChange', 'change', { target: { value: '2' } })
    await f.call(label, element, 'onBlur', 'blur')
    expect(f.props(label)['aria-busy']).toBe(true)
    await act(async () => useRigEditor.setState({ poseCameraId: f.node.id }))
    await act(async () => {
      resolve!({ success: true, value: 2 })
      await Promise.resolve()
    })
    expect(f.current().rig).toEqual(original)
    expect(f.history()).toBe(0)
    expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBeUndefined()
  } finally {
    await f.dispose()
  }
})
