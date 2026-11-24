'use client'
import {
  type AnyNodeId,
  resolvePointAttachment,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { PanelWrapper } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useState } from 'react'
import { updateLight } from './commands'
import { LightControls, useText } from './controls'
import { isStringLight, type LightSettings } from './schema'
import { STRING_LIGHT_ICON } from './icon'
import { SurfaceLayoutControls } from './surface-layout-controls'
import { SurfaceControls } from './surface-controls'
import { SupportEditor } from './support-editor'
import { BlendControls } from './blend-controls'
import { liveLightContext, resolveLightNode } from './resolved-light'
import { useLightDraft } from './store'
import { EffectPlaybackContext } from './effect-playback'

export default function LightPanel() {
  const id = useViewer((s) => s.selection.selectedIds[0])
  const nodes = useScene((s) => s.nodes)
  const node: unknown = id ? nodes[id as AnyNodeId] : undefined
  const override = useLiveNodeOverrides((s) => (id ? s.overrides.get(id) : undefined))
  const actionError = useLightDraft((s) => s.error)
  const readOnly = useScene((s) => s.readOnly),
    [error, setError] = useState(''),
    t = useText()
  useEffect(
    () => () => {
      if (id) useLiveNodeOverrides.getState().clear(id)
    },
    [id],
  )
  if (!isStringLight(node)) return null
  const attachmentBroken =
    node.anchors.some((a) => a.attachment && !resolvePointAttachment(a.attachment, nodes)) ||
    !!(
      node.scatterAttachment &&
      (!nodes[node.scatterAttachment.nodeId as AnyNodeId] ||
        node.scatterAttachment.points.some(
          (p) => p.attachment && !resolvePointAttachment(p.attachment, nodes),
        ))
    )
  const commit = (patch: Partial<LightSettings>) => {
    try {
      updateLight(node.id, patch)
      useLiveNodeOverrides.getState().clear(node.id)
      setError('')
      useLightDraft.setState({ error: '' })
    } catch (e) {
      setError(String(e))
    }
  }
  return (
    <PanelWrapper
      title={node.name || t('灯串', 'String lights')}
      icon={<img src={STRING_LIGHT_ICON} alt="" className="h-6 w-6 object-contain" />}
      onClose={() => useViewer.getState().setSelection({ selectedIds: [] })}
    >
      {(error || actionError) && (
        <p role="alert" className="px-3 py-2 text-xs text-destructive">
          {error || actionError}
        </p>
      )}
      {attachmentBroken && (
        <p role="status" className="px-3 py-2 text-xs text-destructive">
          {t(
            node.mode === 'scatter'
              ? '附着模型已改变或被移除，请选择模型重新布灯。'
              : '附着表面已改变或被移除，请拖动挂点重新吸附，或使用「移到表面」。',
            node.mode === 'scatter'
              ? 'The attached model changed or was removed. Select a model and scatter again.'
              : 'An attachment surface changed or was removed. Reattach supports or use Move to surface.',
          )}
        </p>
      )}
      <fieldset
        disabled={readOnly}
        inert={readOnly || undefined}
        className="min-w-0 border-0 p-0 disabled:opacity-50 [&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-40"
      >
        <SurfaceControls value={node} onChange={commit} />
        <SurfaceLayoutControls
          value={node}
          nodeId={node.id}
          parentId={node.parentId}
          onApply={(patch) => {
            updateLight(node.id, patch)
            useLiveNodeOverrides.getState().clear(node.id)
          }}
        />
        <BlendControls key={`blend-${node.id}`} node={node} onChange={commit} />
        <SupportEditor key={node.id} node={node} onChange={commit} />
        <EffectPlaybackContext.Provider value={node.id}>
          <LightControls
            value={{ ...resolveLightNode(node, liveLightContext(nodes)).node, ...override }}
            onChange={commit}
            onPreview={(patch) => useLiveNodeOverrides.getState().set(node.id, patch)}
            onCommit={commit}
            editPoints
          />
        </EffectPlaybackContext.Provider>
      </fieldset>
    </PanelWrapper>
  )
}
