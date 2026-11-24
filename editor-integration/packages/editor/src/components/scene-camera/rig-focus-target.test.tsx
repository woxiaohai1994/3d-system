import { expect, test } from 'bun:test'
import {
  CameraMotionPoint,
  getEffectiveNode,
  MotionKey,
  MotionSegment,
  SceneAnimation,
  SceneCameraNode,
  SiteNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  blenderRigRequest,
  createSourceCameraRig,
  evaluateSourceCameraRig,
  sampleObjectMotion,
  sceneCameraRigPose,
} from '@pascal-app/viewer'
import { _roots, extend } from '@react-three/fiber'
import { create } from '@react-three/test-renderer'
import { act, type ReactElement } from 'react'
import { Euler, Group, Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import { getLocale, setLocale } from '../../i18n'
import { initialSceneAnimationState, useSceneAnimation } from '../scene-animation/store'
import { cameraPoseAt, resolveMotionTargetAt } from './motion-state'
import { RigSourceControls } from './rig-source-controls'
import { rigSnapshot, useRigEditor } from './rig-state'

class FocusHost {
  constructor() {
    // DOM tab IDs are mutable; Object3D's numeric ID is not.
    const descriptors = {
      ...Object.getOwnPropertyDescriptors(new Object3D()),
      id: { value: '', writable: true, configurable: true },
    }
    Object.defineProperties(this, descriptors)
  }
  aria = { label: '', invalid: false, busy: false }
  data = {
    animation: { state: '' },
    source: { property: '', operator: '', menu: false },
    camera: { rig: { source: '' } },
  }
}
Object.setPrototypeOf(FocusHost.prototype, Object3D.prototype)
extend(
  Object.fromEntries(
    [
      'Div',
      'Section',
      'Details',
      'Summary',
      'Fieldset',
      'Label',
      'Input',
      'Span',
      'Select',
      'Option',
      'P',
      'Button',
      'Img',
      'Svg',
      'Polygon',
    ].map((name) => [name, FocusHost]),
  ),
)
type HostFiber = {
  type: unknown
  memoizedProps: Record<string, unknown>
  child: HostFiber | null
  sibling: HostFiber | null
}

function fixture() {
  const scene = useScene.getState(),
    temporal = useScene.temporal.getState(),
    animation = useSceneAnimation.getState(),
    editor = useRigEditor.getState(),
    live = useLiveNodeOverrides.getState(),
    registry = new Map(sceneRegistry.nodes),
    locale = getLocale()
  const globals = Object.fromEntries(
    [
      'window',
      'document',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'IS_REACT_ACT_ENVIRONMENT',
    ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  )
  Object.assign(globalThis, {
    window: new EventTarget(),
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  Reflect.deleteProperty(globalThis, 'document')
  setLocale('zh-CN')
  const site = SiteNode.parse({}),
    foreignParent = SiteNode.parse({}),
    camera = SceneCameraNode.parse({ parentId: site.id, depthOfField: true }),
    foreign = SceneCameraNode.parse({ parentId: foreignParent.id, depthOfField: true })
  camera.rig = createSourceCameraRig('dolly', sceneCameraRigPose(camera))
  foreign.rig = createSourceCameraRig('2d', sceneCameraRigPose(foreign))
  camera.rig.focus = { kind: 'rig', bone: 'Aim' }
  const parentObject = new Group(),
    foreignObject = new Group(),
    cameraObject = new Group()
  parentObject.position.set(4, -2, 7)
  parentObject.rotation.set(0.3, -0.4, 0.1)
  parentObject.scale.set(2, 0.6, 1.4)
  foreignObject.position.set(40, 50, 60)
  parentObject.add(foreignObject)
  parentObject.updateMatrixWorld(true)
  sceneRegistry.nodes.set(foreignParent.id, parentObject)
  sceneRegistry.nodes.set(foreign.id, foreignObject)
  sceneRegistry.nodes.set(camera.id, cameraObject)
  useScene.setState({
    nodes: {
      [site.id]: site,
      [foreignParent.id]: foreignParent,
      [camera.id]: camera,
      [foreign.id]: foreign,
    },
    rootNodeIds: [site.id, foreignParent.id],
    readOnly: false,
  })
  useSceneAnimation.setState({ ...initialSceneAnimationState, open: false, cameraId: null })
  useScene.temporal.getState().clear()
  return {
    camera,
    foreign,
    site,
    foreignParent,
    parentObject,
    dispose() {
      useScene.setState(scene, true)
      useScene.temporal.setState(temporal, true)
      useSceneAnimation.setState(animation, true)
      useRigEditor.setState(editor, true)
      useLiveNodeOverrides.setState(live, true)
      sceneRegistry.nodes.clear()
      for (const [id, object] of registry) sceneRegistry.nodes.set(id, object)
      setLocale(locale)
      for (const [key, descriptor] of Object.entries(globals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    },
  }
}
function Panel({ node }: { node: SceneCameraNode }) {
  const camera = useScene((state) => state.nodes[node.id]) as SceneCameraNode
  return (
    <RigSourceControls
      node={camera}
      rig={getEffectiveNode(camera).rig!}
      snapshot={rigSnapshot(camera)!}
      timeline={false}
    />
  )
}

test('mounted source DOF menu selects empty origin, hidden bones and another armature', async () => {
  const f = fixture()
  let renderer: Awaited<ReturnType<typeof create>> | undefined
  function hosts(predicate: (fiber: HostFiber) => boolean) {
    const root = [..._roots.values()].find((entry) => entry.store === renderer!.scene.fiber.root)!
    const found: HostFiber[] = []
    const walk = (fiber: HostFiber | null) => {
      if (!fiber) return
      if (predicate(fiber)) found.push(fiber)
      walk(fiber.child)
      walk(fiber.sibling)
    }
    walk(root.fiber.current as unknown as HostFiber)
    return found
  }
  function selects() {
    return hosts(
      (fiber) => fiber.type === 'select' && fiber.memoizedProps['aria-label'] === '对焦物体',
    )
  }
  async function tab(label: string) {
    const button = hosts(
      (fiber) =>
        fiber.type === 'button' &&
        fiber.memoizedProps.role === 'tab' &&
        fiber.memoizedProps.children === label,
    )[0]!
    await act(async () => (button.memoizedProps.onClick as () => void)())
    const panels = hosts((fiber) => fiber.type === 'div' && fiber.memoizedProps.role === 'tabpanel')
    expect(panels.filter((panel) => !panel.memoizedProps.hidden)).toHaveLength(1)
    expect(
      panels.find((panel) => !panel.memoizedProps.hidden)!.memoizedProps['aria-labelledby'],
    ).toBe(button.memoizedProps.id)
  }
  function options(index: number) {
    return (
      selects()[index]!.memoizedProps.children as ReactElement<{
        value: string
        children: string
      }>[]
    ).map((entry) => ({ value: entry.props.value, children: entry.props.children }))
  }
  async function select(index: number, value: string) {
    const change = selects()[index]!.memoizedProps.onChange as (event: {
      target: { value: string }
    }) => void
    await act(async () => change({ target: { value } }))
  }
  try {
    renderer = await create(<Panel node={f.camera} />)
    await tab('景深')
    expect(options(1)).toContainEqual({ value: '', children: '相机架原点' })
    expect(options(1)).toContainEqual({ value: 'MCH-Aim_widget', children: '瞄准形状（机制骨）' })
    await select(1, '')
    expect((useScene.getState().nodes[f.camera.id] as SceneCameraNode).rig!.focus).toEqual({
      kind: 'rig',
      bone: '',
    })
    await select(1, 'MCH-Aim_widget')
    expect((useScene.getState().nodes[f.camera.id] as SceneCameraNode).rig!.focus).toEqual({
      kind: 'rig',
      bone: 'MCH-Aim_widget',
    })
    await select(0, f.foreign.id)
    expect(selects()).toHaveLength(2)
    expect(options(1)).toContainEqual({ value: 'MCH-Center', children: '构图中心（机制骨）' })
    expect(options(1)).toContainEqual({ value: 'MCH-DOF_Parent', children: '对焦跟随（机制骨）' })
    await select(1, 'MCH-Center')
    expect((useScene.getState().nodes[f.camera.id] as SceneCameraNode).rig!.focus).toMatchObject({
      kind: 'object',
      target: { nodeId: f.foreign.id, subtarget: 'MCH-Center' },
    })
    const focus = (useScene.getState().nodes[f.camera.id] as SceneCameraNode).rig!.focus
    await tab('显示')
    await tab('相机架')
    await tab('构图')
    await tab('景深')
    expect((useScene.getState().nodes[f.camera.id] as SceneCameraNode).rig!.focus).toEqual(focus)
    expect(selects()[1]!.memoizedProps.value).toBe('MCH-Center')
  } finally {
    await renderer?.unmount()
    f.dispose()
  }
})

test('foreign hidden bone focus follows its own keyed rig and animated parent on random frame seeks', () => {
  const f = fixture()
  try {
    const before = sceneCameraRigPose(f.foreign),
      afterRig = structuredClone(f.foreign.rig!)
    afterRig.native!.bones.Root!.location[0] = 6
    const a = CameraMotionPoint.parse({ ...before, rig: f.foreign.rig, time: 0 }),
      b = CameraMotionPoint.parse({ ...before, rig: afterRig, time: 1 })
    const parentA = MotionKey.parse({
        time: 0,
        position: [4, -2, 7],
        rotation: [0.3, -0.4, 0.1],
        scale: [2, 0.6, 1.4],
      }),
      parentB = MotionKey.parse({
        time: 1,
        position: [9, 1, 2],
        rotation: [0.3, 0.1, 0.1],
        scale: [2, 0.6, 1.4],
      })
    const parentTrack = {
      kind: 'object' as const,
      nodeId: f.foreignParent.id,
      parentId: null,
      points: [parentA, parentB],
      segments: [
        MotionSegment.parse({
          fromId: parentA.id,
          toId: parentB.id,
          path: 'line',
          rhythm: 'linear',
        }),
      ],
    }
    f.site.animation = SceneAnimation.parse({
      tracks: [
        {
          kind: 'camera',
          nodeId: f.foreign.id,
          parentId: f.foreignParent.id,
          points: [a, b],
          segments: [
            MotionSegment.parse({ fromId: a.id, toId: b.id, path: 'line', rhythm: 'linear' }),
          ],
        },
        parentTrack,
      ],
    })
    useSceneAnimation.setState({ open: true, cameraId: f.camera.id, time: 0 })
    const target = {
      nodeId: f.foreign.id,
      localPoint: [0, 0, 0] as [number, number, number],
      offset: [0, 0, 0] as [number, number, number],
      fallback: [-99, -99, -99] as [number, number, number],
      subtarget: 'MCH-Center',
    }
    f.camera.rig!.focus = { kind: 'object', target }
    f.foreign.rig!.focus = {
      kind: 'object',
      target: { ...target, nodeId: f.camera.id, subtarget: 'Camera' },
    }
    for (const time of [0, 0.25, 0.75, 1, 0.25]) {
      const rig = structuredClone(f.foreign.rig!),
        parent = sampleObjectMotion(parentTrack, time)
      rig.native!.bones.Root!.location[0] = time * 6
      const parentMatrix = new Matrix4().compose(
        new Vector3(...parent.position),
        new Quaternion().setFromEuler(new Euler(...parent.rotation)),
        new Vector3(...parent.scale!),
      )
      const sampled = evaluateSourceCameraRig(
        blenderRigRequest(rig, { aspect: 16 / 9, projection: 'perspective', parentMatrix }, before),
      )
      const expected = new Vector3()
        .setFromMatrixPosition(new Matrix4().fromArray(sampled.boneMatrices['MCH-Center']!))
        .applyMatrix4(new Matrix4().fromArray(rig.native!.placement))
        .applyMatrix4(parentMatrix)
      expect(resolveMotionTargetAt(target, f.camera, time).distanceTo(expected)).toBeLessThan(1e-6)
      const expectedCamera = evaluateSourceCameraRig(
        blenderRigRequest(
          f.camera.rig!,
          { aspect: 16 / 9, projection: 'perspective' },
          sceneCameraRigPose(f.camera),
          null,
          expected,
        ),
      )
      expect(cameraPoseAt(f.camera, time).rigFocusDistance).toBeCloseTo(
        expectedCamera.focusDistance,
        7,
      )
    }
  } finally {
    f.dispose()
  }
})

test('foreign focus reads the active frame edit and excludes that transient edit from export', () => {
  const f = fixture()
  try {
    const before = sceneCameraRigPose(f.foreign),
      editing = structuredClone(before)
    editing.rig!.native!.bones.Root!.location[0] += 7
    const target = {
      nodeId: f.foreign.id,
      localPoint: [0, 0, 0] as [number, number, number],
      offset: [0, 0, 0] as [number, number, number],
      fallback: [-99, -99, -99] as [number, number, number],
      subtarget: 'MCH-Center',
    }
    const point = (pose: typeof before) => {
      const sampled = evaluateSourceCameraRig(
        blenderRigRequest(
          pose.rig!,
          { aspect: 16 / 9, projection: 'perspective', parentMatrix: f.parentObject.matrixWorld },
          pose,
        ),
      )
      return new Vector3()
        .setFromMatrixPosition(new Matrix4().fromArray(sampled.boneMatrices['MCH-Center']!))
        .applyMatrix4(new Matrix4().fromArray(pose.rig!.native!.placement))
        .applyMatrix4(f.parentObject.matrixWorld)
    }
    useSceneAnimation.setState({
      open: true,
      cameraId: f.foreign.id,
      time: 0.5,
      readCameraEditPose: () => editing,
    })
    expect(resolveMotionTargetAt(target, f.camera, 0.5).distanceTo(point(editing))).toBeLessThan(
      1e-6,
    )
    expect(resolveMotionTargetAt(target, f.camera, 0.5).distanceTo(point(before))).toBeGreaterThan(
      1,
    )
    useSceneAnimation.setState({ exporting: true })
    expect(resolveMotionTargetAt(target, f.camera, 0.5).distanceTo(point(before))).toBeLessThan(
      1e-6,
    )
    useSceneAnimation.setState({ exporting: false, readCameraEditPose: undefined })
    expect(resolveMotionTargetAt(target, f.camera, 0.5).distanceTo(point(before))).toBeLessThan(
      1e-6,
    )
  } finally {
    f.dispose()
  }
})
