import { type SceneCameraNode, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useI18n } from '../../i18n'
import { useSceneAnimation } from '../scene-animation/store'
import { readRigCameraAuthorTransform } from './rig-camera-transform'
import { beginRigObjectNumber, changeRigObjectNumber } from './rig-object-number'
import { objectTransformRNA } from './rig-object-rna-source.json'
import type { RigPythonRunner } from './rig-python-runtime'
import { SourceNumber } from './rig-source-number'
import { rigPose, useRigEditor } from './rig-state'

export function RigObjectNumberControls({
  node,
  python,
}: {
  node: SceneCameraNode
  python?: RigPythonRunner
}) {
  const { locale } = useI18n(),
    zh = locale === 'zh-CN',
    state = useSceneAnimation(),
    editor = useRigEditor(),
    readOnly = useScene((s) => s.readOnly),
    selected = useViewer((s) => s.selection.selectedIds)
  useLiveNodeOverrides((s) => s.overrides.get(node.id))
  const rig = rigPose(node)?.rig
  if (!rig?.native || editor.poseCameraId === node.id) return null
  const author = readRigCameraAuthorTransform(rig),
    disabled =
      readOnly ||
      state.playing ||
      state.exporting ||
      state.renderingFilm ||
      state.previewing ||
      state.pickingRigAim ||
      !!editor.gesture ||
      state.lockedIds.includes(node.id) ||
      (state.open ? state.cameraId !== node.id : selected.length !== 1 || selected[0] !== node.id)
  return (
    <details open>
      <summary className="cursor-pointer py-1">
        {zh ? '相机本体微调' : 'Camera body adjustment'}
      </summary>
      <div className="space-y-2 pt-2">
        <p className="text-muted-foreground">
          {zh
            ? '相对于相机架的局部偏移，瞄准点保持不动。'
            : 'Local camera offset; the aim point stays fixed.'}
        </p>
        {(['location', 'rotation'] as const).map((channel) => {
          const rna = objectTransformRNA[channel === 'rotation' ? 'rotation_euler' : channel],
            displayed = author[channel],
            label = zh
              ? { location: '位置', rotation: '旋转', scale: '缩放' }[channel]
              : { location: 'Location', rotation: 'Rotation', scale: 'Scale' }[channel]
          return (
            <div
              key={channel}
              className="grid grid-cols-[3.5rem_repeat(3,minmax(0,1fr))] items-end gap-2"
            >
              <span className="pb-2 text-muted-foreground">{label}</span>
              {(['X', 'Y', 'Z'] as const).map((axis, editorIndex) => {
                const index = editorIndex as 0 | 1 | 2
                return (
                  <label key={axis} className="flex min-w-0 flex-col gap-1">
                    <span className="text-center text-muted-foreground">{axis}</span>
                    <SourceNumber
                      label={`${zh ? '相机本体' : 'Camera body'} ${label} ${axis}`}
                      field={{
                        value: displayed[editorIndex]!,
                        disabled,
                        arrayRange: [Math.min(...displayed), Math.max(...displayed)],
                        change: (value) =>
                          changeRigObjectNumber(node, { channel, index }, Number(value)),
                        beginDrag: () => {
                          const edit = beginRigObjectNumber(node, { channel, index })
                          return {
                            change: (value) => edit.change(value),
                            finish: edit.finish,
                          }
                        },
                      }}
                      precision={rna.precision}
                      step={rna.step / 100}
                      subtype={rna.subtype}
                      python={python}
                      min={rna.hard_min}
                      max={rna.hard_max}
                      softMin={rna.soft_min}
                      softMax={rna.soft_max}
                    />
                  </label>
                )
              })}
            </div>
          )
        })}
      </div>
    </details>
  )
}
