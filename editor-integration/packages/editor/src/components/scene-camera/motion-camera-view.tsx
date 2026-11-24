'use client'

import type { SceneCameraNode } from '@pascal-app/core'
import { useI18n } from '../../i18n'
import { useSceneAnimation } from '../scene-animation/store'
import { useObjectMotion } from './motion-object-store'
import { leaveMotionCameraView, selectMotionCamera } from './motion-state'
import { editCameraRig } from './rig-state'

export function MotionCameraView({ node }: { node: SceneCameraNode }) {
  const zh = useI18n().locale === 'zh-CN',
    state = useSceneAnimation()
  const editingObject = useObjectMotion((s) => !!s.nodeId)
  const locked = state.lockedIds.includes(node.id)
  return (
    <section
      aria-label={zh ? '相机视角编辑' : 'Camera view editing'}
      className="pointer-events-none absolute top-28 left-3 z-50 flex max-w-[calc(100%-24px)] items-center gap-2 rounded border border-border bg-background px-3 py-2 text-xs"
    >
      <strong>{node.name}</strong>
      <span className="text-blue-400">
        {state.playing
          ? zh
            ? '播放中'
            : 'Playing'
          : locked
            ? zh
              ? '相机轨道已锁定'
              : 'Camera track locked'
            : editingObject
              ? zh
                ? '物品编辑中'
                : 'Editing object'
              : zh
                ? '观看中'
                : 'Viewing'}
      </span>
      {editingObject && !state.playing && !locked && (
        <button
          className="pointer-events-auto rounded border border-border px-2 py-1"
          onClick={() => selectMotionCamera(node.id)}
        >
          {zh ? '调整此相机' : 'Adjust camera'}
        </button>
      )}
      {!editingObject && !state.playing && !locked && (
        <button
          className="pointer-events-auto rounded border border-border px-2 py-1"
          onClick={() => editCameraRig(node)}
        >
          {zh ? '编辑相机架' : 'Edit camera rig'}
        </button>
      )}
      <button
        className="pointer-events-auto ml-auto rounded border border-border px-2 py-1"
        onClick={leaveMotionCameraView}
      >
        {zh ? '自由视角' : 'Free view'}
      </button>
    </section>
  )
}
