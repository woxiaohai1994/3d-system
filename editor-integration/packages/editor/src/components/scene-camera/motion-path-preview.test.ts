import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import {
  CameraMotionPoint,
  MotionSegment,
  SceneCameraNode,
  SiteNode,
  useScene,
} from '@pascal-app/core'
import { createTransformMotionEvaluator } from '@pascal-app/viewer'
import { Vector3 } from 'three'
import { useSceneAnimation } from '../scene-animation/store'
import { moveCurveNode } from './motion-curve'
import { commitPath, editingPathData, previewPath } from './motion-path-context'
import { editMotionPath, reshapeMotionPath } from './motion-path-edit'
import { selectPathNode } from './motion-path-nodes'
import { pathPreviewTime, previewCameraPathLocation } from './motion-path-preview'
import {
  changeMotionDraft,
  commitMotionPoint,
  endSceneAnimation,
  motionData,
  openMotion,
  seekMotion,
} from './motion-state'
import { changeRigType } from './rig-state'
import { useCameraStudio } from './store'
import { attachViewfinderCanvas, viewfinderRenderRequest } from './viewfinder-state'

const savedScene = useScene.getState(),
  savedStudio = useCameraStudio.getState()
const oldRaf = globalThis.requestAnimationFrame,
  oldCancel = globalThis.cancelAnimationFrame
beforeAll(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
})
afterAll(() => {
  globalThis.requestAnimationFrame = oldRaf
  globalThis.cancelAnimationFrame = oldCancel
})
afterEach(() => {
  endSceneAnimation(true)
  useScene.setState(savedScene, true)
  useCameraStudio.setState(savedStudio, true)
})

for (const rig of [false, true]) {
  test(`camera path selection and live drafts reach the viewfinder before commit (rig=${rig})`, () => {
    const camera = SceneCameraNode.parse({}),
      site = SiteNode.parse({ children: [camera.id] })
    useScene.setState({
      nodes: { [site.id]: site, [camera.id]: camera },
      rootNodeIds: [site.id],
      readOnly: false,
    })
    useScene.temporal.getState().resume()
    openMotion(camera)
    if (rig) changeRigType(camera, 'dolly')
    for (const time of [0, 4]) {
      seekMotion(time)
      changeMotionDraft({ position: [time, 2, 8] })
      commitMotionPoint()
    }
    expect(motionData().points).toHaveLength(2)
    attachViewfinderCanvas({} as HTMLCanvasElement)
    useCameraStudio.setState({ viewfinderId: camera.id })
    const data = editingPathData(),
      segment = data.segments[0]!,
      first = data.points[0]!
    selectPathNode(first.id, segment.id)
    expect(useSceneAnimation.getState().time).toBe(0)
    expect(useSceneAnimation.getState().pointId).toBe(first.id)
    const originalPose = viewfinderRenderRequest().pose!
    const nodes = useScene.getState().nodes
    useScene.temporal.getState().clear()
    previewPath(moveCurveNode(data, first.id, new Vector3(0, 2, 0)))
    expect(viewfinderRenderRequest().pose!.position[1]).toBeCloseTo(originalPose.position[1] + 2)
    expect(useScene.getState().nodes).toBe(nodes)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    useSceneAnimation.setState({ sceneDraft: null })
    expect(viewfinderRenderRequest().pose).toEqual(originalPose)

    expect(editMotionPath(segment.id)).toBe(true)
    previewCameraPathLocation(segment.id, 0.5)
    expect(useSceneAnimation.getState().time).toBeGreaterThan(0)
    expect(useSceneAnimation.getState().time).toBeLessThan(4)
    const beforeCurve = viewfinderRenderRequest().pose!,
      beforeData = motionData()
    const draft = reshapeMotionPath(data, segment.id, new Vector3(0, 3, 0), 'curve')
    previewPath(draft)
    const duringDrag = viewfinderRenderRequest().pose!
    expect(duringDrag.position[1]).toBeGreaterThan(beforeCurve.position[1] + 1)
    expect(useScene.getState().nodes).toBe(nodes)
    useSceneAnimation.setState({ sceneDraft: null })
    expect(viewfinderRenderRequest().pose).toEqual(beforeCurve)
    expect(commitPath(draft)).toBe(true)
    expect(viewfinderRenderRequest().pose).toEqual(duringDrag)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(motionData()).toEqual(beforeData)
    expect(viewfinderRenderRequest().pose).toEqual(beforeCurve)
  })
}

test('spatial node preview time respects arc length and easing without changing key times', () => {
  const points = [
    [0, 0, 0],
    [10, 0, 0],
  ].map((position, i) =>
    CameraMotionPoint.parse({
      time: i * 8,
      position,
      rotation: [0, 0, 0],
      verticalFov: 50,
      orthographicHeight: 10,
      orbitDistance: 10,
    }),
  )
  for (const rhythm of ['linear', 'ease', 'continuous'] as const) {
    const segment = MotionSegment.parse({
      fromId: points[0]!.id,
      toId: points[1]!.id,
      path: 'bezier',
      rhythm,
      easing: [0.7, 0, 0.9, 0.6],
      handles: [
        [0, 12, 0],
        [-1, 0, 0],
      ],
    })
    const data = { points, segments: [segment] },
      evaluator = createTransformMotionEvaluator(data)
    for (const at of [0, 0.2, 0.6, 1]) {
      const time = pathPreviewTime(data, segment.id, at)!
      expect(
        new Vector3(...evaluator.sample(time)!.position).distanceTo(evaluator.positionAt(0, at)),
      ).toBeLessThan(1e-6)
    }
    expect(points.map((p) => p.time)).toEqual([0, 8])
  }
})
