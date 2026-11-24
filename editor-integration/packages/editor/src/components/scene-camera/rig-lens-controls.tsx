import {
  type AnyNodeId,
  type CameraRig,
  getEffectiveNode,
  type SceneCameraNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import type { BlenderRigResult } from '@pascal-app/viewer'
import { useI18n } from '../../i18n'
import { animationSite } from '../scene-animation/document'
import { CameraNumber } from './inspector'
import { commitExistingKey } from './motion-edit-session'
import { motionData, motionTarget, resolveMotionTarget } from './motion-state'
import { rigControlLabel } from './rig-labels'
import { updateRig } from './rig-state'
import { RigFocalControls } from './rig-focal-controls'
import { cameraTargetLabel } from './target-label'

export function RigLensControls({
  node,
  rig,
  snapshot,
  timeline,
}: {
  node: SceneCameraNode
  rig: CameraRig
  snapshot: BlenderRigResult
  timeline: boolean
}) {
  const zh = useI18n().locale === 'zh-CN'
  const nodes = useScene((s) => s.nodes)
  useLiveNodeOverrides((s) => s.overrides.get(node.id))
  const camera = getEffectiveNode(node),
    native = rig.native!,
    properties = native.bones.Camera!.properties
  const ranges = snapshot.widgets.find((w) => w.name === 'Camera')!.properties
  const patch = (values: Partial<CameraRig>) => updateRig(node, { ...rig, ...values })
  const property = (key: string, value: number) =>
    patch({
      native: {
        ...native,
        bones: {
          ...native.bones,
          Camera: { ...native.bones.Camera!, properties: { ...properties, [key]: value } },
        },
      },
    })
  const updateCamera = (values: Partial<SceneCameraNode>) => {
    const nextRig = {
      ...rig,
      native: {
        ...native,
        projection: values.projection ?? native.projection,
        sensorWidth: values.sensorWidth ?? native.sensorWidth,
      },
    }
    if (!timeline || !motionData(node).points.length) {
      const site = timeline ? animationSite() : null
      useScene
        .getState()
        .updateNodes([
          ...(site ? [{ id: site.id, data: { animation: site.animation } }] : []),
          { id: node.id, data: { ...values, rig: nextRig } },
        ])
      return
    }
    useScene.getState().updateNode(node.id, values)
    if (values.projection || values.sensorWidth) updateRig(node, nextRig)
    else commitExistingKey()
  }
  const setFocusObject = (id: string) => {
    if (id === 'manual') return patch({ focus: { kind: 'manual' } })
    if (id === 'rig')
      return patch({ focus: { kind: 'rig', bone: rig.type === '2d' ? 'DOF' : 'Aim' } })
    const target = motionTarget(id, [0, 0, 0])
    if (target) {
      target.fallback = resolveMotionTarget(target, node).toArray()
      patch({ focus: { kind: 'object', target } })
    }
  }
  const focusValue =
    rig.focus.kind === 'object' ? (rig.focus.target.nodeId ?? 'manual') : rig.focus.kind
  return (
    <>
      <details open>
        <summary className="cursor-pointer py-1">{zh ? '镜头参数' : 'Lens controls'}</summary>
        <div className="space-y-2 pt-2">
          <label className="flex items-center justify-between gap-2">
            {zh ? '相机类型' : 'Camera type'}
            <select
              aria-label={zh ? '相机投影' : 'Camera projection'}
              className="h-8 rounded border border-border bg-background px-2"
              value={camera.projection}
              onChange={(e) =>
                updateCamera({ projection: e.target.value as SceneCameraNode['projection'] })
              }
            >
              <option value="perspective">{zh ? '透视' : 'Perspective'}</option>
              <option value="orthographic">{zh ? '正交' : 'Orthographic'}</option>
            </select>
          </label>
          <RigFocalControls node={camera} rig={rig} snapshot={snapshot} timeline={timeline} />
          {rig.type !== '2d' && (
            <div className="grid grid-cols-2 gap-2">
              {(['X', 'Y'] as const).map((axis, i) => {
                return (
                  <CameraNumber
                    key={axis}
                    compact
                    label={zh ? `镜头偏移 ${axis}` : `Shift ${axis}`}
                    value={native.lensShift[i]!}
                    step={0.01}
                    onChange={(value) =>
                      patch({
                        native: {
                          ...native,
                          lensShift: native.lensShift.map((v, j) => (i === j ? value : v)) as [
                            number,
                            number,
                          ],
                        },
                      })
                    }
                  />
                )
              })}
            </div>
          )}
          <CameraNumber
            label={zh ? '近裁剪 · 米' : 'Clip start · m'}
            value={camera.near}
            min={1e-6}
            max={camera.far - 1e-6}
            precision={6}
            onChange={(near) => updateCamera({ near })}
          />
          <CameraNumber
            label={zh ? '远裁剪 · 米' : 'Clip end · m'}
            value={camera.far}
            min={camera.near + 1e-6}
            precision={6}
            onChange={(far) => updateCamera({ far })}
          />
          <CameraNumber
            label={zh ? '传感器宽度 · 毫米' : 'Sensor width · mm'}
            value={native.sensorWidth}
            min={1}
            disabled={rig.type === '2d'}
            onChange={(sensorWidth) => updateCamera({ sensorWidth })}
          />
        </div>
      </details>
      <details open>
        <summary className="cursor-pointer py-1">
          {zh ? '景深与对焦' : 'Depth of field and focus'}
        </summary>
        <div className="space-y-2 pt-2">
          <label className="flex items-center justify-between">
            {zh ? '启用景深' : 'Enable depth of field'}
            <input
              type="checkbox"
              checked={camera.depthOfField}
              onChange={(e) => updateCamera({ depthOfField: e.target.checked })}
            />
          </label>
          <label className="flex items-center justify-between gap-2">
            {zh ? '对焦目标' : 'Focus target'}
            <select
              aria-label={zh ? '对焦目标' : 'Focus target'}
              value={focusValue}
              className="h-8 max-w-44 rounded border border-border bg-background px-2"
              onChange={(e) => setFocusObject(e.target.value)}
            >
              <option value="manual">{zh ? '手动距离' : 'Manual distance'}</option>
              <option value="rig">{zh ? '相机架控制点' : 'Rig control'}</option>
              {rig.focus.kind === 'object' &&
                rig.focus.target.nodeId &&
                !nodes[rig.focus.target.nodeId as AnyNodeId] && (
                  <option value={rig.focus.target.nodeId}>
                    {zh ? '对象已删除 · 使用保存的对焦点' : 'Missing object · saved point'}
                  </option>
                )}
              {Object.values(nodes)
                .filter((n) => !['site', 'building', 'level', 'scene-camera'].includes(n.type))
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {cameraTargetLabel(n, zh ? 'zh-CN' : 'en')}
                  </option>
                ))}
            </select>
          </label>
          {rig.focus.kind === 'rig' && (
            <label className="flex items-center justify-between gap-2">
              {zh ? '对焦控制骨' : 'Focus bone'}
              <select
                aria-label={zh ? '对焦控制骨' : 'Focus bone'}
                className="h-8 rounded border border-border bg-background px-2"
                value={rig.focus.bone}
                onChange={(e) => patch({ focus: { kind: 'rig', bone: e.target.value } })}
              >
                {snapshot.widgets.map((w) => (
                  <option key={w.name} value={w.name}>
                    {rigControlLabel(w.name, zh)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <CameraNumber
            label={zh ? '对焦距离 · 米' : 'Focus distance · m'}
            value={
              rig.focus.kind === 'manual'
                ? (properties.focus_distance ?? camera.focusDistance)
                : snapshot.focusDistance
            }
            min={0}
            precision={5}
            disabled={rig.focus.kind !== 'manual'}
            onChange={(v) => property('focus_distance', v)}
          />
          {'lens_breathing_scale' in properties && (
            <CameraNumber
              label={zh ? '镜头呼吸' : 'Lens breathing'}
              value={properties.lens_breathing_scale!}
              min={ranges.lens_breathing_scale?.min}
              max={ranges.lens_breathing_scale?.max}
              step={0.01}
              onChange={(v) => property('lens_breathing_scale', v)}
            />
          )}
          <CameraNumber
            label={zh ? '光圈 · f/' : 'Aperture · f/'}
            value={properties.aperture_fstop ?? camera.aperture}
            min={0}
            onChange={(v) => property('aperture_fstop', v)}
          />
        </div>
      </details>
    </>
  )
}
