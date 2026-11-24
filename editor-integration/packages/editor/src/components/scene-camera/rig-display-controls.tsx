import type { SceneCameraNode } from '@pascal-app/core'
import { useI18n } from '../../i18n'
import { CameraNumber } from './inspector'
import { type RigGuide, rigDisplay, rigGuideLabels, updateRigDisplay } from './rig-display'

export function RigDisplayControls({ node }: { node: SceneCameraNode }) {
  const zh = useI18n().locale === 'zh-CN',
    display = rigDisplay(node)
  return (
    <div className="space-y-2">
      <label className="flex items-center justify-between">
        {zh ? '裁剪与对焦距离' : 'Limits'}
        <input
          type="checkbox"
          checked={display.limits}
          onChange={(e) => updateRigDisplay(node, { limits: e.target.checked })}
        />
      </label>
      <label className="flex items-center justify-between">
        {zh ? '画框外遮罩' : 'Passepartout'}
        <input
          type="checkbox"
          checked={display.passepartout}
          onChange={(e) => updateRigDisplay(node, { passepartout: e.target.checked })}
        />
      </label>
      <CameraNumber
        label={zh ? '遮罩不透明度' : 'Passepartout opacity'}
        value={display.opacity}
        min={0}
        max={1}
        step={0.05}
        disabled={!display.passepartout}
        onChange={(opacity) => updateRigDisplay(node, { opacity })}
      />
      <fieldset className="grid grid-cols-2 gap-x-3 gap-y-2">
        <legend className="py-2 text-muted-foreground">
          {zh ? '构图参考线' : 'Composition guides'}
        </legend>
        {(Object.keys(rigGuideLabels) as RigGuide[]).map((guide) => (
          <label key={guide} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={display.guides.includes(guide)}
              onChange={(e) =>
                updateRigDisplay(node, {
                  guides: e.target.checked
                    ? [...display.guides, guide]
                    : display.guides.filter((g) => g !== guide),
                })
              }
            />
            {rigGuideLabels[guide][zh ? 0 : 1]}
          </label>
        ))}
      </fieldset>
    </div>
  )
}
