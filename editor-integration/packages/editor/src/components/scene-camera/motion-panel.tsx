'use client'

import { type SceneCameraNode, useScene } from '@pascal-app/core'
import {
  Box,
  Camera,
  Eye,
  Pause,
  Play,
  Repeat2,
  Route,
  SlidersHorizontal,
  Spline,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../../i18n'
import {
  animationData,
  commitSceneAnimation,
  hasUnsupportedAnimation,
} from '../scene-animation/document'
import { FilmEditor } from '../scene-animation/film-editor'
import { FilmMonitor } from '../scene-animation/film-monitor'
import { useSceneAnimation } from '../scene-animation/store'
import { WorkspaceTabs } from '../scene-animation/workspaces'
import { cameraPreviewErrorText } from './camera-preview-error'
import { downloadCameraBlob } from './download'
import { CameraNumber, CameraProperties } from './inspector'
import { MotionCameraView } from './motion-camera-view'
import { MotionEasingControls } from './motion-easing-controls'
import { hasMotionEdits, requestMotionTransition } from './motion-edit-session'
import { exportCameraMotion } from './motion-export'
import { MotionInspector, MotionInspectorGroup, motionField } from './motion-inspector'
import { MotionLensControls, MotionTimelineLens } from './motion-lens-controls'
import { MotionElementSelector, MotionObjectControls } from './motion-object-panel'
import { useObjectMotion } from './motion-object-store'
import { commitPath, editingPathData } from './motion-path-context'
import { startPathDrawing, usePathDrawing } from './motion-path-drawing'
import { MotionPreview } from './motion-preview'
import { MotionPropertyControls, MotionRigControls } from './motion-property-controls'
import { MotionSceneControls } from './motion-scene-controls'
import {
  commitMotion,
  endSceneAnimation,
  hideSceneTimeline,
  motionCameraFrame,
  motionData,
  motionPlaybackRange,
  motionPreviewPose,
  observedMotionCamera,
  openMotionPreview,
  reconcileMotion,
  seekMotion,
  toggleMotionPlayback,
} from './motion-state'
import { motionStatusText } from './motion-status-text'
import { MotionTimeline } from './motion-timeline'
import { MotionTrajectoryPresets } from './motion-trajectory-presets'
import { currentSceneCameraId } from './scene-camera-state'
import { useCameraStudio } from './store'
import { cameraTargetLabel } from './target-label'
import { TimelinePortal } from './timeline-workspace'

const button =
  'inline-flex min-h-8 items-center justify-center gap-1.5 rounded px-2 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-40'
export function CameraMotionPanel({ node }: { node?: SceneCameraNode }) {
  const zh = useI18n().locale === 'zh-CN',
    state = useSceneAnimation(),
    studio = useCameraStudio(),
    object = useObjectMotion()
  const nodes = useScene((s) => s.nodes),
    readOnly = useScene((s) => s.readOnly)
  const [tool, setTool] = useState<
    'properties' | 'easing' | 'trajectory' | 'output' | 'rig' | null
  >(null)
  const drawing = usePathDrawing()
  const activeTool = drawing.nodeId ? 'trajectory' : tool
  const data = motionData(),
    animation = animationData(),
    path = editingPathData(),
    segment = path.segments.find((s) => s.id === state.segmentId)
  const pose = motionPreviewPose(),
    target = object.nodeId ? nodes[object.nodeId as keyof typeof nodes] : node
  const blocked =
    state.playing || state.exporting || readOnly || state.lockedIds.includes(target?.id ?? '')
  const range = motionPlaybackRange()
  const patchSegment = (patch: Partial<NonNullable<typeof segment>>) => {
    if (segment)
      commitPath({
        ...path,
        segments: path.segments.map((s) => (s.id === segment.id ? { ...s, ...patch } : s)),
      })
  }
  return (
    <>
      {state.workspace === 'film' && <FilmMonitor />}
      {state.workspace === 'shot' && state.cameraView && observedMotionCamera() && (
        <MotionCameraView node={observedMotionCamera()!} />
      )}
      {state.previewing && <MotionPreview />}
      <div className="pointer-events-none absolute inset-x-3 top-24 bottom-16 z-[60] flex min-h-0 flex-col gap-2">
        <div className="flex min-h-0 flex-1 justify-end gap-2">
          {activeTool === 'rig' && state.workspace === 'shot' && !object.nodeId && node && (
            <MotionInspector
              placement="viewport"
              title={zh ? '相机架' : 'Camera rig'}
              context={node.name}
              icon={Camera}
              onClose={() => setTool(null)}
            >
              <MotionRigControls defaultTab="rig" />
            </MotionInspector>
          )}
        </div>
      </div>
      <TimelinePortal>
        <section
          aria-label={zh ? '动画时间轴' : 'Animation timeline'}
          className="pointer-events-auto flex min-h-0 flex-1 flex-col overflow-y-auto bg-background text-foreground"
        >
          <WorkspaceTabs />
          {state.workspace === 'film' ? (
            <FilmEditor />
          ) : (
            <div className="flex min-h-0 flex-1">
              <MotionTimeline
                collapsed={false}
                onEditProperties={() => setTool('properties')}
                onEditPath={(mode) => setTool(mode)}
                onCreateTrajectory={() => {
                  startPathDrawing(drawing.duration)
                  setTool(usePathDrawing.getState().nodeId ? null : 'trajectory')
                }}
                onEditOutput={() => setTool('output')}
                onSelect={() => setTool((current) => (current === 'rig' ? 'rig' : null))}
                creationControls={
                  <>
                    {!drawing.nodeId && (
                      <CameraNumber
                        label={zh ? '运动用时 · 秒' : 'Motion duration · s'}
                        value={drawing.duration}
                        min={1 / animation.fps}
                        max={600}
                        step={1 / animation.fps}
                        onChange={(duration) => usePathDrawing.setState({ duration, error: null })}
                      />
                    )}
                    {!object.nodeId && node && (
                      <MotionTimelineLens
                        key={node.id}
                        node={node}
                        disabled={blocked || state.previewing || !!drawing.nodeId}
                      />
                    )}
                    {!object.nodeId && node && (
                      <button
                        className={button}
                        disabled={blocked || !!drawing.nodeId}
                        aria-expanded={activeTool === 'rig'}
                        onClick={() => setTool(activeTool === 'rig' ? null : 'rig')}
                      >
                        <Camera size={14} />
                        {zh ? '相机架' : 'Camera rig'}
                      </button>
                    )}
                    <button
                      className={button}
                      disabled={!target || blocked || !!drawing.nodeId || hasMotionEdits()}
                      aria-expanded={activeTool === 'trajectory'}
                      title={
                        !target
                          ? zh
                            ? '先选择一条物品或相机轨道'
                            : 'Select an object or camera track first'
                          : undefined
                      }
                      onClick={() => {
                        startPathDrawing(drawing.duration)
                        setTool(usePathDrawing.getState().nodeId ? null : 'trajectory')
                      }}
                    >
                      <Route size={15} />
                      {zh ? '运动轨迹' : 'Motion path'}
                    </button>
                  </>
                }
                transport={
                  <>
                    <button
                      className={button}
                      disabled={state.exporting}
                      aria-label={state.playing ? (zh ? '暂停' : 'Pause') : zh ? '播放' : 'Play'}
                      onClick={toggleMotionPlayback}
                    >
                      {state.playing ? <Pause size={15} /> : <Play size={15} />}
                    </button>
                    <button
                      className={button}
                      aria-label={zh ? '循环播放' : 'Loop playback'}
                      aria-pressed={state.loop}
                      onClick={() => useSceneAnimation.setState({ loop: !state.loop })}
                    >
                      <Repeat2 size={15} />
                    </button>
                    <CameraNumber
                      label={zh ? '时间 · 秒' : 'Time · s'}
                      value={state.time}
                      min={0}
                      max={600}
                      step={1 / data.fps}
                      onChange={seekMotion}
                    />
                  </>
                }
                contextControls={<MotionElementSelector />}
                outputControls={
                  <>
                    <select
                      aria-label={zh ? '预览与导出来源' : 'Preview and export source'}
                      className="h-8 rounded border border-border bg-background px-2"
                      disabled={state.exporting || state.playing}
                      value={state.outputMode}
                      onChange={(e) =>
                        useSceneAnimation.setState({
                          outputMode: e.target.value as 'camera' | 'scene',
                        })
                      }
                    >
                      <option value="camera">{zh ? '当前相机' : 'Current Camera'}</option>
                      <option value="scene" disabled={!currentSceneCameraId()}>
                        {zh ? '场景相机 · 按标记切换' : 'Scene Camera · Markers'}
                      </option>
                    </select>
                    <button
                      className={button}
                      disabled={state.exporting}
                      onClick={openMotionPreview}
                    >
                      <Eye size={14} />
                      {zh ? '相机预览' : 'Camera preview'}
                    </button>
                    <button
                      className={button}
                      disabled={!state.exporting && !studio.ready}
                      onClick={() =>
                        state.exporting ? state.cancelExport?.() : void exportCameraMotion()
                      }
                    >
                      {state.exporting
                        ? `${zh ? '取消' : 'Cancel'} ${Math.round(state.progress * 100)}%`
                        : zh
                          ? state.outputMode === 'scene'
                            ? '导出场景相机 MP4'
                            : '导出此相机 MP4'
                          : 'Export MP4'}
                    </button>
                    <button
                      className={button}
                      disabled={state.exporting}
                      aria-label={zh ? '隐藏时间轴' : 'Hide timeline'}
                      onClick={hideSceneTimeline}
                    >
                      <X size={14} />
                    </button>
                  </>
                }
              />
              {activeTool && activeTool !== 'rig' && (
                <MotionInspector
                  title={
                    zh
                      ? {
                          properties: '动画属性',
                          rig: '相机架',
                          easing: '缓动曲线',
                          trajectory: '创建运动轨迹',
                          output: '输出设置',
                        }[activeTool]
                      : {
                          properties: 'Animation properties',
                          rig: 'Camera rig',
                          easing: 'Easing curve',
                          trajectory: 'Create motion path',
                          output: 'Output settings',
                        }[activeTool]
                  }
                  context={
                    target
                      ? `${cameraTargetLabel(target, zh ? 'zh-CN' : 'en')}${segment && activeTool === 'easing' ? ` · ${path.points.find((p) => p.id === segment.fromId)?.time.toFixed(2)} – ${path.points.find((p) => p.id === segment.toId)?.time.toFixed(2)} ${zh ? '秒' : 's'}` : ''}`
                      : undefined
                  }
                  icon={
                    activeTool === 'easing'
                      ? Spline
                      : activeTool === 'trajectory'
                        ? Route
                        : activeTool === 'output'
                          ? SlidersHorizontal
                          : target?.type === 'scene-camera'
                            ? Camera
                            : Box
                  }
                  onClose={() => setTool(null)}
                  drawing={!!drawing.nodeId}
                >
                  {activeTool === 'trajectory' ? (
                    <MotionTrajectoryPresets onComplete={() => setTool(null)} />
                  ) : activeTool === 'output' ? (
                    <div className="space-y-3">
                      <MotionInspectorGroup title={zh ? '拍摄与画幅' : 'Camera and frame'}>
                        <MotionSceneControls />
                      </MotionInspectorGroup>
                      <MotionInspectorGroup title={zh ? '视频规格' : 'Video format'}>
                        <div className="grid grid-cols-2 gap-2">
                          <select
                            aria-label={zh ? '分辨率' : 'Resolution'}
                            className={motionField}
                            value={data.resolution}
                            onChange={(e) =>
                              commitMotion({
                                ...data,
                                resolution: Number(e.target.value) as 720 | 1080,
                              })
                            }
                          >
                            <option value={720}>720p</option>
                            <option value={1080}>1080p</option>
                          </select>
                          <select
                            aria-label={zh ? '帧率' : 'Frame rate'}
                            className={motionField}
                            value={data.fps}
                            onChange={(e) =>
                              commitMotion({ ...data, fps: Number(e.target.value) as 24 | 30 })
                            }
                          >
                            <option value={24}>24 {zh ? '帧/秒' : 'fps'}</option>
                            <option value={30}>30 {zh ? '帧/秒' : 'fps'}</option>
                          </select>
                        </div>
                      </MotionInspectorGroup>
                      <button
                        className={button}
                        onClick={() => useCameraStudio.setState({ viewfinderCollapsed: false })}
                      >
                        {zh ? '显示取景窗' : 'Viewfinder'}
                      </button>
                      <button
                        className={button}
                        disabled={!studio.ready}
                        onClick={async () => {
                          const blob = await studio.runtime?.takePhoto()
                          if (blob) downloadCameraBlob(blob, `${target?.name ?? 'camera'}.png`)
                        }}
                      >
                        {zh ? '拍照 PNG' : 'Photo PNG'}
                      </button>
                      <MotionInspectorGroup title={zh ? '播放范围' : 'Playback range'} open={false}>
                        {([0, 1] as const).map((i) => (
                          <CameraNumber
                            key={i}
                            label={zh ? (i ? '播放结束' : '播放开始') : i ? 'End' : 'Start'}
                            value={range[i]}
                            min={0}
                            max={600}
                            step={1 / data.fps}
                            onChange={(value) => {
                              const next: [number, number] = [...range]
                              next[i] = value
                              commitSceneAnimation({ ...animation, playbackRange: next })
                            }}
                          />
                        ))}
                      </MotionInspectorGroup>
                      <button
                        className={button}
                        disabled={state.exporting}
                        onClick={() => endSceneAnimation()}
                      >
                        {zh
                          ? '结束动画编辑，恢复基础场景'
                          : 'End animation editing and restore base scene'}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {segment && activeTool === 'easing' ? (
                        <MotionEasingControls
                          key={segment.id}
                          value={segment.rhythm === 'linear' ? [0, 0, 1, 1] : segment.easing}
                          disabled={blocked}
                          continuous={segment.rhythm === 'continuous'}
                          onContinuous={() => patchSegment({ rhythm: 'continuous' })}
                          onChange={(easing) =>
                            patchSegment({
                              rhythm: easing.join() === '0,0,1,1' ? 'linear' : 'ease',
                              easing,
                            })
                          }
                        />
                      ) : object.nodeId ? (
                        <MotionObjectControls />
                      ) : (
                        <fieldset disabled={blocked} className="space-y-3">
                          {state.pointId && (
                            <CameraNumber
                              label={zh ? '关键帧时间' : 'Key time'}
                              value={
                                data.points.find((p) => p.id === state.pointId)?.time ?? state.time
                              }
                              min={0}
                              max={600}
                              step={1 / data.fps}
                              onChange={(value) => {
                                const time = Math.round(value * data.fps) / data.fps
                                const edit = () => {
                                  const data = motionData()
                                  if (
                                    commitMotion(
                                      reconcileMotion(
                                        data.points.map((p) =>
                                          p.id === state.pointId ? { ...p, time } : p,
                                        ),
                                        data,
                                      ),
                                    )
                                  )
                                    seekMotion(time, state.pointId)
                                }
                                if (requestMotionTransition(edit)) edit()
                              }}
                            />
                          )}
                          {node && (
                            <CameraProperties
                              key={node.id}
                              context="timeline"
                              node={pose ? motionCameraFrame(node, pose) : node}
                              lensControls={
                                pose ? <MotionLensControls node={node} pose={pose} /> : undefined
                              }
                            />
                          )}
                        </fieldset>
                      )}
                      {activeTool === 'properties' && target && target.type !== 'scene-camera' && (
                        <MotionPropertyControls nodeId={target.id} />
                      )}
                    </div>
                  )}
                </MotionInspector>
              )}
            </div>
          )}
          <div className="flex shrink-0 flex-wrap items-center gap-3 px-3 text-xs empty:hidden">
            {hasUnsupportedAnimation() && (
              <p role="status" className="text-amber-400">
                {zh
                  ? '动画迁移失败，原数据已保留。请恢复有效项目后继续编辑。'
                  : 'Animation migration failed. Original data is preserved and animation edits are blocked.'}
              </p>
            )}
            {studio.error && (
              <p role="alert" className="text-red-400">
                {cameraPreviewErrorText(studio.error, zh)}
              </p>
            )}
            {state.message && (
              <p role="status" className="text-amber-400">
                {motionStatusText(state.message, zh)}
              </p>
            )}
          </div>
        </section>
      </TimelinePortal>
    </>
  )
}
