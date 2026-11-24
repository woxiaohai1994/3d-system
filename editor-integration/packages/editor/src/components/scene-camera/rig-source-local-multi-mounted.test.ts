import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  CameraRig,
  SceneCameraNode,
  SiteNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { evaluateSourceCameraRig, useViewer } from '@pascal-app/viewer'
import { type RootState, useThree } from '@react-three/fiber'
import { create } from '@react-three/test-renderer'
import { act, createElement } from 'react'
import { Euler, Matrix3, Matrix4, Object3D, PerspectiveCamera, Vector3 } from 'three'
import native from '../../../../../tests/integration/fixtures/add-camera-rigs-pose-local-multi.json'
import useInteractionScope from '../../store/use-interaction-scope'
import { useSceneAnimation } from '../scene-animation/store'
import { useObjectMotion } from './motion-object-store'
import { CameraRigGizmo } from './rig-gizmo'
import { rigPose, useRigEditor } from './rig-state'
import { useCameraStudio } from './store'

type NativeCase = (typeof native.cases)[number]
type Channels = NonNullable<CameraRig['native']>['bones']
type Mode = 'translate' | 'rotate' | 'scale'
const channelNames = ['location', 'rotation', 'scale'] as const

function label(item: NativeCase) {
  return `${item.type}/${item.selected.join('+')}/${item.pivot}/${item.requestedMode}/${'XYZ'[item.axis]}`
}

function sourceRig(item: NativeCase, offset?: Matrix4) {
  return CameraRig.parse({
    type: item.type,
    native: {
      source: 'add-camera-rigs@1.9.0',
      placement: new Matrix4().toArray(),
      sensorWidth: 36,
      bones: structuredClone(item.before),
      cameraOffsetMatrix: offset?.toArray(),
    },
  })
}

function sourceSnapshot(item: NativeCase, rig = sourceRig(item)) {
  return evaluateSourceCameraRig({
    type: rig.type,
    bones: rig.native!.bones,
    worldMatrix: item.placement,
    aspect: 16 / 9,
    projection: 'perspective',
    sensorWidth: 36,
    orthographicHeight: 10,
    tracking: rig.tracking,
    focusOnAim: false,
  })
}

function expectChannels(
  actual: Channels,
  expected: NativeCase['after'] | Channels,
  context: string,
) {
  for (const [name, bone] of Object.entries(expected)) {
    if (!bone) continue
    for (const channel of channelNames)
      actual[name]![channel].forEach((value, index) => {
        const error = Math.abs(value - bone[channel][index]!)
        if (!(error < 2e-4))
          throw new Error(
            `${context}: ${name}.${channel}[${index}] actual=${value}, expected=${bone[channel][index]}, error=${error}`,
          )
        expect(error).toBeLessThan(2e-4)
      })
  }
}

function normalizedAxes(matrix: Matrix4) {
  const result = new Matrix4()
  for (let axis = 0; axis < 3; axis++) {
    const column = new Vector3().setFromMatrixColumn(matrix, axis).normalize()
    for (let row = 0; row < 3; row++) result.elements[axis * 4 + row] = column.getComponent(row)
  }
  return result
}

// Independent affine TransData arithmetic, validated below against recorded Blender channels.
// No authoring, constraint, selection, pivot, or follow production helper computes these values.
function expectedExtension(item: NativeCase, rig: CameraRig) {
  const data = sourceSnapshot(item, rig),
    parent = new Matrix4().fromArray(item.placement),
    base = new Matrix4().fromArray(data.cameraMatrix),
    offset = new Matrix4().fromArray(rig.native!.cameraOffsetMatrix ?? new Matrix4().toArray()),
    delta = base.clone().multiply(offset).multiply(base.clone().invert()),
    following = rig.native!.cameraOffsetMatrix !== undefined,
    result = structuredClone(rig.native!.bones)
  const entries = item.selected.map((name) => {
    const widget = data.widgets.find((entry) => entry.name === name)!,
      raw = parent.clone().multiply(new Matrix4().fromArray(widget.boneMatrix)),
      displayed = parent
        .clone()
        .multiply(
          new Matrix4()
            .fromArray(widget.boneMatrix)
            .premultiply(name === 'Camera' ? delta : new Matrix4()),
        )
    return {
      name,
      widget,
      raw,
      displayed,
      axes: normalizedAxes(displayed),
      head: new Vector3().setFromMatrixPosition(raw),
      displayedHead: new Vector3().setFromMatrixPosition(displayed),
      edit: parent.clone().multiply(new Matrix4().fromArray(widget.editMatrix)),
      location: parent.clone().multiply(new Matrix4().fromArray(widget.locationMatrix)),
    }
  })
  const median = entries
      .reduce((center, entry) => center.add(entry.displayedHead), new Vector3())
      .divideScalar(entries.length),
    parentLinear = new Matrix3().setFromMatrix4(parent),
    parentInverse = parent.clone().invert(),
    displayedTargets = new Map<string, Vector3>()
  for (const entry of entries) {
    const bone = result[entry.name]!,
      before = rig.native!.bones[entry.name]!,
      axis = new Vector3().setFromMatrixColumn(entry.axes, item.axis),
      individual = item.pivot === 'INDIVIDUAL_ORIGINS',
      pivot = individual ? entry.displayedHead : median,
      transform =
        item.mode === 'rotate'
          ? new Matrix4().makeRotationAxis(axis, item.value)
          : entry.axes
              .clone()
              .multiply(
                new Matrix4().makeScale(
                  item.axis === 0 ? item.value : 1,
                  item.axis === 1 ? item.value : 1,
                  item.axis === 2 ? item.value : 1,
                ),
              )
              .multiply(entry.axes.clone().invert())
    if (item.mode === 'translate') {
      const movement = axis.clone().multiplyScalar(item.value),
        channels = movement
          .clone()
          .applyMatrix3(new Matrix3().setFromMatrix4(entry.location).invert())
      bone.location = before.location.map(
        (value, i) => value + (entry.widget.locks.location[i] ? 0 : channels.getComponent(i)),
      ) as [number, number, number]
      displayedTargets.set(entry.name, entry.displayedHead.clone().add(movement))
    } else {
      if (item.mode === 'rotate') {
        const basis = new Matrix3().setFromMatrix4(entry.edit),
          rotation = new Matrix4().setFromMatrix3(
            basis
              .clone()
              .invert()
              .multiply(new Matrix3().setFromMatrix4(transform))
              .multiply(basis)
              .multiply(
                new Matrix3().setFromMatrix4(
                  new Matrix4().makeRotationFromEuler(new Euler(...before.rotation, 'ZYX')),
                ),
              ),
          ),
          euler = new Euler().setFromRotationMatrix(normalizedAxes(rotation), 'ZYX'),
          values = [euler.x, euler.y, euler.z]
        bone.rotation = before.rotation.map((value, i) =>
          entry.widget.locks.rotation[i] ? value : values[i]!,
        ) as [number, number, number]
      } else
        bone.scale = before.scale.map(
          (value, i) =>
            value * (entry.widget.locks.scale[i] ? 1 : i === item.axis ? item.value : 1),
        ) as [number, number, number]
      if (!individual || (following && entry.name === 'Camera')) {
        let movement: Vector3
        if (item.mode === 'rotate')
          movement = entry.head
            .clone()
            .sub(pivot)
            .applyMatrix4(transform)
            .add(pivot)
            .sub(entry.head)
        else {
          const localHead = entry.head.clone().applyMatrix4(parentInverse),
            localPivot = pivot.clone().applyMatrix4(parentInverse)
          movement = localHead
            .clone()
            .sub(localPivot)
            .applyMatrix4(transform)
            .add(localPivot)
            .sub(localHead)
            .applyMatrix3(parentLinear)
        }
        movement.applyMatrix3(new Matrix3().setFromMatrix4(entry.edit).invert())
        bone.location = before.location.map(
          (value, i) => value + (entry.widget.locks.location[i] ? 0 : movement.getComponent(i)),
        ) as [number, number, number]
      }
      displayedTargets.set(
        entry.name,
        individual
          ? entry.displayedHead.clone()
          : entry.displayedHead.clone().sub(median).applyMatrix4(transform).add(median),
      )
    }
  }
  return { channels: result, displayedTargets, before: entries, data }
}

async function fixture(item: NativeCase, offset?: Matrix4) {
  const globals = Object.fromEntries(
      [
        'window',
        'document',
        'HTMLElement',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'IS_REACT_ACT_ENVIRONMENT',
      ].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
    ),
    saved = {
      scene: useScene.getState(),
      temporal: useScene.temporal.getState(),
      viewer: useViewer.getState(),
      animation: useSceneAnimation.getState(),
      rig: useRigEditor.getState(),
      studio: useCameraStudio.getState(),
      overrides: useLiveNodeOverrides.getState(),
      objectMotion: useObjectMotion.getState(),
      interaction: useInteractionScope.getState(),
    }
  Object.assign(globalThis, {
    window: new EventTarget(),
    HTMLElement: class extends EventTarget {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  Reflect.deleteProperty(globalThis, 'document')
  const site = SiteNode.parse({}),
    node = SceneCameraNode.parse({
      parentId: site.id,
      position: [0, 2, 10],
      rig: sourceRig(item, offset),
    }),
    parent = new Object3D(),
    previousParent = sceneRegistry.nodes.get(site.id),
    events = new EventTarget()
  parent.matrixAutoUpdate = false
  parent.matrix.fromArray(item.placement)
  parent.updateMatrixWorld(true)
  sceneRegistry.nodes.set(site.id, parent)
  site.children = [node.id]
  useLiveNodeOverrides.getState().clearAll()
  useScene.setState({
    nodes: { [site.id]: site, [node.id]: node },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useSceneAnimation.setState({
    open: false,
    time: 0,
    playing: false,
    exporting: false,
    previewing: false,
    cameraView: false,
    pickingRigAim: false,
    pickingAnchor: null,
    lockedIds: [],
  })
  useViewer.setState({
    selection: { ...saved.viewer.selection, selectedIds: [node.id] },
    inputDragging: false,
  })
  useCameraStudio.setState({ canvas: null })
  useObjectMotion.setState({ nodeId: null })
  useInteractionScope.getState().end()
  useRigEditor.setState({
    control: item.active,
    selectedControls: [...item.selected],
    selectionCameraId: node.id,
    poseCameraId: node.id,
    mode: 'translate',
    pivot: item.pivot,
    cursor: [0, 0, 0],
    gesture: null,
    frameRequest: 0,
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  const camera = new PerspectiveCamera(50, 1, 0.1, 1000)
  camera.position.set(35, 25, 35)
  camera.lookAt(0, 2, 0)
  camera.updateMatrixWorld()
  let root!: RootState, canvas!: HTMLCanvasElement
  function Host() {
    root = useThree()
    canvas = root.gl.domElement
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1000 }) as DOMRect
    canvas.hasAttribute = () => true
    canvas.focus = () => {}
    canvas.addEventListener = events.addEventListener.bind(events)
    canvas.removeEventListener = events.removeEventListener.bind(events)
    canvas.dispatchEvent = events.dispatchEvent.bind(events)
    return createElement(CameraRigGizmo)
  }
  const renderer = await create(createElement(Host), { camera, width: 1000, height: 1000 }),
    current = () => useScene.getState().nodes[node.id] as SceneCameraNode,
    rig = () => rigPose(current()).rig!
  const key = async (...keys: string[]) => {
    await act(async () => {
      for (const key of keys) {
        const event = new Event('keydown', { cancelable: true })
        Object.defineProperties(
          event,
          Object.fromEntries(
            Object.entries({
              target: canvas,
              key,
              code: key,
              ctrlKey: false,
              metaKey: false,
              altKey: false,
              shiftKey: false,
              repeat: false,
            }).map(([name, value]) => [name, { value }]),
          ),
        )
        window.dispatchEvent(event)
      }
      await renderer.advanceFrames(1, 1 / 60)
    })
  }
  return {
    node,
    root,
    canvas,
    renderer,
    current,
    rig,
    key,
    async begin() {
      const axis = 'xyz'[item.axis]!,
        numeric = item.mode === 'rotate' ? (item.value * 180) / Math.PI : item.value
      await key(
        { translate: 'g', rotate: 'r', scale: 's' }[item.requestedMode as Mode],
        axis,
        axis,
        ...String(numeric),
      )
      expect(useRigEditor.getState().gesture?.space).toBe('local')
      expect(useRigEditor.getState().gesture?.axis).toBe(axis.toUpperCase())
      expect(useRigEditor.getState().gesture?.mode).toBe(item.mode as Mode)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    },
    async dispose() {
      await renderer.unmount()
      if (previousParent) sceneRegistry.nodes.set(site.id, previousParent)
      else sceneRegistry.nodes.delete(site.id)
      useInteractionScope.getState().end()
      useScene.temporal.getState().pause()
      useScene.setState(saved.scene, true)
      useScene.temporal.setState(saved.temporal, true)
      useLiveNodeOverrides.setState(saved.overrides, true)
      useSceneAnimation.setState(saved.animation, true)
      useViewer.setState(saved.viewer, true)
      useRigEditor.setState(saved.rig, true)
      useCameraStudio.setState(saved.studio, true)
      useObjectMotion.setState(saved.objectMotion, true)
      useInteractionScope.setState(saved.interaction, true)
      for (const [name, descriptor] of Object.entries(globals))
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
    },
  }
}

function displayHead(item: NativeCase, rig: CameraRig, name: string) {
  const data = sourceSnapshot(item, rig),
    bone = new Matrix4().fromArray(data.boneMatrices[name]!),
    base = new Matrix4().fromArray(data.cameraMatrix)
  if (name === 'Camera' && rig.native!.cameraOffsetMatrix)
    bone.premultiply(
      base
        .clone()
        .multiply(new Matrix4().fromArray(rig.native!.cameraOffsetMatrix))
        .multiply(base.clone().invert()),
    )
  return new Vector3().setFromMatrixPosition(new Matrix4().fromArray(item.placement).multiply(bone))
}

test('mounted multi-control oracle and independent extension equations retain original Blender evidence', () => {
  const hash = (path: string) =>
    createHash('sha256')
      .update(readFileSync(new URL(`../../../../../${path}`, import.meta.url)))
      .digest('hex')
  expect(hash('vendor/add-camera-rigs/build_rigs.py')).toBe(native.sourceSHA256)
  expect(hash('scripts/blender/export-rig-pose-local-multi.py')).toBe(native.generatorSHA256)
  expect(native.cases).toHaveLength(37)
  for (const item of native.cases) {
    if (item.requestedMode !== item.mode) continue
    const expected = expectedExtension(item, sourceRig(item)),
      parent = new Matrix4().fromArray(item.placement)
    expectChannels(expected.channels, item.after, label(item))
    for (const [name, matrix] of Object.entries(item.boneWorldMatrices)) {
      if (!matrix) continue
      const world = parent
        .clone()
        .multiply(new Matrix4().fromArray(expected.data.boneMatrices[name]!))
      world.elements.forEach((value, index) => {
        expect(Math.abs(value - matrix[index]!)).toBeLessThan(2e-4)
      })
    }
  }
})

for (const item of native.cases)
  test(`mounted original LOCAL ${label(item)} matches per-TransData channels through commit and Undo`, async () => {
    const f = await fixture(item)
    try {
      const before = structuredClone(f.rig())
      await f.begin()
      expectChannels(f.rig().native!.bones, item.after, label(item))
      expect(f.current().rig).toEqual(before)
      expect(f.rig().native!.placement).toEqual(before.native!.placement)
      expect(f.rig().native!.cameraOffsetMatrix).toBeUndefined()
      await f.key('Enter')
      expectChannels(f.rig().native!.bones, item.after, label(item))
      expect(useViewer.getState().inputDragging).toBe(false)
      expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
      const changed = JSON.stringify(f.current().rig) !== JSON.stringify(before)
      expect(useScene.temporal.getState().pastStates).toHaveLength(changed ? 1 : 0)
      if (changed) await act(async () => useScene.temporal.getState().undo())
      expect(f.rig()).toEqual(before)
    } finally {
      await f.dispose()
    }
  })

test('an isolated mounted gizmo cancels Pose without swallowing the next panel or canvas click', async () => {
  const f = await fixture(native.cases[0]!)
  try {
    await f.begin()
    await f.key('Escape')
    const button = new HTMLElement(),
      click = new Event('click', { bubbles: true, cancelable: true })
    Object.defineProperty(click, 'target', { value: button })
    let received = 0
    const listener = () => {
      received++
    }
    window.addEventListener('click', listener)
    try {
      button.dispatchEvent(click)
      window.dispatchEvent(click)
      expect(click.defaultPrevented).toBe(false)
      expect(received).toBe(1)
      // This fixture mounts only the gizmo; the source viewport binding owns drag-sequence clicks.
      // The full owner is covered separately by rig-viewport-pointer and widget-drag-pending tests.
      const canvasClick = new Event('click', { bubbles: true, cancelable: true })
      f.canvas.dispatchEvent(canvasClick)
      expect(canvasClick.defaultPrevented).toBe(false)
    } finally {
      window.removeEventListener('click', listener)
    }
  } finally {
    await f.dispose()
  }
})

for (const item of native.cases.filter(
  (item) => item.axis === 0 && item.requestedMode === item.mode,
))
  test(`mounted body-offset LOCAL ${label(item)} uses each displayed axis while Aim remains source-authored`, async () => {
    const offset = new Matrix4()
        .makeRotationFromEuler(new Euler(0.15, 0.4, -0.2))
        .setPosition(2, 0.8, -1.2),
      f = await fixture(item, offset)
    try {
      const before = structuredClone(f.rig()),
        expected = expectedExtension(item, before),
        aim = expected.before.find((entry) => entry.name === 'Aim')!,
        initialAim = new Vector3().setFromMatrixPosition(
          new Matrix4().fromArray(item.boneWorldMatrices.Aim!),
        )
      expect(aim.displayedHead.distanceTo(initialAim)).toBeLessThan(2e-4)
      expect(expected.before[0]!.axes.elements).not.toEqual(expected.before[1]!.axes.elements)
      await f.begin()
      expectChannels(f.rig().native!.bones, expected.channels, label(item))
      expect(f.rig().native!.placement).toEqual(before.native!.placement)
      const linear = new Matrix3().setFromMatrix4(
        new Matrix4().fromArray(f.rig().native!.cameraOffsetMatrix!),
      )
      linear.elements.forEach((value, i) => {
        expect(value).toBe(new Matrix3().setFromMatrix4(offset).elements[i]!)
      })
      expect(
        displayHead(item, f.rig(), 'Camera').distanceTo(expected.displayedTargets.get('Camera')!),
      ).toBeLessThan(2e-4)
      if (item.mode === 'translate') {
        const target = initialAim
          .clone()
          .add(new Vector3().setFromMatrixColumn(aim.axes, item.axis).multiplyScalar(item.value))
        expect(displayHead(item, f.rig(), 'Aim').distanceTo(target)).toBeLessThan(2e-4)
      } else if (item.pivot === 'INDIVIDUAL_ORIGINS')
        expect(displayHead(item, f.rig(), 'Aim').distanceTo(initialAim)).toBeLessThan(2e-4)
      const preview = structuredClone(f.rig())
      await f.key('Enter')
      expect(f.rig()).toEqual(preview)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      await act(async () => useScene.temporal.getState().undo())
      expect(f.rig()).toEqual(before)
      await f.begin()
      await f.key('Escape')
      expect(f.rig()).toEqual(before)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
    } finally {
      await f.dispose()
    }
  })
