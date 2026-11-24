import {
  CameraMotionPoint,
  MotionKey,
  objectTracks,
  replaceAnimationTracks,
  useScene,
} from '@pascal-app/core'
import { Check, Circle, CornerDownLeft, PenTool, Play, Square, Undo2, X } from 'lucide-react'
import { useState } from 'react'
import { Vector3 } from 'three'
import { useI18n } from '../../i18n'
import { animationData, commitSceneAnimation } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { CameraNumber } from './inspector'
import { hasMotionEdits } from './motion-edit-session'
import { motionChoice } from './motion-inspector'
import { useObjectMotion } from './motion-object-store'
import { objectPose } from './motion-objects'
import { editingPathData, editingPathNode } from './motion-path-context'
import {
  cancelPathDrawing,
  finishPathDrawing,
  savePathDrawing,
  startPathDrawing,
  usePathDrawing,
} from './motion-path-drawing'
import { editMotionPath } from './motion-path-edit'
import { commitMotion, motionData, motionPreviewPose, toggleMotionPlayback } from './motion-state'
import { createDrawnTrajectory, reshapeDrawnTrajectory } from './motion-trajectory'

export function appendTrajectory(
  positions: [number, number, number][],
  duration: number,
  curves?: [number, number, number][][],
) {
  const state = useSceneAnimation.getState(),
    node = editingPathNode(),
    objectId = useObjectMotion.getState().nodeId
  if (
    !node ||
    useScene.getState().readOnly ||
    state.lockedIds.includes(node.id) ||
    hasMotionEdits() ||
    state.playing ||
    state.exporting ||
    positions.length < 2
  )
    return false
  const data = editingPathData(),
    pose = objectId ? objectPose(objectId) : motionPreviewPose()
  if (!pose) return false
  const drawing = usePathDrawing.getState()
  const resultPath =
    drawing.nodeId && drawing.segmentId
      ? reshapeDrawnTrajectory(
          data,
          drawing.segmentId,
          positions,
          animationData().fps,
          !objectId,
          curves,
        )
      : createDrawnTrajectory(
          data,
          drawing.nodeId ? (drawing.pose ?? pose) : pose,
          positions,
          drawing.nodeId ? drawing.startTime : state.time,
          duration,
          animationData().fps,
          !objectId,
          curves,
        )
  if ('error' in resultPath) {
    usePathDrawing.setState({ error: resultPath.error })
    return false
  }
  const { points, segments } = resultPath.data
  const scene = animationData()
  const result = objectId
    ? commitSceneAnimation(
        replaceAnimationTracks({ ...scene }, 'object', [
          ...objectTracks(scene).filter((t) => t.nodeId !== objectId),
          {
            nodeId: objectId,
            parentId: node.parentId,
            points: points.map((p) => MotionKey.parse(p)),
            segments,
          },
        ]),
      )
    : commitMotion({
        ...motionData(),
        points: points.map((p) => CameraMotionPoint.parse(p)),
        segments,
      })
  if (result) usePathDrawing.setState({ error: null })
  if (result)
    useSceneAnimation.setState({ segmentId: resultPath.segmentId, pointId: null, message: null })
  return result
}
export function createTrajectory(kind: 'circle' | 'square', radius: number, duration: number) {
  const id = useObjectMotion.getState().nodeId,
    pose = id ? objectPose(id) : motionPreviewPose()
  if (!pose) return false
  const origin = new Vector3(...pose.position)
  const offsets =
    kind === 'square'
      ? [
          [0, 0, 0],
          [radius * 2, 0, 0],
          [radius * 2, 0, radius * 2],
          [0, 0, radius * 2],
          [0, 0, 0],
        ]
      : [
          [0, 0, 0],
          [-radius, 0, radius],
          [-radius * 2, 0, 0],
          [-radius, 0, -radius],
          [0, 0, 0],
        ]
  const positions = offsets.map((p) =>
    origin
      .clone()
      .add(new Vector3(...p))
      .toArray(),
  )
  const curves =
    kind === 'circle'
      ? Array.from({ length: 4 }, (_, i) => {
          const a = (i * Math.PI) / 2,
            k = radius * 0.5522847498
          return [
            [-Math.sin(a) * k, 0, Math.cos(a) * k],
            [Math.sin(a + Math.PI / 2) * k, 0, -Math.cos(a + Math.PI / 2) * k],
          ] as [number, number, number][]
        })
      : undefined
  const result = appendTrajectory(positions, duration, curves)
  if (result) editMotionPath(useSceneAnimation.getState().segmentId!, true)
  return result
}
const button =
  'inline-flex min-h-8 items-center justify-center rounded px-3 py-1 hover:bg-accent focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-40'

export function MotionTrajectoryPresets({ onComplete }: { onComplete: () => void }) {
  const zh = useI18n().locale === 'zh-CN',
    state = useSceneAnimation(),
    drawing = usePathDrawing(),
    node = editingPathNode(),
    readOnly = useScene((s) => s.readOnly)
  const drawingPath = editingPathData(),
    drawingSegment = drawingPath.segments.find((s) => s.id === drawing.segmentId),
    startTime =
      drawingPath.points.find((p) => p.id === drawingSegment?.fromId)?.time ?? drawing.startTime,
    endTime =
      drawingPath.points.find((p) => p.id === drawingSegment?.toId)?.time ??
      startTime + drawing.duration
  const [radius, setRadius] = useState(2),
    [preset, setPreset] = useState<'draw' | 'circle' | 'square'>('draw')
  const disabled =
    !node ||
    readOnly ||
    state.playing ||
    state.exporting ||
    state.lockedIds.includes(node.id) ||
    hasMotionEdits()
  return (
    <div className="space-y-3">
      {drawing.nodeId ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between tabular-nums">
            <span className="text-muted-foreground">
              {startTime.toFixed(2)} {zh ? '秒' : 's'}
            </span>
            <span className="font-medium">
              {(endTime - startTime).toFixed(2)} {zh ? '秒' : 's'}
            </span>
            <span className="text-muted-foreground">
              {endTime.toFixed(2)} {zh ? '秒' : 's'}
            </span>
          </div>
          <svg viewBox="0 0 300 16" className="h-4 w-full text-sky-400" aria-hidden="true">
            <path d="M8 8H292" stroke="currentColor" strokeWidth="2" />
            <path d="m8 3 5 5-5 5-5-5Zm284 0 5 5-5 5-5-5Z" fill="currentColor" />
          </svg>
          <div className="grid grid-cols-2 divide-x divide-border border-y border-border py-2">
            <DrawingGesture kind="point" label={zh ? '单击 · 放点' : 'Click · Place'} />
            <DrawingGesture kind="curve" label={zh ? '拖动 · 调弯' : 'Drag · Curve'} />
          </div>
          <div className="flex items-center gap-2">
            <span
              role="status"
              className="mr-auto flex items-center gap-1 text-[11px] text-muted-foreground"
            >
              <Check size={12} aria-hidden="true" />
              {drawing.savedShape === JSON.stringify([drawing.points, drawing.tangents])
                ? zh
                  ? '已保存'
                  : 'Saved'
                : zh
                  ? '编辑中'
                  : 'Editing'}
            </span>
            <button
              className={button}
              disabled={disabled || drawing.points.length < 2}
              aria-label={zh ? '撤回上一点' : 'Remove last point'}
              title={zh ? '撤回上一点' : 'Remove last point'}
              onClick={() =>
                savePathDrawing(drawing.points.slice(0, -1), drawing.tangents.slice(0, -1))
              }
            >
              <Undo2 size={15} />
            </button>
            <button
              className={`${button} gap-1.5`}
              disabled={disabled}
              onClick={() => {
                toggleMotionPlayback()
                if (useSceneAnimation.getState().playing) onComplete()
              }}
            >
              <Play size={14} />
              {zh ? '播放' : 'Play'}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className={`${button} justify-between gap-2 border border-border`}
              onClick={() => {
                if (cancelPathDrawing()) onComplete()
              }}
            >
              <span className="flex items-center gap-1.5">
                <X size={14} />
                {zh ? '取消' : 'Cancel'}
              </span>
              <kbd className="text-[10px] opacity-70">{zh ? '退出键' : 'Esc'}</kbd>
            </button>
            <button
              className={`${button} justify-between gap-2 bg-primary text-primary-foreground hover:bg-primary/90`}
              disabled={disabled}
              onClick={() => {
                if (finishPathDrawing()) onComplete()
              }}
            >
              <span>{zh ? '完成绘制' : 'Finish'}</span>
              <CornerDownLeft size={14} aria-label={zh ? '回车键' : 'Enter'} />
            </button>
          </div>
        </div>
      ) : (
        <fieldset disabled={disabled} className="space-y-3">
          <CameraNumber
            label={zh ? '运动用时 · 秒' : 'Duration · s'}
            value={drawing.duration}
            min={1 / animationData().fps}
            step={1 / animationData().fps}
            max={600}
            onChange={(duration) => usePathDrawing.setState({ duration, error: null })}
          />
          <div className="space-y-2">
            <span className="text-muted-foreground">{zh ? '路线方式' : 'Route type'}</span>
            <div className="grid grid-cols-3 gap-2">
              {(['draw', 'circle', 'square'] as const).map((kind) => {
                const Icon = kind === 'draw' ? PenTool : kind === 'circle' ? Circle : Square
                return (
                  <button
                    key={kind}
                    className={motionChoice}
                    aria-pressed={preset === kind}
                    onClick={() => setPreset(kind)}
                  >
                    <Icon size={20} strokeWidth={1.5} />
                    {kind === 'draw'
                      ? zh
                        ? '手绘'
                        : 'Draw'
                      : kind === 'circle'
                        ? zh
                          ? '圆形'
                          : 'Circle'
                        : zh
                          ? '方形'
                          : 'Square'}
                  </button>
                )
              })}
            </div>
          </div>
          {preset !== 'draw' && (
            <CameraNumber
              label={zh ? '尺寸 · 米' : 'Size · m'}
              value={radius}
              min={0.1}
              max={100}
              onChange={setRadius}
            />
          )}
          <button
            className={`${button} w-full bg-primary text-primary-foreground hover:bg-primary/90`}
            onClick={() => {
              usePathDrawing.setState({ error: null })
              if (preset === 'draw') startPathDrawing(drawing.duration)
              else if (createTrajectory(preset, radius, drawing.duration)) onComplete()
            }}
          >
            {preset === 'draw'
              ? zh
                ? '开始绘制'
                : 'Start drawing'
              : zh
                ? '创建路线'
                : 'Create route'}
          </button>
          <span className="block text-center text-[11px] tabular-nums text-muted-foreground">
            {zh ? '从播放头开始' : 'Starts at playhead'} · {state.time.toFixed(2)} {zh ? '秒' : 's'}
          </span>
        </fieldset>
      )}
      {drawing.error && (
        <p role="alert" className="text-amber-400">
          {zh
            ? drawing.error === 'overlap'
              ? '此时间段已有动画，请编辑现有轨迹，或移到空白时间后绘制。'
              : drawing.error === 'empty'
                ? '请画出一段有效路线。'
                : '时间超出范围或不足一帧，请调整运动用时。'
            : drawing.error === 'overlap'
              ? 'Animation already exists in this range. Edit that route or move to an empty time range.'
              : 'Check the route and duration.'}
        </p>
      )}
    </div>
  )
}

function DrawingGesture({ kind, label }: { kind: 'point' | 'curve'; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
      <svg viewBox="0 0 120 42" className="h-10 w-28" aria-hidden="true">
        {kind === 'point' ? (
          <>
            <path d="M18 29H81" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 4" />
            <circle cx="18" cy="29" r="3" fill="currentColor" />
            <circle cx="81" cy="29" r="4" className="fill-sky-400" />
            <path d="m81 7 15 13-8 1-4 7Z" fill="currentColor" />
          </>
        ) : (
          <>
            <path d="M17 32Q60-10 103 32" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M35 10H85" className="stroke-amber-400" strokeWidth="1" />
            <circle cx="35" cy="10" r="2.5" className="fill-amber-400" />
            <circle cx="85" cy="10" r="2.5" className="fill-amber-400" />
            <circle cx="60" cy="11" r="4" className="fill-sky-400" />
            <circle cx="17" cy="32" r="3" fill="currentColor" />
            <circle cx="103" cy="32" r="3" fill="currentColor" />
          </>
        )}
      </svg>
      <span className="text-[11px]">{label}</span>
    </div>
  )
}
