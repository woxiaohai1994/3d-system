'use client'

import * as ContextMenu from '@radix-ui/react-context-menu'
import * as Dialog from '@radix-ui/react-dialog'
import { ChevronDown, ChevronRight, FolderPlus, X } from 'lucide-react'
import { createContext, useContext, useMemo, useRef, useState } from 'react'
import { type NodeRendererProps, SimpleTree, Tree, type TreeApi } from 'react-arborist'
import type { ModelRecord } from '@/lib/model-assets/contracts'
import {
  categoryCounts,
  categoryIcons,
  categoryPath,
  categoryPathLabel,
  type ModelCategory,
  validateTaxonomy,
} from '@/lib/model-assets/taxonomy'
import { modelRequest, useModelLibrary } from './model-library-provider'

export const menuClass =
  'z-[150] min-w-40 rounded-xl border border-border bg-popover p-1.5 text-xs text-popover-foreground shadow-xl'
export const menuItemClass =
  'flex cursor-default items-center gap-2 rounded-md px-3 py-2 outline-none data-[highlighted]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-35'
type Folder = ModelCategory & { children: Folder[] }
function nested(nodes: ModelCategory[], parentId: string | null = null): Folder[] {
  return nodes
    .filter((n) => n.parentId === parentId)
    .map((n) => ({ ...n, children: nested(nodes, n.id) }))
}
function flattened(nodes: Folder[], parentId: string | null = null): ModelCategory[] {
  return nodes.flatMap(({ children, ...n }) => [{ ...n, parentId }, ...flattened(children, n.id)])
}
type Actions = {
  busy: boolean
  nodes: ModelCategory[]
  create: (parentId: string | null) => void
  move: (id: string, parentId: string | null, index: number) => Promise<void>
  canMove: (id: string, parentId: string | null, index: number) => boolean
  count: (id: string) => number
  occupied: (id: string) => boolean
}
const ActionsContext = createContext<Actions | null>(null)

function FolderRow({ node, style, dragHandle, tree }: NodeRendererProps<Folder>) {
  const actions = useContext(ActionsContext)!
  const siblings = actions.nodes.filter((n) => n.parentId === node.data.parentId)
  const index = siblings.findIndex((n) => n.id === node.id)
  const depth = categoryPath(actions.nodes, node.id).length
  const menu = (
    <>
      <ContextMenu.Item
        className={menuItemClass}
        disabled={actions.busy || depth >= 3}
        onSelect={() => actions.create(node.id)}
      >
        新建子分类{depth >= 3 ? '（已到三级）' : ''}
      </ContextMenu.Item>
      <ContextMenu.Item
        className={menuItemClass}
        disabled={actions.busy}
        onSelect={() => actions.create(node.data.parentId)}
      >
        新建同级分类
      </ContextMenu.Item>
      <ContextMenu.Item
        className={menuItemClass}
        disabled={actions.busy}
        onSelect={() => void node.edit()}
      >
        重命名
      </ContextMenu.Item>
      <ContextMenu.Separator className="my-1 h-px bg-border" />
      <ContextMenu.Item
        className={menuItemClass}
        disabled={actions.busy || index === 0}
        onSelect={() => void actions.move(node.id, node.data.parentId, index - 1)}
      >
        上移
      </ContextMenu.Item>
      <ContextMenu.Item
        className={menuItemClass}
        disabled={actions.busy || index === siblings.length - 1}
        onSelect={() => void actions.move(node.id, node.data.parentId, index + 2)}
      >
        下移
      </ContextMenu.Item>
      <ContextMenu.Item
        className={menuItemClass}
        disabled={actions.busy || !node.data.parentId}
        onSelect={() => {
          const parent = actions.nodes.find((n) => n.id === node.data.parentId)!
          const peers = actions.nodes.filter((n) => n.parentId === parent.parentId)
          void actions.move(
            node.id,
            parent.parentId,
            peers.findIndex((n) => n.id === parent.id) + 1,
          )
        }}
      >
        移出一级
      </ContextMenu.Item>
      <ContextMenu.Sub>
        <ContextMenu.SubTrigger className={menuItemClass} disabled={actions.busy}>
          移入分类
          <ChevronRight size={12} className="ml-auto" />
        </ContextMenu.SubTrigger>
        <ContextMenu.Portal>
          <ContextMenu.SubContent className={`${menuClass} max-h-72 max-w-80 overflow-auto`}>
            {actions.nodes
              .filter((n) => actions.canMove(node.id, n.id, 0))
              .map((n) => (
                <ContextMenu.Item
                  key={n.id}
                  className={menuItemClass}
                  onSelect={() => void actions.move(node.id, n.id, 0)}
                >
                  {categoryPathLabel(actions.nodes, n.id)}
                </ContextMenu.Item>
              ))}
          </ContextMenu.SubContent>
        </ContextMenu.Portal>
      </ContextMenu.Sub>
      <ContextMenu.Separator className="my-1 h-px bg-border" />
      <ContextMenu.Item
        className={`${menuItemClass} text-red-500`}
        disabled={actions.busy || !!node.children?.length || actions.occupied(node.id)}
        onSelect={() => void tree.delete(node.id)}
      >
        删除空分类
      </ContextMenu.Item>
    </>
  )
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          ref={dragHandle}
          style={style}
          className={`flex h-full items-center gap-1 rounded-lg pr-2 text-xs ${node.isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/70'} ${node.willReceiveDrop ? 'ring-1 ring-primary' : ''}`}
        >
          <button
            type="button"
            aria-label={`${node.isOpen ? '折叠' : '展开'}：${node.data.name}`}
            className="shrink-0 rounded p-1 hover:bg-accent"
            onClick={(e) => {
              e.stopPropagation()
              node.toggle()
            }}
          >
            {node.isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <img
            src={categoryIcons[node.data.icon]}
            alt=""
            className="h-7 w-7 shrink-0 object-contain"
          />
          {node.isEditing ? (
            <input
              aria-label="分类名称"
              ref={(input) => {
                input?.focus()
              }}
              defaultValue={node.data.name}
              maxLength={60}
              className="min-w-0 flex-1 rounded border border-primary bg-background px-1 py-0.5 outline-none"
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => node.reset()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Escape') node.reset()
                if (e.key === 'Enter') void node.submit(e.currentTarget.value.trim())
              }}
            />
          ) : (
            <span
              className="min-w-0 flex-1 truncate"
              title={categoryPathLabel(actions.nodes, node.id)}
            >
              {node.data.name}
            </span>
          )}
          <span className="text-[10px] tabular-nums opacity-50">{actions.count(node.id)}</span>
          <span className="sr-only">右键管理分类</span>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuClass}>{menu}</ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

export function ModelCategoryTree({
  selected,
  onSelect,
  status,
}: {
  selected: string
  status: ModelRecord['status']
  onSelect: (id: string) => void
}) {
  const library = useModelLibrary()
  const api = useRef<TreeApi<Folder>>(null)
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [managing, setManaging] = useState(false)
  const totals = useMemo(
    () => categoryCounts(library.taxonomy.nodes, library.records, status),
    [library.taxonomy, library.records, status],
  )
  const data = useMemo(() => nested(library.taxonomy.nodes), [library.taxonomy])
  function changed(mutator: (tree: SimpleTree<Folder>) => void) {
    const tree = new SimpleTree(structuredClone(data))
    mutator(tree)
    const nodes = flattened(tree.data)
    validateTaxonomy(nodes)
    return nodes
  }
  async function commit(mutator: (tree: SimpleTree<Folder>) => void) {
    if (lock.current) return false
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const nodes = changed(mutator)
      await modelRequest('/api/model-assets/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: library.taxonomy.revision, nodes }),
      })
      await library.refresh()
      if (selected !== 'all' && !nodes.some((n) => n.id === selected)) onSelect('all')
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : '分类保存失败。')
      await library.refresh().catch(() => {})
      return false
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  function canMove(id: string, parentId: string | null, index: number) {
    if (
      id === parentId ||
      categoryPath(library.taxonomy.nodes, parentId ?? '').some((n) => n.id === id)
    )
      return false
    try {
      changed((t) => t.move({ id, parentId, index }))
      return true
    } catch {
      return false
    }
  }
  async function move(id: string, parentId: string | null, index: number) {
    if (!canMove(id, parentId, index)) {
      setError('移动后会超过三级，或目标是自身的子分类。')
      return
    }
    await commit((t) => t.move({ id, parentId, index }))
  }
  const count = (id: string) => totals.get(id) ?? 0
  const occupied = (id: string) =>
    library.records.some((r) =>
      categoryPath(library.taxonomy.nodes, r.metadata.category).some((n) => n.id === id),
    )
  const create = (parentId: string | null) => {
    void api.current?.create({
      type: 'internal',
      parentId,
      index: library.taxonomy.nodes.filter((n) => n.parentId === parentId).length,
    })
  }
  return (
    <Dialog.Root open={managing} onOpenChange={setManaging}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="shrink-0 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
        >
          管理分类
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/50" />
        <Dialog.Content
          aria-describedby="category-manager-description"
          onKeyDown={(e) => e.stopPropagation()}
          className="fixed left-1/2 top-1/2 z-[110] w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background p-5 text-foreground shadow-2xl"
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold">管理模型分类</Dialog.Title>
            <Dialog.Close aria-label="关闭分类管理" className="rounded p-2 hover:bg-accent">
              <X size={16} />
            </Dialog.Close>
          </div>
          <Dialog.Description
            id="category-manager-description"
            className="mb-4 text-xs text-muted-foreground"
          >
            拖动调整层级和顺序，右键新建、重命名或移动。最多三级，保存后同步模型库与 AI。
          </Dialog.Description>
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => create(null)}
              className="flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs hover:bg-accent"
            >
              <FolderPlus size={14} />
              新建大分类
            </button>
            <button
              type="button"
              disabled={
                busy ||
                selected === 'all' ||
                categoryPath(library.taxonomy.nodes, selected).length >= 3
              }
              onClick={() => create(selected)}
              className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-accent disabled:opacity-40"
            >
              新建子分类
            </button>
          </div>
          <ActionsContext.Provider
            value={{ busy, nodes: library.taxonomy.nodes, create, move, canMove, count, occupied }}
          >
            <div onKeyDown={(e) => e.stopPropagation()}>
              <Tree
                ref={api}
                data={data}
                width="100%"
                height={Math.min(360, Math.max(108, library.taxonomy.nodes.length * 36))}
                rowHeight={36}
                indent={16}
                openByDefault
                disableMultiSelection
                selectionFollowsFocus
                selection={selected === 'all' ? undefined : selected}
                disableEdit={busy}
                disableDrag={busy}
                aria-label="模型分类目录"
                onSelect={(nodes) => {
                  if (nodes[0]) onSelect(nodes[0].id)
                }}
                disableDrop={({ parentNode, dragNodes, index }) =>
                  busy ||
                  dragNodes.some(
                    (n) => !canMove(n.id, parentNode.isRoot ? null : parentNode.id, index),
                  )
                }
                onMove={async ({ dragIds, parentId, index }) => {
                  if (dragIds[0]) await move(dragIds[0], parentId, index)
                }}
                onRename={async ({ id, name }) => {
                  await commit((t) => t.update({ id, changes: { name: name.trim() } }))
                }}
                onCreate={async ({ parentId, index }) => {
                  const parent = library.taxonomy.nodes.find((n) => n.id === parentId)
                  let name = '新分类',
                    i = 2
                  while (
                    library.taxonomy.nodes.some((n) => n.parentId === parentId && n.name === name)
                  )
                    name = `新分类 ${i++}`
                  const folder: Folder = {
                    id: `cat_${crypto.randomUUID().replaceAll('-', '')}`,
                    name,
                    parentId,
                    icon: parent?.icon ?? 'furniture',
                    children: [],
                  }
                  return (await commit((t) => t.create({ parentId, index, data: folder })))
                    ? folder
                    : null
                }}
                onDelete={async ({ ids }) => {
                  if (
                    ids.some(
                      (id) => library.taxonomy.nodes.some((n) => n.parentId === id) || occupied(id),
                    )
                  ) {
                    setError('请先移走模型和子分类，再删除空分类。')
                    return
                  }
                  await commit((t) => {
                    for (const id of ids) t.drop({ id })
                  })
                }}
              >
                {FolderRow}
              </Tree>
            </div>
          </ActionsContext.Provider>
          {error && (
            <p role="alert" className="mt-2 text-xs text-red-500">
              {error}
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
