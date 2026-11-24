import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  BlenderRigRequest,
  CameraRig,
  getEffectiveNode,
  SceneCameraNode,
  SiteNode,
  useScene,
} from '@pascal-app/core'
import { applySourceRigOperator, evaluateSourceCameraRig } from '@pascal-app/viewer'
import { renderToStaticMarkup } from 'react-dom/server'
import { Matrix4 } from 'three'
import animatedSwap from '../../../../../tests/integration/fixtures/add-camera-rigs-animated-swap.json'
import { runRedo, runUndo } from '../../lib/history'
import { useSceneAnimation } from '../scene-animation/store'
import { bindObjectMotionSampler } from './motion-objects'
import {
  cameraPoseAt,
  commitMotionPoint,
  endSceneAnimation,
  motionCamera,
  motionData,
  openMotion,
  seekMotion,
} from './motion-state'
import { sourceNumberDrag } from './rig-number-drag'
import {
  sourcePopupCallbacks,
  sourcePopupExecuteOnOpen,
  sourcePopupHash,
} from './rig-operator-popup-source'
import {
  bindRigPropertyEdits,
  keyRigProperty,
  rigPropertyAddress,
  rigPropertyCurve,
  useRigPropertyEdits,
} from './rig-property-animation'
import { RigSourceLayout } from './rig-source-panel'
import { rigSourceUI, type SourceLayout } from './rig-source-ui'
import { changeRigType, rigPose, rigSnapshot } from './rig-state'
import { beginSwapLens, beginSwapLensDrag } from './rig-swap-lens'
import { sourceSwapLensHash } from './rig-swap-lens-source'

afterEach(() => {
  endSceneAnimation(true)
  useSceneAnimation.setState({ lockedIds: [] })
  useScene.temporal.getState().clear()
})

function setup(timeline = false, keyed = false) {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const site = SiteNode.parse({}),
    node = SceneCameraNode.parse({ parentId: site.id, position: [0, 2, 10] })
  site.children = [node.id]
  useScene.setState({
    nodes: { [site.id]: site, [node.id]: node },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  if (timeline) openMotion(node)
  changeRigType(node, 'dolly')
  if (keyed) commitMotionPoint()
  useScene.temporal.getState().clear()
  const camera = () => useScene.getState().nodes[node.id] as SceneCameraNode
  return { camera, node: camera() }
}

test('invoke, draw and popup callbacks retain the original source hashes', () => {
  for (const [path, hash] of [
    ['add-camera-rigs/operators.py', sourceSwapLensHash],
    ['blender-operator-popup/wm_operators.cc', sourcePopupHash],
  ] as const)
    expect(
      createHash('sha256')
        .update(readFileSync(new URL(`../../../../../vendor/${path}`, import.meta.url)))
        .digest('hex'),
    ).toBe(hash)
  for (const [path, hash] of Object.entries(animatedSwap.hashes))
    expect(
      createHash('sha256')
        .update(
          readFileSync(new URL(`../../../../../vendor/add-camera-rigs/${path}`, import.meta.url)),
        )
        .digest('hex'),
    ).toBe(hash)
  expect(sourcePopupExecuteOnOpen).toBe(false)
  const calls: string[] = [],
    op = {},
    ctx = {}
  let last: unknown = null
  const callbacks = sourcePopupCallbacks({
    WM_operator_last_redo: () => last,
    ED_undo_push_op: () => {
      calls.push('push')
    },
    wm_operator_register: (_c, o) => {
      last = o
      calls.push('register')
    },
    WM_operator_repeat: () => {
      calls.push('execute')
    },
    ED_undo_operator_repeat: () => {
      calls.push('undo-repeat')
    },
    WM_operator_free: () => {
      calls.push('free')
    },
  })
  callbacks.close(ctx, op)
  expect(calls).toEqual(['free'])
  calls.length = 0
  callbacks.update(ctx, op)
  callbacks.update(ctx, op)
  callbacks.close(ctx, op)
  expect(calls).toEqual(['push', 'register', 'execute', 'undo-repeat'])
})

for (const [timeline, keyed] of [
  [false, false],
  [true, false],
  [true, true],
])
  test(`live lens redo keeps one undo step; timeline=${timeline} keyed=${keyed}`, () => {
    const { node, camera } = setup(timeline, keyed)
    const before = rigPose(node).rig!,
      snapshot = rigSnapshot(node)!
    const session = beginSwapLens(node)!
    expect(session).not.toBeNull()
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    for (const lens of [85, 120, 35]) {
      expect(session.change(lens)).toBe(true)
      const expected = applySourceRigOperator(before, snapshot, 'swap_lens', lens)
      expect(rigPose(camera()).rig?.native?.bones).toEqual(expected.native!.bones)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    }
    session.close()
    expect(rigPose(camera()).rig?.native?.bones.Camera?.properties.lens).toBe(35)
    expect(runUndo().kind).toBe('applied')
    expect(rigPose(camera()).rig?.native?.bones).toEqual(before.native!.bones)
    expect(runRedo().kind).toBe('applied')
    expect(rigPose(camera()).rig?.native?.bones.Camera?.properties.lens).toBe(35)
    if (keyed) expect(motionData(motionCamera()!).points).toHaveLength(1)
  })

test('opening then closing is a no-op and renders the original Chinese field without confirmation buttons', () => {
  const { node, camera } = setup()
  const before = camera()
  const session = beginSwapLens(node)!
  const markup = renderToStaticMarkup(
    <RigSourceLayout
      tree={session.layout}
      bindings={{
        property: () => ({ value: session.value, change: () => {} }),
        operator: () => ({ run: () => {} }),
      }}
    />,
  )
  expect(markup).toContain('焦距：')
  expect(markup).toContain('aria-label="焦距（毫米）"')
  expect(markup).not.toContain('<button')
  session.close()
  expect(camera()).toBe(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})

test('an intervening scene edit cannot be consumed by popup redo', () => {
  const { node, camera } = setup()
  const session = beginSwapLens(node)!
  session.change(85)
  useScene.getState().updateNode(node.id, { name: '新名称' })
  expect(session.change(120)).toBe(false)
  expect(camera().name).toBe('新名称')
  expect(useScene.temporal.getState().pastStates).toHaveLength(2)
  session.close()
})

test('native RNA bounds, invalid numbers, locks and ended sessions protect scene history', () => {
  const { node, camera } = setup()
  const session = beginSwapLens(node)!
  expect(session.change(NaN)).toBe(false)
  expect(session.change(5000)).toBe(true)
  expect(session.value).toBe(1000)
  expect(camera().rig!.native!.bones.Camera!.properties.lens).toBe(1000)
  expect(session.change(-1)).toBe(true)
  expect(session.value).toBe(1)
  useSceneAnimation.setState({ lockedIds: [node.id] })
  expect(session.change(50)).toBe(false)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  session.close()
  expect(session.change(50)).toBe(false)
})

test('a paused history cannot make popup repetition rewind another command', () => {
  const { node, camera } = setup()
  useScene.getState().updateNode(node.id, { name: '保留名称' })
  useScene.temporal.getState().pause()
  try {
    const session = beginSwapLens(camera())!
    session.change(85)
    session.change(120)
    expect(camera().name).toBe('保留名称')
    expect(camera().rig!.native!.bones.Camera!.properties.lens).toBe(120)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    session.close()
  } finally {
    useScene.temporal.getState().resume()
  }
})

for (const fixture of animatedSwap.cases)
  test(`animated ${fixture.type} Swap Lens follows real Blender without changing its curve`, () => {
    const { node, camera } = setup(true)
    const native = evaluateSourceCameraRig(BlenderRigRequest.parse({ type: fixture.type }))
    useScene.getState().updateNode(node.id, {
      rig: CameraRig.parse({
        type: fixture.type,
        native: {
          source: 'add-camera-rigs@1.9.0',
          sensorWidth: 36,
          placement: new Matrix4().toArray(),
          bones: native.bones,
        },
      }),
    })
    const edits = bindRigPropertyEdits(),
      sampler = bindObjectMotionSampler()
    const walk = (tree: SourceLayout): SourceLayout[] => [tree, ...tree.children.flatMap(walk)]
    const tree = rigSourceUI.trees
      .flatMap(walk)
      .find(
        (tree) =>
          tree.options.rna?.data_path === 'pose.bones["Camera"]["lens"]' && tree.options.decorate,
      )!
    const address = rigPropertyAddress(tree)!
    let session: ReturnType<typeof beginSwapLens> = null
    try {
      for (const record of fixture.records) {
        if (record.action === 'key') {
          seekMotion(record.frame / 24)
          keyRigProperty(camera(), tree, record.lens, 'insert')
        } else if (record.action === 'seek') {
          session?.close()
          session = null
          seekMotion(record.frame / 24)
        } else {
          session ??= beginSwapLens(camera())
          expect(session?.change(record.argument!)).toBe(true)
        }
        const actual = rigPose(camera()).rig!.native!.bones.Camera!
        expect(actual.properties.lens, record.action).toBeCloseTo(record.lens, 4)
        expect(cameraPoseAt(camera(), record.frame / 24).rigFocalLength).toBeCloseTo(record.lens, 4)
        expect(getEffectiveNode(camera()).rig!.native!.bones.Camera!.properties.lens).toBeCloseTo(
          record.lens,
          4,
        )
        actual.location.forEach((v, i) => {
          expect(v, `${record.action} location ${i}`).toBeCloseTo(record.location[i]!, 4)
        })
        expect(rigPropertyCurve(camera(), address)!.keys.map((key) => [...key.co])).toEqual(
          record.keys,
        )
        if (record.action === 'swap' && record.argument === 35) {
          session!.close()
          session = null
          expect(runUndo().kind).toBe('applied')
          expect(useSceneAnimation.getState().time).toBe(0.5)
          const restored = rigPose(camera()).rig!.native!.bones.Camera!
          expect(restored.properties.lens).toBeCloseTo(47, 4)
          restored.location.forEach((v) => {
            expect(v).toBeCloseTo(0, 4)
          })
          expect(runRedo().kind).toBe('applied')
          expect(useSceneAnimation.getState().time).toBe(0.5)
          expect(rigPose(camera()).rig!.native!.bones.Camera!).toEqual(actual)
          expect(rigPropertyCurve(camera(), address)!.keys.map((key) => [...key.co])).toEqual(
            record.keys,
          )
        }
      }
    } finally {
      session?.close()
      edits()
      sampler()
      useRigPropertyEdits.setState({ edits: {} })
    }
  })

for (const cancel of [false, true])
  test(`source number dragging drives original Swap Lens; cancel=${cancel}`, () => {
    const { node, camera } = setup(true)
    const session = beginSwapLens(node)!
    const original = rigPose(node).rig!.native!.bones
    const value = session.value
    const drag = sourceNumberDrag(
      {
        value,
        hardMin: 1,
        hardMax: 1000,
        softMin: 1,
        softMax: 1000,
        step: 10,
        precision: 3,
        x: 100,
      },
      beginSwapLensDrag(session),
    )
    expect(drag.move(103, true, false, false)).toBe(true)
    expect(drag.changed).toBe(false)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    drag.move(104, true, false, false)
    for (const x of [120, 140, 160, 180, 204]) drag.move(x, true, false, false)
    expect(rigPose(camera()).rig!.native!.bones.Camera!.properties.lens).toBeCloseTo(value + 10, 4)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    drag.finish(cancel)
    session.close()
    if (cancel) {
      const restored = rigPose(camera()).rig!.native!.bones
      expect({ ...restored, Camera: original.Camera }).toEqual({
        ...original,
        Camera: original.Camera,
      })
      expect(restored.Camera!.properties).toEqual(original.Camera!.properties)
      for (const channel of ['location', 'rotation', 'scale'] as const)
        restored.Camera![channel].forEach((v, i) => {
          expect(v).toBeCloseTo(original.Camera![channel][i]!, 10)
        })
    } else {
      expect(runUndo().kind).toBe('applied')
      expect(rigPose(camera()).rig!.native!.bones).toEqual(original)
      expect(runRedo().kind).toBe('applied')
      expect(rigPose(camera()).rig!.native!.bones.Camera!.properties.lens).toBeCloseTo(
        value + 10,
        4,
      )
    }
    expect(drag.move(300, true, false, false)).toBe(false)
  })
