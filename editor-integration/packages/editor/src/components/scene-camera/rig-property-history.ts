import { sampleScenePlayback, subscribeSceneCommits, useScene } from '@pascal-app/core'
import { installPreviewHistory } from '../../lib/history'
import { useSceneAnimation } from '../scene-animation/store'
import type { RigPropertyEdits } from './rig-property-animation'

type Context = { edits: RigPropertyEdits; time: number; cameraId: string | null }
type Nodes = ReturnType<typeof useScene.getState>['nodes']
type Step = { nodes: Nodes; before: Context; after: Context }

export function bindRigPropertyHistory(store: {
  getState: () => { edits: RigPropertyEdits }
  setState: (state: { edits: RigPropertyEdits }) => void
  subscribe: (callback: () => void) => () => void
}) {
  const past: Step[] = [],
    future: Step[] = []
  const contexts = new WeakMap<Nodes, Context>()
  const capture = (): Context => ({
    edits: store.getState().edits,
    time: useSceneAnimation.getState().time,
    cameraId: useSceneAnimation.getState().cameraId,
  })
  let checkpoint = capture()
  const remember = () => {
    checkpoint = capture()
    contexts.set(useScene.getState().nodes, checkpoint)
  }
  const restore = (context: Context) => {
    const frameChanged = context.time !== useSceneAnimation.getState().time
    if (
      useSceneAnimation.getState().open &&
      context.cameraId === useSceneAnimation.getState().cameraId
    )
      useSceneAnimation.setState({ time: context.time })
    // Restoring a different frame triggers Blender's animation evaluation after memfile undo.
    store.setState({ edits: frameChanged ? {} : context.edits })
    sampleScenePlayback(
      useSceneAnimation.getState().open ? useSceneAnimation.getState().time : null,
    )
    remember()
  }
  const matches = (step: Step | undefined) =>
    !!step &&
    step.nodes === useScene.getState().nodes &&
    useSceneAnimation.getState().open &&
    !useScene.getState().readOnly
  const history = installPreviewHistory({
    canUndo: () => matches(past.at(-1)),
    canRedo: () => matches(future.at(-1)),
    undo() {
      const step = past.pop()!
      future.push(step)
      restore(step.before)
      history.notify()
    },
    redo() {
      const step = future.pop()!
      past.push(step)
      restore(step.after)
      history.notify()
    },
    afterSceneJump() {
      sampleScenePlayback(
        useSceneAnimation.getState().open ? useSceneAnimation.getState().time : null,
      )
    },
  })
  remember()
  const releaseEdits = store.subscribe(history.notify)
  const releaseScene = useScene.subscribe((next, previous) => {
    if (next.nodes === previous.nodes) return
    // Scene undo restores the same immutable node snapshot. Keep its unkeyed RNA edits alongside it.
    const context = contexts.get(next.nodes)
    if (context) restore(context)
    else remember()
  })
  const releaseCommits = subscribeSceneCommits(({ origin }) => {
    future.length = 0
    if (origin === 'load') {
      past.length = 0
      store.setState({ edits: {} })
    }
    remember()
    history.notify()
  })
  return {
    commit: remember,
    record(before: RigPropertyEdits, after: RigPropertyEdits) {
      if (JSON.stringify(before) === JSON.stringify(after)) return
      const context = capture()
      past.push({
        nodes: useScene.getState().nodes,
        before: checkpoint,
        after: { ...context, edits: after },
      })
      if (past.length > 50) past.shift()
      future.length = 0
      useScene.temporal.setState({ futureStates: [] })
      remember()
      history.notify()
    },
    dispose() {
      releaseEdits()
      releaseScene()
      releaseCommits()
      history.dispose()
    },
  }
}
