import { useScene } from '@pascal-app/core'
import { Trash2 } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useSceneAnimation } from '../scene-animation/store'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../ui/primitives/context-menu'
import { cameraDeletionBlocked, deleteSceneCamera } from './delete-camera'
import { useObjectMotion } from './motion-object-store'

export function DeleteCameraButton({
  id,
  name,
  showLabel = false,
}: {
  id: string
  name?: string
  showLabel?: boolean
}) {
  const zh = useI18n().locale === 'zh-CN'
  useScene((state) => state.readOnly)
  useSceneAnimation()
  useObjectMotion((state) => state.draft)
  const label = `${zh ? '删除相机' : 'Delete camera'}${name ? ` ${name}` : ''}`
  return (
    <button
      type="button"
      className={`flex shrink-0 items-center justify-center gap-1.5 rounded text-xs text-muted-foreground hover:bg-accent hover:text-red-400 disabled:opacity-40 ${showLabel ? 'h-8 px-2' : 'h-6 w-7'}`}
      aria-label={label}
      title={`${label} · ${zh ? '可撤销' : 'Undo available'}`}
      disabled={cameraDeletionBlocked()}
      onClick={() => deleteSceneCamera(id)}
    >
      <Trash2 size={14} />
      {showLabel && (zh ? '删除相机' : 'Delete camera')}
    </button>
  )
}

export function CameraTab({
  id,
  name,
  selected,
  onSelect,
}: {
  id: string
  name: string
  selected: boolean
  onSelect: () => void
}) {
  const zh = useI18n().locale === 'zh-CN'
  useScene((state) => state.readOnly)
  useSceneAnimation()
  useObjectMotion((state) => state.draft)
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={`flex shrink-0 items-center rounded-md border border-border ${selected ? 'bg-accent text-sky-300' : ''}`}
        >
          <button
            type="button"
            aria-pressed={selected}
            title={name}
            className="max-w-32 truncate px-2 py-1.5 text-xs hover:bg-accent"
            onClick={onSelect}
          >
            {name}
          </button>
          <DeleteCameraButton id={id} name={name} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="z-[100]">
        <ContextMenuItem
          variant="destructive"
          disabled={cameraDeletionBlocked()}
          onSelect={() => deleteSceneCamera(id)}
        >
          {zh ? '删除相机' : 'Delete camera'}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
