'use client'

import { useEditor } from '@pascal-app/editor'
import { catalogDisplayName, catalogMatchesSearch } from '@pascal-app/editor/catalog-label'
import { useI18n } from '@pascal-app/editor/i18n'
import { resolveCdnUrl, useViewer } from '@pascal-app/viewer'
import * as ContextMenu from '@radix-ui/react-context-menu'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Box,
  Check,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { MODEL_MAX_BYTES, type ModelRecord } from '@/lib/model-assets/contracts'
import { categoryPath, categoryPathLabel } from '@/lib/model-assets/taxonomy'
import { ModelCategoryBrowser } from './model-category-browser'
import { menuClass, menuItemClass } from './model-category-tree'
import { ModelImportDialog } from './model-import-dialog'
import { modelRequest, useModelLibrary } from './model-library-provider'

export function ModelLibraryPanel() {
  const library = useModelLibrary()
  const { locale } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<ModelRecord | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [section, setSection] = useState<ModelRecord['status']>('published')
  const [category, setCategory] = useState('all')
  const [searchCurrent, setSearchCurrent] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const scroll = useRef<HTMLDivElement>(null)
  const scrollPositions = useRef({ compact: 0, wide: 0 })
  const expandButton = useRef<HTMLButtonElement>(null)
  const query = search.trim()
  const filterKey = JSON.stringify([query, category, section, searchCurrent])
  const previousFilter = useRef(filterKey)
  const wide = expanded
  const attachScroll = useCallback(
    (node: HTMLDivElement | null) => {
      scroll.current = node
      if (node) node.scrollTop = scrollPositions.current[wide ? 'wide' : 'compact']
    },
    [wide],
  )
  useLayoutEffect(() => {
    if (previousFilter.current === filterKey) return
    previousFilter.current = filterKey
    scrollPositions.current = { compact: 0, wide: 0 }
    if (scroll.current) scroll.current.scrollTop = 0
  }, [filterKey])
  const [managing, setManaging] = useState(false)
  const selectedItem = useEditor((s) => s.selectedItem)
  const counts = (status: ModelRecord['status']) =>
    library.records.filter((r) => r.status === status).length
  const nameOf = (record: ModelRecord) => catalogDisplayName(locale, record.asset)
  const records = library.records.filter(
    (r) =>
      r.status === section &&
      ((query && !searchCurrent) ||
        category === 'all' ||
        categoryPath(library.taxonomy.nodes, r.metadata.category).some((n) => n.id === category)) &&
      (!query ||
        catalogMatchesSearch(r.asset, query) ||
        r.metadata.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
  )

  async function upload(file: File) {
    setError('')
    setNotice('')
    if (!file.name.toLowerCase().endsWith('.glb') || file.size > MODEL_MAX_BYTES) {
      setError('请选择 GLB 文件，大小不超过 200 MB。')
      return
    }
    setBusy(true)
    try {
      const result = (await modelRequest('/api/model-assets', {
        method: 'POST',
        headers: {
          'Content-Type': 'model/gltf-binary',
          'X-Model-Filename': encodeURIComponent(file.name),
        },
        body: file,
      })) as { record: ModelRecord; duplicate: boolean }
      await library.refresh()
      if (result.record.status === 'deleted') {
        setSection('deleted')
        setCategory('all')
        setSearch(result.record.metadata.name)
        setNotice('这个模型在回收站中，恢复后即可继续使用。')
      } else {
        if (result.duplicate) setNotice('已找到相同模型，可继续编辑，无需重复入库。')
        setDraft(result.record)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '模型导入失败。')
    } finally {
      setBusy(false)
    }
  }
  async function changeState(record: ModelRecord, deleted: boolean) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await modelRequest(`/api/model-assets/${record.id}/${deleted ? 'delete' : 'restore'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: record.revision }),
      })
      if (deleted && selectedItem?.id === record.id) {
        useEditor.setState({ selectedItem: null })
        useEditor.getState().setTool('select')
      }
      await library.refresh()
      setNotice(
        deleted
          ? `“${nameOf(record)}”已移至回收站，现有场景不受影响。`
          : `“${nameOf(record)}”已恢复。`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败。')
    } finally {
      setBusy(false)
    }
  }
  function place(record: ModelRecord) {
    setExpanded(false)
    useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
    const editor = useEditor.getState()
    editor.setSelectedItem(record.asset)
    editor.setTool(record.baseAsset?.tool ?? 'item')
    editor.setMode('build')
  }
  const panel = (
    <section
      className="flex h-full min-h-0 w-full flex-col"
      aria-label="模型库"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header className="shrink-0 space-y-2.5 border-b border-border/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold tracking-tight">模型库</h2>
          <div className="flex gap-2">
            <button
              ref={expandButton}
              type="button"
              aria-label={wide ? '收起模型库' : '展开模型库'}
              title={wide ? '收起模型库' : '展开模型库'}
              onClick={() => setExpanded(!wide)}
              className="rounded-lg border border-border p-2 hover:bg-accent"
            >
              {wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button
              type="button"
              title={managing ? '完成管理' : '管理模型'}
              aria-label={managing ? '完成管理' : '管理模型'}
              aria-pressed={managing}
              onClick={() => setManaging(!managing)}
              className={`rounded-lg border p-2 transition-colors ${managing ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent'}`}
            >
              {managing ? <Check size={16} /> : <SlidersHorizontal size={16} />}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => input.current?.click()}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              <Plus size={15} />
              {busy ? '处理中…' : '导入模型'}
            </button>
          </div>
        </div>
        <input
          ref={input}
          aria-label="选择 GLB 模型"
          type="file"
          accept=".glb"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void upload(file)
          }}
        />
        <div className="flex gap-1 rounded-lg bg-muted/50 p-1" role="tablist" aria-label="模型状态">
          {(
            [
              ['published', '模型'],
              ['draft', '待入库'],
              ['deleted', '回收站'],
            ] as const
          ).map(([status, label]) => (
            <button
              key={status}
              type="button"
              role="tab"
              aria-selected={section === status}
              onClick={() => {
                setSection(status)
                setCategory('all')
                setSearch('')
              }}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs transition-colors ${section === status ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {label}
              <span className="ml-1.5 opacity-50">{counts(status)}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 text-muted-foreground" size={15} />
          <input
            aria-label="搜索模型"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索名称、用途或标签"
            className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-xs outline-none focus:border-primary"
          />
        </div>
        {query && (
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span role="status">
              {searchCurrent && category !== 'all' ? '当前分类' : '整个模型库'} · 找到{' '}
              {records.length} 个
            </span>
            {category !== 'all' && (
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={searchCurrent}
                  onChange={(e) => setSearchCurrent(e.target.checked)}
                />
                仅当前分类
              </label>
            )}
          </div>
        )}
        <ModelCategoryBrowser selected={category} onSelect={setCategory} status={section} />
      </header>
      {(error || library.error) && (
        <div role="alert" className="m-3 rounded-lg bg-red-500/10 p-3 text-xs text-red-500">
          {error || library.error}
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => void library.refresh().catch(() => {})}
          >
            重试
          </button>
        </div>
      )}
      {notice && (
        <p
          role="status"
          className="mx-4 mt-3 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground"
        >
          {notice}
        </p>
      )}
      <div
        ref={attachScroll}
        role="region"
        aria-label="模型缩略图"
        onScroll={(e) => {
          scrollPositions.current[wide ? 'wide' : 'compact'] = e.currentTarget.scrollTop
        }}
        className="min-h-0 flex-1 overflow-y-auto p-3"
      >
        {section === 'deleted' && (
          <p className="mb-3 px-1 text-xs leading-relaxed text-muted-foreground">
            删除后不再供新放置或 AI 调用。已在场景中使用的模型保留，可随时恢复。
          </p>
        )}
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${wide ? 148 : 112}px,1fr))` }}
        >
          {records.map((record) => (
            <ContextMenu.Root key={record.id}>
              <ContextMenu.Trigger asChild>
                <article
                  className={`group overflow-hidden rounded-xl border transition-colors ${selectedItem?.id === record.id && section === 'published' ? 'border-primary bg-primary/5' : 'border-border/50 bg-muted/20 hover:border-border hover:bg-muted/40'}`}
                >
                  <button
                    type="button"
                    title={`${section === 'published' && !managing ? '放置' : '查看资料'}：${nameOf(record)}`}
                    aria-label={`${section === 'published' && !managing ? '放置' : '查看资料'}：${nameOf(record)}`}
                    disabled={busy || section === 'deleted'}
                    onClick={() =>
                      section === 'published' && !managing ? place(record) : setDraft(record)
                    }
                    className="w-full text-left disabled:cursor-default"
                  >
                    <div className="relative aspect-[4/3] p-2">
                      <img
                        alt={nameOf(record)}
                        src={resolveCdnUrl(record.asset.thumbnail) || ''}
                        className="h-full w-full object-contain transition-transform group-hover:scale-105"
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.visibility = 'hidden'
                        }}
                      />
                      {record.status === 'draft' && (
                        <span className="absolute left-2 top-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600">
                          待确认
                        </span>
                      )}
                    </div>
                    <div className="px-3 pb-3">
                      <p title={nameOf(record)} className="truncate text-xs font-medium">
                        {nameOf(record)}
                      </p>
                      <p
                        title={categoryPathLabel(library.taxonomy.nodes, record.metadata.category)}
                        className="mt-1 truncate text-[10px] text-muted-foreground"
                      >
                        {categoryPathLabel(library.taxonomy.nodes, record.metadata.category)}
                        <span className="mx-1.5 opacity-40">/</span>
                        {
                          { floor: '落地', 'wall-side': '挂墙', ceiling: '吊顶' }[
                            record.metadata.mounting
                          ]
                        }
                      </p>
                    </div>
                  </button>
                  {(managing || section !== 'published') && (
                    <div className="flex border-t border-border/50">
                      {section === 'deleted' ? (
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={`恢复：${nameOf(record)}`}
                          onClick={() => void changeState(record, false)}
                          className="flex flex-1 items-center justify-center gap-1.5 py-2 text-xs hover:bg-accent"
                        >
                          <RotateCcw size={13} />
                          恢复模型
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            aria-label={`编辑资料：${nameOf(record)}`}
                            disabled={busy}
                            onClick={() => setDraft(record)}
                            className="flex flex-1 items-center justify-center gap-1.5 py-2 text-xs hover:bg-accent"
                          >
                            <Pencil size={12} />
                            编辑
                          </button>
                          <button
                            type="button"
                            aria-label={`删除：${nameOf(record)}`}
                            disabled={busy}
                            onClick={() => void changeState(record, true)}
                            className="border-l border-border/50 px-3 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </article>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content className={menuClass}>
                  {section === 'deleted' ? (
                    <ContextMenu.Item
                      className={menuItemClass}
                      disabled={busy}
                      onSelect={() => void changeState(record, false)}
                    >
                      <RotateCcw size={14} />
                      恢复模型
                    </ContextMenu.Item>
                  ) : (
                    <>
                      <ContextMenu.Item
                        className={menuItemClass}
                        disabled={busy}
                        onSelect={() => setDraft(record)}
                      >
                        <Pencil size={14} />
                        编辑模型资料
                      </ContextMenu.Item>
                      <ContextMenu.Item
                        className={`${menuItemClass} text-red-500`}
                        disabled={busy}
                        onSelect={() => void changeState(record, true)}
                      >
                        <Trash2 size={14} />
                        删除模型
                      </ContextMenu.Item>
                    </>
                  )}
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          ))}
        </div>
        {!records.length && (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <Box size={28} strokeWidth={1.2} />
            <p className="text-sm">
              {search
                ? '没有找到匹配的模型'
                : section === 'deleted'
                  ? '回收站是空的'
                  : section === 'draft'
                    ? '没有待确认的模型'
                    : '暂无模型'}
            </p>
            {query && (
              <p className="max-w-48 text-xs leading-relaxed">
                {searchCurrent
                  ? '试试取消“仅当前分类”，或使用其他名称。'
                  : '试试其他名称、英文别名或用途。'}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
  return (
    <>
      <Dialog.Root open={wide} onOpenChange={setExpanded}>
        {wide ? (
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/50" />
            <Dialog.Content
              aria-describedby={undefined}
              onCloseAutoFocus={(e) => {
                e.preventDefault()
                if (!draft) expandButton.current?.focus()
              }}
              onKeyDown={(e) => e.stopPropagation()}
              className="fixed left-1/2 top-1/2 z-[90] h-[90vh] w-[min(1100px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-border bg-background text-foreground shadow-2xl"
            >
              <Dialog.Title className="sr-only">浏览模型库</Dialog.Title>
              {panel}
            </Dialog.Content>
          </Dialog.Portal>
        ) : (
          panel
        )}
        {draft && (
          <ModelImportDialog
            key={draft.id}
            record={draft}
            onClose={(published) => {
              if (published) {
                setSection('published')
                setCategory(published.metadata.category)
                setSearch('')
              }
              setDraft(null)
            }}
          />
        )}
      </Dialog.Root>
    </>
  )
}
