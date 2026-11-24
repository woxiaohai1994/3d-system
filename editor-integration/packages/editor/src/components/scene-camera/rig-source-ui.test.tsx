import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { SceneCameraNode, useScene } from '@pascal-app/core'
import {
  applySourceRigOperator,
  createSourceCameraRig,
  sceneCameraRigPose,
  useViewer,
} from '@pascal-app/viewer'
import { renderToStaticMarkup } from 'react-dom/server'
import paletteSequence from '../../../../../tests/integration/fixtures/add-camera-rigs-palette-sequence.json'
import { useSceneAnimation } from '../scene-animation/store'
import { CameraRigControls } from './rig-controls'
import { RigSourceControls } from './rig-source-controls'
import { rigSourceUI, sourceRigUIState, sourceWidgetStyle } from './rig-source-ui'
import { rigSnapshot, useRigEditor } from './rig-state'
import { CameraRigToolbar } from './rig-toolbar'
import icons from './rig-ui-icons-source.json'

const scene = useScene.getState(),
  animation = useSceneAnimation.getState(),
  viewer = useViewer.getState(),
  rigEditor = useRigEditor.getState()
afterEach(() => {
  useScene.setState(scene, true)
  useSceneAnimation.setState(animation, true)
  useViewer.setState(viewer, true)
  useRigEditor.setState(rigEditor, true)
})

test('Chinese control labels preserve source bone identifiers and the selected control', () => {
  const node = SceneCameraNode.parse({})
  node.rig = createSourceCameraRig('crane', sceneCameraRigPose(node))
  useScene.setState({ nodes: { [node.id]: node }, readOnly: false })
  useViewer.setState({ selection: { ...viewer.selection, selectedIds: [node.id] } })
  useSceneAnimation.setState({ open: false, cameraId: null })
  // Server rendering reads Zustand's initial snapshot rather than its live state.
  const snapshots = [useScene, useViewer, useSceneAnimation, useRigEditor].map((store) => ({
    initial: store.getInitialState(),
    saved: { ...store.getInitialState() },
    current: store.getState,
  }))
  try {
    for (const [control, label] of [
      ['Camera', '机位'],
      ['Aim', '瞄准'],
      ['Crane_Height', '支柱升降'],
    ]) {
      useRigEditor.setState({
        control,
        poseCameraId: node.id,
        selectionCameraId: node.id,
        selectedControls: [control!],
      })
      for (const snapshot of snapshots) Object.assign(snapshot.initial, snapshot.current())
      const markup = renderToStaticMarkup(<CameraRigToolbar />)
      expect(markup).toContain(`<option value="${control}" selected="">${label}</option>`)
      expect(markup).not.toContain(`<option value="${label}"`)
    }
  } finally {
    for (const snapshot of snapshots) Object.assign(snapshot.initial, snapshot.saved)
  }
})

test('exported layout provenance matches the unmodified Python files it executed', () => {
  for (const [name, hash] of Object.entries(rigSourceUI.hashes)) {
    const source = readFileSync(
      new URL(`../../../../../vendor/add-camera-rigs/${name}`, import.meta.url),
    )
    expect(createHash('sha256').update(source).digest('hex')).toBe(hash)
  }
})

test('Swap Lens keeps its distinct original operator RNA range', () => {
  expect(rigSourceUI.swapLens.hard_min).toBe(1)
  expect(rigSourceUI.swapLens.hard_max).toBe(1000)
})

test('camera type choices follow the pinned 4.3 Camera RNA rather than later host additions', () => {
  const metadata = rigSourceUI.cameraTypeRNA,
    original = readFileSync(new URL(`../../../../../${metadata.path}`, import.meta.url)),
    block = original
      .toString()
      .match(/static const EnumPropertyItem prop_type_items\[\] = \{([\s\S]*?)\n {2}\};/)![1]!,
    values = [...block.matchAll(/\{CAM_\w+, "([^"]+)"/g)].map((match) => match[1]!)
  expect(createHash('sha256').update(original).digest('hex')).toBe(metadata.sha256)
  expect(metadata.blenderVersion).toBe('4.3.0')
  expect(metadata.items.map((item) => item.value)).toEqual(values)
  let fields = 0
  const visit = (tree: (typeof rigSourceUI.trees)[number]) => {
    if (tree.options.owner === 'cameraData' && tree.options.property === 'type') {
      expect(tree.options.rna!.items).toEqual(metadata.items)
      fields++
    }
    for (const child of tree.children) visit(child)
  }
  for (const tree of rigSourceUI.trees) visit(tree)
  expect(fields).toBeGreaterThan(0)
})

test('all source rigs expose absolute Object channels separately from Pose bone channels', () => {
  const snapshots = [useScene, useViewer, useSceneAnimation, useRigEditor].map((store) => ({
    initial: store.getInitialState(),
    saved: { ...store.getInitialState() },
    current: store.getState,
  }))
  try {
    for (const type of ['dolly', 'crane', '2d'] as const) {
      const node = SceneCameraNode.parse({})
      node.rig = createSourceCameraRig(type, sceneCameraRigPose(node))
      useScene.setState({ nodes: { [node.id]: node }, readOnly: false })
      useViewer.setState({ selection: { ...viewer.selection, selectedIds: [node.id] } })
      useSceneAnimation.setState({ open: false, cameraId: null })
      for (const poseMode of [false, true]) {
        useRigEditor.setState({
          control: 'Camera',
          gesture: null,
          poseCameraId: poseMode ? node.id : null,
          selectionCameraId: node.id,
          selectedControls: ['Camera'],
        })
        for (const snapshot of snapshots) Object.assign(snapshot.initial, snapshot.current())
        const markup = renderToStaticMarkup(<CameraRigControls node={node} showAim={false} />)
        if (poseMode) {
          expect(markup).not.toContain('相机架对象 位置 X')
          expect(markup).toContain('机位 位移 X')
        } else {
          expect(markup).toContain('相机本体 位置 X')
          expect(markup).toContain('相机本体 旋转 Y')
          expect(markup).not.toContain('相机本体 缩放')
          expect(markup).not.toContain('机位 位移 X')
        }
      }
    }
  } finally {
    for (const snapshot of snapshots) Object.assign(snapshot.initial, snapshot.saved)
  }
})

test('plugin UI icons embed the unmodified Blender SVG bytes', () => {
  for (const [name, entry] of Object.entries(icons.source.files)) {
    const bytes = readFileSync(
      new URL(
        `../../../../../vendor/blender-rig-ui-icons/${name.toLowerCase()}.svg`,
        import.meta.url,
      ),
    )
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256)
    expect(
      Buffer.from(icons.icons[name as keyof typeof icons.icons].split(',')[1]!, 'base64'),
    ).toEqual(bytes)
  }
})

test('viewport colors retain upstream bone palettes and Dolly Zoom override', () => {
  for (const [type, control, zoom, palette] of [
    ['dolly', 'Root', false, 'THEME02'],
    ['dolly', 'Aim', false, 'THEME04'],
    ['crane', 'Camera_Offset', false, 'THEME09'],
    ['dolly', 'Aim', true, 'THEME01'],
  ] as const) {
    const source = rigSourceUI.colors[palette]!
    const style = sourceWidgetStyle(type, control, zoom)
    expect(style.color.select).toEqual(source.select)
    expect(style.color.active).toEqual(source.active)
    expect(style.solidColor).toEqual(source.normal)
    for (let channel = 0; channel < 3; channel++)
      expect(style.color.normal[channel]).toBeCloseTo(
        Math.max(Math.round(source.normal[channel]! * 255) - 50, 0) / 255,
        7,
      )
  }
  expect(sourceWidgetStyle('dolly', 'Root', false).width).toBe(1.5)
})

test('native Dolly Zoom removal restores the underlying blue bone palette after repeated operations', () => {
  for (const [file, hash] of Object.entries(paletteSequence.sources))
    expect(
      createHash('sha256')
        .update(readFileSync(new URL(`../../../../../${file}`, import.meta.url)))
        .digest('hex'),
    ).toBe(hash)
  const drawing = readFileSync(
    new URL('../../../../../vendor/blender-rig-wire/overlay_armature.cc', import.meta.url),
    'utf8',
  )
  expect(drawing).toMatch(
    /if \(pchan_->color\.palette_index == 0\) \{[\s\S]*?return pchan_->bone->color\.wrap\(\);/,
  )
  for (const type of ['dolly', 'crane'] as const) {
    const node = SceneCameraNode.parse({})
    let rig = createSourceCameraRig(type, sceneCameraRigPose(node))
    node.rig = rig
    useScene.setState({ nodes: { [node.id]: node }, readOnly: false })
    useSceneAnimation.setState({ open: false, cameraId: null })
    for (const sample of paletteSequence.sequence.filter((sample) => sample.rig === type)) {
      if (sample.operation)
        rig = applySourceRigOperator(
          rig,
          rigSnapshot(node, rig)!,
          sample.operation as 'set_dolly_zoom' | 'remove_dolly_zoom',
        )
      const expected = rigSourceUI.colors[sample.effectivePalette]!
      const style = sourceWidgetStyle(type, 'Aim', rig.dollyZoom)
      expect(style.color.select).toEqual(expected.select)
      expect(style.color.active).toEqual(expected.active)
      expect(style.solidColor).toEqual(expected.normal)
      expect(rig.dollyZoom).toBe(sample.posePalette !== 'DEFAULT')
      expect(sample.bonePalette).toBe('THEME04')
      for (let channel = 0; channel < 3; channel++)
        expect(style.color.normal[channel]).toBeCloseTo(
          Math.max(Math.round(expected.normal[channel]! * 255) - 50, 0) / 255,
          7,
        )
    }
  }
})

for (const type of ['dolly', 'crane', '2d'] as const)
  for (const projection of ['perspective', 'orthographic'] as const)
    for (const dollyZoom of type === '2d' ? [false] : [false, true])
      for (const depthOfField of [false, true])
        for (const kind of ['manual', 'object', 'rig'] as const)
          test(`source layout bindings ${type} ${projection} zoom=${dollyZoom} dof=${depthOfField} ${kind}`, () => {
            const node = SceneCameraNode.parse({ projection, depthOfField })
            node.rig = createSourceCameraRig(type, sceneCameraRigPose(node))
            node.rig.dollyZoom = dollyZoom
            node.rig.focus =
              kind === 'manual'
                ? { kind }
                : kind === 'rig'
                  ? { kind, bone: 'Aim' }
                  : {
                      kind,
                      target: {
                        nodeId: node.id,
                        localPoint: [0, 0, 0],
                        offset: [0, 0, 0],
                        fallback: [0, 0, 0],
                      },
                    }
            useScene.setState({ nodes: { [node.id]: node }, readOnly: false })
            useSceneAnimation.setState({ open: false, cameraId: null })
            const entries = sourceRigUIState(node.rig, projection, depthOfField, true)
            expect(entries.filter((entry) => entry.panel)).toHaveLength(4)
            const markup = renderToStaticMarkup(
              <RigSourceControls
                node={node}
                rig={node.rig}
                snapshot={rigSnapshot(node)!}
                timeline={false}
              />,
            )
            expect(markup).toContain('相机架')
            expect(markup).toContain('视图显示')
            expect(markup).toContain('相机架属性')
            if (type === 'crane') {
              expect(markup).toContain('摇臂支柱高度')
              expect(markup).toContain('臂长')
            }
            if (type === '2d') {
              expect(markup).toContain('旋转／平移构图')
              expect(markup).not.toContain('镜头呼吸')
            } else if (projection === 'orthographic') expect(markup).toContain('正交尺寸')
            else if (dollyZoom) expect(markup).toContain('焦距偏移')
            else expect(markup).toContain('焦距')
          })
