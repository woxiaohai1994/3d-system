import { type AnyNodeId, getEffectiveNode, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { useI18n } from '../../i18n'
import { useSceneAnimation } from '../scene-animation/store'
import { EmbeddedInspectorContext } from '../ui/panels/panel-wrapper'
import { ParametricInspector } from '../ui/panels/parametric-inspector'
import type { CameraSettingsTab } from './camera-panel-tabs'
import { CameraProperties } from './inspector'
import { MotionLensControls } from './motion-lens-controls'
import { MotionAdditionalProperties } from './motion-property-fields'
import { motionCamera, motionCameraFrame, motionPreviewPose } from './motion-state'

export function MotionPropertyControls({ nodeId }: { nodeId: string }) {
  const zh = useI18n().locale === 'zh-CN'
  const source = useScene((s) => s.nodes[nodeId as AnyNodeId]),
    state = useSceneAnimation()
  useLiveNodeOverrides((s) => s.overrides.get(nodeId))
  const node = source ? getEffectiveNode(source) : undefined
  if (!node || node.type === 'scene-camera') return null
  return (
    <details className="border-t border-border pt-2 text-xs">
      <summary
        className="cursor-pointer py-2"
        title={zh ? '修改后使用创建／更新关键帧记录' : 'Record changes with the keyframe button'}
      >
        {zh ? '其他动画属性' : 'Other animated properties'}
      </summary>
      <fieldset
        disabled={
          state.playing || state.exporting || state.previewing || state.lockedIds.includes(nodeId)
        }
      >
        <EmbeddedInspectorContext.Provider value={true}>
          <ParametricInspector inline nodeId={nodeId as AnyNodeId} />
          <MotionAdditionalProperties node={node} />
        </EmbeddedInspectorContext.Provider>
      </fieldset>
    </details>
  )
}
export function MotionRigControls({ defaultTab }: { defaultTab?: CameraSettingsTab }) {
  useSceneAnimation()
  const node = motionCamera()
  const pose = motionPreviewPose()
  return node ? (
    <CameraProperties
      key={node.id}
      node={pose ? motionCameraFrame(node, pose) : node}
      context="timeline"
      defaultTab={defaultTab}
      lensControls={pose ? <MotionLensControls node={node} pose={pose} /> : undefined}
    />
  ) : null
}
