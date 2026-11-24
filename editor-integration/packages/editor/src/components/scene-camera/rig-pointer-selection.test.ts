import { describe, expect, test } from 'bun:test'
import { SceneCameraNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { _roots, createRoot, events } from '@react-three/fiber'
import { PerspectiveCamera, type WebGLRenderer } from 'three'
import { type RigPointerContinuation, waitForRigPointerSelection } from './rig-pointer-selection'

function pointer(type: string, pointerId = 7, clientX = 10, clientY = 20) {
  return Object.assign(new Event(type, { cancelable: true }), {
    pointerId,
    clientX,
    clientY,
  }) as PointerEvent
}

function key(name: string) {
  return Object.assign(new Event('keydown', { cancelable: true }), { key: name }) as KeyboardEvent
}

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((fulfill, fail) => {
    resolve = fulfill
    reject = fail
  })
  return { promise, resolve, reject }
}

function fixture() {
  const eventTarget = new EventTarget(),
    from = pointer('pointerdown'),
    gpu = deferred<string | null>()
  const calls: string[] = []
  let sequence: RigPointerContinuation | undefined, signal: AbortSignal | undefined
  const wait = waitForRigPointerSelection(from, {
    eventTarget,
    pick: (nextSignal) => {
      signal = nextSignal
      calls.push('pick')
      return gpu.promise
    },
    onWaitingChange: (waiting) => {
      calls.push(`waiting:${waiting}`)
    },
    onHit: (hit, nextSequence) => {
      calls.push(`hit:${hit}`)
      sequence = nextSequence
    },
    onMiss: (nextSequence) => {
      calls.push('miss')
      sequence = nextSequence
    },
    onCancel: (reason) => {
      calls.push(`cancel:${reason}`)
    },
    onError: () => {
      calls.push('error')
    },
  })
  return {
    eventTarget,
    from,
    gpu,
    calls,
    wait,
    get sequence() {
      return sequence
    },
    get signal() {
      return signal!
    },
  }
}

describe('GPU pointer selection handoff', () => {
  test('released pending canvas click cannot reach real R3F miss and clear the scene selection', async () => {
    const savedViewer = useViewer.getState()
    const canvas = new EventTarget() as HTMLCanvasElement,
      node = SceneCameraNode.parse({}),
      camera = new PerspectiveCamera(50, 1, 0.1, 100),
      root = createRoot(canvas),
      gpu = deferred<string | null>()
    camera.position.z = 10
    camera.updateMatrixWorld()
    let cancel = () => {}
    try {
      await root.configure({
        gl: { render() {}, setSize() {}, setPixelRatio() {} } as unknown as WebGLRenderer,
        camera,
        events,
        frameloop: 'never',
        size: { width: 100, height: 100, top: 0, left: 0 },
      })
      const state = _roots.get(canvas)!.store.getState()
      state.onPointerMissed = () => useViewer.getState().setSelection({ selectedIds: [] })
      const from = pointer('pointerdown'),
        up = pointer('pointerup'),
        click = () =>
          Object.assign(new Event('click', { cancelable: true }), {
            button: 0,
            detail: 1,
            pointerId: 7,
            offsetX: 10,
            offsetY: 20,
            clientX: 10,
            clientY: 20,
          }) as PointerEvent
      Object.defineProperty(from, 'target', { value: canvas })
      Object.assign(from, { offsetX: 10, offsetY: 20 })
      state.events.handlers!.onPointerDown(from)
      useViewer.setState({
        selection: { ...savedViewer.selection, selectedIds: [node.id] },
        inputDragging: true,
      })
      state.events.handlers!.onClick(click())
      expect(useViewer.getState().selection.selectedIds).toEqual([])
      useViewer.getState().setSelection({ selectedIds: [node.id] })
      const wait = waitForRigPointerSelection(from, {
        eventTarget: canvas,
        pick: () => gpu.promise,
        onWaitingChange: (value) => useViewer.getState().setInputDragging(value),
        onHit: () => {},
        onMiss: () => {},
      })
      cancel = wait.cancel
      const missedClick = (event: Event) => state.events.handlers!.onClick(event as MouseEvent)
      canvas.addEventListener('click', missedClick)
      canvas.dispatchEvent(up)
      const pendingClick = click()
      canvas.dispatchEvent(pendingClick)
      expect(pendingClick.defaultPrevented).toBe(true)
      expect(useViewer.getState().selection.selectedIds).toEqual([node.id])
      expect(useViewer.getState().inputDragging).toBe(true)
      gpu.resolve('Camera')
      expect(await wait.finished).toEqual({ type: 'hit', hit: 'Camera' })
      const ordinaryClick = click()
      canvas.dispatchEvent(ordinaryClick)
      expect(ordinaryClick.defaultPrevented).toBe(false)
      expect(useViewer.getState().selection.selectedIds).toEqual([])
      canvas.removeEventListener('click', missedClick)
    } finally {
      cancel()
      _roots.delete(canvas)
      useViewer.setState(savedViewer, true)
    }
  })

  test('listeners retain matching travel in order and preserve the latest move and original down', async () => {
    const f = fixture()
    expect(f.calls).toEqual(['waiting:true', 'pick'])
    const other = pointer('pointermove', 8, 100, 200),
      first = pointer('pointermove', 7, 40, 30),
      latest = pointer('pointermove', 7, 60, 80)
    f.eventTarget.dispatchEvent(other)
    f.eventTarget.dispatchEvent(first)
    f.eventTarget.dispatchEvent(latest)
    expect(other.defaultPrevented).toBe(false)
    expect(first.defaultPrevented).toBe(true)
    expect(latest.defaultPrevented).toBe(true)
    f.gpu.resolve('Aim')
    expect(await f.wait.finished).toEqual({ type: 'hit', hit: 'Aim' })
    expect(f.sequence).toMatchObject({ down: f.from, current: latest, release: null })
    expect(f.sequence?.history?.map(({ timeStamp, ...sample }) => sample)).toEqual([
      { clientX: 40, clientY: 30, shiftKey: false, ctrlKey: false },
      { clientX: 60, clientY: 80, shiftKey: false, ctrlKey: false },
    ])
    expect(f.calls).toEqual(['waiting:true', 'pick', 'waiting:false', 'hit:Aim'])
    const later = pointer('pointermove', 7, 300, 400)
    f.eventTarget.dispatchEvent(later)
    expect(later.defaultPrevented).toBe(false)
    expect(f.sequence!.current).toBe(latest)
  })

  test('pending click protection is limited to the released primary pointer on its original surface', async () => {
    const f = fixture(),
      surface = new EventTarget(),
      otherSurface = new EventTarget()
    Object.defineProperty(f.from, 'target', { value: surface })
    const click = (target: EventTarget, pointerId?: number, button = 0, detail = 1) => {
      const event = Object.assign(new Event('click', { cancelable: true }), {
        button,
        detail,
        ...(pointerId === undefined ? {} : { pointerId }),
      })
      Object.defineProperty(event, 'target', { value: target })
      return event
    }
    let passed = 0
    f.eventTarget.addEventListener('click', () => passed++)
    const beforeRelease = click(surface, 7)
    f.eventTarget.dispatchEvent(beforeRelease)
    expect(beforeRelease.defaultPrevented).toBe(false)
    f.eventTarget.dispatchEvent(pointer('pointerup'))
    for (const unrelated of [
      click(otherSurface, 7),
      click(surface, 8),
      click(surface, 7, 1),
      click(surface, 7, 0, 0),
    ]) {
      f.eventTarget.dispatchEvent(unrelated)
      expect(unrelated.defaultPrevented).toBe(false)
    }
    for (const automatic of [click(surface, 7), click(surface)]) {
      f.eventTarget.dispatchEvent(automatic)
      expect(automatic.defaultPrevented).toBe(true)
    }
    expect(passed).toBe(5)
    f.wait.cancel()
    const afterCancel = click(surface, 7)
    f.eventTarget.dispatchEvent(afterCancel)
    expect(afterCancel.defaultPrevented).toBe(false)
    expect(await f.wait.finished).toEqual({ type: 'cancelled', reason: 'cancelled' })
    f.gpu.resolve('Aim')
  })

  test('release before readback is retained for confirmation and freezes the latest drag move', async () => {
    const f = fixture(),
      move = pointer('pointermove', 7, 60, 80),
      up = pointer('pointerup', 7, 60, 80)
    const bubbled: string[] = []
    f.eventTarget.addEventListener('pointerup', () => {
      bubbled.push('up')
    })
    f.eventTarget.dispatchEvent(move)
    f.eventTarget.dispatchEvent(pointer('pointerup', 8))
    expect(bubbled).toEqual(['up'])
    f.eventTarget.dispatchEvent(up)
    expect(up.defaultPrevented).toBe(true)
    expect(bubbled).toEqual(['up'])
    const hover = pointer('pointermove', 7, 400, 500)
    f.eventTarget.dispatchEvent(hover)
    expect(hover.defaultPrevented).toBe(false)
    f.gpu.resolve('Camera')
    expect(await f.wait.finished).toEqual({ type: 'hit', hit: 'Camera' })
    expect(f.sequence).toMatchObject({ down: f.from, current: move, release: up })
    expect(f.sequence?.history).toHaveLength(1)
    expect(f.calls.filter((call) => call === 'waiting:false')).toHaveLength(1)
  })

  test('no hit hands the original released sequence to caller fallback without replaying events', async () => {
    const f = fixture(),
      up = pointer('pointerup'),
      delivered: Event[] = []
    f.eventTarget.addEventListener('pointerdown', (event) => {
      delivered.push(event)
    })
    f.eventTarget.dispatchEvent(up)
    f.gpu.resolve(null)
    expect(await f.wait.finished).toEqual({ type: 'miss' })
    expect(f.calls).toEqual(['waiting:true', 'pick', 'waiting:false', 'miss'])
    expect(f.sequence).toEqual({ down: f.from, current: f.from, release: up })
    expect(delivered).toEqual([])
  })

  test('modifier presses and releases retain their anchored position during GPU waiting', async () => {
    const f = fixture()
    f.eventTarget.dispatchEvent(pointer('pointermove', 7, 50, 20))
    f.eventTarget.dispatchEvent(
      Object.assign(new Event('keydown'), {
        key: 'Shift',
        shiftKey: true,
        ctrlKey: false,
      }),
    )
    f.eventTarget.dispatchEvent(
      Object.assign(pointer('pointermove', 7, 80, 80), { shiftKey: true }),
    )
    f.eventTarget.dispatchEvent(
      Object.assign(new Event('keyup'), {
        key: 'Shift',
        shiftKey: false,
        ctrlKey: false,
      }),
    )
    f.gpu.resolve('Camera')
    await f.wait.finished
    expect(f.sequence?.history?.map(({ timeStamp, ...sample }) => sample)).toEqual([
      { clientX: 50, clientY: 20, shiftKey: false, ctrlKey: false },
      { clientX: 50, clientY: 20, shiftKey: true, ctrlKey: false },
      { clientX: 80, clientY: 80, shiftKey: true, ctrlKey: false },
      { clientX: 80, clientY: 80, shiftKey: false, ctrlKey: false },
    ])
  })

  test('GPU history retains coalesced travel and modifier-event timestamps for speed integration', async () => {
    const f = fixture()
    const timed = <T extends Event>(event: T, timeStamp: number) => {
      Object.defineProperty(event, 'timeStamp', { value: timeStamp })
      return event
    }
    const first = timed(pointer('pointermove', 7, 40, 20), 110)
    const second = timed(pointer('pointermove', 7, 60, 20), 125)
    const latest = timed(pointer('pointermove', 7, 60, 20), 125)
    Object.assign(latest, { getCoalescedEvents: () => [first, second] })
    f.eventTarget.dispatchEvent(latest)
    f.eventTarget.dispatchEvent(timed(Object.assign(key('Shift'), { shiftKey: true }), 140))
    f.eventTarget.dispatchEvent(
      timed(Object.assign(pointer('pointerup'), { shiftKey: false }), 160),
    )
    f.gpu.resolve('Camera')
    await f.wait.finished
    expect(f.sequence?.history).toEqual([
      { clientX: 40, clientY: 20, shiftKey: false, ctrlKey: false, timeStamp: 110 },
      { clientX: 60, clientY: 20, shiftKey: false, ctrlKey: false, timeStamp: 125 },
      { clientX: 60, clientY: 20, shiftKey: true, ctrlKey: false, timeStamp: 140 },
      { clientX: 60, clientY: 20, shiftKey: false, ctrlKey: false, timeStamp: 160 },
    ])
  })

  for (const reason of ['pointercancel', 'escape', 'blur', 'superseded', 'cancelled'] as const)
    test(`${reason} immediately restores waiting state, aborts readback, and ignores late selection`, async () => {
      const f = fixture()
      if (reason === 'pointercancel') f.eventTarget.dispatchEvent(pointer('pointercancel'))
      else if (reason === 'escape') f.eventTarget.dispatchEvent(key('Escape'))
      else if (reason === 'blur') f.eventTarget.dispatchEvent(new Event('blur'))
      else if (reason === 'superseded') f.eventTarget.dispatchEvent(pointer('pointerdown'))
      else f.wait.cancel()
      expect(await f.wait.finished).toEqual({ type: 'cancelled', reason })
      expect(f.signal.aborted).toBe(true)
      expect(f.calls).toEqual(['waiting:true', 'pick', 'waiting:false', `cancel:${reason}`])
      f.gpu.resolve('Aim')
      await Promise.resolve()
      expect(f.sequence).toBeUndefined()
      const move = pointer('pointermove')
      f.eventTarget.dispatchEvent(move)
      expect(move.defaultPrevented).toBe(false)
      f.wait.cancel()
      expect(f.calls.filter((call) => call === 'waiting:false')).toHaveLength(1)
    })

  test('another pointer and ordinary keys cannot cancel the pending selection', async () => {
    const f = fixture()
    f.eventTarget.dispatchEvent(pointer('pointercancel', 8))
    f.eventTarget.dispatchEvent(pointer('pointerdown', 8))
    const enter = key('Enter')
    f.eventTarget.dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(false)
    expect(f.signal.aborted).toBe(false)
    f.gpu.resolve(null)
    expect(await f.wait.finished).toEqual({ type: 'miss' })
  })

  test('GPU failure releases caller state before reporting and never starts a drag', async () => {
    const f = fixture(),
      error = new Error('device lost')
    f.gpu.reject(error)
    expect(await f.wait.finished).toEqual({ type: 'error', error })
    expect(f.calls).toEqual(['waiting:true', 'pick', 'waiting:false', 'error'])
    expect(f.sequence).toBeUndefined()
  })

  test('cancellation finishes immediately even when GPU has not drained its buffer', async () => {
    const f = fixture()
    f.eventTarget.dispatchEvent(pointer('pointerup'))
    f.eventTarget.dispatchEvent(key('Escape'))
    expect(await f.wait.finished).toEqual({ type: 'cancelled', reason: 'escape' })
    f.gpu.reject(new Error('aborted copy'))
    await Promise.resolve()
    expect(f.calls).not.toContain('error')
  })

  test('synchronous selection errors and handoff errors settle without leaked listeners', async () => {
    for (const synchronous of [true, false]) {
      const eventTarget = new EventTarget(),
        error = new Error('handoff'),
        waiting: boolean[] = []
      const wait = waitForRigPointerSelection(pointer('pointerdown'), {
        eventTarget,
        pick: () => {
          if (synchronous) throw error
          return Promise.resolve('Aim')
        },
        onWaitingChange: (value) => {
          waiting.push(value)
        },
        onHit: () => {
          throw error
        },
        onMiss: () => {},
        onError: () => {
          throw new Error('report failure')
        },
      })
      expect((await wait.finished).type).toBe('error')
      expect(waiting).toEqual([true, false])
      const move = pointer('pointermove')
      eventTarget.dispatchEvent(move)
      expect(move.defaultPrevented).toBe(false)
    }
  })
})
