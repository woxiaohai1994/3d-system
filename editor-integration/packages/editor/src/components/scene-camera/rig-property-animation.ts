import {
  CameraPropertyCurve,
  cameraTracks,
  createFCurveEvaluator,
  getEffectiveNode,
  type SceneCameraNode,
  sampleScenePlayback,
  upsertAnimationTrack,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { flushSync } from '@react-three/fiber'
import { create } from 'zustand'
import { animationData, animationSite, commitSceneAnimation } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { sceneCameraAspect } from './camera-math'
import type { SourceNumberEdit } from './rig-number-drag'
import { bindRigPropertyHistory } from './rig-property-history'
import type { SourceLayout } from './rig-source-ui'

export type RigPropertyAddress = Pick<CameraPropertyCurve, 'owner' | 'dataPath' | 'index'>
const idOf = (address: RigPropertyAddress) =>
  JSON.stringify([address.owner, address.dataPath, address.index])
type PropertyEdit = { address: RigPropertyAddress; value: number }
export type RigPropertyEdits = Record<string, Record<string, PropertyEdit>>
let propertyHistory: ReturnType<typeof bindRigPropertyHistory> | null = null
export const useRigPropertyEdits = create<{ edits: RigPropertyEdits }>(() => ({ edits: {} }))
const displayPath = ['metadata', 'editor.cameraRigDisplay']
function targetPath(address: RigPropertyAddress): (string | number)[] | null {
  const { owner, dataPath, index } = address
  if (owner === 'rig') {
    if (dataPath === 'show_in_front') return ['rig', 'showInFront']
    if (
      dataPath.endsWith('.constraints["Track To"].influence') ||
      dataPath.endsWith('.constraints["Copy Location"].influence')
    )
      return ['rig', dataPath.includes('MCH-DOF_Parent') ? 'dofTracking' : 'tracking']
    const property = /^pose\.bones\["([^"]+)"\]\["([^"]+)"\]$/.exec(dataPath)
    if (property) return ['rig', 'native', 'bones', property[1]!, 'properties', property[2]!]
    const scale = /^pose\.bones\["([^"]+)"\]\.scale$/.exec(dataPath)
    if (scale) return ['rig', 'native', 'bones', scale[1]!, 'scale', index]
  }
  if (owner === 'cameraData') {
    const property = {
      type: 'projection',
      clip_start: 'near',
      clip_end: 'far',
      ortho_scale: 'orthographicHeight',
    }[dataPath]
    if (property) return [property]
    if (dataPath === 'shift_x' || dataPath === 'shift_y')
      return ['rig', 'native', 'lensShift', dataPath === 'shift_x' ? 0 : 1]
    if (dataPath === 'show_limits') return [...displayPath, 'limits']
    if (dataPath === 'passepartout_alpha') return [...displayPath, 'opacity']
  }
  return null
}
function withPath<T>(base: T, path: (string | number)[], value: unknown): T {
  const [key, ...rest] = path
  if (key === undefined) return value as T
  if (['__proto__', 'constructor', 'prototype'].includes(String(key))) return base
  const original =
    base && typeof base === 'object' ? (base as Record<string | number, unknown>) : {}
  const copy = Array.isArray(base) ? [...base] : { ...original }
  ;(copy as Record<string | number, unknown>)[key] = withPath(original[key], rest, value)
  return copy as T
}
export function rigPropertyAddress(tree: SourceLayout): RigPropertyAddress | null {
  const o = tree.options
  if (
    !o.rna?.is_animatable ||
    !o.rna.data_path ||
    !['rig', 'camera', 'cameraData'].includes(o.owner ?? '')
  )
    return null
  const address = {
    owner: o.owner as RigPropertyAddress['owner'],
    dataPath: o.rna.data_path,
    index: o.index ?? 0,
  }
  return targetPath(address) ? address : null
}
export function rigPropertyCurve(node: SceneCameraNode, address: RigPropertyAddress) {
  return cameraTracks(animationData())
    .find((track) => track.nodeId === node.id && track.parentId === node.parentId)
    ?.propertyCurves?.find((curve) => idOf(curve) === idOf(address))
}
function applyValue(
  node: SceneCameraNode,
  address: RigPropertyAddress,
  value: number,
  aspect = animationData().aspect,
) {
  const path = targetPath(address)
  if (!path || (path[0] === 'rig' && !node.rig?.native)) return node
  if (path[2] === 'bones' && !Object.hasOwn(node.rig!.native!.bones, path[3]!)) return node
  const converted =
    address.owner === 'cameraData' && address.dataPath === 'type'
      ? ['perspective', 'orthographic'][value]
      : address.dataPath === 'show_in_front' || address.dataPath === 'show_limits'
        ? Boolean(value)
        : address.dataPath === 'ortho_scale'
          ? value / Math.max(1, aspect)
          : value
  if (converted === undefined) return node
  return withPath(node, path, converted)
}
export function sampleRigPropertyAnimation(node: SceneCameraNode, time: number) {
  const animation = animationData()
  const track = cameraTracks(animation).find(
    (t) => t.nodeId === node.id && t.parentId === node.parentId,
  )
  let result = node
  for (const curve of track?.propertyCurves ?? []) {
    if (!curve.keys.length) continue
    const evaluator = createFCurveEvaluator(curve)
    try {
      result = applyValue(result, curve, evaluator.sample(time * animation.fps))
    } finally {
      evaluator.dispose()
    }
  }
  const state = useSceneAnimation.getState()
  if (!state.exporting && !state.renderingFilm && Math.abs(state.time - time) < 1e-7)
    for (const edit of Object.values(useRigPropertyEdits.getState().edits[node.id] ?? {}))
      result = applyValue(result, edit.address, edit.value)
  return result
}
function clearEdit(nodeId: string, address: RigPropertyAddress) {
  const edits = useRigPropertyEdits.getState().edits
  const { [idOf(address)]: removed, ...rest } = edits[nodeId] ?? {}
  if (!removed) return
  useRigPropertyEdits.setState({ edits: { ...edits, [nodeId]: rest } })
}
export function bindRigPropertyEdits() {
  const history = bindRigPropertyHistory(useRigPropertyEdits)
  propertyHistory = history
  const release = useSceneAnimation.subscribe((next, previous) => {
    if (
      next.time !== previous.time ||
      next.open !== previous.open ||
      next.cameraId !== previous.cameraId
    )
      useRigPropertyEdits.setState({ edits: {} })
  })
  return () => {
    release()
    history.dispose()
    if (propertyHistory === history) propertyHistory = null
  }
}
export function changeRigProperty(
  node: SceneCameraNode,
  address: RigPropertyAddress,
  value: number,
) {
  commitRigProperty(node, address, value, useRigPropertyEdits.getState().edits)
}
function commitRigProperty(
  node: SceneCameraNode,
  address: RigPropertyAddress,
  value: number,
  historyBefore: RigPropertyEdits,
) {
  const state = useSceneAnimation.getState(),
    site = animationSite()
  if (
    !Number.isFinite(value) ||
    !site ||
    useScene.getState().readOnly ||
    state.playing ||
    state.exporting ||
    state.previewing ||
    state.lockedIds.includes(node.id)
  )
    return false
  const edits = useRigPropertyEdits.getState().edits
  const next = { ...edits, [node.id]: { ...edits[node.id], [idOf(address)]: { address, value } } }
  if (rigPropertyCurve(node, address)) {
    useRigPropertyEdits.setState({ edits: next })
    propertyHistory?.record(historyBefore, next)
  } else {
    const current = useScene.getState().nodes[node.id]
    if (current?.type !== 'scene-camera') return false
    const changed = applyValue(current, address, value),
      path = targetPath(address)!
    // The site entry marks an authored property edit, bypassing whole-pose auto-keying.
    useScene.getState().updateNodes([
      { id: site.id, data: { animation: site.animation } },
      { id: node.id, data: { [path[0]!]: changed[path[0] as keyof SceneCameraNode] } },
    ])
    useRigPropertyEdits.setState({ edits: next })
    propertyHistory?.commit()
  }
  sampleScenePlayback(state.time)
  return true
}

export function runWithRigPropertyValue(
  node: SceneCameraNode,
  address: RigPropertyAddress,
  value: number,
  run: () => boolean,
) {
  const state = useSceneAnimation.getState()
  if (!state.open || state.cameraId !== node.id || !rigPropertyCurve(node, address)) return run()
  const before = useRigPropertyEdits.getState().edits
  useRigPropertyEdits.setState({
    edits: {
      ...before,
      [node.id]: { ...before[node.id], [idOf(address)]: { address, value } },
    },
  })
  let applied = false
  try {
    applied = run()
    return applied
  } finally {
    if (!applied) useRigPropertyEdits.setState({ edits: before })
    // The operator's scene step owns both the bone edit and its unkeyed RNA value.
    propertyHistory?.commit()
    sampleScenePlayback(state.time)
  }
}

export function checkpointRigPropertyHistory() {
  propertyHistory?.commit()
}

export function beginRigPropertyDrag(
  node: SceneCameraNode,
  address: RigPropertyAddress,
  initialValue: number,
): SourceNumberEdit {
  const initial = useSceneAnimation.getState(),
    nodes = useScene.getState().nodes,
    before = useRigPropertyEdits.getState().edits
  let preview = before,
    value = initialValue,
    ended = false
  const available = () => {
    const state = useSceneAnimation.getState()
    return (
      !ended &&
      !!targetPath(address) &&
      state.open &&
      state.cameraId === node.id &&
      state.cameraId === initial.cameraId &&
      state.time === initial.time &&
      state.workspace === initial.workspace &&
      !state.playing &&
      !state.exporting &&
      !state.renderingFilm &&
      !state.previewing &&
      !state.lockedIds.includes(node.id) &&
      !useScene.getState().readOnly &&
      useScene.getState().nodes === nodes &&
      useRigPropertyEdits.getState().edits === preview
    )
  }
  return {
    change(next) {
      if (!available() || !Number.isFinite(next)) return false
      value = next
      preview = {
        ...before,
        [node.id]: { ...before[node.id], [idOf(address)]: { address, value } },
      }
      useRigPropertyEdits.setState({ edits: preview })
      sampleScenePlayback(initial.time)
      return true
    },
    finish(cancel) {
      if (ended) return
      const commit = !cancel && available() && value !== initialValue
      ended = true
      let applied = false
      if (commit)
        flushSync(() => {
          applied = commitRigProperty(node, address, value, before)
        })
      if (applied) return
      if (useRigPropertyEdits.getState().edits === preview)
        useRigPropertyEdits.setState({ edits: before })
      propertyHistory?.commit()
      const state = useSceneAnimation.getState()
      sampleScenePlayback(state.open ? state.time : null)
    },
  }
}

export function beginPhotoRigPropertyDrag(
  node: SceneCameraNode,
  address: RigPropertyAddress,
  initialValue: number,
  commit: (value: number) => void,
): SourceNumberEdit {
  const initial = useSceneAnimation.getState(),
    nodes = useScene.getState().nodes,
    base = getEffectiveNode(node),
    root = targetPath(address)?.[0] as keyof SceneCameraNode | undefined,
    previous = useLiveNodeOverrides.getState().get(node.id),
    owned = root !== undefined && Object.hasOwn(previous ?? {}, root)
  let preview: unknown = root ? previous?.[root] : undefined,
    value = initialValue,
    ended = false
  const available = () => {
    const state = useSceneAnimation.getState()
    return (
      !ended &&
      !!root &&
      state.open === initial.open &&
      state.cameraId === initial.cameraId &&
      state.time === initial.time &&
      state.workspace === initial.workspace &&
      !state.playing &&
      !state.exporting &&
      !state.renderingFilm &&
      !state.previewing &&
      !state.lockedIds.includes(node.id) &&
      !useScene.getState().readOnly &&
      useScene.getState().nodes === nodes &&
      useLiveNodeOverrides.getState().get(node.id)?.[root] === preview
    )
  }
  return {
    change(next) {
      if (!available() || !Number.isFinite(next)) return false
      value = next
      preview = applyValue(base, address, value, sceneCameraAspect(base))[root!]
      useLiveNodeOverrides.getState().set(node.id, { [root!]: preview })
      useScene.getState().markDirty(node.id)
      return true
    },
    finish(cancel) {
      if (ended) return
      const apply = !cancel && available() && value !== initialValue
      ended = true
      if (apply) flushSync(() => commit(value))
      const live = useLiveNodeOverrides.getState()
      if (root && live.get(node.id)?.[root] === preview) {
        if (owned) live.set(node.id, { [root]: previous![root] })
        else live.clearFields(node.id, [root])
        useScene.getState().markDirty(node.id)
      }
    },
  }
}

export function keyRigProperty(
  node: SceneCameraNode,
  tree: SourceLayout,
  value: number,
  operation: 'insert' | 'delete',
) {
  const state = useSceneAnimation.getState(),
    address = rigPropertyAddress(tree)
  if (
    !address ||
    !state.open ||
    useScene.getState().readOnly ||
    state.playing ||
    state.exporting ||
    state.previewing ||
    state.lockedIds.includes(node.id)
  )
    return false
  const animation = animationData(),
    existing = rigPropertyCurve(node, address)
  const curve =
    existing ??
    CameraPropertyCurve.parse({
      ...address,
      keys: [],
      discrete: ['BOOLEAN', 'ENUM'].includes(tree.options.rna!.type),
      integer: ['BOOLEAN', 'ENUM', 'INT'].includes(tree.options.rna!.type),
    })
  const evaluator = createFCurveEvaluator(curve)
  let keys: CameraPropertyCurve['keys']
  try {
    const changed =
      operation === 'insert'
        ? evaluator.insert(state.time * animation.fps, value)
        : evaluator.delete(state.time * animation.fps)
    if (!changed) return false
    keys = evaluator.keys()
  } finally {
    evaluator.dispose()
  }
  const track = cameraTracks(animation).find((t) => t.nodeId === node.id)
  const propertyCurves = (track?.propertyCurves ?? []).filter((c) => idOf(c) !== idOf(address))
  if (keys.length) propertyCurves.push({ ...curve, keys })
  const updated = upsertAnimationTrack(animation, {
    ...track,
    kind: 'camera',
    nodeId: node.id,
    parentId: node.parentId,
    points: track?.points ?? [],
    segments: track?.segments ?? [],
    propertyCurves,
  })
  if (!commitSceneAnimation(updated)) return false
  clearEdit(node.id, address)
  propertyHistory?.commit()
  sampleScenePlayback(state.time)
  return true
}
