import { afterEach, beforeAll, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  CameraMotion,
  CameraMotionPoint,
  cameraTracks,
  getEffectiveNode,
  MotionSegment,
  SceneAnimation,
  SceneCameraNode,
  SiteNode,
  sampleScenePlayback,
  updateSceneCameraMotion,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { createSourceCameraRig, sceneCameraRigPose } from '@pascal-app/viewer'
import historyReference from '../../../../../tests/integration/fixtures/add-camera-rigs-property-history.json'
import { getHistoryCommandState, runRedo, runUndo } from '../../lib/history'
import { animationData, commitSceneAnimation } from '../scene-animation/document'
import { initialSceneAnimationState, useSceneAnimation } from '../scene-animation/store'
import { bindObjectMotionSampler } from './motion-objects'
import { cameraPoseAt, seekMotion } from './motion-state'
import {
  beginPhotoRigPropertyDrag,
  beginRigPropertyDrag,
  bindRigPropertyEdits,
  changeRigProperty,
  keyRigProperty,
  rigPropertyAddress,
  rigPropertyCurve,
  sampleRigPropertyAnimation,
  useRigPropertyEdits,
} from './rig-property-animation'
import { rigSourceUI, type SourceLayout } from './rig-source-ui'
import { rigSnapshot, updateRig } from './rig-state'

beforeAll(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
})
let release = () => {}
afterEach(() => {
  release()
  useRigPropertyEdits.setState({ edits: {} })
  useLiveNodeOverrides.setState({ overrides: new Map() })
  useSceneAnimation.setState(initialSceneAnimationState)
})
function layout(path: string): SourceLayout {
  const walk = (tree: SourceLayout): SourceLayout[] => [tree, ...tree.children.flatMap(walk)]
  return rigSourceUI.trees
    .flatMap(walk)
    .find((tree) => tree.options.rna?.data_path === path && tree.options.decorate)!
}
function setup() {
  const site = SiteNode.parse({ animation: SceneAnimation.parse({}) })
  const node = SceneCameraNode.parse({ parentId: site.id })
  node.rig = createSourceCameraRig('dolly', sceneCameraRigPose(node))
  site.children = [node.id]
  useScene.setState({
    nodes: { [site.id]: site, [node.id]: node },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useSceneAnimation.setState({ ...initialSceneAnimationState, open: true, cameraId: node.id })
  useScene.temporal.getState().clear()
  const sampler = bindObjectMotionSampler(),
    edits = bindRigPropertyEdits()
  release = () => {
    sampler()
    edits()
  }
  return { node, site }
}
const lensPath = 'pose.bones["Camera"]["lens"]'
test('independent lens keys follow native interpolation without creating pose keys', () => {
  const { node } = setup(),
    tree = layout(lensPath)
  const address = rigPropertyAddress(tree)!
  for (const [frame, value] of [
    [1, 38],
    [7, 47],
    [19, 53],
    [43, 62],
  ]) {
    seekMotion(frame! / 24)
    expect(keyRigProperty(node, tree, value!, 'insert')).toBe(true)
  }
  expect(cameraTracks(animationData())[0]!.points).toEqual([])
  expect(rigPropertyCurve(node, address)!.keys).toHaveLength(4)
  seekMotion(11 / 24)
  expect(cameraPoseAt(node, 11 / 24).rigFocalLength).toBeCloseTo(51.055557, 4)
  expect(getEffectiveNode(node).rig!.native!.bones.Camera!.properties.lens).toBeCloseTo(
    51.055557,
    4,
  )
  expect(SceneAnimation.parse(JSON.parse(JSON.stringify(animationData()))).tracks).toEqual(
    animationData().tracks,
  )
})
test('unrecorded property changes preview, then seeking restores the original independent curve', () => {
  const { node } = setup(),
    tree = layout(lensPath),
    address = rigPropertyAddress(tree)!
  keyRigProperty(node, tree, 35, 'insert')
  seekMotion(1)
  keyRigProperty(node, tree, 70, 'insert')
  const before = structuredClone(rigPropertyCurve(node, address))
  seekMotion(0.5)
  changeRigProperty(node, address, 100)
  expect(cameraPoseAt(node, 0.5).rigFocalLength).toBeCloseTo(100, 4)
  expect(rigPropertyCurve(node, address)).toEqual(before)
  seekMotion(1)
  expect(cameraPoseAt(node, 1).rigFocalLength).toBeCloseTo(70, 4)
  expect(cameraTracks(animationData())[0]!.points).toEqual([])
})
test('deleting a property key affects only that channel and deleting its final key removes the curve', () => {
  const { node } = setup(),
    tree = layout(lensPath),
    clip = layout('clip_start')
  keyRigProperty(node, tree, 35, 'insert')
  keyRigProperty(node, clip, 0.25, 'insert')
  seekMotion(1)
  keyRigProperty(node, tree, 70, 'insert')
  const clipCurve = structuredClone(rigPropertyCurve(node, rigPropertyAddress(clip)!))
  expect(keyRigProperty(node, tree, 999, 'delete')).toBe(true)
  expect(rigPropertyCurve(node, rigPropertyAddress(tree)!)!.keys).toHaveLength(1)
  expect(rigPropertyCurve(node, rigPropertyAddress(clip)!)).toEqual(clipCurve)
  seekMotion(0)
  expect(keyRigProperty(node, tree, 999, 'delete')).toBe(true)
  expect(rigPropertyCurve(node, rigPropertyAddress(tree)!)).toBeUndefined()
  expect(rigPropertyCurve(node, rigPropertyAddress(clip)!)).toEqual(clipCurve)
})
test('all undriven animated source panel properties have a host channel', () => {
  const walk = (tree: SourceLayout): SourceLayout[] => [tree, ...tree.children.flatMap(walk)]
  for (const tree of rigSourceUI.trees.flatMap(walk)) {
    const o = tree.options
    if (
      (o.decorate || tree.kind === 'decorator') &&
      o.rna?.is_animatable &&
      !o.rna.driven_indices?.length
    )
      expect(rigPropertyAddress(tree), `${o.owner}.${o.rna.data_path}`).not.toBeNull()
  }
})
test('projection and display channels use discrete values and restore when playback ends', () => {
  const { node } = setup(),
    projection = layout('type'),
    display = layout('show_limits')
  keyRigProperty(node, projection, 0, 'insert')
  keyRigProperty(node, display, 0, 'insert')
  seekMotion(1)
  keyRigProperty(node, projection, 1, 'insert')
  keyRigProperty(node, display, 1, 'insert')
  seekMotion(0.5)
  expect(getEffectiveNode(node).projection).toBe('perspective')
  seekMotion(1)
  expect(getEffectiveNode(node).projection).toBe('orthographic')
  expect(
    (getEffectiveNode(node).metadata['editor.cameraRigDisplay'] as { limits: boolean }).limits,
  ).toBe(true)
  expect(sampleRigPropertyAnimation(node, 0.5).projection).toBe('perspective')
  sampleScenePlayback(null)
  expect(getEffectiveNode(node).projection).toBe('perspective')
  expect(getEffectiveNode(node).metadata['editor.cameraRigDisplay']).toBeUndefined()
})

test('saved scene reload retains independent curve sampling without a pose track', () => {
  const { node, site } = setup(),
    tree = layout(lensPath)
  keyRigProperty(node, tree, 24, 'insert')
  seekMotion(1)
  keyRigProperty(node, tree, 70, 'insert')
  const restoredSite = SiteNode.parse(
    JSON.parse(JSON.stringify(useScene.getState().nodes[site.id])),
  )
  const restoredCamera = SceneCameraNode.parse(
    JSON.parse(JSON.stringify(useScene.getState().nodes[node.id])),
  )
  sampleScenePlayback(null)
  useRigPropertyEdits.setState({ edits: {} })
  useScene.setState({ nodes: { [site.id]: restoredSite, [node.id]: restoredCamera } })
  seekMotion(0.5)
  expect(cameraPoseAt(restoredCamera, 0.5).rigFocalLength).toBeCloseTo(47, 4)
  expect(cameraTracks(animationData())[0]!.points).toEqual([])
})

test('undo and redo restore a deleted property key and its native interpolation', () => {
  const { node } = setup(),
    tree = layout(lensPath)
  useScene.temporal.getState().clear()
  keyRigProperty(node, tree, 24, 'insert')
  seekMotion(1)
  keyRigProperty(node, tree, 70, 'insert')
  keyRigProperty(node, tree, 70, 'delete')
  expect(cameraPoseAt(node, 0.5).rigFocalLength).toBeCloseTo(24, 4)
  useScene.temporal.getState().undo()
  expect(cameraPoseAt(node, 0.5).rigFocalLength).toBeCloseTo(47, 4)
  useScene.temporal.getState().redo()
  expect(cameraPoseAt(node, 0.5).rigFocalLength).toBeCloseTo(24, 4)
})

test('unkeyed value changes have their own undo steps without deleting curve keys', () => {
  const { node } = setup(),
    tree = layout(lensPath),
    address = rigPropertyAddress(tree)!
  keyRigProperty(node, tree, 24, 'insert')
  seekMotion(1)
  keyRigProperty(node, tree, 70, 'insert')
  seekMotion(0.5)
  changeRigProperty(node, address, 100)
  changeRigProperty(node, address, 120)
  runUndo()
  expect(cameraPoseAt(node, 0.5).rigFocalLength).toBeCloseTo(100, 4)
  runUndo()
  expect(cameraPoseAt(node, 0.5).rigFocalLength).toBeCloseTo(47, 4)
  expect(rigPropertyCurve(node, address)!.keys).toHaveLength(2)
  expect(getHistoryCommandState().canRedo).toBe(true)
  runRedo()
  expect(cameraPoseAt(node, 0.5).rigFocalLength).toBeCloseTo(47, 4)
  changeRigProperty(node, address, 80)
  expect(getHistoryCommandState().canRedo).toBe(false)
  expect(runRedo().kind).toBe('empty')
})

test('value editing and key insertion share chronological undo and redo', () => {
  const { node } = setup(),
    tree = layout(lensPath),
    address = rigPropertyAddress(tree)!
  keyRigProperty(node, tree, 24, 'insert')
  seekMotion(1)
  keyRigProperty(node, tree, 70, 'insert')
  seekMotion(0.5)
  changeRigProperty(node, address, 100)
  keyRigProperty(node, tree, 100, 'insert')
  runUndo()
  expect(rigPropertyCurve(node, address)!.keys).toHaveLength(2)
  expect(cameraPoseAt(node, 0.5).rigFocalLength).toBeCloseTo(100, 4)
  runUndo()
  expect(cameraPoseAt(node, 0.5).rigFocalLength).toBeCloseTo(47, 4)
  runRedo()
  expect(cameraPoseAt(node, 0.5).rigFocalLength).toBeCloseTo(47, 4)
  runRedo()
  expect(rigPropertyCurve(node, address)!.keys).toHaveLength(3)
  expect(cameraPoseAt(node, 0.5).rigFocalLength).toBeCloseTo(100, 4)
})

test('a scene edit after a preview value is undone before the preview value', () => {
  const { node } = setup(),
    tree = layout(lensPath),
    address = rigPropertyAddress(tree)!
  keyRigProperty(node, tree, 24, 'insert')
  changeRigProperty(node, address, 100)
  useScene.getState().updateNode(node.id, { name: '临时名称' })
  runUndo()
  expect(useScene.getState().nodes[node.id]!.name).toBe(node.name)
  expect(cameraPoseAt(node, 0).rigFocalLength).toBeCloseTo(100, 4)
  runUndo()
  expect(cameraPoseAt(node, 0).rigFocalLength).toBeCloseTo(24, 4)
  runRedo()
  runRedo()
  expect(useScene.getState().nodes[node.id]!.name).toBe('临时名称')
  expect(cameraPoseAt(node, 0).rigFocalLength).toBeCloseTo(100, 4)
})

test('undoing the first unanimated property edit restores its original value', () => {
  const { node } = setup(),
    tree = layout(lensPath),
    address = rigPropertyAddress(tree)!
  const before = cameraPoseAt(node, 0).rigFocalLength!
  changeRigProperty(node, address, 100)
  runUndo()
  expect(
    cameraPoseAt(useScene.getState().nodes[node.id] as SceneCameraNode, 0).rigFocalLength,
  ).toBeCloseTo(before, 4)
  runRedo()
  expect(
    cameraPoseAt(useScene.getState().nodes[node.id] as SceneCameraNode, 0).rigFocalLength,
  ).toBeCloseTo(100, 4)
})

test('pose animation and independent lens animation retain their own channels', () => {
  const { node } = setup(),
    tree = layout(lensPath)
  keyRigProperty(node, tree, 24, 'insert')
  seekMotion(1)
  keyRigProperty(node, tree, 70, 'insert')
  const rig0 = structuredClone(node.rig!),
    rig1 = structuredClone(node.rig!)
  rig0.native!.bones.Camera!.properties.lens = 200
  rig1.native!.bones.Camera!.properties.lens = 500
  rig1.native!.bones.Root!.location[0] += 4
  const a = CameraMotionPoint.parse({ ...sceneCameraRigPose(node), rig: rig0, time: 0 })
  const b = CameraMotionPoint.parse({ ...sceneCameraRigPose(node), rig: rig1, time: 1 })
  const motion = CameraMotion.parse({
    points: [a, b],
    segments: [MotionSegment.parse({ fromId: a.id, toId: b.id, path: 'line', rhythm: 'linear' })],
  })
  expect(commitSceneAnimation(updateSceneCameraMotion(animationData(), node, motion))).toBe(true)
  seekMotion(0.5)
  const pose = cameraPoseAt(node, 0.5)
  expect(pose.rigFocalLength).toBeCloseTo(47, 4)
  expect(pose.rig!.native!.bones.Root!.location[0]).toBeCloseTo(
    rig0.native!.bones.Root!.location[0] + 2,
    4,
  )
  expect(cameraTracks(animationData())[0]!.propertyCurves).toHaveLength(1)
  expect(cameraTracks(animationData())[0]!.points).toHaveLength(2)
})

test('property history follows real Blender frames, values and keys through every undo and redo', () => {
  for (const [path, hash] of Object.entries(historyReference.hashes))
    expect(
      createHash('sha256')
        .update(readFileSync(new URL(`../../../../../${path}`, import.meta.url)))
        .digest('hex'),
    ).toBe(hash)
  const { node } = setup(),
    tree = layout(lensPath),
    address = rigPropertyAddress(tree)!
  for (const [index, expected] of historyReference.records.entries()) {
    if (expected.action === 'key') {
      if (index < 2) seekMotion(expected.frame / 24)
      keyRigProperty(node, tree, expected.value, 'insert')
    } else if (expected.action === 'seek') seekMotion(expected.frame / 24)
    else if (expected.action === 'value') changeRigProperty(node, address, expected.value)
    else if (expected.action === 'undo') runUndo()
    else if (expected.action === 'redo') runRedo()
    const time = useSceneAnimation.getState().time
    expect(time * 24, `${index} ${expected.action} frame`).toBe(expected.frame)
    expect(
      cameraPoseAt(node, time).rigFocalLength,
      `${index} ${expected.action} value`,
    ).toBeCloseTo(expected.value, 4)
    expect(getEffectiveNode(node).rig!.native!.bones.Camera!.properties.lens).toBeCloseTo(
      expected.value,
      4,
    )
    expect(rigPropertyCurve(node, address)!.keys.map((key) => [...key.co])).toEqual(expected.keys)
  }
})

test('export and film sampling use the authored curve and restore the live unkeyed value afterwards', () => {
  const { node } = setup(),
    tree = layout(lensPath),
    address = rigPropertyAddress(tree)!
  keyRigProperty(node, tree, 24, 'insert')
  seekMotion(1)
  keyRigProperty(node, tree, 70, 'insert')
  seekMotion(0.5)
  changeRigProperty(node, address, 100)
  for (const mode of ['exporting', 'renderingFilm'] as const) {
    useSceneAnimation.setState({ [mode]: true })
    sampleScenePlayback(0.5)
    expect(cameraPoseAt(node, 0.5).rigFocalLength).toBeCloseTo(47, 4)
    expect(getEffectiveNode(node).rig!.native!.bones.Camera!.properties.lens).toBeCloseTo(47, 4)
    useSceneAnimation.setState({ [mode]: false })
    sampleScenePlayback(0.5)
    expect(cameraPoseAt(node, 0.5).rigFocalLength).toBeCloseTo(100, 4)
  }
})

for (const animated of [false, true])
  for (const cancel of [false, true])
    test(`numeric drag previews without scene commits, animated=${animated}, cancel=${cancel}`, () => {
      const { node } = setup(),
        tree = layout(lensPath),
        address = rigPropertyAddress(tree)!
      if (animated) {
        keyRigProperty(node, tree, 24, 'insert')
        seekMotion(1)
        keyRigProperty(node, tree, 70, 'insert')
        seekMotion(0.5)
      }
      const initial = cameraPoseAt(node, useSceneAnimation.getState().time).rigFocalLength!,
        nodes = useScene.getState().nodes,
        curve = structuredClone(rigPropertyCurve(node, address)),
        history = useScene.temporal.getState().pastStates,
        edit = beginRigPropertyDrag(node, address, initial)
      for (const value of [80, 120, 95]) {
        expect(edit.change(value)).toBe(true)
        expect(getEffectiveNode(node).rig!.native!.bones.Camera!.properties.lens).toBe(value)
        expect(useScene.getState().nodes).toBe(nodes)
        expect(useScene.temporal.getState().pastStates).toBe(history)
      }
      edit.finish(cancel)
      edit.finish(cancel)
      expect(edit.change(200)).toBe(false)
      expect(rigPropertyCurve(node, address)).toEqual(curve)
      const current = () => useScene.getState().nodes[node.id] as SceneCameraNode
      expect(getEffectiveNode(current()).rig!.native!.bones.Camera!.properties.lens).toBeCloseTo(
        cancel ? initial : 95,
        4,
      )
      if (cancel) expect(useScene.temporal.getState().pastStates).toBe(history)
      else {
        expect(runUndo().kind).toBe('applied')
        expect(getEffectiveNode(current()).rig!.native!.bones.Camera!.properties.lens).toBeCloseTo(
          animated ? 70 : initial,
          4,
        )
        expect(runRedo().kind).toBe('applied')
        expect(getEffectiveNode(current()).rig!.native!.bones.Camera!.properties.lens).toBe(
          animated ? 47 : 95,
        )
      }
    })

test('seeking during a numeric drag cannot commit or resurrect its old frame preview', () => {
  const { node } = setup(),
    tree = layout(lensPath),
    address = rigPropertyAddress(tree)!
  keyRigProperty(node, tree, 24, 'insert')
  seekMotion(1)
  keyRigProperty(node, tree, 70, 'insert')
  seekMotion(0)
  const edit = beginRigPropertyDrag(node, address, 24)
  expect(edit.change(120)).toBe(true)
  seekMotion(1)
  expect(edit.change(200)).toBe(false)
  edit.finish(false)
  expect(getEffectiveNode(node).rig!.native!.bones.Camera!.properties.lens).toBe(70)
  expect(useRigPropertyEdits.getState().edits).toEqual({})
  expect(useSceneAnimation.getState().time).toBe(1)
})

test('an interrupted drag preserves a newer scene edit and restores its original property', () => {
  const { node } = setup(),
    address = rigPropertyAddress(layout('shift_x'))!,
    edit = beginRigPropertyDrag(node, address, 0)
  expect(edit.change(0.5)).toBe(true)
  useScene.getState().updateNode(node.id, { name: '新的场景操作' })
  expect(edit.change(1)).toBe(false)
  edit.finish(true)
  const current = useScene.getState().nodes[node.id] as SceneCameraNode
  expect(current.name).toBe('新的场景操作')
  expect(getEffectiveNode(current).rig!.native!.lensShift[0]).toBe(0)
})

for (const cancel of [false, true])
  test(`photo lens drag updates the solved camera and has one commit, cancel=${cancel}`, () => {
    const { node } = setup()
    useSceneAnimation.setState({ open: false })
    const address = rigPropertyAddress(layout(lensPath))!,
      before = structuredClone(node.rig!),
      nodes = useScene.getState().nodes,
      initial = before.native!.bones.Camera!.properties.lens!,
      edit = beginPhotoRigPropertyDrag(node, address, initial, (value) => {
        const rig = structuredClone(before)
        rig.native!.bones.Camera!.properties.lens = value
        updateRig(node, rig)
      })
    useLiveNodeOverrides.getState().set(node.id, { near: 0.3 })
    for (const value of [80, 120, 95]) {
      expect(edit.change(value)).toBe(true)
      expect(rigSnapshot(node)!.lens).toBeCloseTo(value, 4)
      expect(useScene.getState().nodes).toBe(nodes)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    }
    edit.finish(cancel)
    expect(useLiveNodeOverrides.getState().get(node.id)).toEqual({ near: 0.3 })
    expect(useScene.temporal.getState().pastStates).toHaveLength(cancel ? 0 : 1)
    const current = () => useScene.getState().nodes[node.id] as SceneCameraNode
    expect(rigSnapshot(current())!.lens).toBeCloseTo(cancel ? initial : 95, 4)
    if (!cancel) {
      runUndo()
      expect(rigSnapshot(current())!.lens).toBeCloseTo(initial, 4)
      runRedo()
      expect(rigSnapshot(current())!.lens).toBeCloseTo(95, 4)
    }
  })

test('photo orthographic dragging uses the photo aspect and restores an existing override', () => {
  const { node } = setup()
  useSceneAnimation.setState({ open: false })
  node.frameAspect = 2
  useLiveNodeOverrides.getState().set(node.id, { orthographicHeight: 3 })
  const edit = beginPhotoRigPropertyDrag(
    node,
    rigPropertyAddress(layout('ortho_scale'))!,
    6,
    () => {
      throw new Error('Cancelled drag must not commit')
    },
  )
  expect(edit.change(10)).toBe(true)
  expect(getEffectiveNode(node).orthographicHeight).toBe(5)
  edit.finish(true)
  expect(getEffectiveNode(node).orthographicHeight).toBe(3)
})

test('photo drag cannot overwrite another preview owner or commit across a workspace switch', () => {
  const { node } = setup()
  useSceneAnimation.setState({ open: false })
  const edit = beginPhotoRigPropertyDrag(
    node,
    rigPropertyAddress(layout('clip_start'))!,
    node.near,
    () => {
      throw new Error('Interrupted drag must not commit')
    },
  )
  expect(edit.change(0.5)).toBe(true)
  useLiveNodeOverrides.getState().set(node.id, { near: 0.7 })
  expect(edit.change(1)).toBe(false)
  edit.finish(false)
  expect(getEffectiveNode(node).near).toBe(0.7)
  const next = beginPhotoRigPropertyDrag(
    node,
    rigPropertyAddress(layout('clip_start'))!,
    0.7,
    () => {
      throw new Error('Interrupted drag must not commit')
    },
  )
  expect(next.change(0.9)).toBe(true)
  useSceneAnimation.setState({ open: true })
  next.finish(false)
  expect(getEffectiveNode(node).near).toBe(0.7)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})

for (const name of ['Crane_Height', 'Crane_Arm'])
  for (const timeline of [false, true])
    test(`crane array component drag previews and commits only scale Y: ${name}, timeline=${timeline}`, () => {
      const { node } = setup()
      node.rig = createSourceCameraRig('crane', sceneCameraRigPose(node))
      useSceneAnimation.setState({ open: timeline })
      const original = structuredClone(node.rig),
        tree = layout(`pose.bones["${name}"].scale`),
        address = rigPropertyAddress(tree)!,
        initial = original.native!.bones[name]!.scale[1],
        matrix = rigSnapshot(node)!.cameraMatrix,
        edit = timeline
          ? beginRigPropertyDrag(node, address, initial)
          : beginPhotoRigPropertyDrag(node, address, initial, (value) => {
              const rig = structuredClone(original)
              rig.native!.bones[name]!.scale[1] = value
              updateRig(node, rig)
            })
      expect(address.index).toBe(1)
      const nodes = useScene.getState().nodes
      for (const value of [2, 3, 4]) {
        expect(edit.change(value)).toBe(true)
        expect(getEffectiveNode(node).rig!.native!.bones[name]!.scale).toEqual([
          original.native!.bones[name]!.scale[0],
          value,
          original.native!.bones[name]!.scale[2],
        ])
        expect(rigSnapshot(node)!.cameraMatrix).not.toEqual(matrix)
        expect(useScene.getState().nodes).toBe(nodes)
        expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      }
      edit.finish(false)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      const current = () => useScene.getState().nodes[node.id] as SceneCameraNode
      expect(getEffectiveNode(current()).rig!.native!.bones[name]!.scale[1]).toBe(4)
      expect(cameraTracks(animationData()).flatMap((track) => track.points)).toEqual([])
      runUndo()
      expect(getEffectiveNode(current()).rig!.native!.bones[name]!.scale).toEqual(
        original.native!.bones[name]!.scale,
      )
      runRedo()
      expect(getEffectiveNode(current()).rig!.native!.bones[name]!.scale[1]).toBe(4)
    })

for (const animated of [false, true])
  for (const previousEdit of [false, true])
    test(`timeline property release never exposes its starting value, animated=${animated}, previousEdit=${previousEdit}`, () => {
      const { node } = setup(),
        tree = layout(lensPath),
        address = rigPropertyAddress(tree)!
      if (animated) expect(keyRigProperty(node, tree, 24, 'insert')).toBe(true)
      if (previousEdit) changeRigProperty(node, address, 80)
      const current = () => useScene.getState().nodes[node.id] as SceneCameraNode,
        initial = cameraPoseAt(current(), 0).rigFocalLength!,
        curve = structuredClone(rigPropertyCurve(node, address)),
        edit = beginRigPropertyDrag(current(), address, initial)
      expect(edit.change(90)).toBe(true)
      expect(edit.change(95)).toBe(true)
      const trace: number[] = [],
        observe = () => trace.push(cameraPoseAt(current(), 0).rigFocalLength!),
        stopEdits = useRigPropertyEdits.subscribe(observe),
        stopScene = useScene.subscribe(observe),
        stopLive = useLiveNodeOverrides.subscribe(observe)
      try {
        edit.finish(false)
      } finally {
        stopEdits()
        stopScene()
        stopLive()
      }
      expect(trace.length).toBeGreaterThan(0)
      expect(
        trace.every((value) => Math.abs(value - 95) < 1e-7),
        JSON.stringify(trace),
      ).toBe(true)
      expect(rigPropertyCurve(node, address)).toEqual(curve)
      expect(cameraTracks(animationData()).flatMap((track) => track.points)).toEqual([])
      expect(runUndo().kind).toBe('applied')
      expect(cameraPoseAt(current(), 0).rigFocalLength).toBeCloseTo(initial, 7)
      expect(rigPropertyCurve(node, address)).toEqual(curve)
      expect(runRedo().kind).toBe('applied')
      expect(cameraPoseAt(current(), 0).rigFocalLength).toBeCloseTo(95, 7)
    })

test('photo property release keeps the preview visible until its authored commit is published', () => {
  const { node } = setup()
  useSceneAnimation.setState({ open: false })
  const address = rigPropertyAddress(layout(lensPath))!,
    initial = node.rig!.native!.bones.Camera!.properties.lens!,
    current = () => useScene.getState().nodes[node.id] as SceneCameraNode,
    edit = beginPhotoRigPropertyDrag(node, address, initial, (value) => {
      const rig = structuredClone(node.rig!)
      rig.native!.bones.Camera!.properties.lens = value
      updateRig(node, rig)
    })
  useLiveNodeOverrides.getState().set(node.id, { near: 0.3 })
  expect(edit.change(90)).toBe(true)
  expect(edit.change(95)).toBe(true)
  const trace: number[] = [],
    observe = () => trace.push(rigSnapshot(current())!.lens),
    stopScene = useScene.subscribe(observe),
    stopLive = useLiveNodeOverrides.subscribe(observe)
  try {
    edit.finish(false)
  } finally {
    stopScene()
    stopLive()
  }
  expect(trace.length).toBeGreaterThan(0)
  expect(
    trace.every((value) => Math.abs(value - 95) < 1e-7),
    JSON.stringify(trace),
  ).toBe(true)
  expect(useLiveNodeOverrides.getState().get(node.id)).toEqual({ near: 0.3 })
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  expect(runUndo().kind).toBe('applied')
  expect(rigSnapshot(current())!.lens).toBeCloseTo(initial, 7)
  expect(runRedo().kind).toBe('applied')
  expect(rigSnapshot(current())!.lens).toBeCloseTo(95, 7)
})
