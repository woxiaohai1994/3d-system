'use client'

import * as Popover from '@radix-ui/react-popover'
import { Command } from 'cmdk'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ModelRecord } from '@/lib/model-assets/contracts'
import {
  categoryCounts,
  categoryIcons,
  categoryPath,
  categoryPathLabel,
  type ModelCategory,
} from '@/lib/model-assets/taxonomy'
import { ModelCategoryTree } from './model-category-tree'
import { useModelLibrary } from './model-library-provider'

function CategoryPicker({
  label,
  options,
  counts,
  selected,
  onSelect,
}: {
  label: string
  options: ModelCategory[]
  counts: Map<string, number>
  selected: string
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const { taxonomy } = useModelLibrary()
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent"
        >
          {label.startsWith('切换') ? (
            <ChevronDown size={12} />
          ) : (
            <>
              <Search size={12} />
              {label}
            </>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-[140] w-72 max-w-[90vw] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl"
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Command label={label}>
            <Command.Input
              placeholder="搜索分类或路径…"
              aria-label="搜索分类"
              className="w-full border-b border-border bg-transparent px-3 py-2.5 text-xs outline-none"
            />
            <Command.List className="max-h-64 overflow-y-auto p-1">
              <Command.Empty className="p-3 text-xs text-muted-foreground">
                没有匹配的分类
              </Command.Empty>
              {options.map((node) => (
                <Command.Item
                  key={node.id}
                  value={node.id}
                  keywords={[node.name, categoryPathLabel(taxonomy.nodes, node.id)]}
                  onSelect={() => {
                    onSelect(node.id)
                    setOpen(false)
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs data-[selected=true]:bg-accent"
                >
                  <img src={categoryIcons[node.icon]} alt="" className="h-5 w-5" />
                  <span className="min-w-0 flex-1">
                    <span className={selected === node.id ? 'font-semibold' : ''}>{node.name}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                      {categoryPathLabel(taxonomy.nodes, node.id)}
                    </span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {counts.get(node.id) ?? 0}
                  </span>
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function ModelCategoryBrowser({
  selected,
  onSelect,
  status,
}: {
  selected: string
  onSelect: (id: string) => void
  status: ModelRecord['status']
}) {
  const { taxonomy, records } = useModelLibrary()
  const nodes = taxonomy.nodes
  const path = categoryPath(nodes, selected)
  const roots = nodes.filter((n) => n.parentId === null)
  const children = nodes.filter((n) => n.parentId === selected)
  const counts = useMemo(() => categoryCounts(nodes, records, status), [nodes, records, status])
  const total = records.filter((r) => r.status === status).length
  return (
    <div role="group" className="space-y-2" aria-label="浏览模型分类">
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          aria-pressed={selected === 'all'}
          onClick={() => onSelect('all')}
          className="rounded px-1 py-1 text-xs hover:bg-accent"
        >
          全部模型 <span className="text-muted-foreground tabular-nums">{total}</span>
        </button>
        <div className="flex items-center">
          <CategoryPicker
            label="查找分类"
            options={nodes}
            counts={counts}
            selected={selected}
            onSelect={onSelect}
          />
          <ModelCategoryTree selected={selected} onSelect={onSelect} status={status} />
        </div>
      </div>
      <div
        role="group"
        aria-label="模型大分类"
        className="grid gap-1"
        style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(76px,1fr))' }}
      >
        {roots.map((root) => (
          <button
            key={root.id}
            type="button"
            aria-pressed={path[0]?.id === root.id}
            aria-label={`${root.name}，${counts.get(root.id) ?? 0} 个模型`}
            title={`${root.name}（包含下级模型）`}
            onClick={() => onSelect(root.id)}
            className={`flex min-w-0 items-center justify-center gap-0.5 rounded-md px-0.5 py-2 text-[10px] ${path[0]?.id === root.id ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-accent'}`}
          >
            <img
              src={categoryIcons[root.icon]}
              alt=""
              className="h-4 w-4 shrink-0 object-contain"
            />
            <span className="truncate">{root.name}</span>
            <span className="text-[9px] tabular-nums text-muted-foreground">
              {counts.get(root.id) ?? 0}
            </span>
          </button>
        ))}
      </div>
      {path.length > 0 && (
        <nav
          aria-label="当前分类路径"
          className="flex min-w-0 items-center gap-0.5 border-t border-border/50 pt-2"
        >
          {path.map((node, index) => (
            <div key={node.id} className="flex min-w-0 items-center">
              {index > 0 && <ChevronRight size={11} className="shrink-0 text-muted-foreground" />}
              <button
                type="button"
                aria-current={node.id === selected ? 'location' : undefined}
                title={node.name}
                onClick={() => onSelect(node.id)}
                className="min-w-0 truncate rounded px-1 py-1 text-[11px] hover:bg-accent"
              >
                {node.name}{' '}
                <span className="tabular-nums text-muted-foreground">
                  {counts.get(node.id) ?? 0}
                </span>
              </button>
              <CategoryPicker
                label={`切换${node.name}的同级分类`}
                options={nodes.filter((n) => n.parentId === node.parentId)}
                counts={counts}
                selected={selected}
                onSelect={onSelect}
              />
            </div>
          ))}
        </nav>
      )}
      {children.length > 0 && (
        <div role="group" aria-label="下级分类" className="flex items-center gap-1 overflow-hidden">
          <span className="shrink-0 rounded bg-muted px-2 py-1 text-[11px]">
            全部 {counts.get(selected) ?? 0}
          </span>
          {children.slice(0, 2).map((node) => (
            <button
              key={node.id}
              type="button"
              onClick={() => onSelect(node.id)}
              title={node.name}
              className="flex min-w-0 items-center gap-1 rounded border border-border/70 px-2 py-1 text-[11px] hover:bg-accent"
            >
              <span className="truncate">{node.name}</span>
              <span className="tabular-nums text-muted-foreground">{counts.get(node.id) ?? 0}</span>
              <ChevronRight size={11} className="shrink-0" />
            </button>
          ))}
          {children.length > 2 && (
            <CategoryPicker
              label={`更多 (${children.length - 2})`}
              options={children}
              counts={counts}
              selected={selected}
              onSelect={onSelect}
            />
          )}
        </div>
      )}
    </div>
  )
}
