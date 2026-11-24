import { expect, test } from 'bun:test'
import { CameraRig } from './camera-rig'
import { SceneCameraNode } from './nodes/scene-camera'

test('rig focus allows the armature origin and hidden source bones', () => {
  for (const bone of ['', 'MCH-Aim_widget', 'MCH-Center', 'MCH-DOF_Parent']) {
    const rig = CameraRig.parse({ type: '2d', focus: { kind: 'rig', bone } })
    expect(rig.focus).toEqual({ kind: 'rig', bone })
    expect(CameraRig.parse(JSON.parse(JSON.stringify(rig)))).toEqual(rig)
  }
})

test('foreign armature focus subtargets survive camera serialization without changing generic targets', () => {
  for (const subtarget of ['', 'Aim', 'MCH-Center']) {
    const node = SceneCameraNode.parse({
      rig: {
        type: 'dolly',
        focus: {
          kind: 'object',
          target: { nodeId: 'foreign-rig', fallback: [1, 2, 3], subtarget },
        },
      },
    })
    expect(node.rig!.focus).toMatchObject({ kind: 'object', target: { subtarget } })
    expect(SceneCameraNode.parse(JSON.parse(JSON.stringify(node)))).toEqual(node)
  }
  const legacy = CameraRig.parse({
    type: 'dolly',
    focus: { kind: 'object', target: { nodeId: 'plain-object', fallback: [0, 0, 0] } },
  })
  expect(legacy.focus).toEqual({
    kind: 'object',
    target: { nodeId: 'plain-object', localPoint: null, offset: [0, 0, 0], fallback: [0, 0, 0] },
  })
  expect(
    CameraRig.safeParse({ type: 'dolly', focus: { kind: 'rig', bone: 'x'.repeat(81) } }).success,
  ).toBe(false)
})
