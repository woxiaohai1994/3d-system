import {
  changeFilmFps,
  migrateFilmAnimation,
  reconcileFilmSources,
  SceneAnimation,
  sampleScenePlayback,
  useScene,
} from '@pascal-app/core'
import { resolveSceneCameraAtFrame } from '../scene-camera/scene-camera-resolve'
import { useSceneAnimation } from './store'

const emptyAnimation = SceneAnimation.parse({})
const parsedAnimations = new WeakMap<object, { signature: string; data: SceneAnimation }>()
const unsupportedAnimations = new WeakSet<object>()
export function animationSite() {
  return Object.values(useScene.getState().nodes).find((n) => n.type === 'site') ?? null
}
function readAnimation(raw: SceneAnimation | undefined): SceneAnimation {
  const cameras = Object.values(useScene.getState().nodes).filter((n) => n.type === 'scene-camera')
  const signature = cameras.map((n) => n.id).join(',')
  const key = raw ?? emptyAnimation
  if (typeof key !== 'object') return emptyAnimation
  const cached = parsedAnimations.get(key)
  if (cached?.signature === signature) return cached.data
  try {
    const data = migrateFilmAnimation(raw, cameras)
    parsedAnimations.set(key, { signature, data })
    return data
  } catch {
    unsupportedAnimations.add(key)
    return emptyAnimation
  }
}
export function animationData(): SceneAnimation {
  const state = useSceneAnimation.getState()
  return readAnimation(
    (state.renderingFilm || state.exporting ? null : state.sceneDraft) ??
      animationSite()?.animation,
  )
}
export function hasUnsupportedAnimation() {
  const raw = animationSite()?.animation
  readAnimation(raw)
  return !!raw && (typeof raw !== 'object' || unsupportedAnimations.has(raw))
}
export function commitSceneAnimation(animation: SceneAnimation) {
  const site = animationSite()
  if (!site || useScene.getState().readOnly || useSceneAnimation.getState().exporting) return false
  if (hasUnsupportedAnimation()) {
    useSceneAnimation.setState({ message: '动画迁移失败，已保留原数据；请恢复有效项目后编辑' })
    return false
  }
  const previous = animationData()
  const state = useSceneAnimation.getState()
  const sceneCamera = resolveSceneCameraAtFrame(
    previous,
    Math.trunc(state.time * previous.fps + 1e-7),
    Object.values(useScene.getState().nodes)
      .filter((node) => node.type === 'scene-camera')
      .map((node) => node.id),
    !state.exporting && !state.playing ? state.sceneCameraOverride : null,
  )
  if (animation.fps !== previous.fps) {
    try {
      animation = changeFilmFps({ ...animation, fps: previous.fps }, animation.fps)
    } catch (error) {
      useSceneAnimation.setState({ message: String(error) })
      return false
    }
  }
  const parsed = SceneAnimation.safeParse(reconcileFilmSources(animation))
  if (!parsed.success) {
    useSceneAnimation.setState({ message: parsed.error.issues.map((i) => i.message).join('；') })
    return false
  }
  if (
    animation.activeCameraId === previous.activeCameraId &&
    JSON.stringify(animation.cameraMarkers ?? []) !== JSON.stringify(previous.cameraMarkers ?? [])
  )
    // Blender's marker update retains scene.camera when no valid marker remains.
    parsed.data.activeCameraId = sceneCamera
  useScene.getState().updateNode(site.id, { animation: parsed.data })
  useSceneAnimation.setState({ sceneDraft: null, timelineMax: null, message: null })
  sampleScenePlayback(useSceneAnimation.getState().time)
  return true
}
