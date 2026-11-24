import { expect, test } from 'bun:test'
import { SceneCameraNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { create } from '@react-three/test-renderer'
import { act } from 'react'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import { useKeyboard } from './use-keyboard'

async function fixture() {
  const originals = Object.fromEntries(
    [
      'window',
      'document',
      'Element',
      'HTMLElement',
      'HTMLInputElement',
      'HTMLTextAreaElement',
      'HTMLSelectElement',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'IS_REACT_ACT_ENVIRONMENT',
    ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  )
  const saved = {
    scene: useScene.getState(),
    temporal: useScene.temporal.getState(),
    viewer: useViewer.getState(),
    editor: useEditor.getState(),
    scope: useInteractionScope.getState(),
  }
  class ElementTarget extends EventTarget {}
  Object.assign(globalThis, {
    window: new EventTarget(),
    Element: ElementTarget,
    HTMLElement: ElementTarget,
    HTMLInputElement: class extends ElementTarget {},
    HTMLTextAreaElement: class extends ElementTarget {},
    HTMLSelectElement: class extends ElementTarget {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  Reflect.deleteProperty(globalThis, 'document')
  const node = SceneCameraNode.parse({})
  useScene.setState({ nodes: { [node.id]: node }, rootNodeIds: [node.id], readOnly: false })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  useScene.getState().updateNode(node.id, { name: '测试相机' })
  useEditor.getState().armToolMode({ mode: 'select' })
  useInteractionScope.getState().end()
  useViewer.setState({
    selection: {
      ...saved.viewer.selection,
      buildingId: null,
      levelId: null,
      selectedIds: [node.id],
    },
    inputDragging: false,
  })
  function Host() {
    useKeyboard()
    return null
  }
  const renderer = await create(<Host />)
  const key = async (key: string, consumed: boolean, metaKey = false) => {
    const event = new Event('keydown', { cancelable: true })
    Object.assign(event, { key, code: key === 'z' ? 'KeyZ' : key, metaKey })
    if (consumed) event.preventDefault()
    await act(async () => {
      window.dispatchEvent(event)
    })
  }
  return {
    node,
    key,
    async dispose() {
      await renderer.unmount()
      useScene.setState(saved.scene, true)
      useScene.temporal.setState(saved.temporal, true)
      useViewer.setState(saved.viewer, true)
      useEditor.setState(saved.editor, true)
      useInteractionScope.setState(saved.scope, true)
      for (const [key, descriptor] of Object.entries(originals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    },
  }
}

test('Escape consumed by a menu preserves the selected camera and ordinary Escape still clears it', async () => {
  const f = await fixture()
  try {
    await f.key('Escape', true)
    expect(useViewer.getState().selection.selectedIds).toEqual([f.node.id])
    expect(useEditor.getState().mode).toBe('select')
    await f.key('Escape', false)
    expect(useViewer.getState().selection.selectedIds).toEqual([])
  } finally {
    await f.dispose()
  }
})

test('a consumed undo shortcut does not jump scene history', async () => {
  const f = await fixture()
  try {
    await f.key('z', true, true)
    expect(useScene.getState().nodes[f.node.id]?.name).toBe('测试相机')
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    await f.key('z', false, true)
    expect(useScene.getState().nodes[f.node.id]?.name).toBe(f.node.name)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  } finally {
    await f.dispose()
  }
})
