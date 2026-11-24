export type RigPointerSample = Readonly<
  Pick<PointerEvent, 'clientX' | 'clientY' | 'shiftKey' | 'ctrlKey' | 'timeStamp'>
>

export type RigPointerContinuation = Readonly<{
  down: PointerEvent
  current: PointerEvent
  release: PointerEvent | null
  history?: readonly RigPointerSample[]
}>

export type RigPointerCancelReason =
  | 'cancelled'
  | 'pointercancel'
  | 'escape'
  | 'blur'
  | 'superseded'

export type RigPointerSelectionOutcome<T> =
  | { type: 'hit'; hit: T }
  | { type: 'miss' }
  | { type: 'cancelled'; reason: RigPointerCancelReason }
  | { type: 'error'; error: unknown }

type Options<T> = {
  eventTarget?: EventTarget
  pick: (signal: AbortSignal) => Promise<T | null>
  onHit: (hit: T, continuation: RigPointerContinuation) => void
  onMiss: (continuation: RigPointerContinuation) => void
  onWaitingChange?: (waiting: boolean) => void
  onCancel?: (reason: RigPointerCancelReason) => void
  onError?: (error: unknown) => void
}

/** Capture a pointer sequence while its frozen GPU selection frame is being read back.
 * The caller owns selection/drag state and transfers the original events without redispatching.
 */
export function waitForRigPointerSelection<T>(from: PointerEvent, options: Options<T>) {
  const target = options.eventTarget ?? window
  const controller = new AbortController()
  let current = from
  let release: PointerEvent | null = null
  let closed = false
  const history: RigPointerSample[] = []
  let modifiers = { shiftKey: from.shiftKey ?? false, ctrlKey: from.ctrlKey ?? false }
  const record = (
    point: Pick<PointerEvent, 'clientX' | 'clientY'>,
    next: Partial<typeof modifiers> & Pick<Event, 'timeStamp'>,
  ) => {
    modifiers = {
      shiftKey: next.shiftKey ?? modifiers.shiftKey,
      ctrlKey: next.ctrlKey ?? modifiers.ctrlKey,
    }
    history.push({
      clientX: point.clientX,
      clientY: point.clientY,
      timeStamp: next.timeStamp,
      ...modifiers,
    })
  }
  let resolve!: (outcome: RigPointerSelectionOutcome<T>) => void
  const finished = new Promise<RigPointerSelectionOutcome<T>>((complete) => {
    resolve = complete
  })
  const listeners: [string, EventListener][] = []
  const detach = () => {
    for (const [type, listener] of listeners) target.removeEventListener(type, listener, true)
  }
  const endWaiting = () => {
    closed = true
    detach()
    // Restore the waiting caller's input state before a drag takes ownership of it.
    options.onWaitingChange?.(false)
  }
  const reportError = (error: unknown) => {
    try {
      options.onError?.(error)
    } catch (handlerError) {
      resolve({ type: 'error', error: handlerError })
      return
    }
    resolve({ type: 'error', error })
  }
  const cancel = (reason: RigPointerCancelReason = 'cancelled') => {
    if (closed) return
    closed = true
    detach()
    controller.abort(reason)
    try {
      options.onWaitingChange?.(false)
      options.onCancel?.(reason)
      resolve({ type: 'cancelled', reason })
    } catch (error) {
      reportError(error)
    }
  }
  const consume = (event: Event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const move = (event: Event) => {
    const pointer = event as PointerEvent
    if (pointer.pointerId !== from.pointerId || release) return
    consume(pointer)
    current = pointer
    const points = pointer.getCoalescedEvents?.()
    for (const point of points?.length ? points : [pointer]) record(point, point)
  }
  const up = (event: Event) => {
    const pointer = event as PointerEvent
    if (pointer.pointerId !== from.pointerId || release) return
    consume(pointer)
    release = pointer
    if (
      (pointer.shiftKey !== undefined && pointer.shiftKey !== modifiers.shiftKey) ||
      (pointer.ctrlKey !== undefined && pointer.ctrlKey !== modifiers.ctrlKey)
    )
      record(current, pointer)
  }
  const click = (event: Event) => {
    const pointer = event as MouseEvent & Partial<PointerEvent>
    if (
      release?.type !== 'pointerup' ||
      pointer.target !== from.target ||
      pointer.button !== 0 ||
      pointer.detail === 0 ||
      (typeof pointer.pointerId === 'number' && pointer.pointerId !== from.pointerId)
    )
      return
    // Prevent this release's automatic click from reaching scene selection before GPU readback.
    consume(pointer)
  }
  const pointerCancel = (event: Event) => {
    if ((event as PointerEvent).pointerId !== from.pointerId) return
    consume(event)
    cancel('pointercancel')
  }
  const key = (event: Event) => {
    const next = event as KeyboardEvent
    if (next.key === 'Shift' || next.key === 'Control') {
      if (!release) record(current, next)
      return
    }
    if (next.key !== 'Escape' || next.type !== 'keydown') return
    consume(event)
    cancel('escape')
  }
  const down = (event: Event) => {
    if (event !== from && (event as PointerEvent).pointerId === from.pointerId) cancel('superseded')
  }
  listeners.push(
    ['pointermove', move],
    ['pointerup', up],
    ['click', click],
    ['pointercancel', pointerCancel],
    ['keydown', key],
    ['keyup', key],
    ['blur', () => cancel('blur')],
    ['pointerdown', down],
  )
  for (const [type, listener] of listeners) target.addEventListener(type, listener, true)
  const complete = (hit: T | null) => {
    if (closed) return
    const continuation = Object.freeze({
      down: from,
      current,
      release,
      ...(history.length ? { history: Object.freeze(history.slice()) } : {}),
    })
    try {
      endWaiting()
      if (hit !== null) {
        options.onHit(hit, continuation)
        resolve({ type: 'hit', hit })
      } else {
        options.onMiss(continuation)
        resolve({ type: 'miss' })
      }
    } catch (error) {
      reportError(error)
    }
  }
  const fail = (error: unknown) => {
    if (closed) return
    try {
      endWaiting()
    } catch (cleanupError) {
      reportError(cleanupError)
      return
    }
    reportError(error)
  }
  try {
    options.onWaitingChange?.(true)
    if (!closed) void options.pick(controller.signal).then(complete, fail)
  } catch (error) {
    fail(error)
  }
  return { cancel, finished }
}
