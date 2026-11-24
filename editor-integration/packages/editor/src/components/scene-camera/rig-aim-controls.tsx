import {
  type AnyNodeId,
  type SceneCameraNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n'
import { useSceneAnimation } from '../scene-animation/store'
import { canEditRigAim, startRigAimPick, stopRigAimPick } from './rig-aim-picker'
import { canAimAtNode, rigPose, setRigTarget, updateRig, useRigEditor } from './rig-state'
import { cameraTargetLabel } from './target-label'

export function RigAimControls({ node }: { node: SceneCameraNode }) {
  const { locale } = useI18n(),
    zh = locale === 'zh-CN'
  const state = useSceneAnimation()
  const nodes = useScene((s) => s.nodes)
  useScene((s) => s.readOnly)
  useLiveNodeOverrides((s) => s.overrides.get(node.id))
  const owner = useRigEditor((s) => s.aimCameraId)
  const pickMode = useRigEditor((s) => s.aimPickMode)
  const picking = state.pickingRigAim && owner === node.id
  const disabled = !canEditRigAim(node)
  const rig = rigPose(node)?.rig
  const targetId = rig?.target?.nodeId
  const target = targetId ? nodes[targetId as AnyNodeId] : null
  const [error, setError] = useState(false)
  useEffect(
    () => () => {
      if (useRigEditor.getState().aimCameraId === node.id) stopRigAimPick()
    },
    [node.id],
  )
  useEffect(() => {
    if (picking && disabled) stopRigAimPick()
  }, [picking, disabled])
  const bind = (id: string | null) => {
    const changed = setRigTarget(id, undefined, node)
    setError(!changed)
    if (changed) stopRigAimPick()
  }
  const following =
    rig?.type === '2d'
      ? (rig.native?.bones.Camera?.properties.rotation_shift ?? 0) < 1
      : (rig?.tracking ?? 1) > 0
  const button =
    'rounded border border-border px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-40'
  return (
    <fieldset
      disabled={disabled}
      className="space-y-2 text-xs disabled:opacity-40"
      aria-label={zh ? '物品瞄准' : 'Aim at object'}
    >
      <label className="flex items-center gap-2">
        <span className="shrink-0">{zh ? '瞄准物品' : 'Aim subject'}</span>
        <select
          aria-label={zh ? '瞄准物品' : 'Aim subject'}
          className="min-w-0 flex-1 rounded border border-border bg-background p-1.5"
          value={targetId ?? ''}
          onChange={(e) => bind(e.target.value || null)}
        >
          <option value="">{zh ? '不绑定物品' : 'No object binding'}</option>
          {targetId && !target && (
            <option value={targetId}>{zh ? '原物品已删除' : 'Subject deleted'}</option>
          )}
          {Object.values(nodes)
            .filter(canAimAtNode)
            .map((n) => (
              <option key={n.id} value={n.id}>
                {cameraTargetLabel(n, locale)}
              </option>
            ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className={button}
          aria-pressed={picking}
          onClick={() => {
            setError(false)
            if (picking) stopRigAimPick()
            else setError(!startRigAimPick(node))
          }}
        >
          {picking
            ? zh
              ? '取消点选 · 退出键'
              : 'Cancel · Esc'
            : zh
              ? '在场景中点选'
              : 'Pick in scene'}
        </button>
        <button
          type="button"
          className={button}
          aria-pressed={picking && pickMode === 'surface'}
          title={
            zh
              ? '按所选面重新摆正相机架，保留实际焦距和拍摄距离；可撤销。'
              : 'Reset the rig pose facing a surface, retaining focal length and distance. Undo is available.'
          }
          onClick={() => {
            setError(false)
            if (picking && pickMode === 'surface') stopRigAimPick()
            else setError(!startRigAimPick(node, 'surface'))
          }}
        >
          {zh ? '正对表面' : 'Face surface'}
        </button>
        {target && (
          <button type="button" className={button} onClick={() => bind(target.id)}>
            {zh ? '瞄准物品中心' : 'Aim at center'}
          </button>
        )}
        {rig?.target && (
          <button type="button" className={button} onClick={() => bind(null)}>
            {zh ? '解除绑定' : 'Unbind'}
          </button>
        )}
      </div>
      <p role="status" className={picking || error ? 'text-sky-300' : 'text-muted-foreground'}>
        {error
          ? zh
            ? '暂时无法绑定，请确认物品已加载且没有其他操作。'
            : 'Cannot bind yet. Check that the object has loaded and no other edit is active.'
          : picking
            ? zh
              ? pickMode === 'surface'
                ? '点击要正对的面：重新摆正相机架，保留焦距和距离；按退出键取消。'
                : '点击大画面中的物品位置；空白处不确认，按退出键取消。'
              : pickMode === 'surface'
                ? 'Pick a face to reset the rig pose, retaining focal length and distance. Esc cancels.'
                : 'Click a point on an object in the scene. Esc cancels.'
            : targetId && !target
              ? zh
                ? '物品已删除，请重新选择或解除绑定。'
                : 'Choose another subject or unbind.'
              : target
                ? zh
                  ? `已绑定：${cameraTargetLabel(target, locale)}。瞄准点随物品移动。`
                  : `Following ${cameraTargetLabel(target, locale)}.`
                : zh
                  ? rig
                    ? '列表选择物品中心；场景点选可指定瞄准位置。'
                    : '选择物品后启用相机架瞄准；也可在场景中点选具体位置。'
                  : rig
                    ? 'Choose an object center or pick a specific point in the scene.'
                    : 'Choose a subject to enable rig aiming, or pick a specific point in the scene.'}
      </p>
      {target && !following && rig && (
        <button
          type="button"
          className={button}
          onClick={() =>
            updateRig(
              node,
              rig.type === '2d' && rig.native
                ? {
                    ...rig,
                    native: {
                      ...rig.native,
                      bones: {
                        ...rig.native.bones,
                        Camera: {
                          ...rig.native.bones.Camera!,
                          properties: { ...rig.native.bones.Camera!.properties, rotation_shift: 0 },
                        },
                      },
                    },
                  }
                : { ...rig, tracking: 1 },
            )
          }
        >
          {zh ? '朝向跟随已关闭 · 启用' : 'Orientation tracking off · Enable'}
        </button>
      )}
    </fieldset>
  )
}
