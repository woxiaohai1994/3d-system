import { subscribeSceneCommits, useScene } from '@pascal-app/core'
import { type SceneAnimationState, useSceneAnimation } from '../scene-animation/store'

type Nodes = ReturnType<typeof useScene.getState>['nodes']
type Context = {
  siteId: string | null
  override: SceneAnimationState['sceneCameraOverride']
}

const siteOf = (nodes: Nodes) => Object.values(nodes).find((node) => node.type === 'site')

export function bindSceneCameraHistory() {
  let contexts = new WeakMap<Nodes, Context>()
  let restoring = false
  let time = useSceneAnimation.getState().time
  let restored: { nodes: Nodes; context: Context } | null = null
  const capture = (): Context => ({
    siteId: siteOf(useScene.getState().nodes)?.id ?? null,
    override: useSceneAnimation.getState().sceneCameraOverride,
  })
  const remember = () => contexts.set(useScene.getState().nodes, capture())
  const restore = (context: Context) => {
    const nodes = useScene.getState().nodes,
      site = siteOf(nodes),
      state = useSceneAnimation.getState()
    const animation =
      (!state.renderingFilm && !state.exporting ? state.sceneDraft : null) ?? site?.animation
    const frame = Math.trunc(state.time * (animation?.fps ?? 24) + 1e-7)
    const activeId = site?.animation?.activeCameraId
    const override =
      context.siteId === site?.id &&
      context.override?.frame === frame &&
      activeId &&
      nodes[activeId as keyof Nodes]?.type === 'scene-camera'
        ? context.override
        : null
    if (state.sceneCameraOverride === override) return
    restoring = true
    try {
      useSceneAnimation.setState({ sceneCameraOverride: override })
    } finally {
      restoring = false
    }
  }
  remember()
  const releaseScene = useScene.subscribe((next, previous) => {
    if (next.hydrationId !== previous.hydrationId) {
      contexts = new WeakMap()
      restored = null
      restore({ siteId: siteOf(next.nodes)?.id ?? null, override: null })
      remember()
      return
    }
    if (next.nodes === previous.nodes) return
    const context = contexts.get(next.nodes)
    if (context) {
      restored = { nodes: next.nodes, context }
      restore(context)
    } else {
      restored = null
      if (siteOf(next.nodes)?.id !== siteOf(previous.nodes)?.id)
        restore({ siteId: siteOf(next.nodes)?.id ?? null, override: null })
      remember()
    }
  })
  const releaseAnimation = useSceneAnimation.subscribe((next, previous) => {
    const currentTime = useSceneAnimation.getState().time
    const frameEvaluation = currentTime !== time || next.time !== previous.time
    time = currentTime
    // Frame evaluation expires the live choice, while Blender's undo snapshot retains it.
    if (!restoring && !frameEvaluation && next.sceneCameraOverride !== previous.sceneCameraOverride)
      remember()
  })
  const releaseTemporal = useScene.temporal.subscribe((next, previous) => {
    if (next.pastStates === previous.pastStates && next.futureStates === previous.futureStates)
      return
    const context = restored
    restored = null
    // Property history may restore the frame in a later scene subscriber before this event.
    if (context?.nodes === useScene.getState().nodes) restore(context.context)
  })
  const releaseCommits = subscribeSceneCommits(({ origin }) => {
    if (origin !== 'load') return
    contexts = new WeakMap()
    restored = null
    useSceneAnimation.setState({ sceneCameraOverride: null })
    remember()
  })
  return () => {
    releaseScene()
    releaseAnimation()
    releaseTemporal()
    releaseCommits()
  }
}
