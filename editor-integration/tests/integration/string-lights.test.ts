import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  AnyNode,
  BuildingNode,
  LevelNode,
  ItemNode,
  SiteNode,
  nodeRegistry,
  registerNode,
  useScene,
  useLiveNodeOverrides,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { stringLightDefinition } from '../../../string-lights-plugin/src/definition'
import { stringLightsAI } from '../../../string-lights-plugin/src/ai'
import { LIGHT_KIND, PLUGIN_ID, isStringLight } from '../../../string-lights-plugin/src/schema'
import {
  describeAIPlugins,
  preparePluginAction,
  registerAIPlugin,
} from '../../packages/editor/src/components/ai/plugin-tools'
import { validateToolArguments } from '../../packages/editor/src/components/ai/tool-validation'
import { buildMutationCommands } from '../../packages/editor/src/components/ai/preview/confirm-operations'
import { SceneEditAdapter } from '../../packages/editor/src/integrations/pascal/scene-edit-adapter'
import { appendLightPoint, endLightPath } from '../../../string-lights-plugin/src/drafting'
import { useLightDraft } from '../../../string-lights-plugin/src/store'
import { LightSettings } from '../../../string-lights-plugin/src/schema'

const saved = useScene.getState(),
  selection = useViewer.getState().selection
let restore: () => void, unregister: () => void, adapter: SceneEditAdapter, level: LevelNode
let oldRaf: typeof requestAnimationFrame, oldCancel: typeof cancelAnimationFrame
beforeEach(() => {
  oldRaf = globalThis.requestAnimationFrame
  oldCancel = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  restore = nodeRegistry._snapshot()
  if (!nodeRegistry.has(LIGHT_KIND)) registerNode(stringLightDefinition as never)
  unregister = registerAIPlugin(stringLightsAI)
  const site = SiteNode.parse({}),
    building = BuildingNode.parse({ parentId: site.id })
  level = LevelNode.parse({ parentId: building.id, level: 0 })
  site.children = [building.id]
  building.children = [level.id]
  useScene
    .getState()
    .setScene({ [site.id]: site, [building.id]: building, [level.id]: level }, [site.id])
  useScene.setState({ installedPlugins: [PLUGIN_ID], readOnly: false })
  useViewer.getState().setSelection({ levelId: level.id, selectedIds: [] })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  adapter = new SceneEditAdapter('string-lights-test')
  endLightPath()
  useLightDraft.setState({ settings: LightSettings.parse({}) })
})
afterEach(() => {
  endLightPath()
  adapter.dispose()
  unregister()
  restore()
  useScene.setState(saved)
  useViewer.getState().setSelection(selection)
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  globalThis.requestAnimationFrame = oldRaf
  globalThis.cancelAnimationFrame = oldCancel
})

test('drawing commits each span to one node and stopping retains only clicked points', () => {
  appendLightPoint([0, 2, 0], [], level.id)
  expect(Object.values(useScene.getState().nodes).filter(isStringLight)).toHaveLength(0)
  appendLightPoint([4, 2, 0], [], level.id)
  const id = useLightDraft.getState().nodeId! as AnyNode['id']
  expect(useScene.getState().nodes[id]).toMatchObject({
    points: [
      [0, 2, 0],
      [4, 2, 0],
    ],
  })
  appendLightPoint([4, 2, 4], [], level.id)
  expect(Object.values(useScene.getState().nodes).filter(isStringLight)).toHaveLength(1)
  const committed = useScene.getState().nodes[id]
  expect(committed).toMatchObject({
    points: [
      [0, 2, 0],
      [4, 2, 0],
      [4, 2, 4],
    ],
  })
  useLiveNodeOverrides.getState().set(id, {
    points: [
      [0, 2, 0],
      [99, 2, 99],
    ],
  })
  endLightPath()
  expect(useLiveNodeOverrides.getState().get(id)).toBeUndefined()
  expect(useScene.getState().nodes[id]).toEqual(committed)
  expect(useLightDraft.getState().points).toEqual([])
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[id]).toMatchObject({
    points: [
      [0, 2, 0],
      [4, 2, 0],
    ],
  })
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[id]).toBeUndefined()
  useScene.temporal.getState().redo()
  expect(useScene.getState().nodes[id]).toMatchObject({
    points: [
      [0, 2, 0],
      [4, 2, 0],
    ],
  })
  appendLightPoint([8, 2, 0], [], level.id)
  appendLightPoint([8, 2, 4], [], level.id)
  expect(useLightDraft.getState().nodeId).not.toBe(id)
  expect(Object.values(useScene.getState().nodes).filter(isStringLight)).toHaveLength(2)
})

test('stopping after a start point creates nothing; duplicate clicks create no history', () => {
  appendLightPoint([0, 2, 0], [], level.id)
  appendLightPoint([0, 2, 0], [], level.id)
  endLightPath()
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  expect(Object.values(useScene.getState().nodes).filter(isStringLight)).toHaveLength(0)
  appendLightPoint([0, 2, 0], [], level.id)
  appendLightPoint([2, 2, 0], [], level.id)
  const history = useScene.temporal.getState().pastStates.length
  appendLightPoint([2, 2, 0], [], level.id)
  expect(useScene.temporal.getState().pastStates).toHaveLength(history)
})

test('AI tool creates one editable scatter node through preview and one undo transaction', () => {
  const call = {
    tool: 'plugin_action' as const,
    pluginId: PLUGIN_ID,
    action: 'create',
    input: {
      name: '测试灌木灯',
      mode: 'scatter',
      count: 120,
      seed: 43,
      colors: ['#ff0000', '#ffffff'],
      colorRule: 'sequence',
    },
  }
  const { tool, ...args } = call
  expect(validateToolArguments(tool, args)).toBe(true)
  const op = preparePluginAction(call)
  expect(op.status).toBe('valid')
  const result = buildMutationCommands([op], useScene.getState().nodes, level.id)
  expect(result.commands).toHaveLength(1)
  const preview = adapter.prepare({
    ...adapter.read(),
    requestId: 'create-scatter',
    operations: result.commands,
  })
  expect(
    Object.values(useScene.getState().nodes).filter((n) => (n.type as string) === LIGHT_KIND),
  ).toHaveLength(0)
  const receipt = adapter.commit(preview),
    id = receipt.createdIds[0]!
  const node: unknown = useScene.getState().nodes[id]
  expect(isStringLight(node) && node.count).toBe(120)
  expect(isStringLight(node) && node.cableVisible).toBe(false)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[id]).toBeUndefined()
  useScene.temporal.getState().redo()
  expect(useScene.getState().nodes[id]).toEqual(node as AnyNode)
  const update = preparePluginAction({
    tool: 'plugin_action',
    pluginId: PLUGIN_ID,
    action: 'update',
    input: { nodeId: id, count: 70 },
  })
  const changed = buildMutationCommands([update], useScene.getState().nodes, level.id)
  adapter.commit(
    adapter.prepare({
      ...adapter.read(),
      requestId: 'update-scatter',
      operations: changed.commands,
    }),
  )
  expect(useScene.getState().nodes[id]).toMatchObject({
    count: 70,
    seed: 43,
    mode: 'scatter',
    colors: ['#ff0000', '#ffffff'],
  })
  expect(describeAIPlugins()).toContain(id)
})

test('disabled plugin, readonly scenes and unrecognized assets fail before mutation', () => {
  const call = {
    tool: 'plugin_action' as const,
    pluginId: PLUGIN_ID,
    action: 'create',
    input: { assetId: 'not-published' },
  }
  expect(preparePluginAction(call).status).toBe('invalid')
  useScene.setState({ installedPlugins: [] })
  expect(preparePluginAction({ ...call, input: {} }).status).toBe('invalid')
  expect(describeAIPlugins()).toBe('')
  useScene.setState({ installedPlugins: [PLUGIN_ID], readOnly: true })
  expect(preparePluginAction({ ...call, input: {} }).errorReason).toContain('read-only')
})

test('AI creates independent bulb heads and seeded mounting variation through the shared transaction', () => {
  const operation = preparePluginAction({
    tool: 'plugin_action',
    pluginId: PLUGIN_ID,
    action: 'create',
    input: {
      bulbHead: 'c6',
      arrangement: 'alternating',
      orientation: 'branch',
      sidePattern: 'random',
      leftProbability: 0.3,
      mountJitter: 0.4,
      axialJitter: 0.8,
      seed: 73,
    },
  })
  expect(operation.status).toBe('valid')
  const result = buildMutationCommands([operation], useScene.getState().nodes, level.id)
  const receipt = adapter.commit(
    adapter.prepare({ ...adapter.read(), requestId: 'c6-random', operations: result.commands }),
  )
  const saved = JSON.parse(JSON.stringify(useScene.getState().nodes[receipt.createdIds[0]!]))
  expect(saved).toMatchObject({
    bulbHead: 'c6',
    arrangement: 'alternating',
    sidePattern: 'random',
    leftProbability: 0.3,
    mountJitter: 0.4,
    axialJitter: 0.8,
    seed: 73,
  })
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[receipt.createdIds[0]!]).toBeUndefined()
  useScene.temporal.getState().redo()
  expect(useScene.getState().nodes[receipt.createdIds[0]!]).toEqual(saved)
})

test('AI respects fixed product facts and requires smart mode for random colors', () => {
  const call = { tool: 'plugin_action' as const, pluginId: PLUGIN_ID, action: 'create' }
  expect(preparePluginAction({ ...call, input: { sizeJitter: 0.3 } }).status).toBe('invalid')
  expect(preparePluginAction({ ...call, input: { irregularity: 0.3 } }).status).toBe('invalid')
  expect(preparePluginAction({ ...call, input: { colorRule: 'random' } }).status).toBe('invalid')
  expect(preparePluginAction({ ...call, input: { smart: true, colorRule: 'random' } }).status).toBe(
    'valid',
  )
  const operation = preparePluginAction({
    ...call,
    input: { naturalness: 0.8, bulbSize: 0.022, spacing: 0.4, colorRule: 'sequence' },
  })
  const result = buildMutationCommands([operation], useScene.getState().nodes, level.id)
  const receipt = adapter.commit(
    adapter.prepare({
      ...adapter.read(),
      requestId: 'naturalness-product-facts',
      operations: result.commands,
    }),
  )
  expect(useScene.getState().nodes[receipt.createdIds[0]!]).toMatchObject({
    naturalness: 0.8,
    bulbSize: 0.022,
    spacing: 0.4,
    colorRule: 'sequence',
    smart: false,
    sizeJitter: 0,
    irregularity: 0,
    mountJitter: (0.8 * Math.PI) / 2,
  })
})

test('AI reuses a published model asset and rejects it after it leaves the library', async () => {
  const { setLightAssets, useLightAssets } = await import(
    '../../../string-lights-plugin/src/assets'
  )
  const previous = useLightAssets.getState().assets
  try {
    setLightAssets([
      {
        id: 'imported-c9-test',
        name: 'C9 带夹子',
        src: '/models/c9-test.glb',
        category: 'lighting',
        thumbnail: '',
        dimensions: [0.05, 0.12, 0.05],
        availableMaterials: ['bulb', 'clip'],
        stringLight: true,
      },
    ])
    const call = {
      tool: 'plugin_action' as const,
      pluginId: PLUGIN_ID,
      action: 'create',
      input: { mode: 'wrap', style: 'c9', assetId: 'imported-c9-test', seed: 17 },
    }
    const operation = preparePluginAction(call)
    expect(describeAIPlugins()).toContain('imported-c9-test')
    expect(operation.status).toBe('valid')
    const commands = buildMutationCommands([operation], useScene.getState().nodes, level.id)
    const result = adapter.commit(
      adapter.prepare({
        ...adapter.read(),
        requestId: 'imported-bulb',
        operations: commands.commands,
      }),
    )
    expect(useScene.getState().nodes[result.createdIds[0]!]).toMatchObject({
      mode: 'wrap',
      seed: 17,
      asset: {
        id: 'imported-c9-test',
        src: '/models/c9-test.glb',
        availableMaterials: ['bulb', 'clip'],
      },
    })
    setLightAssets([])
    expect(describeAIPlugins()).not.toContain(
      'Relevant published bulb assets=[{"assetId":"imported-c9-test"',
    )
    expect(preparePluginAction(call).status).toBe('invalid')
    expect(useScene.getState().nodes[result.createdIds[0]!]).toBeDefined()
  } finally {
    setLightAssets(previous)
  }
})

let lightAIRequestSequence = 0
function applyLightAI(action: string, input: Record<string, unknown>) {
  const before = useScene.getState().nodes
  const history = useScene.temporal.getState().pastStates.length
  const operation = preparePluginAction({
    tool: 'plugin_action',
    pluginId: PLUGIN_ID,
    action,
    input,
  })
  expect(operation.status).toBe('valid')
  const mutations = buildMutationCommands([operation], before, level.id)
  const preview = adapter.prepare({
    ...adapter.read(),
    requestId: `light-${action}-${++lightAIRequestSequence}`,
    operations: mutations.commands,
  })
  expect(useScene.getState().nodes).toBe(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(history)
  return adapter.commit(preview)
}

function addAttachmentHost() {
  const host = ItemNode.parse({
    parentId: level.id,
    asset: { id: 'post-ai', name: 'Post', src: '/post.glb', thumbnail: '', category: 'furniture' },
  })
  useScene.getState().createNode(host)
  return host
}

test('AI-created supports capture the same deformation binding as manual creation', async () => {
  const { commitLight } = await import('../../../string-lights-plugin/src/commands')
  const { planLightContext } = await import('../../../string-lights-plugin/src/plan-light')
  const host = addAttachmentHost()
  const points = [
    [1, 2, 0],
    [2, 2, 0],
  ]
  const input = {
    points,
    anchors: points.map((point, index) => ({
      index,
      nodeId: host.id,
      localPosition: point,
      referencePosition: point,
    })),
    surfaceTargets: [host.id],
    spacing: 0.35,
    bulbSize: 0.045,
    seed: 47,
  }
  const manual = commitLight(input, level.id)
  useScene.temporal.getState().clear()
  const result = applyLightAI('create', input)
  const light = useScene.getState().nodes[result.createdIds[0]!]
  expect(isStringLight(light)).toBe(true)
  if (!isStringLight(light)) return
  expect(light.anchors).toEqual(manual.anchors)
  expect(light.anchors[0]?.attachment).toBeDefined()
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[light.id]).toBeUndefined()
  useScene.temporal.getState().redo()
  useScene.setState({ nodes: JSON.parse(JSON.stringify(useScene.getState().nodes)) })
  useScene.getState().updateNode(host.id, { scale: [2, 1, 1] })
  const nodes = useScene.getState().nodes
  const rendered = planLightContext(light, (id) => nodes[id as AnyNode['id']], nodes).points!(light)
  expect(rendered).toEqual([
    [2, 2, 0],
    [4, 2, 0],
  ])
  expect([light.spacing, light.bulbSize, light.seed]).toEqual([0.35, 0.045, 47])
})

test('AI blend creation and detachment use current attached boundary positions without a 3D renderer', async () => {
  const { commitLight } = await import('../../../string-lights-plugin/src/commands')
  const host = addAttachmentHost()
  const points = [
    [0, 2, 0],
    [4, 2, 0],
  ]
  const a = commitLight(
    {
      points,
      anchors: points.map((point, index) => ({
        index,
        nodeId: host.id,
        localPosition: point,
        referencePosition: point,
      })),
    },
    level.id,
  )
  const b = commitLight({ points, position: [0, 0, 4] }, level.id)
  useScene.getState().updateNode(host.id, { position: [2, 0, 0] })
  const result = applyLightAI('blend', { fromId: a.id, toId: b.id, count: 1 })
  const light = useScene.getState().nodes[result.createdIds[0]!]
  expect(isStringLight(light)).toBe(true)
  if (!isStringLight(light)) return
  expect(light.points).toEqual([
    [1, 2, 2],
    [5, 2, 2],
  ])
  useScene.getState().updateNode(host.id, { position: [4, 0, 0] })
  useScene.temporal.getState().clear()
  applyLightAI('update', { nodeId: light.id, blend: null })
  const detached = useScene.getState().nodes[light.id]
  expect(detached).toMatchObject({
    blend: null,
    points: [
      [2, 2, 2],
      [6, 2, 2],
    ],
  })
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[light.id]).toEqual(light)
  useScene.temporal.getState().redo()
  expect(useScene.getState().nodes[light.id]).toEqual(detached)
})

test('AI model selection preserves same-model calibration and matches the picker when replacing it', async () => {
  const { commitLight } = await import('../../../string-lights-plugin/src/commands')
  const { asBulbAsset, setLightAssets, useLightAssets } = await import(
    '../../../string-lights-plugin/src/assets'
  )
  const { appearancePatch } = await import('../../../string-lights-plugin/src/model-choice')
  const previousAssets = useLightAssets.getState().assets
  const asset = {
    id: 'calibrated-c9',
    name: 'C9 夹子灯',
    src: '/c9.glb',
    thumbnail: '',
    category: 'lighting',
    dimensions: [0.05, 0.12, 0.05] as [number, number, number],
    stringLight: true,
  }
  const replacement = { ...asset, id: 'direct-s14', name: 'S14', src: '/s14.glb' }
  setLightAssets([asset, replacement])
  try {
    const original = commitLight(
      {
        asset: {
          ...asBulbAsset(asset),
          connection: [0, 0.04, 0],
          rotation: [0.2, 0.3, 0],
          emissionMaterials: ['bulb'],
          scale: [1, 0.8, 1],
        },
        modelScale: 2,
        spacing: 0.35,
        bulbSize: 0.045,
        seed: 83,
      },
      level.id,
    )
    useScene.temporal.getState().clear()
    applyLightAI('update', {
      nodeId: original.id,
      assetId: asset.id,
      colors: ['#ff6600', '#8800ff'],
      colorRule: 'sequence',
    })
    const recolored = useScene.getState().nodes[original.id]
    expect(recolored).toMatchObject({
      asset: original.asset,
      modelScale: 2,
      colors: ['#ff6600', '#8800ff'],
      seed: 83,
      spacing: 0.35,
      bulbSize: 0.045,
    })
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[original.id]).toEqual(original)
    useScene.temporal.getState().redo()
    if (!isStringLight(recolored)) throw new Error('Expected editable light')
    applyLightAI('update', { nodeId: original.id, assetId: replacement.id })
    const changed = useScene.getState().nodes[original.id]
    expect(changed).toMatchObject({
      ...recolored,
      ...appearancePatch(recolored, { kind: 'asset', asset: replacement }),
    })
    applyLightAI('update', { nodeId: original.id, assetId: asset.id, modelScale: 0.5 })
    expect(useScene.getState().nodes[original.id]).toMatchObject({
      modelScale: 0.5,
      asset: { id: asset.id },
    })
  } finally {
    setLightAssets(previousAssets)
  }
})
