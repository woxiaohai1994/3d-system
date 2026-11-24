import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  BuildingNode,
  clearSceneHistory,
  getScaledDimensions,
  ItemNode,
  initSpaceDetectionSync,
  LevelNode,
  nodeRegistry,
  SiteNode,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  answerPendingQuestion,
  confirmOperationsFromUI,
  runAgentLoop,
  stopAI,
} from '../../packages/editor/src/components/ai/ai-agent-loop'
import {
  resetAIExecutionMode,
  useAIExecutionMode,
} from '../../packages/editor/src/components/ai/ai-execution-mode'
import { useAIChat } from '../../packages/editor/src/components/ai/ai-chat-store'
import { validateAllToolCalls } from '../../packages/editor/src/components/ai/ai-mutation-executor'
import {
  applyGhostPreview,
  bindAIProject,
  clearGhostPreview,
  confirmGhostPreview,
  getAIAdapter,
  undoConfirmedOperation,
  useAIPreview,
} from '../../packages/editor/src/components/ai/ai-preview-manager'
import { parseToolCall } from '../../packages/editor/src/components/ai/ai-stream-client'
import type { ChatTransport } from '../../packages/editor/src/components/ai/contracts/runtime'
import {
  createDefaultAIRuntime,
  setAIRuntime,
} from '../../packages/editor/src/components/ai/runtime'
import {
  fullToolNames,
  validateToolArguments,
} from '../../packages/editor/src/components/ai/tool-validation'

let saved: ReturnType<typeof useScene.getState>, level: LevelNode
let cleanup: () => void, restore: () => void, sync: (() => void) | undefined
let raf: typeof requestAnimationFrame, cancelRaf: typeof cancelAnimationFrame
const runtime = createDefaultAIRuntime()
beforeEach(() => {
  resetAIExecutionMode()
  saved = useScene.getState()
  restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
  nodeRegistry._register({
    kind: 'item',
    category: 'furnish',
    defaults: () => ({}),
    schemaVersion: 1,
    schema: ItemNode,
    capabilities: {
      floorPlaced: {
        footprint: (node) => ({
          dimensions: getScaledDimensions(node as ItemNode),
          rotation: (node as ItemNode).rotation,
        }),
        applies: (node) => !(node as ItemNode).asset.attachTo,
      },
    },
  })
  raf = globalThis.requestAnimationFrame
  cancelRaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const site = SiteNode.parse({}),
    building = BuildingNode.parse({ parentId: site.id })
  level = LevelNode.parse({ parentId: building.id, height: 3 })
  site.children = [building.id]
  building.children = [level.id]
  useScene.setState({
    nodes: Object.fromEntries([site, building, level].map((node) => [node.id, node])),
    rootNodeIds: [site.id],
    collections: {},
    materials: {},
    installedPlugins: [],
    readOnly: false,
    dirtyNodes: new Set(),
  })
  useViewer.getState().setSelection({ levelId: level.id })
  clearSceneHistory()
  cleanup = bindAIProject(`full-ai-test-${crypto.randomUUID()}`)
  useAIChat.getState().clearChat()
  useAIChat.getState().setProjectContext('full-ai-test')
})
afterEach(() => {
  resetAIExecutionMode()
  stopAI()
  sync?.()
  sync = undefined
  cleanup()
  setAIRuntime(runtime)
  useScene.setState(saved)
  clearSceneHistory()
  restore()
  globalThis.requestAnimationFrame = raf
  globalThis.cancelAnimationFrame = cancelRaf
})
const addSofa = () =>
  validateAllToolCalls([
    { tool: 'add_item', catalogSlug: 'sofa', position: [0, 0, 0], rotationY: 0 },
  ])
async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Timed out')
}
test('source tool catalog is complete and every declared tool has a parser', () => {
  expect(fullToolNames.filter((name) => name !== 'plugin_action')).toHaveLength(56)
  expect(fullToolNames).toContain('plugin_action')
  for (const name of fullToolNames) expect(parseToolCall(name, {})).not.toBeNull()
  expect(validateToolArguments('add_wall', { start: [0, 0], end: [4, 0] })).toBe(true)
  expect(validateToolArguments('add_wall', { start: [0], end: [4, 0] })).toBe(false)
  expect(
    validateToolArguments('batch_operations', {
      operations: [{ type: 'execute_code', code: 'bad' }],
    }),
  ).toBe(false)
})
test('donor furniture preview leaves native data and history untouched; confirm and inverse undo are atomic', () => {
  const before = getAIAdapter().read().scene
  const operations = addSofa()
  expect(operations[0]?.status).not.toBe('invalid')
  applyGhostPreview(operations)
  expect(getAIAdapter().read().scene).toEqual(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  const log = confirmGhostPreview(operations)
  expect(log.createdNodeIds).toHaveLength(1)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  const after = getAIAdapter().read().scene
  useScene.temporal.getState().undo()
  expect(getAIAdapter().read().scene).toEqual(before)
  useScene.temporal.getState().redo()
  expect(getAIAdapter().read().scene).toEqual(after)
  undoConfirmedOperation(log)
  expect(getAIAdapter().read().scene).toEqual(before)
})
test('cancel and external edits invalidate previews without leaking transient scene metadata', () => {
  const operations = addSofa()
  applyGhostPreview(operations)
  clearGhostPreview()
  expect(() => confirmGhostPreview(operations)).toThrow('STALE_PREVIEW')
  applyGhostPreview(operations)
  useScene.getState().updateNode(level.id, { name: 'Manual edit' })
  expect(useAIPreview.getState().preview).toBeNull()
  expect(() => confirmGhostPreview(operations)).toThrow('STALE_PREVIEW')
  expect(JSON.stringify(useScene.getState().nodes)).not.toContain('isGhostPreview')
})
test('multi-round agent waits for confirmation, feeds matching tool results, and completes', async () => {
  let rounds = 0
  const transport: ChatTransport = {
    summarize: async () => null,
    streamChat: async (request, callbacks) => {
      rounds++
      if (rounds === 1)
        callbacks.onComplete(
          '',
          [{ tool: 'add_item', catalogSlug: 'sofa', position: [0, 0, 0], rotationY: 0 }],
          ['call_sofa'],
        )
      else {
        expect(
          request.messages.some((message) =>
            message.tool_calls?.some((call) => call.id === 'call_sofa'),
          ),
        ).toBe(true)
        expect(
          request.messages.some(
            (message) => message.role === 'tool' && message.tool_call_id === 'call_sofa',
          ),
        ).toBe(true)
        callbacks.onTextChunk('已完成')
        callbacks.onComplete('已完成', [], [])
      }
    },
  }
  setAIRuntime({ ...runtime, transport })
  useAIChat.getState().addUserMessage('添加沙发')
  const pending = runAgentLoop({ userMessage: '添加沙发', catalogSummary: '' })
  await until(() => !!useAIPreview.getState().preview)
  expect(
    Object.values(useScene.getState().nodes).filter((node) => node.type === 'item'),
  ).toHaveLength(0)
  const message = useAIChat.getState().messages.at(-1)!
  await confirmOperationsFromUI(message.id, message.operations!)
  await pending
  expect(rounds).toBe(2)
  expect(useAIChat.getState().operationLog).toHaveLength(1)
  expect(useAIChat.getState().messages.at(-1)?.content).toBe('已完成')
})
test('ask_user still pauses in auto mode, answers resume; stopping never sends another request', async () => {
  useAIExecutionMode.setState({ autoApply: true })
  let rounds = 0
  setAIRuntime({
    ...runtime,
    transport: {
      summarize: async () => null,
      streamChat: async (_request, callbacks) => {
        rounds++
        if (rounds === 1)
          callbacks.onComplete(
            '',
            [{ tool: 'ask_user', question: '哪个房间？', suggestions: ['客厅'] }],
            ['question'],
          )
        else callbacks.onComplete('收到', [], [])
      },
    },
  })
  const first = runAgentLoop({ userMessage: '布置', catalogSummary: '' })
  await until(() => !!useAIChat.getState().pendingQuestion)
  answerPendingQuestion('客厅')
  await first
  expect(rounds).toBe(2)
  rounds = 0
  const second = runAgentLoop({ userMessage: '布置', catalogSummary: '' })
  await until(() => !!useAIChat.getState().pendingQuestion)
  stopAI()
  await second
  expect(rounds).toBe(1)
  expect(useAIChat.getState().isAIProcessing).toBe(false)
})
test('stopping during preview cannot commit or continue', async () => {
  setAIRuntime({
    ...runtime,
    transport: {
      summarize: async () => null,
      streamChat: async (_request, callbacks) =>
        callbacks.onComplete(
          '',
          [{ tool: 'add_item', catalogSlug: 'sofa', position: [0, 0, 0], rotationY: 0 }],
          ['call'],
        ),
    },
  })
  const pending = runAgentLoop({ userMessage: '添加', catalogSummary: '' })
  await until(() => !!useAIPreview.getState().preview)
  stopAI()
  await pending
  expect(useAIPreview.getState().preview).toBeNull()
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})
test('a closed room preview includes every native derived surface and commits exactly that candidate', () => {
  let spaces = {}
  sync = initSpaceDetectionSync(useScene, {
    getState: () => ({
      spaces,
      setSpaces: (value: object) => {
        spaces = value
      },
    }),
  })
  const points: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ]
  const operations = validateAllToolCalls(
    points.map((start, index) => ({ tool: 'add_wall', start, end: points[(index + 1) % 4]! })),
  )
  const before = getAIAdapter().read().scene
  applyGhostPreview(operations)
  const expected = { ...before.nodes }
  for (const { id, after } of useAIPreview.getState().preview!.changes) {
    if (after) expected[id] = after
    else delete expected[id]
  }
  const log = confirmGhostPreview(operations)
  expect(useScene.getState().nodes).toEqual(expected)
  undoConfirmedOperation(log)
  expect(getAIAdapter().read().scene).toEqual(before)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(expected)
  expect(
    Object.values(useScene.getState().nodes).filter((node) => node.type === 'slab'),
  ).toHaveLength(1)
  expect(log.createdNodeIds.length).toBeGreaterThan(4)
})

test('models stay cached until manual refresh and project reopen rebuilds the cache', async () => {
  const { resolveCatalogSlug, generateCatalogSummary, refreshCatalogCache } = await import(
    '../../packages/editor/src/components/ai/ai-catalog-resolver'
  )
  expect(resolveCatalogSlug('custom-late-model-xyz').asset).toBeNull()
  const asset = {
    id: 'custom-late-model-xyz',
    name: '定制展示台',
    category: 'furniture',
    src: 'https://example.com/display.glb',
    thumbnail: '',
    dimensions: [1, 1, 1] as [number, number, number],
  }
  const imported = ItemNode.parse({ asset, position: [10, 0, 10] })
  useScene.getState().createNode(imported, level.id)
  expect(resolveCatalogSlug(asset.id).asset).toBeNull()
  expect(generateCatalogSummary()).not.toContain('定制展示台')
  refreshCatalogCache()
  expect(resolveCatalogSlug(asset.id).asset?.src).toBe(asset.src)
  expect(resolveCatalogSlug(asset.name).asset?.id).toBe(asset.id)
  expect(generateCatalogSummary()).toContain('定制展示台')
  const second = ItemNode.parse({
    asset: { ...asset, id: 'reopen-unique-asset', name: '重开资源' },
    position: [15, 0, 15],
  })
  useScene.getState().createNode(second, level.id)
  expect(generateCatalogSummary()).not.toContain('重开资源')
  cleanup()
  const releaseOther = bindAIProject('another-project')
  releaseOther()
  cleanup = bindAIProject('full-ai-test')
  expect(generateCatalogSummary()).toContain('重开资源')
  const operations = validateAllToolCalls([
    { tool: 'add_item', catalogSlug: asset.id, position: [3, 0, 0], rotationY: 0 },
  ])
  expect(operations[0]?.status).not.toBe('invalid')
  applyGhostPreview(operations)
  confirmGhostPreview(operations)
  expect(
    Object.values(useScene.getState().nodes).filter(
      (node) => node.type === 'item' && node.asset.id === asset.id,
    ),
  ).toHaveLength(2)
})

test('wall material edits write current native slots and undo material resources together', () => {
  const wall = WallNode.parse({ start: [0, 0], end: [5, 0] })
  useScene.getState().createNode(wall, level.id)
  const before = getAIAdapter().read().scene
  const operations = validateAllToolCalls([
    { tool: 'update_wall_material', nodeId: wall.id, side: 'interior', materialColor: '#ff0000' },
  ])
  expect(operations[0]?.status).not.toBe('invalid')
  applyGhostPreview(operations)
  expect(getAIAdapter().read().scene).toEqual(before)
  const log = confirmGhostPreview(operations)
  const painted = useScene.getState().nodes[wall.id] as WallNode
  expect(painted.slots?.interior).toMatch(/^scene:/)
  expect(Object.values(useScene.getState().materials)[0]?.material.properties?.color).toBe(
    '#ff0000',
  )
  undoConfirmedOperation(log)
  expect(getAIAdapter().read().scene).toEqual(before)
})

test.each([
  { tool: 'add_wall', start: [0, 0], end: [6, 0], height: 3 },
  {
    tool: 'add_slab',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
  },
  {
    tool: 'add_ceiling',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    height: 3,
  },
  { tool: 'add_roof', position: [0, 3, 0], width: 6, depth: 6, roofType: 'gable' },
  { tool: 'add_stair', position: [0, 0, 0], stairType: 'straight', length: 3, width: 1 },
  {
    tool: 'add_zone',
    name: '测试房间',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
  },
  { tool: 'add_level', name: '二层', height: 3 },
  { tool: 'add_fence', start: [0, 0], end: [6, 0] },
  {
    tool: 'add_duct_segment',
    points: [
      [0, 2, 0],
      [4, 2, 0],
    ],
    crossSection: 'round',
    diameter: 6,
  },
  { tool: 'add_duct_fitting', position: [4, 2, 0], fittingType: 'elbow' },
  { tool: 'add_duct_terminal', position: [4, 2, 0], terminalType: 'diffuser' },
  {
    tool: 'add_pipe_segment',
    points: [
      [0, 1, 0],
      [4, 1, 0],
    ],
    diameter: 2,
  },
  { tool: 'add_pipe_fitting', position: [4, 1, 0], fittingType: 'elbow' },
  { tool: 'add_pipe_trap', position: [4, 1, 0], diameter: 2 },
  { tool: 'add_hvac_equipment', position: [4, 1, 0], equipmentType: 'indoor-unit' },
] as const)('source tool $tool produces a native atomic transaction', (call) => {
  const operations = validateAllToolCalls([
    call as unknown as import('../../packages/editor/src/components/ai/types').AIToolCall,
  ])
  expect(operations.every((op) => op.status !== 'invalid')).toBe(true)
  const before = getAIAdapter().read().scene
  applyGhostPreview(operations)
  expect(getAIAdapter().read().scene).toEqual(before)
  confirmGhostPreview(operations)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(getAIAdapter().read().scene).toEqual(before)
})

test('moving furniture between levels preserves local pose and inverse undo restores the graph', () => {
  const upper = LevelNode.parse({ level: 1, height: 3 })
  useScene.getState().createNode(upper, level.parentId as BuildingNode['id'])
  const sofa = addSofa()
  applyGhostPreview(sofa)
  confirmGhostPreview(sofa)
  const item = Object.values(useScene.getState().nodes).find((node) => node.type === 'item')!
  const before = getAIAdapter().read().scene
  const operations = validateAllToolCalls([
    { tool: 'move_item', nodeId: item.id, position: [2, 0, 3], rotationY: 0.5, levelId: upper.id },
  ])
  expect(operations[0]?.status).not.toBe('invalid')
  applyGhostPreview(operations)
  const log = confirmGhostPreview(operations)
  const moved = useScene.getState().nodes[item.id] as ItemNode
  expect(moved).toMatchObject({ parentId: upper.id, position: [2, 0, 3] })
  expect(moved.rotation[1]).toBeCloseTo(0.5)
  undoConfirmedOperation(log)
  expect(getAIAdapter().read().scene).toEqual(before)
})

test('splitting and merging a room includes hosted ceiling items and inverse undo', () => {
  let spaces = {}
  sync = initSpaceDetectionSync(useScene, {
    getState: () => ({
      spaces,
      setSpaces: (value: object) => {
        spaces = value
      },
    }),
  })
  const points: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ]
  const walls = validateAllToolCalls(
    points.map((start, index) => ({ tool: 'add_wall', start, end: points[(index + 1) % 4]! })),
  )
  applyGhostPreview(walls)
  confirmGhostPreview(walls)
  const ceiling = Object.values(useScene.getState().nodes).find((node) => node.type === 'ceiling')!
  const lamp = ItemNode.parse({
    asset: {
      id: 'fixture-lamp',
      name: '灯',
      category: 'lighting',
      src: '/fixture.glb',
      thumbnail: '',
      attachTo: 'ceiling',
    },
    position: [3, 0, 2],
  })
  useScene.getState().createNode(lamp, ceiling.id)
  const before = getAIAdapter().read().scene
  const divider = validateAllToolCalls([{ tool: 'add_wall', start: [2, 0], end: [2, 4] }])
  applyGhostPreview(divider)
  const expected = { ...before.nodes }
  for (const { id, after } of useAIPreview.getState().preview!.changes) {
    if (after) expected[id] = after
    else delete expected[id]
  }
  const log = confirmGhostPreview(divider)
  expect(useScene.getState().nodes).toEqual(expected)
  expect(Object.values(expected).filter((node) => node.type === 'ceiling')).toHaveLength(2)
  expect(expected[lamp.id]).toBeDefined()
  undoConfirmedOperation(log)
  expect(getAIAdapter().read().scene).toEqual(before)
})

test('auto mode commits through native history; turning it off pauses the next valid preview', async () => {
  expect(useAIExecutionMode.getState().autoApply).toBe(false)
  useAIExecutionMode.setState({ autoApply: true })
  let rounds = 0
  setAIRuntime({
    ...runtime,
    transport: {
      summarize: async () => null,
      streamChat: async (_request, callbacks) => {
        rounds++
        if (rounds === 2) useAIExecutionMode.setState({ autoApply: false })
        if (rounds <= 2)
          callbacks.onComplete(
            '',
            [{ tool: 'add_wall', start: [0, rounds * 4], end: [4, rounds * 4] }],
            [`wall-${rounds}`],
          )
        else callbacks.onComplete('完成', [], [])
      },
    },
  })
  const pending = runAgentLoop({ userMessage: '创建两面墙', catalogSummary: '' })
  await until(() => rounds === 2 && !!useAIPreview.getState().preview)
  expect(Object.values(useScene.getState().nodes).filter((n) => n.type === 'wall')).toHaveLength(1)
  expect(useAIChat.getState().operationLog).toHaveLength(1)
  const message = useAIChat.getState().messages.at(-1)!
  await confirmOperationsFromUI(message.id, message.operations!)
  await pending
  expect(Object.values(useScene.getState().nodes).filter((n) => n.type === 'wall')).toHaveLength(2)
  useScene.temporal.getState().undo()
  expect(Object.values(useScene.getState().nodes).filter((n) => n.type === 'wall')).toHaveLength(1)
})

test('auto mode never applies invalid operations', async () => {
  useAIExecutionMode.setState({ autoApply: true })
  let rounds = 0
  setAIRuntime({
    ...runtime,
    transport: {
      summarize: async () => null,
      streamChat: async (_request, callbacks) => {
        if (++rounds === 1)
          callbacks.onComplete(
            '',
            [{ tool: 'remove_node', nodeId: 'missing-node', reason: 'test' }],
            ['invalid'],
          )
        else callbacks.onComplete('无法应用', [], [])
      },
    },
  })
  const before = getAIAdapter().read().scene
  await runAgentLoop({ userMessage: '无效操作', catalogSummary: '' })
  expect(getAIAdapter().read().scene).toEqual(before)
  expect(useAIChat.getState().operationLog).toHaveLength(0)
})

test('preview preparation failure never publishes a confirmable operation', async () => {
  useScene.setState({ readOnly: true })
  setAIRuntime({
    ...runtime,
    transport: {
      summarize: async () => null,
      streamChat: async (_request, callbacks) => {
        callbacks.onComplete(
          '',
          [
            {
              tool: 'update_site',
              polygon: [
                [-6, -4.5],
                [12, -4.5],
                [12, 4.5],
                [-6, 4.5],
              ],
            },
          ],
          ['site-edit'],
        )
      },
    },
  })
  const before = getAIAdapter().read().scene
  await runAgentLoop({ userMessage: '修改场地边界', catalogSummary: '' })
  expect(useAIChat.getState().error).toBe('READ_ONLY')
  expect(
    useAIChat.getState().messages.some((message) => message.operationStatus === 'pending'),
  ).toBe(false)
  expect(useAIPreview.getState().preview).toBeNull()
  expect(getAIAdapter().read().scene).toEqual(before)
  expect(useAIChat.getState().operationLog).toHaveLength(0)
})

test('a later transport error does not mark an already applied operation as rejected', async () => {
  useAIExecutionMode.setState({ autoApply: true })
  let rounds = 0
  setAIRuntime({
    ...runtime,
    transport: {
      summarize: async () => null,
      streamChat: async (_request, callbacks) => {
        if (++rounds === 1)
          callbacks.onComplete('', [{ tool: 'add_wall', start: [0, 0], end: [4, 0] }], ['wall'])
        else callbacks.onError('PROVIDER_ERROR')
      },
    },
  })
  await runAgentLoop({ userMessage: '添加墙体', catalogSummary: '' })
  expect(useAIChat.getState().error).toBe('PROVIDER_ERROR')
  expect(
    useAIChat.getState().messages.find((message) => message.operations?.length)?.operationStatus,
  ).toBe('confirmed')
  expect(useAIChat.getState().operationLog).toHaveLength(1)
  expect(
    Object.values(useScene.getState().nodes).filter((node) => node.type === 'wall'),
  ).toHaveLength(1)
})
