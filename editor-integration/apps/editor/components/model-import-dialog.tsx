'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Box, Check, Ruler, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  type ModelMetadata,
  type ModelRecord,
  type ModelSuggestion,
  modelMetadataSchema,
  recordTransform,
} from '@/lib/model-assets/contracts'
import { categoryPathLabel } from '@/lib/model-assets/taxonomy'
import { useAIConfiguration } from './ai-panel'
import { ModelImportPreview } from './model-import-preview'
import { modelRequest, useModelLibrary } from './model-library-provider'

const fields = ['name', 'englishName', 'category', 'mounting', 'description', 'tags'] as const
const labels = {
  name: '模型名称',
  englishName: '英文别名',
  category: '分类',
  mounting: '安装方式',
  description: '用途说明',
  tags: '搜索标签',
}
const mounts = { floor: '落地', 'wall-side': '挂墙', ceiling: '吊顶' }
const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
const buttonClass =
  'rounded-md border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50'

export function ModelImportDialog({
  record,
  onClose,
}: {
  record: ModelRecord
  onClose: (published?: ModelRecord) => void
}) {
  const capture = useRef<(() => string) | null>(null)
  const abort = useRef<AbortController | null>(null)
  const ai = useAIConfiguration()
  const library = useModelLibrary()
  const [metadata, setMetadata] = useState<ModelMetadata>(record.metadata)
  const [tagsText, setTagsText] = useState(record.metadata.tags.join(', '))
  const [suggestion, setSuggestion] = useState<ModelSuggestion | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set(fields))
  const [busy, setBusy] = useState<'ai' | 'save' | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState<'info' | 'placement' | 'ai'>('info')
  useEffect(() => {
    return () => {
      abort.current?.abort()
    }
  }, [])
  const dimensions = recordTransform(record, metadata).dimensions
  const update = <K extends keyof ModelMetadata>(key: K, value: ModelMetadata[K]) => {
    setMetadata((previous) => ({ ...previous, [key]: value }))
    setSuggestion(null)
    setNotice('')
  }
  async function analyze() {
    if (!ai?.selection.profileId) {
      setError('请先在 AI 助手中保存并选择配置。也可以直接手动填写入库。')
      return
    }
    setBusy('ai')
    setError('')
    setNotice('')
    setSuggestion(null)
    abort.current = new AbortController()
    try {
      const result = await modelRequest('/api/ai/assets/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abort.current.signal,
        body: JSON.stringify({
          id: record.id,
          revision: record.revision,
          metadata,
          ...ai.selection,
        }),
      })
      setSuggestion(result.suggestion)
      setSelected(new Set(fields))
    } catch (e) {
      setError(
        abort.current.signal.aborted
          ? '已取消 AI 分析，仍可手动填写。'
          : e instanceof Error
            ? e.message
            : 'AI 分析失败。',
      )
    } finally {
      setBusy(null)
    }
  }
  async function publish() {
    setError('')
    const parsed = modelMetadataSchema.safeParse(metadata)
    if (!parsed.success) {
      setError('请检查名称、标签、分类和尺寸校正。')
      return
    }
    if (!capture.current) {
      setError('请等待模型预览成功后再入库。')
      return
    }
    setBusy('save')
    try {
      const result = await modelRequest(`/api/model-assets/${record.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revision: record.revision,
          metadata: parsed.data,
          thumbnail: capture.current(),
        }),
      })
      await library.refresh().catch(() => {})
      onClose(result.record)
    } catch (e) {
      setError(e instanceof Error ? e.message : '入库失败。')
    } finally {
      setBusy(null)
    }
  }
  function display(key: (typeof fields)[number], value: unknown): string {
    if (key === 'category')
      return categoryPathLabel(library.taxonomy.nodes, String(value)) || String(value)
    if (key === 'mounting') return mounts[value as keyof typeof mounts] ?? String(value)
    return Array.isArray(value) ? value.join('、') : String(value || '未填写')
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && busy !== 'save') onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => {
            if (busy === 'save') e.preventDefault()
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className="fixed left-1/2 top-1/2 z-[130] max-h-[92vh] w-[min(1000px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-border bg-background p-0 text-foreground shadow-2xl"
        >
          <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-muted p-2.5">
                <Box size={20} strokeWidth={1.5} />
              </div>
              <div>
                <Dialog.Title className="text-base font-semibold">
                  {record.status === 'published' ? '编辑模型' : '导入模型'}
                </Dialog.Title>
                <p className="mt-0.5 text-xs text-muted-foreground">{record.metadata.name}</p>
              </div>
            </div>
            <button
              type="button"
              aria-label="关闭导入"
              disabled={busy === 'save'}
              className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
              onClick={() => onClose()}
            >
              <X size={18} />
            </button>
          </header>
          <div className="grid max-h-[calc(92vh-156px)] overflow-y-auto md:grid-cols-[42%_58%]">
            <aside className="space-y-4 border-b border-border/60 bg-muted/10 p-5 md:border-b-0 md:border-r">
              <ModelImportPreview record={record} metadata={metadata} capture={capture} />
              <div className="grid grid-cols-3 divide-x divide-border rounded-xl border border-border/60 bg-background py-3">
                {['宽', '高', '深'].map((label, i) => (
                  <div key={label} className="text-center">
                    <p className="text-[11px] text-muted-foreground">{label} / cm</p>
                    <p className="mt-1 text-base font-medium tabular-nums">
                      {(dimensions[i]! * 100).toFixed(2)}
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {record.baseAsset
                  ? '尺寸来自目录，可在“尺寸与安装”中校正。'
                  : '请核对实物尺寸与文件单位。'}
              </p>
              <details className="rounded-xl border border-border/60 px-3 py-2.5 text-xs text-muted-foreground">
                <summary className="cursor-pointer">模型文件与检测信息</summary>
                <div className="mt-3 space-y-2 break-words">
                  <p>
                    {record.filename}
                    {record.bytes > 0 ? ` · ${(record.bytes / 1024).toFixed(1)} KB` : ''}
                  </p>
                  <p>部件：{record.facts.meshNames.join('、') || '目录未提供'}</p>
                  <p>材质名称：{record.facts.materials.join('、') || '目录未提供'}</p>
                  <p>三角形：{record.baseAsset ? '未重新检测' : record.facts.triangleCount}</p>
                  {record.facts.warnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                </div>
              </details>
            </aside>
            <section className="min-w-0 p-5">
              <div
                role="tablist"
                aria-label="模型编辑"
                className="mb-5 flex gap-1 rounded-lg bg-muted/50 p-1"
              >
                {(
                  [
                    { id: 'info', label: '基本信息', icon: Box },
                    { id: 'placement', label: '尺寸与安装', icon: Ruler },
                    { id: 'ai', label: 'AI 校正', icon: Sparkles },
                  ] as const
                ).map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    role="tab"
                    aria-selected={tab === t.id}
                    onClick={() => setTab(t.id)}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs ${tab === t.id ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    <t.icon size={14} />
                    {t.label}
                  </button>
                ))}
              </div>
              {tab === 'info' && (
                <fieldset disabled={!!busy} className="space-y-4">
                  <label className="block text-xs font-medium">
                    模型名称
                    <input
                      className={`${inputClass} mt-1.5`}
                      value={metadata.name}
                      maxLength={120}
                      onChange={(e) => update('name', e.target.value)}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs font-medium">
                      英文别名
                      <input
                        className={`${inputClass} mt-1.5`}
                        value={metadata.englishName}
                        maxLength={120}
                        onChange={(e) => update('englishName', e.target.value)}
                      />
                    </label>
                    <label className="block text-xs font-medium">
                      分类
                      <select
                        aria-label="分类"
                        className={`${inputClass} mt-1.5`}
                        value={metadata.category}
                        onChange={(e) =>
                          update('category', e.target.value as ModelMetadata['category'])
                        }
                      >
                        {library.taxonomy.nodes.map((n) => (
                          <option key={n.id} value={n.id}>
                            {categoryPathLabel(library.taxonomy.nodes, n.id)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="block text-xs font-medium">
                    用途说明
                    <textarea
                      className={`${inputClass} mt-1.5 resize-none`}
                      rows={3}
                      maxLength={1200}
                      placeholder="说明用途、使用场景或需要保留的特征"
                      value={metadata.description}
                      onChange={(e) => update('description', e.target.value)}
                    />
                  </label>
                  <label className="block text-xs font-medium">
                    搜索标签
                    <input
                      className={`${inputClass} mt-1.5`}
                      value={tagsText}
                      placeholder="中英文均可，用逗号分隔"
                      onChange={(e) => {
                        setTagsText(e.target.value)
                        update(
                          'tags',
                          e.target.value
                            .split(/[,，]/)
                            .map((s) => s.trim())
                            .filter(Boolean),
                        )
                      }}
                    />
                  </label>
                </fieldset>
              )}
              {tab === 'placement' && (
                <fieldset disabled={!!busy} className="space-y-5">
                  <label className="block text-xs font-medium">
                    安装方式
                    <select
                      className={`${inputClass} mt-1.5`}
                      aria-label="安装方式"
                      value={metadata.mounting}
                      onChange={(e) =>
                        update('mounting', e.target.value as ModelMetadata['mounting'])
                      }
                    >
                      {Object.entries(mounts).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs font-medium">
                      实际宽度（厘米）
                      <input
                        aria-label="实际宽度（厘米）"
                        className={`${inputClass} mt-1.5`}
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={Number((dimensions[0] * 100).toFixed(3))}
                        onChange={(e) => {
                          const width = Number(e.target.value)
                          if (width > 0)
                            update(
                              'unitScale',
                              (metadata.unitScale * width) / (dimensions[0] * 100),
                            )
                        }}
                      />
                    </label>
                    <label className="block text-xs font-medium">
                      正面方向
                      <select
                        aria-label="正面方向"
                        className={`${inputClass} mt-1.5`}
                        value={metadata.rotationY}
                        onChange={(e) =>
                          update('rotationY', Number(e.target.value) as ModelMetadata['rotationY'])
                        }
                      >
                        {[0, 90, 180, 270].map((angle) => (
                          <option key={angle} value={angle}>
                            {angle}°
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="block text-xs font-medium">
                    {record.baseAsset ? '相对原模型比例' : '文件单位'}
                    <select
                      aria-label="文件单位"
                      className={`${inputClass} mt-1.5`}
                      value={
                        [1, 0.01, 0.001].includes(metadata.unitScale)
                          ? metadata.unitScale
                          : 'custom'
                      }
                      onChange={(e) => update('unitScale', Number(e.target.value))}
                    >
                      <option value="1">{record.baseAsset ? '保持原始比例' : '米'}</option>
                      <option value="0.01">{record.baseAsset ? '缩小至 1%' : '厘米'}</option>
                      <option value="0.001">{record.baseAsset ? '缩小至 0.1%' : '毫米'}</option>
                      <option value="custom" disabled>
                        按实际宽度校正
                      </option>
                    </select>
                  </label>
                  <p className="rounded-xl bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                    调整宽度会等比例缩放整个模型。已有场景中的物件保留原资料，新的放置使用这里保存的设置。
                  </p>
                </fieldset>
              )}
              {tab === 'ai' && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      根据模型资料建议分类、标签及用途，应用后需保存。
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        className={buttonClass}
                        type="button"
                        disabled={!!busy}
                        onClick={analyze}
                      >
                        AI 检查并建议校正
                      </button>
                      {busy === 'ai' && (
                        <button
                          className={buttonClass}
                          type="button"
                          onClick={() => abort.current?.abort()}
                        >
                          取消分析
                        </button>
                      )}
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {busy === 'ai'
                        ? '正在分析…'
                        : ai?.selection.model
                          ? `使用 ${ai.selection.model} · 资料分析，非视觉识别`
                          : '请先在 AI 助手中选择配置；也可直接手动填写'}
                    </p>
                  </div>
                  {suggestion && (
                    <section aria-label="AI 校正建议" className="space-y-3">
                      <h3 className="text-sm font-semibold">选择要采用的建议</h3>
                      {fields.map((key) => (
                        <label
                          key={key}
                          className="flex gap-3 rounded-lg border border-border/60 p-3 text-xs"
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={selected.has(key)}
                            onChange={(e) =>
                              setSelected((previous) => {
                                const next = new Set(previous)
                                if (e.target.checked) next.add(key)
                                else next.delete(key)
                                return next
                              })
                            }
                          />
                          <span className="min-w-0 space-y-1">
                            <b className="block">{labels[key]}</b>
                            <span className="block break-words text-muted-foreground">
                              {display(key, metadata[key])}
                            </span>
                            <span className="block break-words">
                              → {display(key, suggestion[key])}
                            </span>
                          </span>
                        </label>
                      ))}
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer">查看判断依据</summary>
                        <ul className="mt-2 space-y-1">
                          {suggestion.reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      </details>
                      {suggestion.questions.length > 0 && (
                        <div className="rounded-lg bg-amber-500/10 p-3 text-xs leading-relaxed">
                          <p className="mb-2 font-medium">仍需核对</p>
                          {suggestion.questions.map((question) => (
                            <p key={question} className="mt-1">
                              {question}
                            </p>
                          ))}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={buttonClass}
                          onClick={() => {
                            const next = { ...metadata }
                            for (const key of fields)
                              if (selected.has(key)) Object.assign(next, { [key]: suggestion[key] })
                            setMetadata(next)
                            setTagsText(next.tags.join(', '))
                            setSuggestion(null)
                            setTab('info')
                            setNotice('已应用建议。请检查最终资料，再确认保存。')
                          }}
                        >
                          应用选中建议
                        </button>
                        <button
                          type="button"
                          className={buttonClass}
                          onClick={() => setSuggestion(null)}
                        >
                          保留原资料
                        </button>
                      </div>
                    </section>
                  )}
                </div>
              )}
              {error && (
                <p role="alert" className="mt-4 rounded-lg bg-red-500/10 p-3 text-xs text-red-500">
                  {error}
                </p>
              )}
              {notice && (
                <p
                  role="status"
                  className="mt-4 flex gap-2 rounded-lg bg-emerald-500/10 p-3 text-xs"
                >
                  <Check size={14} className="shrink-0" />
                  {notice}
                </p>
              )}
            </section>
          </div>
          <footer className="flex items-center justify-between gap-4 border-t border-border/60 bg-background px-6 py-4">
            <p className="text-xs text-muted-foreground">
              {suggestion
                ? '请先审核 AI 建议'
                : record.status === 'draft'
                  ? '待入库'
                  : '仅影响后续放置'}
            </p>
            <button
              className="shrink-0 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
              type="button"
              disabled={!!busy || !!suggestion}
              onClick={publish}
            >
              {busy === 'save'
                ? '正在保存…'
                : record.status === 'published'
                  ? '保存校正'
                  : '确认入库'}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
