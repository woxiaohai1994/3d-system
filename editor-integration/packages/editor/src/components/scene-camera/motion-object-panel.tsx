import {
  type AnyNodeId,
  type MotionKey,
  objectTracks,
  replaceAnimationTracks,
  sampleScenePlayback,
  useScene,
} from '@pascal-app/core'
import { useI18n } from '../../i18n'
import { animationData, commitSceneAnimation } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { CameraNumber } from './inspector'
import { requestMotionTransition } from './motion-edit-session'
import { MotionInspectorGroup } from './motion-inspector'
import { useObjectMotion } from './motion-object-store'
import {
  addMotionObject,
  canAnimateObject,
  changeObjectDraft,
  objectPose,
  objectTrackValid,
  removeObjectPoint,
} from './motion-objects'
import { objectPathData, reconcilePaths } from './motion-path-data'
import { motionData, seekMotion, selectMotionCamera } from './motion-state'
import { cameraTargetLabel } from './target-label'

const button = 'rounded border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-40'
export function MotionElementSelector() {
  const { locale } = useI18n(),
    zh = locale === 'zh-CN'
  const state = useSceneAnimation(),
    object = useObjectMotion(),
    nodes = useScene((s) => s.nodes)
  return (
    <label className="flex min-w-0 items-center gap-2">
      {zh ? '编辑对象' : 'Edit object'}
      <select
        aria-label={zh ? '编辑对象' : 'Edit object'}
        className="h-8 max-w-48 rounded border border-border bg-background px-2"
        value={
          nodes[(object.nodeId ?? state.cameraId ?? '') as AnyNodeId]
            ? (object.nodeId ?? state.cameraId ?? '')
            : ''
        }
        disabled={state.playing || state.exporting}
        onChange={(e) => {
          const node = nodes[e.target.value as AnyNodeId]
          if (node?.type === 'scene-camera') selectMotionCamera(node.id)
          else if (node) addMotionObject(node.id)
        }}
      >
        <option value="" disabled>
          {zh ? '选择对象' : 'Choose object'}
        </option>
        {Object.values(nodes)
          .filter(
            (n) => (n.type === 'scene-camera' && n.id === state.cameraId) || canAnimateObject(n),
          )
          .map((n) => (
            <option key={n.id} value={n.id}>
              {cameraTargetLabel(n, locale)}
            </option>
          ))}
      </select>
    </label>
  )
}
export function MotionObjectControls() {
  const { locale } = useI18n(),
    zh = locale === 'zh-CN'
  const state = useSceneAnimation(),
    object = useObjectMotion()
  const nodes = useScene((s) => s.nodes),
    readOnly = useScene((s) => s.readOnly)
  const data = motionData(),
    track = objectTracks(animationData()).find((t) => t.nodeId === object.nodeId) ?? {
      nodeId: object.nodeId!,
      parentId: nodes[object.nodeId as AnyNodeId]?.parentId ?? null,
      points: [],
    }
  const pose = object.nodeId ? objectPose(object.nodeId) : null
  if (!pose) return null
  const point = track.points.find((p) => Math.abs(p.time - state.time) < 0.5 / data.fps)
  const blocked =
    state.playing ||
    state.exporting ||
    readOnly ||
    state.lockedIds.includes(track.nodeId) ||
    !objectTrackValid(track)
  const update = (patch: Partial<MotionKey>) => {
    if (!point) return
    const keyId = point.id
    const apply = () => {
      const data = animationData(),
        track = objectTracks(data).find((t) => t.nodeId === object.nodeId),
        point = track?.points.find((p) => p.id === keyId)
      if (!track || !point) return
      if (
        commitSceneAnimation(
          replaceAnimationTracks(
            { ...data },
            'object',
            objectTracks(data).map((t) =>
              t === track
                ? {
                    ...t,
                    segments: reconcilePaths(
                      objectPathData({
                        ...t,
                        points: t.points
                          .map((p) => (p === point ? { ...p, ...patch } : p))
                          .sort((a, b) => a.time - b.time),
                      }).points,
                      objectPathData(t),
                    ).segments,
                    points: t.points
                      .map((p) => (p === point ? { ...p, ...patch } : p))
                      .sort((a, b) => a.time - b.time),
                  }
                : t,
            ),
          ),
        )
      ) {
        if (patch.time !== undefined) seekMotion(patch.time)
        else sampleScenePlayback(state.time)
      }
    }
    if (requestMotionTransition(apply)) apply()
  }
  return (
    <fieldset disabled={blocked} className="space-y-2 text-xs">
      {!objectTrackValid(track) && (
        <p role="alert">
          {zh
            ? '对象已删除或父级改变，请移除此轨道并重新添加。'
            : 'Object missing or reparented. Remove and add its track again.'}
        </p>
      )}
      <MotionInspectorGroup title={zh ? '变换数值' : 'Transform values'} open={false}>
        {(['position', 'rotation'] as const).map((key) => (
          <div key={key} className="space-y-1">
            {pose[key].map((value, axis) => (
              <CameraNumber
                key={axis}
                label={`${key === 'position' ? (zh ? '位置' : 'Position') : zh ? '角度' : 'Angle'} ${'XYZ'[axis]}`}
                value={key === 'position' ? value : (value * 180) / Math.PI}
                onChange={(v) => {
                  const next = [...pose[key]] as [number, number, number]
                  next[axis] = key === 'position' ? v : (v * Math.PI) / 180
                  changeObjectDraft({ ...pose, [key]: next })
                }}
              />
            ))}
          </div>
        ))}
      </MotionInspectorGroup>
      {point && (
        <fieldset disabled={!!object.draft} className="space-y-2 border-t border-border pt-3">
          <CameraNumber
            label={zh ? '关键帧时间' : 'Key time'}
            value={point.time}
            min={0}
            max={600}
            step={1 / data.fps}
            onChange={(v) => update({ time: Math.round(v * data.fps) / data.fps })}
          />
          <button className={button} onClick={() => removeObjectPoint(track.nodeId, point.id)}>
            {zh ? '删除此关键帧' : 'Delete key'}
          </button>
        </fieldset>
      )}
    </fieldset>
  )
}
