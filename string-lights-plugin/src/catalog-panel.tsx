'use client'
import { type AnyNodeId, NON_PHYSICAL_HOST_KINDS, useScene } from '@pascal-app/core'
import { ActionButton, ActionGroup, SliderControl, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { commitLight } from './commands'
import { LightControls, useText } from './controls'
import { LIGHT_KIND, isStringLight } from './schema'
import { STRING_LIGHT_ICON } from './icon'
import { setDraft, useLightDraft } from './store'
import { SurfaceControls } from './surface-controls'
import { PanelToggle } from './panel-toggle'
import { prepareScatterOnModel } from './scatter-selection'
import { beginLightDrawing } from './drawing-session'

export default function LightCatalogPanel() {
  const draft = useLightDraft(),
    selection = useViewer((s) => s.selection),
    tool = useEditor((s) => s.tool),
    inPlan = useEditor((s) => s.viewMode === '2d')
  const readOnly = useScene((s) => s.readOnly),
    t = useText()
  const nodes = useScene((s) => s.nodes)
  const selectedModels = selection.selectedIds.filter((id) => {
    const node = nodes[id as AnyNodeId]
    return node && !isStringLight(node) && !NON_PHYSICAL_HOST_KINDS.includes(node.type)
  })
  const selected =
    selection.selectedIds.length === 1 ? nodes[selection.selectedIds[0] as AnyNodeId] : null
  const editing = isStringLight(selected) && tool !== LIGHT_KIND
  const drawing = tool === LIGHT_KIND
  const path = draft.settings.mode === 'path'
  const report = (action: () => void) => {
    try {
      action()
      useLightDraft.setState({ error: '' })
    } catch (e) {
      useLightDraft.setState({ error: e instanceof Error ? e.message : String(e) })
    }
  }
  const select = (node: { id: string }) => {
    useEditor.getState().setTool(null)
    useViewer.getState().setSelection({ selectedIds: [node.id as AnyNodeId] })
  }
  const start = () => report(() => beginLightDrawing())
  return (
    <div
      className="subtle-scrollbar h-full overflow-y-auto text-foreground"
      data-string-light-creator
    >
      <div className="space-y-3 border-b border-border/50 p-3">
        <div className="flex items-center gap-2">
          <img src={STRING_LIGHT_ICON} alt="" className="h-8 w-8 object-contain" />
          <h2 className="text-sm font-medium">{t('灯串', 'String lights')}</h2>
        </div>
        {draft.error && (
          <p role="alert" className="text-xs text-destructive">
            {draft.error}
          </p>
        )}
        <fieldset
          disabled={readOnly}
          inert={readOnly || undefined}
          className="min-w-0 space-y-3 border-0 p-0 disabled:opacity-50 [&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-40"
        >
          {drawing ? (
            <>
              <p role="status" className="text-sm font-medium" data-testid="light-drawing-step">
                {draft.points.length === 0
                  ? t('点击第一个挂点', 'Click the first support')
                  : draft.points.length === 1
                    ? t('点击下一个挂点', 'Click the next support')
                    : t(
                        `已连接 ${draft.points.length} 个挂点，可继续点击或完成`,
                        `${draft.points.length} supports connected. Add more or finish.`,
                      )}
              </p>
              <ActionGroup>
                <ActionButton
                  type="button"
                  label={t('完成并调整', 'Finish & adjust')}
                  disabled={path && draft.points.length < 2}
                  onClick={() => draft.finish?.()}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                />
                <ActionButton
                  type="button"
                  label={t('退出绘制', 'Exit drawing')}
                  onClick={() => draft.finish?.()}
                />
              </ActionGroup>
            </>
          ) : (
            <ActionButton
              type="button"
              label={
                editing
                  ? t('画另一条灯串', 'Draw another string')
                  : path
                    ? t('画灯串', 'Draw string lights')
                    : t('在场景中放置', 'Place in scene')
              }
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={start}
            />
          )}
          {!editing && path && (
            <>
              <PanelToggle
                label={t('挂到物体表面', 'Attach to object surfaces')}
                checked={draft.settings.surfaceSnap !== false}
                onChange={(surfaceSnap) => setDraft({ surfaceSnap })}
              />
              <SliderControl
                label={t('悬空挂点高度', 'Free support height')}
                value={draft.elevation}
                min={-100}
                max={100}
                step={0.1}
                precision={2}
                unit="m"
                onChange={(elevation) => useLightDraft.setState({ elevation })}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {inPlan
                  ? t(
                      '二维新挂点使用此高度；三维可直接挂到物体表面。',
                      'New plan supports use this height. In 3D, attach directly to surfaces.',
                    )
                  : t(
                      '物体上按实际高度挂线；空处使用此高度。',
                      'On objects, use the surface height. In empty space, use this height.',
                    )}
              </p>
            </>
          )}
          {drawing && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {path
                ? t(
                    'Enter / 双击完成 · Esc 结束 · ⌘Z / Ctrl+Z 撤销',
                    'Enter / double-click to finish · Esc to exit · ⌘Z / Ctrl+Z to undo',
                  )
                : t('点击放置 · Esc 退出', 'Click to place · Esc to exit')}
            </p>
          )}
          {!drawing && !editing && selectedModels.length > 0 && (
            <ActionButton
              type="button"
              label={
                draft.settings.mode === 'scatter'
                  ? t('在选中灌木布灯', 'Scatter on selected shrub')
                  : t('仅在选中模型上贴合 / 缠绕', 'Follow / wrap selected model')
              }
              onClick={() =>
                report(() => {
                  if (draft.settings.mode !== 'scatter') {
                    beginLightDrawing(selectedModels)
                    return
                  }
                  if (!selection.levelId || selectedModels.length !== 1)
                    throw new Error(t('请选中一个灌木模型。', 'Select one shrub model.'))
                  select(
                    commitLight(
                      prepareScatterOnModel(draft.settings, selection.levelId, selectedModels[0]!),
                      selection.levelId,
                    ),
                  )
                })
              }
            />
          )}
          {editing && (
            <details className="text-xs leading-relaxed text-muted-foreground">
              <summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-ring">
                {t('挂点操作', 'Support controls')}
              </summary>
              <p className="pt-2">
                {inPlan
                  ? t(
                      '拖动圆点换位置；展开所选灯串属性，可调整挂点高度、单段下垂和灯泡外观。',
                      'Drag points to move them. Expand properties to edit heights, span sag and appearance.',
                    )
                  : t(
                      '拖动圆点换位置，竖直箭头调高度，线段中间的手柄调下垂。灯泡、灯距和颜色在所选灯串的属性中调整。',
                      'Drag a support to move it, its vertical arrow to change height, or a span handle to change sag. Appearance is in the selected string’s properties.',
                    )}
              </p>
            </details>
          )}
        </fieldset>
      </div>
      {!editing && (
        <fieldset
          disabled={readOnly}
          inert={readOnly || undefined}
          className="min-w-0 border-0 p-0 disabled:opacity-50"
        >
          <LightControls value={draft.settings} onChange={setDraft} />
          <SurfaceControls value={draft.settings} onChange={setDraft} />
          {!drawing && (
            <div className="p-3">
              <ActionButton
                type="button"
                label={t('创建示例', 'Create example')}
                onClick={() =>
                  report(() => {
                    if (!selection.levelId)
                      throw new Error(t('请先选择一个楼层。', 'Select a level first.'))
                    select(commitLight(draft.settings, selection.levelId))
                  })
                }
              />
            </div>
          )}
        </fieldset>
      )}
    </div>
  )
}
