// SPDX-License-Identifier: GPL-3.0-or-later
import type { CameraRig } from '@pascal-app/core'
import { sourceBoneWireColor } from './rig-bbone-source'
import data from './rig-source-ui.json'

export type SourceLayout = {
  kind: string
  options: {
    enabled?: boolean
    active?: boolean
    decorate?: boolean
    ui_enabled?: boolean
    use_property_split?: boolean
    use_property_decorate?: boolean
    align?: boolean
    heading?: string
    text?: string
    label?: string
    description?: string
    icon?: string
    owner?: string
    path?: string
    property?: string
    index?: number
    operator?: string
    menu?: string
    panel?: string
    rna?: {
      name: string
      type: string
      subtype?: string
      description?: string
      is_animatable?: boolean
      is_array?: boolean
      is_readonly?: boolean
      data_path?: string
      driven_indices?: number[]
      min?: number
      max?: number
      hard_min?: number
      hard_max?: number
      soft_min?: number
      soft_max?: number
      step?: number
      precision?: number
      items?: { value: string; name: string }[]
    }
  }
  children: SourceLayout[]
}
export type SourceUIEntry = { panel?: string; menu?: string; body: number; header?: number }
type BoneColor = { normal: number[]; select: number[]; active: number[] }
type WidgetStyle = BoneColor & { palette: string; wireWidth: number }

export const rigSourceUI = data as unknown as {
  cameraTypeRNA: typeof data.cameraTypeRNA
  swapLens: NonNullable<SourceLayout['options']['rna']>
  poseTransformRNA: Record<
    'location' | 'rotation_euler' | 'scale',
    NonNullable<SourceLayout['options']['rna']>
  >
  source: typeof data.source
  hashes: Record<string, string>
  panels: typeof data.panels
  trees: SourceLayout[]
  variants: Record<string, SourceUIEntry[]>
  composition: SourceLayout
  widgets: Record<CameraRig['type'], Record<string, WidgetStyle>>
  colors: Record<string, BoneColor>
}

export function sourceRigUIState(
  rig: CameraRig,
  projection: string,
  depthOfField: boolean,
  passepartout: boolean,
) {
  const key = [
    rig.type,
    projection === 'orthographic' ? 'ORTHO' : 'PERSP',
    Number(rig.type !== '2d' && rig.dollyZoom),
    Number(depthOfField),
    rig.focus.kind,
    Number(rig.native!.sensorWidth === 36),
    Number(passepartout),
  ].join(':')
  return rigSourceUI.variants[key]!
}

export function sourceWidgetStyle(type: CameraRig['type'], name: string, dollyZoom: boolean) {
  const widget = rigSourceUI.widgets[type][name]!
  const palette = name === 'Aim' && dollyZoom ? 'THEME01' : widget.palette
  const color = palette === 'CUSTOM' ? widget : rigSourceUI.colors[palette]!
  return {
    width: widget.wireWidth,
    color: { ...color, normal: sourceBoneWireColor(color.normal) },
    solidColor: color.normal,
  }
}
