import {
  type AnyNode,
  type AnyNodeId,
  cameraTracks,
  getScenePlaybackTime,
  MotionKey,
  type MotionTrack,
  objectTracks,
  registerScenePlaybackSampler,
  replaceAnimationTracks,
  sampleScenePlayback,
  sceneRegistry,
  snapshotMotionProperties,
  type TransformPose,
  usePlaybackTransforms,
  useScene,
} from '@pascal-app/core'
import { objectMotionPose, sampleObjectMotion, useViewer } from '@pascal-app/viewer'
import useEditor from '../../store/use-editor'
import { animationData, commitSceneAnimation } from '../scene-animation/document'
import { recordTrackKey } from '../scene-animation/keyframes'
import { useSceneAnimation } from '../scene-animation/store'
import {
  clearMotionProperties,
  commitExistingKey,
  requestMotionTransition,
  useMotionEdits,
} from './motion-edit-session'
import { useObjectMotion } from './motion-object-store'
import { objectPathData, reconcilePaths } from './motion-path-data'
import { bindMotionPropertySampler, motionSnapshot } from './motion-properties'
import {
  cameraPoseAt,
  motionCameras,
  motionPreviewPose,
  openMotion,
  seekMotion,
} from './motion-state'

export function canAnimateObject(node: AnyNode | undefined) {
  return !!node && !['site', 'building', 'level', 'scene-camera'].includes(node.type)
}
export function objectTrackValid(track: MotionTrack) {
  const node = useScene.getState().nodes[track.nodeId as AnyNodeId]
  return !!node && node.parentId === track.parentId
}
export function bindObjectMotionSampler() {
  const properties = bindMotionPropertySampler()
  const sample = (time: number | null) => {
    properties.sample(time)
    const poses = new Map<string, TransformPose>()
    const state = useSceneAnimation.getState(),
      object = useObjectMotion.getState()
    if (time !== null && state.open) {
      for (const track of objectTracks(animationData())) {
        const source = useScene.getState().nodes[track.nodeId as AnyNodeId]
        if (
          objectTrackValid(track) &&
          source &&
          'position' in source &&
          Array.isArray(source.position) &&
          source.position.length === 3
        )
          poses.set(track.nodeId, sampleObjectMotion(track, time))
      }
      for (const [id, patch] of Object.entries(
        state.renderingFilm || state.exporting ? {} : useMotionEdits.getState().properties,
      )) {
        const target = sceneRegistry.nodes.get(id)
        if (!target) continue
        const pose = poses.get(id) ?? objectMotionPose(target)
        poses.set(id, {
          ...pose,
          ...(Array.isArray(patch.position) && patch.position.length === 3
            ? { position: patch.position as [number, number, number] }
            : {}),
          ...(patch.rotation !== undefined
            ? {
                rotation: (Array.isArray(patch.rotation)
                  ? patch.rotation
                  : [0, patch.rotation, 0]) as [number, number, number],
              }
            : {}),
          ...(Array.isArray(patch.scale) ? { scale: patch.scale as [number, number, number] } : {}),
        })
      }
      if (
        object.nodeId &&
        object.draft &&
        !state.renderingFilm &&
        !state.exporting &&
        Math.abs(time - state.time) < 1e-7
      )
        poses.set(object.nodeId, object.draft)
    }
    if (time !== null && state.open) {
      // Keep camera membership stable while object poses update before look-at evaluation.
      const previous = usePlaybackTransforms.getState().poses
      for (const track of cameraTracks(animationData())) {
        const node = useScene.getState().nodes[track.nodeId as AnyNodeId]
        if (node?.type === 'scene-camera' && node.parentId === track.parentId)
          poses.set(
            node.id,
            previous.get(node.id) ?? { position: node.position, rotation: node.rotation },
          )
      }
    }
    usePlaybackTransforms.setState({ poses })
    if (time !== null && state.open) {
      const animation = animationData()
      const cameraPoses = new Map(poses)
      for (const node of motionCameras()) {
        const track = cameraTracks(animation).find((t) => t.nodeId === node.id)
        if (track && track.parentId === node.parentId) {
          const pose =
            !state.renderingFilm &&
            !state.exporting &&
            node.id === state.cameraId &&
            (state.draft || state.readCameraEditPose?.())
              ? motionPreviewPose()
              : cameraPoseAt(node, time)
          if (pose) cameraPoses.set(node.id, { position: pose.position, rotation: pose.rotation })
        }
      }
      usePlaybackTransforms.setState({ poses: cameraPoses })
    }
  }
  const release = registerScenePlaybackSampler(sample, -100)
  const changes = useScene.subscribe((s, p) => {
    if (s.nodes !== p.nodes && getScenePlaybackTime() !== null) {
      const id = useObjectMotion.getState().nodeId
      if (id && !s.nodes[id as AnyNodeId]) useObjectMotion.setState({ nodeId: null, draft: null })
      sample(getScenePlaybackTime())
    }
  })
  return () => {
    release()
    properties.sample(null)
    changes()
    usePlaybackTransforms.setState({ poses: new Map() })
  }
}
export function objectPose(id: string) {
  const state = useObjectMotion.getState()
  if (state.nodeId === id && state.draft) return state.draft
  const track = objectTracks(animationData()).find((entry) => entry.nodeId === id)
  if (track && objectTrackValid(track) && !useMotionEdits.getState().properties[id])
    return sampleObjectMotion(track, useSceneAnimation.getState().time)
  const object = sceneRegistry.nodes.get(id)
  return object ? objectMotionPose(object) : null
}
export function selectMotionObject(id: string) {
  if (!requestMotionTransition(() => selectMotionObject(id))) return
  useSceneAnimation.getState().finishCameraEdit?.(false)
  const state = useSceneAnimation.getState()
  if (state.draft || state.exporting || state.playing || useObjectMotion.getState().draft) return
  const node = useScene.getState().nodes[id as AnyNodeId]
  if (!canAnimateObject(node)) return
  useEditor.getState().setTool(null)
  useEditor.getState().setMode('select')
  useObjectMotion.setState({ nodeId: id, draft: null })
  useSceneAnimation.setState({
    navigating: false,
    pickingAnchor: null,
    segmentId: null,
    pointId: null,
  })
  // Timeline selection must retain the native move/rotate handles in both viewports.
  if (!useViewer.getState().selection.selectedIds.includes(id))
    useViewer.getState().setSelection({ selectedIds: [id] })
}
export function addMotionObject(id: string) {
  selectMotionObject(id)
  if (useObjectMotion.getState().nodeId !== id) return
}

export function recordObjectContextKey(id: string) {
  const state = useSceneAnimation.getState()
  const node = useScene.getState().nodes[id as AnyNodeId]
  if (
    !canAnimateObject(node) ||
    useScene.getState().readOnly ||
    state.playing ||
    state.exporting ||
    state.previewing ||
    state.pickingAnchor ||
    state.pickingRigAim ||
    state.lockedIds.includes(id)
  )
    return
  const record = () => {
    const object = sceneRegistry.nodes.get(id)
    const pose = useSceneAnimation.getState().open
      ? objectPose(id)
      : object
        ? objectMotionPose(object)
        : null
    if (!pose) return
    openMotion()
    if (!useSceneAnimation.getState().open) return
    if (useObjectMotion.getState().nodeId !== id) selectMotionObject(id)
    if (useObjectMotion.getState().nodeId !== id) return
    useObjectMotion.setState({ draft: pose })
    commitObjectPoint()
  }
  if (useObjectMotion.getState().nodeId === id || requestMotionTransition(record)) record()
}

export function changeObjectDraft(pose: TransformPose, complete = true) {
  const state = useSceneAnimation.getState()
  if (
    state.playing ||
    state.exporting ||
    state.lockedIds.includes(useObjectMotion.getState().nodeId ?? '') ||
    state.draft ||
    state.pickingAnchor ||
    useScene.getState().readOnly
  )
    return
  useObjectMotion.setState({ draft: pose })
  sampleScenePlayback(state.time)
  if (complete) commitExistingKey()
}
export function discardObjectDraft() {
  useObjectMotion.setState({ draft: null })
  sampleScenePlayback(useSceneAnimation.getState().time)
}
export function commitObjectPoint() {
  const state = useSceneAnimation.getState(),
    id = useObjectMotion.getState().nodeId
  if (!id || state.playing || state.exporting || state.draft || state.lockedIds.includes(id)) return
  const data = animationData(),
    track = objectTracks(data).find((t) => t.nodeId === id) ?? {
      nodeId: id,
      parentId: useScene.getState().nodes[id as AnyNodeId]?.parentId ?? null,
      points: [],
    },
    pose = objectPose(id)
  if (!objectTrackValid(track) || !pose) return
  const time = Math.round(state.time * data.fps) / data.fps
  const previous = track.points.find((p) => Math.abs(p.time - time) < 0.5 / data.fps)
  const source = useScene.getState().nodes[id as AnyNodeId]
  const point = MotionKey.parse({
    ...previous,
    ...pose,
    values: source ? motionSnapshot(source) : previous?.values,
    channels: [
      ...new Set([
        ...(previous?.channels ?? []),
        ...Object.keys(useMotionEdits.getState().properties[id] ?? {}),
      ]),
    ],
    time,
  })
  if (
    commitSceneAnimation(
      recordTrackKey(
        data,
        { ...track, kind: 'object' },
        point,
        source ? snapshotMotionProperties(source) : {},
      ),
    )
  ) {
    clearMotionProperties(id)
    useObjectMotion.setState({ draft: null })
    sampleScenePlayback(time)
  }
}
export function removeObjectPoint(nodeId: string, pointId?: string) {
  const data = animationData()
  const objects = objectTracks(data).flatMap((track) => {
    if (track.nodeId !== nodeId) return [track]
    const points = pointId ? track.points.filter((p) => p.id !== pointId) : []
    return points.length
      ? [
          {
            ...track,
            points,
            segments: reconcilePaths(
              objectPathData({ ...track, points }).points,
              objectPathData(track),
            ).segments,
          },
        ]
      : []
  })
  if (commitSceneAnimation(replaceAnimationTracks({ ...data }, 'object', objects))) {
    useObjectMotion.setState({
      draft: null,
      ...(objects.some((t) => t.nodeId === nodeId) ? {} : { nodeId: null }),
    })
    sampleScenePlayback(useSceneAnimation.getState().time)
  }
}

export function duplicateObjectPoint(nodeId: string, pointId: string) {
  const data = animationData(),
    track = objectTracks(data).find((t) => t.nodeId === nodeId)
  if (!track) return
  const index = track.points.findIndex((p) => p.id === pointId),
    point = track.points[index],
    next = track.points[index + 1]
  if (!point) return
  const time = next
    ? Math.round(((point.time + next.time) * data.fps) / 2) / data.fps
    : point.time + 3
  const copy = MotionKey.safeParse({ ...point, id: undefined, time })
  if (!copy.success) return
  const points = [...track.points, copy.data].sort((a, b) => a.time - b.time)
  const segments = reconcilePaths(
    objectPathData({ ...track, points }).points,
    objectPathData(track),
  ).segments
  if (
    commitSceneAnimation(
      replaceAnimationTracks(
        { ...data },
        'object',
        objectTracks(data).map((t) => (t === track ? { ...track, points, segments } : t)),
      ),
    )
  )
    seekMotion(time)
}
