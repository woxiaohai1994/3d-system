// SPDX-License-Identifier: GPL-2.0-or-later
import source from './rig-constraint-source.json'

export function nextRigConstraint(orientation: number, axis: string | null, key: string) {
  const mask = (value: string | null) =>
    [...(value ?? '')].reduce((bits, name) => bits | (1 << 'XYZ'.indexOf(name)), 0)
  const pressed = ['X', 'Y', 'Z', 'YZ', 'XZ', 'XY'].indexOf(key)
  const [nextOrientation, nextMask] =
    source.transitions[(orientation * 8 + mask(axis)) * 6 + pressed]!
  return {
    orientation: nextOrientation!,
    axis: nextMask ? [...'XYZ'].filter((_, i) => nextMask & (1 << i)).join('') : null,
    space: nextOrientation === 2 ? ('local' as const) : ('world' as const),
  }
}
