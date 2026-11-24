type Point = { x: number; y: number }

const radians = Math.PI / 180

export function createRigOrbitPointer(initial: Point, initialTime: number) {
  let previous = { ...initial }
  let previousTime = initialTime
  let gain = 0.225
  let measured = false
  let yaw = 0,
    pitch = 0
  return {
    update(point: Point, timeStamp: number): readonly [yaw: number, pitch: number] {
      const dx = point.x - previous.x,
        dy = point.y - previous.y,
        elapsed =
          Number.isFinite(timeStamp - previousTime) && timeStamp > previousTime
            ? timeStamp - previousTime
            : 16
      const speed = Math.hypot(dx, dy) / elapsed
      const fraction = Math.max(0, Math.min(1, (speed - 0.08) / 0.82))
      const target = 0.225 + 1.275 * fraction * fraction * (3 - 2 * fraction)
      // Integrate each segment once; changing speed must never rescale earlier travel.
      if (!measured && (dx || dy)) {
        gain = target
        measured = true
      } else gain += (target - gain) * (1 - Math.exp(-elapsed / 40))
      yaw += dx * gain * radians
      pitch += dy * gain * radians * 0.7
      previous = { ...point }
      previousTime = timeStamp
      return [yaw, pitch]
    },
  }
}
