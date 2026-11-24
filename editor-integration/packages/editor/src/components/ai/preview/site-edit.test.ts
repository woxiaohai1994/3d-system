import { afterEach, beforeEach, expect, test } from 'bun:test'
import { BuildingNode, LevelNode, SiteNode, useScene, WallNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  applyGhostPreview,
  bindAIProject,
  confirmGhostPreview,
  getAIAdapter,
  undoConfirmedOperation,
  useAIPreview,
} from '../ai-preview-manager'
import { validateUpdateSite } from '../mutation/validate-structure'
import type { ValidatedOperation } from '../types'

const savedScene = useScene.getState()
const savedViewer = useViewer.getState()
let site: SiteNode
let level: LevelNode
let cleanup: () => void
let oldRaf: typeof requestAnimationFrame
let oldCancelRaf: typeof cancelAnimationFrame

beforeEach(() => {
  oldRaf = globalThis.requestAnimationFrame
  oldCancelRaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  site = SiteNode.parse({ name: '场地' })
  const building = BuildingNode.parse({ parentId: site.id })
  level = LevelNode.parse({ parentId: building.id })
  site.children = [building.id]
  building.children = [level.id]
  useScene
    .getState()
    .setScene({ [site.id]: site, [building.id]: building, [level.id]: level }, [site.id])
  useScene.setState({ readOnly: false })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  useViewer.getState().setSelection({ levelId: level.id, selectedIds: [] })
  cleanup = bindAIProject('site-edit-regression')
})

afterEach(() => {
  cleanup()
  useScene.setState(savedScene)
  useViewer.setState(savedViewer)
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  globalThis.requestAnimationFrame = oldRaf
  globalThis.cancelAnimationFrame = oldCancelRaf
})

const polygon: [number, number][] = [
  [-6, -4.5],
  [12, -4.5],
  [12, 4.5],
  [-6, 4.5],
]

test.each([
  false,
  true,
])('site edit and slab batch applies atomically in an existing scene: %s', (existing) => {
  if (existing) {
    useScene.getState().createNode(WallNode.parse({ start: [-6, -4.5], end: [6, -4.5] }), level.id)
    useScene.temporal.getState().clear()
  }
  const before = getAIAdapter().read().scene
  const operation = validateUpdateSite({ tool: 'update_site', polygon })
  expect(operation.status).toBe('valid')
  const operations: ValidatedOperation[] = [
    operation,
    {
      type: 'add_slab',
      status: 'valid',
      polygon,
      elevation: 0,
      holes: [],
      levelId: level.id,
    },
  ]
  applyGhostPreview(operations)
  expect(getAIAdapter().read().scene).toEqual(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  const revision = getAIAdapter().read().sceneRevision
  const preview = useAIPreview.getState().preview
  useViewer.getState().setCameraDragging(true)
  useViewer.getState().setCameraMode('orthographic')
  useViewer.getState().setCameraDragging(false)
  expect(useAIPreview.getState().preview).toBe(preview)
  expect(getAIAdapter().read().sceneRevision).toBe(revision)
  confirmGhostPreview(operations)
  expect(useScene.getState().nodes[site.id]).toMatchObject({
    polygon: { type: 'polygon', points: polygon },
  })
  expect(Object.values(useScene.getState().nodes).filter((n) => n.type === 'slab')).toHaveLength(1)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  const after = getAIAdapter().read().scene
  useScene.temporal.getState().undo()
  expect(getAIAdapter().read().scene).toEqual(before)
  useScene.temporal.getState().redo()
  expect(getAIAdapter().read().scene).toEqual(after)
  const nextPolygon = polygon.map(([x, z]): [number, number] => [x * 2, z * 2])
  const followup = [validateUpdateSite({ tool: 'update_site', polygon: nextPolygon })]
  applyGhostPreview(followup)
  confirmGhostPreview(followup)
  expect(useScene.getState().nodes[site.id]).toMatchObject({
    polygon: { type: 'polygon', points: nextPolygon },
  })
  expect(Object.values(useScene.getState().nodes).filter((n) => n.type === 'slab')).toHaveLength(1)
})

test('unrelated AI edits preserve unsupported saved animation through preview, commit and undo', () => {
  const animation = { version: 1, cameras: [], objects: [] }
  const nodes = useScene.getState().nodes
  useScene.setState({
    nodes: {
      ...nodes,
      [site.id]: { ...nodes[site.id], animation } as unknown as SiteNode,
    },
  })
  const before = getAIAdapter().read().scene
  const operations = [validateUpdateSite({ tool: 'update_site', polygon })]
  applyGhostPreview(operations)
  expect(getAIAdapter().read().scene).toEqual(before)
  const log = confirmGhostPreview(operations)
  expect(useScene.getState().nodes[site.id]).toMatchObject({
    polygon: { type: 'polygon', points: polygon },
    animation,
  })
  undoConfirmedOperation(log)
  expect(getAIAdapter().read().scene).toEqual(before)
  expect(() =>
    getAIAdapter().prepare({
      ...getAIAdapter().read(),
      requestId: 'bad-animation',
      operations: [
        { op: 'update', id: site.id, data: { animation: { ...animation, duration: 8 } } },
      ],
    }),
  ).toThrow('INVALID_NODE')
  expect(() =>
    getAIAdapter().prepare({
      ...getAIAdapter().read(),
      requestId: 'bad-polygon',
      operations: [{ op: 'update', id: site.id, data: { polygon } }],
    }),
  ).toThrow('INVALID_NODE')
  expect(() =>
    getAIAdapter().prepare({
      ...getAIAdapter().read(),
      requestId: 'new-invalid-animation',
      operations: [{ op: 'create', node: { type: 'site', animation } }],
    }),
  ).toThrow('INVALID_NODE')
  expect(getAIAdapter().read().scene).toEqual(before)
})
