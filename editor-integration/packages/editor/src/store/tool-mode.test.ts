import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { emitter, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor, { normalizePersistedEditorUiState } from './use-editor'
import useInteractionScope from './use-interaction-scope'

function resetToolMode() {
  useEditor.getState().setPhase('structure')
  useEditor.getState().setStructureLayer('elements')
  useEditor.getState().armToolMode({ mode: 'select' })
  useEditor.getState().setActivePaintMaterial(null)
}

beforeEach(resetToolMode)
afterEach(resetToolMode)

describe('ToolMode transition', () => {
  test('entering navigation cancels the active tool without changing the scene or selection', () => {
    useEditor.getState().armToolMode({ mode: 'build', tool: 'wall' })
    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'wall' })
    const nodes = useScene.getState().nodes
    const selection = useViewer.getState().selection
    let cancelled = false
    const cancel = () => {
      cancelled = true
    }
    emitter.on('tool:cancel', cancel)
    try {
      useEditor.getState().armToolMode({ mode: 'pan' })
      expect(cancelled).toBe(true)
      expect(useInteractionScope.getState().scope.kind).toBe('idle')
      expect(useEditor.getState().tool).toBeNull()
      expect(useScene.getState().nodes).toBe(nodes)
      expect(useViewer.getState().selection).toBe(selection)
      useEditor.getState().armToolMode({ mode: 'select' })
      expect(useViewer.getState().selection).toBe(selection)
    } finally {
      emitter.off('tool:cancel', cancel)
    }
  })

  test('choosing a paint swatch while selected arms material paint', () => {
    useEditor.getState().armToolMode({ mode: 'select' })
    useEditor.getState().armMaterialPaint({
      materialPreset: 'library:test-paint',
      sourceTarget: 'wall',
    })

    expect(useEditor.getState().toolMode).toEqual({ mode: 'material-paint' })
    expect(useEditor.getState().mode).toBe('material-paint')
    expect(useEditor.getState().tool).toBeNull()
    expect(useEditor.getState().activePaintMaterial?.materialPreset).toBe('library:test-paint')
  })

  test('leaving build clears the materialized tool', () => {
    useEditor.getState().armToolMode({ mode: 'build', tool: 'wall' })
    useEditor.getState().armToolMode({ mode: 'select' })

    expect(useEditor.getState().toolMode).toEqual({ mode: 'select' })
    expect(useEditor.getState().mode).toBe('select')
    expect(useEditor.getState().tool).toBeNull()
  })

  test('the setMode compatibility wrapper elects a default build tool', () => {
    useEditor.getState().setMode('build')

    expect(useEditor.getState().toolMode).toEqual({ mode: 'build', tool: 'wall' })
    expect(useEditor.getState().mode).toBe('build')
    expect(useEditor.getState().tool).toBe('wall')
  })

  test('setTool enters build and null exits it', () => {
    useEditor.getState().armToolMode({ mode: 'select' })
    useEditor.getState().setTool('slab')

    expect(useEditor.getState().toolMode).toEqual({ mode: 'build', tool: 'slab' })
    expect(useEditor.getState().mode).toBe('build')
    expect(useEditor.getState().tool).toBe('slab')

    useEditor.getState().setTool(null)
    expect(useEditor.getState().toolMode).toEqual({ mode: 'select' })
    expect(useEditor.getState().tool).toBeNull()
  })
})

describe('persisted ToolMode normalization', () => {
  test('restores navigation across every editor phase and view without reviving a build tool', () => {
    for (const phase of ['site', 'structure', 'furnish'] as const) {
      for (const viewMode of ['2d', '3d', 'split'] as const) {
        const state = normalizePersistedEditorUiState({
          phase,
          viewMode,
          toolMode: { mode: 'pan' },
          mode: 'build',
          tool: 'wall',
        })
        expect(state.mode).toBe('pan')
        expect(state.tool).toBeNull()
        expect(state.viewMode).toBe(viewMode)
        expect(state.phase).toBe(phase)
      }
    }
  })

  test('elects a default for build with a null tool', () => {
    const state = normalizePersistedEditorUiState({
      phase: 'structure',
      toolMode: { mode: 'build', tool: null as never },
      mode: 'select',
      tool: 'slab',
      structureLayer: 'elements',
    })

    expect(state.toolMode).toEqual({ mode: 'build', tool: 'wall' })
    expect(state.mode).toBe('build')
    expect(state.tool).toBe('wall')
  })

  test('clears a persisted tool from a non-build mode', () => {
    const state = normalizePersistedEditorUiState({
      phase: 'structure',
      toolMode: { mode: 'select' },
      mode: 'build',
      tool: 'wall',
      structureLayer: 'elements',
    })

    expect(state.toolMode).toEqual({ mode: 'select' })
    expect(state.mode).toBe('select')
    expect(state.tool).toBeNull()
  })
})
