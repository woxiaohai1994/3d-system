import { afterEach, expect, test } from 'bun:test'
import { type SceneAnimation, SceneCameraNode, SiteNode, useScene } from '@pascal-app/core'
import { endSceneAnimation, openMotion } from '../scene-camera/motion-state'
import { animationData, commitSceneAnimation, hasUnsupportedAnimation } from './document'
import { useSceneAnimation } from './store'

const raf = globalThis.requestAnimationFrame
const cancel = globalThis.cancelAnimationFrame
afterEach(() => {
  endSceneAnimation(true)
  globalThis.requestAnimationFrame = raf
  globalThis.cancelAnimationFrame = cancel
})

test('unvalidated cached animation cannot break opening; edits cannot replace unsupported original data', () => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const raw = { version: 1, cameras: [{ nodeId: 'old-camera', points: [] }], objects: [] }
  const site = { ...SiteNode.parse({}), animation: raw as unknown as SceneAnimation }
  useScene.setState({ nodes: { [site.id]: site }, rootNodeIds: [site.id], readOnly: false })
  expect(hasUnsupportedAnimation()).toBe(true)
  expect(() => openMotion()).not.toThrow()
  expect(useSceneAnimation.getState().timelineVisible).toBe(true)
  expect(animationData().tracks).toEqual([])
  expect((useScene.getState().nodes[site.id] as SiteNode).animation as unknown).toBe(raw)
  expect(commitSceneAnimation({ ...animationData(), duration: 8 })).toBe(false)
  const saved = useScene.getState().nodes[site.id] as SiteNode
  expect(saved.animation as unknown).toBe(raw)
  expect(hasUnsupportedAnimation()).toBe(true)
  useScene.temporal.getState().undo()
  expect(() => animationData()).not.toThrow()
})

test('invalid imported tracks cannot prevent a static camera or timeline from being read', () => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const camera = SceneCameraNode.parse({})
  const site = {
    ...SiteNode.parse({ children: [camera.id] }),
    animation: { tracks: null } as unknown as SceneAnimation,
  }
  useScene.setState({
    nodes: { [site.id]: site, [camera.id]: camera },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  expect(() => openMotion(camera)).not.toThrow()
  expect(useSceneAnimation.getState().cameraId).toBe(camera.id)
  expect(animationData().tracks).toEqual([])
})

test('film rendering and export always read the committed document instead of a timeline draft', () => {
  const site = SiteNode.parse({ animation: { version: 2, duration: 6 } })
  useScene.setState({ nodes: { [site.id]: site }, rootNodeIds: [site.id], readOnly: false })
  useSceneAnimation.setState({
    sceneDraft: { ...site.animation!, duration: 12 },
    renderingFilm: false,
    exporting: false,
  })
  expect(animationData().duration).toBe(12)
  useSceneAnimation.setState({ renderingFilm: true })
  expect(animationData().duration).toBe(6)
  useSceneAnimation.setState({ renderingFilm: false, exporting: true })
  expect(animationData().duration).toBe(6)
})
