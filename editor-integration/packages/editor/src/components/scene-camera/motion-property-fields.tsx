import {
  type AnyNode,
  getEffectiveNode,
  isMotionProperty,
  nodeRegistry,
  useScene,
} from '@pascal-app/core'
import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n'
import { prettifyKey } from '../ui/panels/parametric-field-utils'
import { CameraNumber } from './inspector'

const propertyLabels: Record<string, string> = {
  visible: '可见',
  asset: '资源',
  id: '标识',
  category: '分类',
  thumbnail: '缩略图',
  floorPlanUrl: '平面预览图',
  source: '来源',
  isDraft: '草稿',
  src: '模型地址',
  attachTo: '挂载位置',
  recessed: '嵌入安装',
  tags: '标签',
  functionTags: '功能标签',
  interactive: '交互',
  controls: '控件',
  effects: '效果',
  kind: '类型',
  label: '标签',
  default: '默认值',
  displayMode: '显示方式',
  min: '最小值',
  max: '最大值',
  step: '步长',
  unit: '单位',
  clips: '动画片段',
  on: '开启',
  off: '关闭',
  loop: '循环',
  intensityRange: '强度范围',
  distance: '距离',
  wallId: '墙体标识',
  wallT: '沿墙位置',
  roofSegmentId: '屋顶段标识',
  roofFace: '屋顶面',
  blockFaceId: '块体面标识',
  supportSlabId: '支撑板标识',
}
const enumLabels: Record<string, string> = {
  library: '素材库',
  community: '社区',
  mine: '我的',
  wall: '墙面',
  'wall-side': '墙侧',
  ceiling: '天花板',
  toggle: '开关',
  slider: '滑动条',
  temperature: '温度',
  stepper: '步进',
  dial: '旋钮',
  animation: '动画',
  light: '灯光',
}
type FieldSchema = {
  _zod?: {
    def?: {
      type?: string
      innerType?: FieldSchema
      shape?: Record<string, FieldSchema>
      element?: FieldSchema
      items?: FieldSchema[]
      entries?: Record<string, string>
      defaultValue?: unknown
      valueType?: FieldSchema
    }
  }
}
function unwrap(schema: FieldSchema | undefined): FieldSchema | undefined {
  const inner = schema?._zod?.def?.innerType
  return inner ? unwrap(inner) : schema
}
function PropertyValue({
  name,
  value,
  schema,
  onChange,
  literalName = false,
}: {
  name: string
  value: unknown
  schema?: FieldSchema
  onChange: (value: unknown) => void
  literalName?: boolean
}) {
  const { label, locale } = useI18n(),
    [open, setOpen] = useState(false),
    [draft, setDraft] = useState(typeof value === 'string' ? value : '')
  useEffect(() => {
    setDraft(typeof value === 'string' ? value : '')
  }, [value])
  const title = literalName
      ? name
      : locale === 'zh-CN' && Object.hasOwn(propertyLabels, name)
        ? propertyLabels[name]!
        : label(prettifyKey(name)),
    def = unwrap(schema)?._zod?.def
  if (typeof value === 'number')
    return <CameraNumber label={title} value={value} onChange={onChange} />
  if (typeof value === 'boolean')
    return (
      <label className="flex items-center justify-between py-1">
        {title}
        <input
          aria-label={title}
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
        />
      </label>
    )
  if (typeof value === 'string') {
    const options = def?.entries ? Object.values(def.entries) : null
    return (
      <label className="flex items-center justify-between gap-2 py-1">
        <span>{title}</span>
        {options ? (
          <select
            aria-label={title}
            className="max-w-40 rounded border border-border bg-background p-1"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            {options.map((v) => (
              <option key={v} value={v}>
                {locale === 'zh-CN' && Object.hasOwn(enumLabels, v)
                  ? enumLabels[v]
                  : label(prettifyKey(v))}
              </option>
            ))}
          </select>
        ) : (
          <input
            aria-label={title}
            className="w-36 rounded border border-border bg-background p-1"
            type={/^#[\da-f]{6}$/i.test(value) ? 'color' : 'text'}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              if (e.target.type === 'color') onChange(e.target.value)
            }}
            onBlur={() => {
              if (draft !== value) onChange(draft)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
          />
        )}
      </label>
    )
  }
  if (value && typeof value === 'object')
    return (
      <details
        onToggle={(e) => setOpen(e.currentTarget.open)}
        className="border-l border-border pl-2"
      >
        <summary className="cursor-pointer py-1">{title}</summary>
        {open &&
          Object.entries(value).map(([key, child]) => (
            <PropertyValue
              key={key}
              name={key}
              value={child}
              literalName={def?.type === 'record'}
              schema={
                Array.isArray(value)
                  ? (def?.items?.[Number(key)] ?? def?.element)
                  : def?.type === 'record'
                    ? def.valueType
                    : def?.shape?.[key]
              }
              onChange={(next) => {
                const copy = Array.isArray(value) ? [...value] : { ...value }
                ;(copy as Record<string, unknown>)[key] = next
                onChange(copy)
              }}
            />
          ))}
      </details>
    )
  return (
    <label className="flex items-center justify-between py-1">
      {title}
      <input
        aria-label={title}
        className="w-36 rounded border border-border bg-background p-1"
        placeholder="—"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft) onChange(def?.type === 'number' ? Number(draft) : draft)
        }}
      />
    </label>
  )
}
/** The same key recorder covers plugin and nested properties, not a hardcoded transform whitelist. */
export function MotionAdditionalProperties({ node }: { node: AnyNode }) {
  const zh = useI18n().locale === 'zh-CN',
    [error, setError] = useState(''),
    [open, setOpen] = useState(false)
  const definition = nodeRegistry.get(node.type)
  const declared = new Set(
    definition?.parametrics?.groups.flatMap((group) => group.fields.map((f) => String(f.key))) ??
      [],
  )
  const fields = Object.entries(node).filter(
    ([key]) =>
      isMotionProperty(key) &&
      !declared.has(key) &&
      !['position', 'rotation', 'scale', 'object', 'camera', 'metadata'].includes(key),
  )
  const shape = unwrap(definition?.schema as unknown as FieldSchema)?._zod?.def?.shape
  return (
    <details
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="space-y-2 border-t border-border p-2"
    >
      <summary className="cursor-pointer">{zh ? '更多属性' : 'More properties'}</summary>
      {error && (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      )}
      {open &&
        fields.map(([key, value]) => (
          <PropertyValue
            key={key}
            name={key}
            value={value}
            schema={shape?.[key]}
            onChange={(value) => {
              const current = getEffectiveNode(useScene.getState().nodes[node.id] ?? node)
              const patch = { [key]: value },
                result = definition?.schema.safeParse({ ...current, ...patch })
              if (result && !result.success) {
                setError(
                  zh
                    ? '此属性值无效，请检查数值范围或格式。'
                    : 'Invalid value. Check its range or format.',
                )
                return
              }
              setError('')
              useScene.getState().updateNode(node.id, patch as Partial<AnyNode>)
            }}
          />
        ))}
    </details>
  )
}
