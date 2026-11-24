import { afterEach, expect, test } from 'bun:test'
import { type CameraRig, SceneCameraNode, useScene } from '@pascal-app/core'
import { createSourceCameraRig, sceneCameraRigPose } from '@pascal-app/viewer'
import { renderToStaticMarkup } from 'react-dom/server'
import { useSceneAnimation } from '../scene-animation/store'
import { MotionLensControls } from './motion-lens-controls'
import { QuickCameraLens } from './quick-lens'

const savedScene = useScene.getState(),
  savedAnimation = useSceneAnimation.getState()
afterEach(() => {
  useScene.setState(savedScene, true)
  useSceneAnimation.setState(savedAnimation, true)
})

function camera(type: CameraRig['type']) {
  const node = SceneCameraNode.parse({ focalLength: 50 })
  node.rig = createSourceCameraRig(type, sceneCameraRigPose(node))
  useSceneAnimation.setState({ open: false, cameraId: null })
  useScene.setState({ nodes: { [node.id]: node }, readOnly: false })
  return node
}

function inputs(markup: string) {
  return [...markup.matchAll(/<input\b[^>]*>/g)].map(([tag]) =>
    Object.fromEntries(
      [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]),
    ),
  )
}

test('photo and timeline quick lens use source custom-property limits without truncating effective optics', () => {
  const node = camera('crane')
  node.rig!.native!.bones.Camera!.properties.lens = 5000
  const pose = sceneCameraRigPose(node)
  for (const element of [
    <QuickCameraLens key="photo" node={node} />,
    <MotionLensControls key="timeline" node={node} pose={pose} />,
  ]) {
    const markup = renderToStaticMarkup(element)
    const fields = inputs(markup)
    expect(fields).toHaveLength(1)
    expect(fields[0]).toMatchObject({
      'aria-label': '焦距 · 毫米',
      value: '5000',
      min: '1',
      max: '1000000',
    })
    expect(fields[0]).not.toHaveProperty('disabled')
    expect(markup).toContain('实际焦距')
    expect(markup).not.toContain('24–85')
  }
})

test('quick Dolly Zoom exposes lens offset and keeps the driven focal value read-only', () => {
  const node = camera('dolly')
  node.rig!.dollyZoom = true
  node.rig!.referenceDistance = 5
  node.rig!.native!.bones.Camera!.properties.lens_offset = 7
  const pose = sceneCameraRigPose(node)
  const fields = inputs(renderToStaticMarkup(<QuickCameraLens node={node} />))
  expect(fields).toHaveLength(2)
  expect(fields[0]).toMatchObject({
    'aria-label': '焦距 · 毫米',
    disabled: '',
    value: String(Number(pose.rigFocalLength!.toFixed(3))),
  })
  expect(fields[1]).toMatchObject({ 'aria-label': '焦距偏移 · 毫米', value: '7' })
  expect(fields[1]).not.toHaveProperty('disabled')
})

test('2D quick controls direct framing edits to native corners instead of a generic focal slider', () => {
  const node = camera('2d')
  const pose = sceneCameraRigPose(node)
  for (const element of [
    <QuickCameraLens key="photo" node={node} />,
    <MotionLensControls key="timeline" node={node} pose={pose} />,
  ]) {
    const markup = renderToStaticMarkup(element)
    expect(inputs(markup).map((input) => input['aria-label'])).toEqual(['旋转 ↔ 平移构图'])
    expect(markup).toContain('调整构图边界')
    expect(markup).not.toContain('type="range"')
  }
})
