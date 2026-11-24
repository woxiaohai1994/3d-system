import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  SceneAnimation,
  SceneCameraMarker,
  SceneCameraNode,
  SiteNode,
  useScene,
} from '@pascal-app/core'
import { createSourceCameraRig, sceneCameraRigPose } from '@pascal-app/viewer'
import { extend } from '@react-three/fiber'
import { create } from '@react-three/test-renderer'
import { act } from 'react'
import { Object3D } from 'three'
import retention from '../../../../../vendor/blender-scene-camera/retention-fixtures.json'
import { animationData, commitSceneAnimation } from '../scene-animation/document'
import { initialSceneAnimationState, useSceneAnimation } from '../scene-animation/store'
import { useMotionEdits } from './motion-edit-session'
import { useObjectMotion } from './motion-object-store'
import { motionCamera, observedMotionCamera, outputMotionCamera } from './motion-state'
import { rigSceneOperator } from './rig-scene-operators'
import { RigSourceLayout } from './rig-source-panel'
import { rigSourceUI } from './rig-source-ui'
import { SceneCameraMarkers } from './scene-camera-markers'
import { currentSceneCameraId } from './scene-camera-state'

type HostProps = Record<string, unknown>
class MarkerHost extends Object3D {
  data = {}
  aria = { pressed: false, hidden: false }
  focusCalls = 0
  focused = false
  private draftValue: string | undefined
  constructor() {
    super()
    // Radix's DOM id is writable; Three's numeric Object3D id is not.
    const fields: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(this)
    fields.id = { ...fields.id, writable: true, configurable: true }
    // biome-ignore lint/correctness/noConstructorReturn: A DOM host needs its writable id descriptor instead of Three's readonly id.
    return Object.create(MarkerHost.prototype, fields) as MarkerHost
  }
  private get hostProps(): HostProps {
    return (this as unknown as { __r3f?: { props: HostProps } }).__r3f?.props ?? {}
  }
  get value() {
    return this.draftValue ?? String(this.hostProps.defaultValue ?? '')
  }
  set value(next: string) {
    this.draftValue = next
  }
  focus() {
    this.focusCalls++
    this.focused = true
    const handler = this.hostProps.onFocus
    if (typeof handler === 'function') handler(inputEvent('focus', this))
  }
  blur() {
    if (!this.focused) return
    this.focused = false
    const handler = this.hostProps.onBlur
    if (typeof handler === 'function') handler(inputEvent('blur', this))
  }
  closest(selector: string) {
    if (selector !== 'input') return null
    const type = (this as unknown as { __r3f?: { type: string } }).__r3f?.type
    return type === 'input' ? this : null
  }
}
extend({
  Div: MarkerHost,
  Button: MarkerHost,
  Input: MarkerHost,
  Span: MarkerHost,
  Img: MarkerHost,
})

function inputEvent(type: string, target: MarkerHost, extra: HostProps = {}) {
  const event = new Event(type, { cancelable: true, bubbles: true })
  for (const [key, value] of Object.entries({
    target,
    currentTarget: target,
    button: 0,
    pointerId: 7,
    clientX: 100,
    detail: 0,
    ...extra,
  }))
    Object.defineProperty(event, key, { value })
  return event
}

const operatorNodes = rigSourceUI.trees
  .flatMap((tree) => tree.children.flatMap((column) => column.children))
  .filter((tree) =>
    ['add_camera_rigs.add_marker_bind', 'add_camera_rigs.set_scene_camera'].includes(
      tree.options.operator ?? '',
    ),
  )
  .slice(0, 2)

let globals: Record<string, PropertyDescriptor | undefined>
let sceneBefore: ReturnType<typeof useScene.getState>
let historyBefore: ReturnType<typeof useScene.temporal.getState>
let animationBefore: ReturnType<typeof useSceneAnimation.getState>
let editsBefore: ReturnType<typeof useMotionEdits.getState>
let objectBefore: ReturnType<typeof useObjectMotion.getState>
const mounted: Awaited<ReturnType<typeof create>>[] = []

beforeEach(() => {
  sceneBefore = useScene.getState()
  historyBefore = useScene.temporal.getState()
  animationBefore = useSceneAnimation.getState()
  editsBefore = useMotionEdits.getState()
  objectBefore = useObjectMotion.getState()
  globals = Object.fromEntries(
    [
      'window',
      'document',
      'HTMLElement',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'IS_REACT_ACT_ENVIRONMENT',
    ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  )
  Object.assign(globalThis, {
    window: new EventTarget(),
    document: Object.assign(new EventTarget(), { documentElement: { lang: 'zh-CN' } }),
    HTMLElement: MarkerHost,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  useSceneAnimation.setState({ ...initialSceneAnimationState })
  useMotionEdits.setState({ cameraDirty: false, properties: {} })
  useObjectMotion.setState({ nodeId: null, draft: null })
})

afterEach(async () => {
  for (const renderer of mounted.splice(0)) await renderer.unmount()
  useScene.setState(sceneBefore, true)
  useScene.temporal.setState(historyBefore, true)
  useSceneAnimation.setState(animationBefore, true)
  useMotionEdits.setState(editsBefore, true)
  useObjectMotion.setState(objectBefore, true)
  for (const [key, descriptor] of Object.entries(globals))
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
})

function setup() {
  const site = SiteNode.parse({ animation: SceneAnimation.parse({}) })
  const cameras = ['A', 'B', 'C'].map((name) => {
    const node = SceneCameraNode.parse({ parentId: site.id, name })
    node.rig = createSourceCameraRig('dolly', sceneCameraRigPose(node))
    return node
  })
  const [a, b, c] = cameras as [SceneCameraNode, SceneCameraNode, SceneCameraNode]
  site.children = cameras.map((camera) => camera.id)
  site.animation!.activeCameraId = a.id
  useScene.setState({
    nodes: { [site.id]: site, ...Object.fromEntries(cameras.map((node) => [node.id, node])) },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useSceneAnimation.setState({
    open: true,
    timelineVisible: true,
    cameraId: c.id,
    outputMode: 'scene',
    viewSceneCamera: true,
    time: 2,
  })
  useScene.temporal.getState().clear()
  return { site, a, b, c }
}

function seedMarkers(items: SceneCameraMarker[]) {
  const site = Object.values(useScene.getState().nodes).find((node) => node.type === 'site')!
  useScene.getState().updateNode(site.id, {
    animation: { ...animationData(), cameraMarkers: items },
  })
  useScene.temporal.getState().clear()
}

async function mount(camera: SceneCameraNode) {
  function Host() {
    useScene((state) => state.nodes)
    useScene((state) => state.readOnly)
    useSceneAnimation()
    return (
      <>
        <SceneCameraMarkers scale={120} inset={16} />
        {operatorNodes.map((tree) => (
          <RigSourceLayout
            key={tree.options.operator}
            tree={tree}
            bindings={{
              property() {
                throw new Error('The original scene operator buttons do not read properties')
              },
              operator(id) {
                return rigSceneOperator(
                  camera,
                  id.replace('add_camera_rigs.', '') as 'add_marker_bind' | 'set_scene_camera',
                )
              },
            }}
          />
        ))}
      </>
    )
  }
  const renderer = await create(<Host />)
  mounted.push(renderer)
  const call = async (props: HostProps, key: string, type: string, extra: HostProps = {}) => {
    const target = new MarkerHost()
    const handler = props[key]
    if (typeof handler !== 'function') throw new Error(`Missing mounted ${key}`)
    const event = inputEvent(type, target, extra)
    await act(async () => handler(event))
    return event
  }
  return {
    renderer,
    marker(id: string) {
      return renderer.scene.findByProps({ 'data-camera-marker': id })
    },
    async clickOperator(operation: 'add_marker_bind' | 'set_scene_camera') {
      const props = renderer.scene.findByProps({
        'data-source-operator': `add_camera_rigs.${operation}`,
      }).props
      if (!props.disabled) await call(props, 'onClick', 'click')
    },
    async select(id: string) {
      await call(this.marker(id).props, 'onClick', 'click')
      expect(this.marker(id).props['aria-pressed']).toBe(true)
    },
    async key(key: string) {
      return call(renderer.scene.findByProps({ role: 'group' }).props, 'onKeyDown', 'keydown', {
        key,
      })
    },
    async down(id: string, clientX = 100, pointerId = 7) {
      return call(this.marker(id).props, 'onPointerDown', 'pointerdown', { clientX, pointerId })
    },
    async windowEvent(type: string, extra: HostProps = {}) {
      const event = inputEvent(type, new MarkerHost(), extra)
      await act(async () => window.dispatchEvent(event))
      return event
    },
  }
}

const undoLength = () => useScene.temporal.getState().pastStates.length
async function undo() {
  await act(async () => useScene.temporal.getState().undo())
}

test('mounted original marker button binds twice at the same frame; one Undo removes only the final binding', async () => {
  const { b, c } = setup()
  const ui = await mount(b)
  expect(operatorNodes).toHaveLength(2)
  await ui.clickOperator('add_marker_bind')
  const first = animationData().cameraMarkers![0]!
  expect(first).toMatchObject({ name: 'cam_48', frame: 48, cameraId: b.id })
  expect(ui.marker(first.id).props['aria-label']).toContain('B')
  expect(undoLength()).toBe(1)
  await ui.clickOperator('add_marker_bind')
  expect(animationData().cameraMarkers).toHaveLength(2)
  expect(animationData().cameraMarkers![1]!.id).not.toBe(first.id)
  expect(undoLength()).toBe(2)
  expect(motionCamera()!.id).toBe(c.id)
  await undo()
  expect(animationData().cameraMarkers).toEqual([first])
  expect(undoLength()).toBe(1)
  expect(ui.marker(first.id).props['aria-label']).toContain('48')
})

test('mounted Make Active polls after its one Undo transaction without changing the edited camera', async () => {
  const { a, b, c } = setup()
  const ui = await mount(b)
  const props = () =>
    ui.renderer.scene.findByProps({ 'data-source-operator': 'add_camera_rigs.set_scene_camera' })
      .props
  expect(props().disabled).toBe(false)
  await ui.clickOperator('set_scene_camera')
  expect(currentSceneCameraId()).toBe(b.id)
  expect(observedMotionCamera()!.id).toBe(b.id)
  expect(motionCamera()!.id).toBe(c.id)
  expect(props().disabled).toBe(true)
  expect(props().title).toBe('当前相机已经是场景相机。')
  expect(undoLength()).toBe(1)
  await ui.clickOperator('set_scene_camera')
  expect(undoLength()).toBe(1)
  await undo()
  expect(animationData().activeCameraId).toBe(a.id)
  expect(motionCamera()!.id).toBe(c.id)
  expect(currentSceneCameraId()).toBe(a.id)
  expect(outputMotionCamera()!.id).toBe(a.id)
  expect(props().disabled).toBe(false)
})

test('marker dragging previews a frozen document, commits once, and Escape restores the original override', async () => {
  const { site, a, b, c } = setup()
  const marker = SceneCameraMarker.parse({ name: 'B48', frame: 48, cameraId: b.id })
  seedMarkers([marker])
  const ui = await mount(b)
  const committed = (useScene.getState().nodes[site.id] as SiteNode).animation!
  await ui.down(marker.id)
  await ui.windowEvent('pointermove', { clientX: 102 })
  expect(useSceneAnimation.getState().sceneDraft).toBeNull()
  await ui.windowEvent('pointermove', { clientX: 160 })
  expect(animationData().cameraMarkers![0]!.frame).toBe(60)
  expect(useSceneAnimation.getState().sceneDraft!.activeCameraId).toBe(b.id)
  expect((useScene.getState().nodes[site.id] as SiteNode).animation).toBe(committed)
  expect(undoLength()).toBe(0)
  expect(currentSceneCameraId()).toBe(b.id)
  await ui.windowEvent('pointerup')
  expect(useSceneAnimation.getState().sceneDraft).toBeNull()
  expect(animationData().cameraMarkers![0]!.frame).toBe(60)
  expect(undoLength()).toBe(1)
  await undo()
  expect(animationData().cameraMarkers).toEqual([marker])
  await act(async () =>
    useSceneAnimation.setState({
      sceneCameraOverride: { frame: 48, cameraId: a.id },
    }),
  )
  const originalOverride = useSceneAnimation.getState().sceneCameraOverride
  await ui.down(marker.id)
  await ui.windowEvent('pointermove', { clientX: 180 })
  expect(useSceneAnimation.getState().sceneCameraOverride).toBeNull()
  expect(animationData().cameraMarkers![0]!.frame).toBe(64)
  const escapeEvent = await ui.windowEvent('keydown', { key: 'Escape' })
  expect(escapeEvent.defaultPrevented).toBe(true)
  expect(useSceneAnimation.getState().sceneDraft).toBeNull()
  expect(useSceneAnimation.getState().sceneCameraOverride).toBe(originalOverride)
  expect(animationData().cameraMarkers).toEqual([marker])
  expect(undoLength()).toBe(0)
  await ui.windowEvent('pointermove', { clientX: 300 })
  await ui.windowEvent('pointerup')
  expect(animationData().cameraMarkers).toEqual([marker])
  expect(motionCamera()!.id).toBe(c.id)
})

test('F2 calls the mounted rename ref focus; Enter commits once and Escape discards the draft name', async () => {
  const { b } = setup()
  const marker = SceneCameraMarker.parse({ name: '原名字', frame: 48, cameraId: b.id })
  seedMarkers([marker])
  const ui = await mount(b)
  await ui.select(marker.id)
  await ui.key('F2')
  const input = ui.renderer.scene.findByProps({ 'aria-label': '标记名称' })
  const host = input.instance as MarkerHost
  expect(host.focusCalls).toBe(1)
  expect(host.focused).toBe(true)
  expect(host.value).toBe('原名字')
  host.value = '环绕镜头'
  await act(async () => input.props.onKeyDown(inputEvent('keydown', host, { key: 'Enter' })))
  expect(animationData().cameraMarkers![0]!.name).toBe('环绕镜头')
  expect(undoLength()).toBe(1)
  expect(ui.marker(marker.id).props['aria-label']).toContain('环绕镜头')
  await ui.key('F2')
  const next = ui.renderer.scene.findByProps({ 'aria-label': '标记名称' })
  const nextHost = next.instance as MarkerHost
  expect(nextHost.focused).toBe(true)
  nextHost.value = '不应保存'
  await act(async () => next.props.onKeyDown(inputEvent('keydown', nextHost, { key: 'Escape' })))
  expect(animationData().cameraMarkers![0]!.name).toBe('环绕镜头')
  expect(undoLength()).toBe(1)
  await undo()
  expect(animationData().cameraMarkers![0]!.name).toBe('原名字')
})

test.each([
  false,
  true,
])('deleting B through the mounted marker preserves B unless an earlier valid A remains (%s)', async (earlierA) => {
  const { a, b, c } = setup()
  const marker = SceneCameraMarker.parse({ name: 'B48', frame: 48, cameraId: b.id })
  const first = SceneCameraMarker.parse({ name: 'A24', frame: 24, cameraId: a.id })
  seedMarkers(earlierA ? [first, marker] : [marker])
  expect(currentSceneCameraId()).toBe(b.id)
  if (!earlierA)
    expect(
      retention.cases.find((entry) => entry.id === 'delete-last-valid-from-A')!.states.at(-1)!
        .sceneCamera,
    ).toBe('B')
  const ui = await mount(b)
  await ui.select(marker.id)
  await ui.key('Delete')
  expect(animationData().activeCameraId).toBe(b.id)
  expect(animationData().cameraMarkers).toEqual(earlierA ? [first] : [])
  expect(currentSceneCameraId()).toBe(earlierA ? a.id : b.id)
  expect(observedMotionCamera()!.id).toBe(earlierA ? a.id : b.id)
  expect(outputMotionCamera()!.id).toBe(earlierA ? a.id : b.id)
  expect(motionCamera()!.id).toBe(c.id)
  expect(undoLength()).toBe(1)
  await undo()
  expect(currentSceneCameraId()).toBe(b.id)
  expect(animationData().cameraMarkers).toEqual(earlierA ? [first, marker] : [marker])
})

test('explicit active C wins at its override frame and marker mutations retain that camera', async () => {
  const { b, c } = setup()
  const marker = SceneCameraMarker.parse({ name: 'B48', frame: 48, cameraId: b.id })
  seedMarkers([marker])
  const ui = await mount(c)
  await ui.clickOperator('set_scene_camera')
  expect(animationData().activeCameraId).toBe(c.id)
  expect(useSceneAnimation.getState().sceneCameraOverride).toEqual({ frame: 48, cameraId: c.id })
  expect(currentSceneCameraId()).toBe(c.id)
  expect(outputMotionCamera()!.id).toBe(c.id)
  await ui.select(marker.id)
  await ui.key('Backspace')
  expect(useSceneAnimation.getState().sceneCameraOverride).toBeNull()
  expect(currentSceneCameraId()).toBe(c.id)
  expect(animationData().activeCameraId).toBe(c.id)
  expect(undoLength()).toBe(2)
})

test('serialization and requested export frames preserve the actual retained scene fallback', async () => {
  const { site, a, b } = setup()
  const first = SceneCameraMarker.parse({ name: 'A24', frame: 24, cameraId: a.id })
  const last = SceneCameraMarker.parse({ name: 'B48', frame: 48, cameraId: b.id })
  seedMarkers([first, last])
  const ui = await mount(b)
  await ui.select(last.id)
  await ui.key('Delete')
  expect(animationData().activeCameraId).toBe(b.id)
  const saved = SceneAnimation.parse(JSON.parse(JSON.stringify(animationData())))
  expect(saved.cameraMarkers).toEqual([first])
  expect(saved.activeCameraId).toBe(b.id)
  await act(async () => useScene.getState().updateNode(site.id, { animation: saved }))
  const before = (useScene.getState().nodes[site.id] as SiteNode).animation
  await act(async () => useSceneAnimation.setState({ exporting: true }))
  expect(outputMotionCamera(0)!.id).toBe(a.id)
  expect(outputMotionCamera(3)!.id).toBe(a.id)
  expect(useSceneAnimation.getState().time).toBe(2)
  expect((useScene.getState().nodes[site.id] as SiteNode).animation).toBe(before)
  expect(animationData().activeCameraId).toBe(b.id)
  await act(async () => useSceneAnimation.setState({ exporting: false }))
  await act(async () => {
    expect(commitSceneAnimation({ ...animationData(), cameraMarkers: [] })).toBe(true)
  })
  expect(currentSceneCameraId()).toBe(a.id)
  expect(animationData().activeCameraId).toBe(a.id)
})

test.each([
  'pointercancel',
  'blur',
  'unmount',
])('active marker drag is cancelled on %s and cannot write after teardown', async (ending) => {
  const { b } = setup()
  const marker = SceneCameraMarker.parse({ name: 'B48', frame: 48, cameraId: b.id })
  seedMarkers([marker])
  const ui = await mount(b)
  await ui.down(marker.id)
  await ui.windowEvent('pointermove', { pointerId: 8, clientX: 180 })
  expect(useSceneAnimation.getState().sceneDraft).toBeNull()
  await ui.windowEvent('pointermove', { clientX: 180 })
  expect(useSceneAnimation.getState().sceneDraft).not.toBeNull()
  if (ending === 'unmount') {
    await ui.renderer.unmount()
    mounted.splice(mounted.indexOf(ui.renderer), 1)
  } else await ui.windowEvent(ending)
  expect(useSceneAnimation.getState().sceneDraft).toBeNull()
  expect(animationData().cameraMarkers).toEqual([marker])
  await ui.windowEvent('pointermove', { clientX: 300 })
  await ui.windowEvent('pointerup')
  expect(animationData().cameraMarkers).toEqual([marker])
  expect(undoLength()).toBe(0)
})

for (const blocker of ['readOnly', 'playing', 'exporting', 'sceneDraft'] as const)
  test(`mounted operator polling and marker gestures reject ${blocker} without a transaction`, async () => {
    const { b } = setup()
    const marker = SceneCameraMarker.parse({ name: 'B48', frame: 48, cameraId: b.id })
    seedMarkers([marker])
    const ui = await mount(b)
    const original = animationData()
    await act(async () => {
      if (blocker === 'readOnly') useScene.setState({ readOnly: true })
      else if (blocker === 'sceneDraft') useSceneAnimation.setState({ sceneDraft: original })
      else useSceneAnimation.setState({ [blocker]: true })
    })
    for (const operation of ['add_marker_bind', 'set_scene_camera'] as const) {
      expect(
        ui.renderer.scene.findByProps({
          'data-source-operator': `add_camera_rigs.${operation}`,
        }).props.disabled,
      ).toBe(true)
      await ui.clickOperator(operation)
    }
    await ui.down(marker.id)
    await ui.windowEvent('pointermove', { clientX: 240 })
    await ui.windowEvent('pointerup')
    expect(animationData().cameraMarkers).toEqual([marker])
    expect(useSceneAnimation.getState().sceneDraft).toBe(blocker === 'sceneDraft' ? original : null)
    expect(undoLength()).toBe(0)
  })

test('an author document update during marker preview keeps its tracks and duration after late pointerup', async () => {
  const { site, b, c } = setup()
  const marker = SceneCameraMarker.parse({ name: 'B48', frame: 48, cameraId: b.id })
  seedMarkers([marker])
  const ui = await mount(b)
  const original = animationData()
  await ui.down(marker.id)
  await ui.windowEvent('pointermove', { clientX: 180 })
  const incoming = SceneAnimation.parse({
    ...original,
    duration: 23,
    tracks: [{ kind: 'camera', nodeId: c.id, parentId: site.id, points: [], segments: [] }],
  })
  await act(async () => useScene.getState().updateNode(site.id, { animation: incoming }))
  const history = undoLength()
  const authored = (useScene.getState().nodes[site.id] as SiteNode).animation!
  expect(authored).toEqual(incoming)
  expect(useSceneAnimation.getState().sceneDraft).toBeNull()
  await ui.windowEvent('pointermove', { clientX: 300 })
  await ui.windowEvent('pointerup')
  expect((useScene.getState().nodes[site.id] as SiteNode).animation).toBe(authored)
  expect(animationData().duration).toBe(23)
  expect(animationData().tracks).toEqual(incoming.tracks)
  expect(animationData().cameraMarkers).toEqual([marker])
  expect(undoLength()).toBe(history)
})

for (const ending of ['pointerup', 'keydown', 'blur', 'unmount'] as const)
  test(`another timeline draft owner survives the marker's late ${ending}`, async () => {
    const { site, b, c } = setup()
    const marker = SceneCameraMarker.parse({ name: 'B48', frame: 48, cameraId: b.id })
    seedMarkers([marker])
    const ui = await mount(b)
    const committed = (useScene.getState().nodes[site.id] as SiteNode).animation!
    await ui.down(marker.id)
    await ui.windowEvent('pointermove', { clientX: 180 })
    const foreign = { ...committed, activeCameraId: c.id, duration: 37 }
    const foreignOverride = { frame: 48, cameraId: c.id }
    await act(async () =>
      useSceneAnimation.setState({
        sceneDraft: foreign,
        sceneCameraOverride: foreignOverride,
      }),
    )
    await ui.windowEvent('pointermove', { clientX: 300 })
    if (ending === 'unmount') {
      await ui.renderer.unmount()
      mounted.splice(mounted.indexOf(ui.renderer), 1)
    } else {
      const lateEvent = await ui.windowEvent(ending, { key: 'Escape' })
      expect(lateEvent.defaultPrevented).toBe(false)
    }
    expect(useSceneAnimation.getState().sceneDraft).toBe(foreign)
    expect(useSceneAnimation.getState().sceneCameraOverride).toBe(foreignOverride)
    expect((useScene.getState().nodes[site.id] as SiteNode).animation).toBe(committed)
    expect(undoLength()).toBe(0)
  })

for (const context of [
  'time',
  'open',
  'workspace',
  'cameraId',
  'timelineVisible',
  'playing',
  'exporting',
  'renderingFilm',
  'previewing',
  'readOnly',
] as const)
  test(`a marker preview relinquishes its ownership immediately when ${context} changes`, async () => {
    const { site, b } = setup()
    const marker = SceneCameraMarker.parse({ name: 'B48', frame: 48, cameraId: b.id })
    seedMarkers([marker])
    const ui = await mount(b)
    const committed = (useScene.getState().nodes[site.id] as SiteNode).animation!
    await ui.down(marker.id)
    await ui.windowEvent('pointermove', { clientX: 180 })
    expect(useSceneAnimation.getState().sceneDraft).not.toBeNull()
    await act(async () => {
      if (context === 'readOnly') useScene.setState({ readOnly: true })
      else if (context === 'time') useSceneAnimation.setState({ time: 3 })
      else if (context === 'workspace') useSceneAnimation.setState({ workspace: 'film' })
      else if (context === 'cameraId') useSceneAnimation.setState({ cameraId: b.id })
      else if (context === 'open' || context === 'timelineVisible')
        useSceneAnimation.setState({ [context]: false })
      else useSceneAnimation.setState({ [context]: true })
    })
    expect(useSceneAnimation.getState().sceneDraft).toBeNull()
    const lateEscape = await ui.windowEvent('keydown', { key: 'Escape' })
    expect(lateEscape.defaultPrevented).toBe(false)
    await ui.windowEvent('pointermove', { clientX: 300 })
    await ui.windowEvent('pointerup')
    expect(useSceneAnimation.getState().sceneDraft).toBeNull()
    expect((useScene.getState().nodes[site.id] as SiteNode).animation).toBe(committed)
    expect(undoLength()).toBe(0)
  })

test('an external scene-camera override survives cancellation of the marker preview', async () => {
  const { b, c } = setup()
  const marker = SceneCameraMarker.parse({ name: 'B48', frame: 48, cameraId: b.id })
  seedMarkers([marker])
  const ui = await mount(b)
  await ui.down(marker.id)
  await ui.windowEvent('pointermove', { clientX: 180 })
  const externalOverride = { frame: 48, cameraId: c.id }
  await act(async () => useSceneAnimation.setState({ sceneCameraOverride: externalOverride }))
  expect(useSceneAnimation.getState().sceneDraft).toBeNull()
  await ui.windowEvent('keydown', { key: 'Escape' })
  expect(useSceneAnimation.getState().sceneCameraOverride).toBe(externalOverride)
  expect(undoLength()).toBe(0)
})
