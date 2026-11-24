import { expect, test } from 'bun:test'
import { ItemNode, useScene } from '@pascal-app/core'
import { type AnyNodeDefinition, nodeRegistry, registerNode } from '@pascal-app/core/registry'
import { _roots, extend } from '@react-three/fiber'
import { create } from '@react-three/test-renderer'
import { act, type ReactElement } from 'react'
import { Object3D } from 'three'
import { itemDefinition } from '../../../../nodes/dist/item/definition'
import { getLocale, setLocale } from '../../i18n'
import { MotionAdditionalProperties } from './motion-property-fields'

class PropertyHost extends Object3D {
  aria = { label: '' }
}
extend({
  Details: PropertyHost,
  Summary: PropertyHost,
  Label: PropertyHost,
  Input: PropertyHost,
  Span: PropertyHost,
  Select: PropertyHost,
  Option: PropertyHost,
  P: PropertyHost,
})

type HostFiber = {
  type: unknown
  memoizedProps: Record<string, unknown>
  child: HostFiber | null
  sibling: HostFiber | null
  return: HostFiber | null
}

async function fixture() {
  const globals = Object.fromEntries(
    [
      'window',
      'document',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'IS_REACT_ACT_ENVIRONMENT',
    ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  )
  const scene = useScene.getState(),
    temporal = useScene.temporal.getState(),
    locale = getLocale(),
    restoreRegistry = nodeRegistry._snapshot()
  Object.assign(globalThis, {
    window: new EventTarget(),
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  Reflect.deleteProperty(globalThis, 'document')
  nodeRegistry._reset()
  registerNode(itemDefinition as unknown as AnyNodeDefinition)
  setLocale('zh-CN')
  const item = ItemNode.parse({
    name: 'User English Item',
    slots: { CustomSlotName: 'scene:EnglishMaterial', visible: 'library:EnglishMaterial' },
    asset: {
      id: 'UserAsset',
      name: 'User English Asset',
      category: 'User English Category',
      thumbnail: '/UserImage.png',
      src: 'https://example.com/UserModel.glb',
      source: 'library',
      attachTo: 'wall-side',
      recessed: true,
      tags: ['User English Tag'],
      interactive: { controls: [{ kind: 'toggle', label: 'User English Control', default: true }] },
    },
  })
  useScene.setState({ nodes: { [item.id]: item }, readOnly: false })
  const renderer = await create(<MotionAdditionalProperties node={item} />)
  function host(type: string, matches: (props: Record<string, unknown>) => boolean) {
    // R3F removes children from Three props; the mounted React tree retains displayed text.
    const root = [..._roots.values()].find((root) => root.store === renderer.scene.fiber.root)!
    function find(fiber: HostFiber | null): HostFiber | null {
      if (!fiber) return null
      if (fiber.type === type && matches(fiber.memoizedProps)) return fiber
      return find(fiber.child) ?? find(fiber.sibling)
    }
    const result = find(root.fiber.current as unknown as HostFiber)
    if (!result) throw new Error(`Missing mounted ${type}`)
    return result
  }
  return {
    item,
    renderer,
    input(label: string) {
      return renderer.scene.findByProps({ 'aria-label': label }).props
    },
    options(label: string) {
      const props = host('select', (props) => props['aria-label'] === label).memoizedProps
      return (props.children as ReactElement<{ value: string; children: string }>[]).map(
        (option) => option.props,
      )
    },
    async open(label: string) {
      const summary = host('summary', (props) => props.children === label),
        toggle = summary.return!.memoizedProps.onToggle as (event: {
          currentTarget: { open: boolean }
        }) => void
      await act(async () => toggle({ currentTarget: { open: true } }))
    },
    async dispose() {
      await renderer.unmount()
      setLocale(locale)
      restoreRegistry()
      useScene.setState(scene, true)
      useScene.temporal.setState(temporal, true)
      for (const [key, descriptor] of Object.entries(globals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    },
  }
}

test('mounted Chinese animation properties translate labels and enum display while preserving data', async () => {
  const f = await fixture()
  try {
    await f.open('更多属性')
    expect(f.input('可见').checked).toBe(true)
    await f.open('资源')
    expect(f.input('名称').value).toBe('User English Asset')
    expect(f.input('分类').value).toBe('User English Category')
    expect(f.input('模型地址').value).toBe('https://example.com/UserModel.glb')
    expect(f.input('嵌入安装').checked).toBe(true)
    const source = f.input('来源'),
      attachment = f.input('挂载位置')
    expect(source.value).toBe('library')
    expect(f.options('来源')).toEqual([
      { value: 'library', children: '素材库' },
      { value: 'community', children: '社区' },
      { value: 'mine', children: '我的' },
    ])
    expect(attachment.value).toBe('wall-side')
    expect(f.options('挂载位置')).toEqual([
      { value: 'wall', children: '墙面' },
      { value: 'wall-side', children: '墙侧' },
      { value: 'ceiling', children: '天花板' },
    ])
    await f.open('标签')
    expect(f.input('0').value).toBe('User English Tag')
    await f.open('交互')
    await f.open('控件')
    await f.open('0')
    expect(f.input('标签').value).toBe('User English Control')
    expect(f.input('默认值').checked).toBe(true)
    expect(f.input('类型').value).toBe('toggle')
    await act(async () => source.onChange({ target: { value: 'community' } }))
    const current = useScene.getState().nodes[f.item.id] as ItemNode
    expect(current.asset.source).toBe('community')
    expect(current.name).toBe('User English Item')
    expect(current.asset.name).toBe('User English Asset')
    expect(current.asset.tags).toEqual(['User English Tag'])
    expect(current.asset.interactive).toEqual(f.item.asset.interactive)
    expect(current.slots).toEqual(f.item.slots)
    expect(f.item.asset.source).toBe('library')
  } finally {
    await f.dispose()
  }
})

test('mounted properties keep custom record names and English locale through language changes', async () => {
  const f = await fixture()
  try {
    await f.open('更多属性')
    await f.open('材质槽')
    expect(f.input('CustomSlotName').value).toBe('scene:EnglishMaterial')
    expect(f.input('visible').value).toBe('library:EnglishMaterial')
    await f.open('资源')
    await act(async () => setLocale('en'))
    expect(f.input('Visible').checked).toBe(true)
    expect(f.input('Category').value).toBe('User English Category')
    expect(f.input('CustomSlotName').value).toBe('scene:EnglishMaterial')
    expect(f.input('visible').value).toBe('library:EnglishMaterial')
    expect(f.options('Source')[0]).toEqual({ value: 'library', children: 'Library' })
    await act(async () => setLocale('zh-CN'))
    expect(f.input('可见').checked).toBe(true)
    expect(f.input('分类').value).toBe('User English Category')
    expect(useScene.getState().nodes[f.item.id]).toEqual(f.item)
  } finally {
    await f.dispose()
  }
})
